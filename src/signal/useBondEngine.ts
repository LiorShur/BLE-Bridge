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
import { shouldInitiateConnection } from '../ble/gatt/constants';
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
  const t = useStore.getState().tunables;
  return {
    alpha: t.alpha,
    pathLossN: t.pathLossN,
    dNear: t.dNear,
    dFar: t.dFar,
    toleranceDeg: t.toleranceDeg,
    formThreshold: t.formThreshold,
    breakThreshold: t.breakThreshold,
    alignFloor: t.alignFloor,
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
  const lastObsAt = useRef(0);
  const lastScanStartAt = useRef(0);
  const scanErrorRef = useRef<string | null>(null);
  const lastReactionNonceByPeer = useRef<Map<number, number>>(new Map());
  const lastAckNonceByPeer = useRef<Map<number, number>>(new Map());
  // Transport the last observation for each peer arrived over.
  const transportByPeer = useRef<Map<number, 'adv' | 'gatt'>>(new Map());

  useEffect(() => {
    if (!enabled) return;

    const manager = new BleManager();
    managerRef.current = manager;
    const scanner = new BleScanner(manager);
    scannerRef.current = scanner;
    const gatt = gattEnabled ? new GattClient(manager) : null;
    gattRef.current = gatt;
    const localPeerId = useStore.getState().localPeerId;

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
    const ingest = (obs: ScanObservation, transport: 'adv' | 'gatt'): void => {
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
      if (transport === 'gatt' || !(gatt?.isConnected(eo.peerId))) {
        transportByPeer.current.set(eo.peerId, transport);
      }

      handleReactionsAndAcks(obs.payload, eo.peerId, next.machine.bonded);
    };

    const onGattErr = (err: Error): void => {
      // Surface GATT connect failures separately from scan errors so the HUD can
      // show why the interop path isn't connecting (common on old radios).
      useStore.getState().setGattError(err.message || 'gatt error');
    };

    const onAdvObs = (obs: ScanObservation): void => {
      ingest(obs, 'adv');
      // Interop: dial peers we should be central for (lower peerId dials).
      if (gatt && shouldInitiateConnection(localPeerId, obs.payload.peerId)) {
        gatt.ensureConnected(obs.deviceId, obs.payload.peerId, (g) => ingest(g, 'gatt'), onGattErr);
      }
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
      scanner.start(onAdvObs, onErr);
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

      if (gatt) {
        const map: Record<number, 'adv' | 'gatt'> = {};
        for (const [id, tr] of transportByPeer.current) map[id] = tr;
        store.setPeerTransports(map);
        store.setGattStatus({ connections: gatt.activeCount() });
      }

      if (now - lastObsAt.current > SCAN_SILENCE_MS && now - lastScanStartAt.current > SCAN_RESTART_COOLDOWN_MS) {
        scanner.stop();
        startScan(now);
      }
    };

    const interval = setInterval(() => publish(Date.now()), TICK_MS);

    return () => {
      clearInterval(interval);
      gatt?.stop();
      scanner.stop();
      manager.destroy();
      managerRef.current = null;
      scannerRef.current = null;
      gattRef.current = null;
      peers.current.clear();
      transportByPeer.current.clear();
    };
  }, [enabled, gattEnabled, onScanError]);
}
