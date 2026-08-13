/**
 * React glue for the pure signal engine (engine.ts).
 *
 * Owns one long-lived BLE scan and a fixed-rate tick. Scan observations are
 * folded into per-peer state; the tick drives staleness decay and republishes
 * the derived primary {@link BondState} and per-peer debug rows into the store.
 * All the actual math lives in the pure, tested engine — this file only pumps it.
 *
 * Interop (GATT) path: when enabled, the SAME scan discovers connectable peers
 * (they advertise the service UUID in their scan response); for peers this device
 * should dial (role tie-break), a GATT connection is opened and its payload
 * notifications feed the very same engine — so a GATT peer and an advertised peer
 * are indistinguishable downstream. No second scan is started.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { useEffect, useRef } from 'react';
import { BleManager } from 'react-native-ble-plx';
import { BleScanner, type ScanObservation } from '../ble/scanner';
import { GattClient } from '../ble/gatt/gattClient';
import { GattMessaging } from '../ble/gatt/gattMessaging';
import { MSG_TYPE } from '../ble/gatt/messaging';
import { utf8Encode, utf8Decode } from '../ble/gatt/utf8';
import { encodeProfile, decodeProfile } from '../ble/gatt/profileCodec';
import { base64ToBytes, bytesToBase64 } from '../ble/base64';
import { useStore } from '../state/store';
import { Sound } from '../audio/sound';
import {
  initPeerEngine,
  ingestObservation,
  tickPeer,
  toDebugRow,
  isRemoved,
  selectPrimaryBond,
  selectAllBonds,
  type EngineObservation,
  type EngineTunables,
  type PeerEngineState,
} from './engine';

const TICK_MS = 100;

function tunablesFromStore(): EngineTunables {
  const s = useStore.getState();
  const t = s.tunables;
  return {
    alpha: t.alpha,
    pathLossN: t.pathLossN,
    dNear: t.dNear,
    dFar: t.dFar,
    toleranceDeg: t.toleranceDeg,
    formThreshold: t.formThreshold,
    breakThreshold: t.breakThreshold,
    // Proximity-only mode pins the alignment floor to 1 so facing never gates the
    // bond; otherwise the tunable value keeps facing as a factor (§3.2).
    alignFloor: s.proximityMode ? 1 : t.alignFloor,
    staleMs: t.staleMs,
    decayMs: t.decayMs,
    removeMs: t.removeMs,
  };
}

function toEngineObservation(obs: ScanObservation): EngineObservation {
  return {
    peerId: obs.payload.peerId,
    rssi: obs.rssi,
    headingDeg: obs.headingDeg,
    headingAccuracy: obs.payload.headingAccuracy,
    txPower: obs.payload.txPower,
    hue: obs.payload.hue,
    flags: obs.payload.flags,
    sequence: obs.payload.sequence,
    timestamp: obs.timestamp,
  };
}

// Scan supervision: some OEMs (notably MIUI/HyperOS) silently stop delivering
// BLE scan results after a while, even in the foreground. If the result stream
// goes quiet for this long, restart the scan — but no more often than the
// cooldown, to stay well under Android's "5 startScan per 30 s" limit.
const SCAN_SILENCE_MS = 12000;
const SCAN_RESTART_COOLDOWN_MS = 20000;

export function useBondEngine(
  enabled: boolean,
  gattEnabled: boolean,
  onScanError?: (e: Error) => void,
): void {
  const peers = useRef<Map<number, PeerEngineState>>(new Map());
  const managerRef = useRef<BleManager | null>(null);
  const scannerRef = useRef<BleScanner | null>(null);
  const gattRef = useRef<GattClient | null>(null);
  const messagingRef = useRef<GattMessaging | null>(null);
  // Peers we've already sent our profile to (per profile version); cleared when
  // our own profile changes so it re-sends.
  const sentProfileTo = useRef<Set<number>>(new Set());
  const lastProfileSig = useRef('');
  const sentPhotoTo = useRef<Set<number>>(new Set());
  const lastPhotoSig = useRef('');
  const localPeerIdRef = useRef(0);
  const lastObsAt = useRef(0);
  const lastScanStartAt = useRef(0);
  const scanErrorRef = useRef<string | null>(null);
  const lastReactionNonceByPeer = useRef<Map<number, number>>(new Map());
  const lastAckNonceByPeer = useRef<Map<number, number>>(new Map());
  // Transport the last observation for each peer arrived over.
  const transportByPeer = useRef<Map<number, 'adv' | 'gatt'>>(new Map());

  // Main effect: scan + publish. Deliberately does NOT depend on gattEnabled, so
  // toggling the interop path never restarts the scan (which MIUI throttles).
  useEffect(() => {
    if (!enabled) return;

    const manager = new BleManager();
    managerRef.current = manager;
    const scanner = new BleScanner(manager);
    scannerRef.current = scanner;
    const localPeerId = useStore.getState().localPeerId;
    localPeerIdRef.current = localPeerId;

    const local = () => {
      const s = useStore.getState();
      return { headingDeg: s.localHeadingDeg, accuracy: s.localHeadingAccuracy };
    };

    // Reactions/acks addressed to us, folded from either transport's payload.
    const handleReactionsAndAcks = (p: ScanObservation['payload'], peerId: number, bonded: boolean): void => {
      if (p.reactionId !== 0 && p.reactionTarget === localPeerId && bonded) {
        if (lastReactionNonceByPeer.current.get(peerId) !== p.reactionNonce) {
          lastReactionNonceByPeer.current.set(peerId, p.reactionNonce);
          useStore.getState().pushIncomingReaction(peerId, p.reactionId, p.reactionNonce);
        }
      }
      if (p.ackTarget === localPeerId && p.ackNonce !== 0) {
        if (lastAckNonceByPeer.current.get(peerId) !== p.ackNonce) {
          lastAckNonceByPeer.current.set(peerId, p.ackNonce);
          if (useStore.getState().recentSentNonces.includes(p.ackNonce)) Sound.delivered();
        }
      }
    };

    // Shared ingest for BOTH transports — the engine can't tell them apart.
    const ingest = (obs: ScanObservation, transport: 'adv' | 'gatt'): PeerEngineState => {
      lastObsAt.current = obs.timestamp;
      if (scanErrorRef.current !== null) {
        scanErrorRef.current = null;
        useStore.getState().setScanError(null);
      }
      const eo = toEngineObservation(obs);
      const prev = peers.current.get(eo.peerId) ?? initPeerEngine(eo.peerId);
      const next = ingestObservation(prev, eo, local(), tunablesFromStore());
      peers.current.set(eo.peerId, next);

      // A GATT-connected peer stays labelled 'gatt' even though its advertisement
      // still arrives — so the HUD shows the connection is doing the work.
      if (transport === 'gatt' || !gattRef.current?.isConnected(eo.peerId)) {
        transportByPeer.current.set(eo.peerId, transport);
      }

      handleReactionsAndAcks(obs.payload, eo.peerId, next.machine.bonded);
      return next;
    };

    const onGattErr = (err: Error): void => {
      // Surface GATT connect failures separately from scan errors so the HUD can
      // show why the interop path isn't connecting (common on old radios).
      useStore.getState().setGattError(err.message || 'gatt error');
    };

    const onAdvObs = (obs: ScanObservation): void => {
      // A manufacturer-data peer is another Android (or the ADV side of any
      // device). We already have its full payload from the advertisement — no
      // GATT connection is needed or wanted here. GATT is only used to reach
      // iPhones, which surface via onGattCandidate (no manufacturer data).
      ingest(obs, 'adv');
    };

    // A peer advertising the Bridge service UUID with no manufacturer data — an
    // iPhone. Android is always the central toward an iPhone (the iPhone can't
    // read us over GATT), so connect and read its payload characteristic.
    const onGattCandidate = (deviceId: string, _rssi: number): void => {
      const gatt = gattRef.current;
      if (gatt) gatt.connectDevice(deviceId, (g) => ingest(g, 'gatt'), onGattErr);
    };

    const onErr = (err: Error): void => {
      const msg = err.message || 'scan error';
      if (scanErrorRef.current !== msg) {
        scanErrorRef.current = msg;
        useStore.getState().setScanError(msg);
      }
      onScanError?.(err);
    };

    const startScan = (now: number): void => {
      lastScanStartAt.current = now;
      lastObsAt.current = now;
      scanner.start(onAdvObs, onErr, onGattCandidate);
    };

    startScan(Date.now());

    const publish = (now: number): void => {
      const t = tunablesFromStore();
      for (const [id, state] of peers.current) {
        const ticked = tickPeer(state, now, t);
        if (isRemoved(ticked)) {
          peers.current.delete(id);
          transportByPeer.current.delete(id);
        } else {
          peers.current.set(id, ticked);
        }
      }
      const store = useStore.getState();
      const values = [...peers.current.values()];
      store.setBond(selectPrimaryBond(values));
      store.setBonds(selectAllBonds(values));
      store.setPeerRows(values.map((s) => toDebugRow(s, now)));

      const gatt = gattRef.current;
      if (gatt) {
        const map: Record<number, 'adv' | 'gatt'> = {};
        for (const [id, tr] of transportByPeer.current) map[id] = tr;
        store.setPeerTransports(map);
        store.setGattStatus({ connections: gatt.activeCount() });
      }

      // Serverless profile exchange (GATT_MESSAGING_SPEC §3): once bonded, push my
      // profile to each peer over GATT so they learn my name/interests with no
      // backend. Sent once per peer per profile-version; a no-op where there's no
      // GATT link (Android↔Android), where Firebase still covers it.
      const messaging = messagingRef.current;
      if (messaging && store.myName) {
        const sig = `${store.myName}|${store.myInterests.join(',')}|${store.myHeadline ?? ''}`;
        if (sig !== lastProfileSig.current) {
          lastProfileSig.current = sig;
          sentProfileTo.current.clear(); // my profile changed → re-send to all
        }
        let bytes: Uint8Array | null = null;
        for (const [pid, state] of peers.current) {
          if (!state.machine.bonded || sentProfileTo.current.has(pid)) continue;
          if (!bytes) {
            bytes = encodeProfile({
              name: store.myName,
              interests: store.myInterests,
              ...(store.myHeadline ? { headline: store.myHeadline } : {}),
            });
          }
          messaging.send(pid, MSG_TYPE.PROFILE, bytes);
          sentProfileTo.current.add(pid);
        }
      }

      // Photo thumbnail — a separate, larger PHOTO message (paced by the transport)
      // so the tiny name PROFILE still shows instantly and the avatar fills in after.
      if (messaging && store.myPhotoThumb) {
        const psig = String(store.myPhotoThumb.length);
        if (psig !== lastPhotoSig.current) {
          lastPhotoSig.current = psig;
          sentPhotoTo.current.clear();
        }
        let photoBytes: Uint8Array | null = null;
        for (const [pid, state] of peers.current) {
          if (!state.machine.bonded || sentPhotoTo.current.has(pid)) continue;
          if (!photoBytes) photoBytes = base64ToBytes(store.myPhotoThumb);
          messaging.send(pid, MSG_TYPE.PHOTO, photoBytes);
          sentPhotoTo.current.add(pid);
        }
      }

      if (now - lastObsAt.current > SCAN_SILENCE_MS && now - lastScanStartAt.current > SCAN_RESTART_COOLDOWN_MS) {
        scanner.stop();
        startScan(now);
      }
    };

    const interval = setInterval(() => publish(Date.now()), TICK_MS);

    return () => {
      clearInterval(interval);
      scanner.stop();
      manager.destroy();
      managerRef.current = null;
      scannerRef.current = null;
      peers.current.clear();
      transportByPeer.current.clear();
    };
  }, [enabled, onScanError]);

  // GATT central lifecycle — SEPARATE effect keyed on gattEnabled, reusing the
  // scan's BleManager. Toggling interop creates/destroys only the GattClient; the
  // advertise + scan loops keep running untouched.
  useEffect(() => {
    if (!enabled || !gattEnabled) return;
    const manager = managerRef.current;
    if (!manager) return; // main effect not mounted yet (shouldn't happen)
    const gatt = new GattClient(manager);
    gattRef.current = gatt;

    // Messaging (GATT_MESSAGING_SPEC): inbound text → chat store; register the
    // outbound sender so the store's sendChat reaches the transport.
    const messaging = new GattMessaging(gatt, () => useStore.getState().localPeerId);
    messagingRef.current = messaging;
    messaging.onMessage((peerId, type, content) => {
      const store = useStore.getState();
      if (type === MSG_TYPE.TEXT) {
        store.pushChatMessage(peerId, 'them', utf8Decode(content));
        // If this peer's chat isn't open, cue the user: a sound + an unread badge.
        if (store.chatPeerId !== peerId) {
          Sound.receive();
          store.bumpUnread(peerId);
        }
      } else if (type === MSG_TYPE.PROFILE) {
        // Serverless identity: a peer sent us their name/interests over GATT.
        const p = decodeProfile(content);
        if (p) store.setPeerProfileFromGatt(peerId, p);
      } else if (type === MSG_TYPE.PHOTO) {
        // Serverless avatar: raw JPEG bytes → a data: URI the UI can render.
        store.setPeerPhotoFromGatt(peerId, `data:image/jpeg;base64,${bytesToBase64(content)}`);
      }
    });
    useStore.getState().registerChatSender((peerId, text) => messaging.send(peerId, MSG_TYPE.TEXT, utf8Encode(text)));

    return () => {
      useStore.getState().registerChatSender(null);
      messaging.stop();
      messagingRef.current = null;
      sentProfileTo.current.clear();
      sentPhotoTo.current.clear();
      gatt.stop();
      if (gattRef.current === gatt) gattRef.current = null;
      useStore.getState().setGattStatus({ connections: 0 });
    };
  }, [enabled, gattEnabled]);
}
