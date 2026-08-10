/**
 * React glue for the pure signal engine (engine.ts).
 *
 * Owns one long-lived BLE scan and a fixed-rate tick. Scan observations are
 * folded into per-peer state; the tick drives staleness decay and republishes
 * the derived primary {@link BondState} and per-peer debug rows into the store.
 * All the actual math lives in the pure, tested engine — this file only pumps it.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { useEffect, useRef } from 'react';
import { BleScanner, type ScanObservation } from '../ble/scanner';
import { useStore } from '../state/store';
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

export function useBondEngine(enabled: boolean, onScanError?: (e: Error) => void): void {
  const peers = useRef<Map<number, PeerEngineState>>(new Map());
  const scannerRef = useRef<BleScanner | null>(null);
  const lastObsAt = useRef(0);
  const lastScanStartAt = useRef(0);
  const scanErrorRef = useRef<string | null>(null);
  const lastReactionNonceByPeer = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    if (!enabled) return;

    const scanner = new BleScanner();
    scannerRef.current = scanner;
    const localPeerId = useStore.getState().localPeerId;

    const local = () => {
      const s = useStore.getState();
      return { headingDeg: s.localHeadingDeg, accuracy: s.localHeadingAccuracy };
    };

    const onObs = (obs: ScanObservation): void => {
      lastObsAt.current = obs.timestamp;
      if (scanErrorRef.current !== null) {
        scanErrorRef.current = null;
        useStore.getState().setScanError(null); // results flowing again
      }

      // Reaction addressed to us? Fire once per fresh nonce from that sender.
      const p = obs.payload;
      if (p.reactionId !== 0 && p.reactionTarget === localPeerId) {
        if (lastReactionNonceByPeer.current.get(p.peerId) !== p.reactionNonce) {
          lastReactionNonceByPeer.current.set(p.peerId, p.reactionNonce);
          useStore.getState().pushIncomingReaction(p.peerId, p.reactionId);
        }
      }

      const eo = toEngineObservation(obs);
      const prev = peers.current.get(eo.peerId) ?? initPeerEngine(eo.peerId);
      peers.current.set(eo.peerId, ingestObservation(prev, eo, local(), tunablesFromStore()));
    };
    const onErr = (err: Error): void => {
      // Surface the reason (ble-plx reports e.g. location-services-disabled) and
      // let the silence check below restart the scan after the cooldown.
      const msg = err.message || 'scan error';
      if (scanErrorRef.current !== msg) {
        scanErrorRef.current = msg;
        useStore.getState().setScanError(msg);
      }
      onScanError?.(err);
    };

    const startScan = (now: number): void => {
      lastScanStartAt.current = now;
      lastObsAt.current = now; // grace period before the silence check can fire
      scanner.start(onObs, onErr);
    };

    startScan(Date.now());

    const publish = (now: number): void => {
      const t = tunablesFromStore();
      for (const [id, state] of peers.current) {
        const ticked = tickPeer(state, now, t);
        if (isRemoved(ticked)) peers.current.delete(id);
        else peers.current.set(id, ticked);
      }
      const store = useStore.getState();
      const values = [...peers.current.values()];
      store.setBond(selectPrimaryBond(values));
      store.setBonds(selectAllBonds(values));
      store.setPeerRows(values.map((s) => toDebugRow(s, now)));

      // Supervisor: restart a scan that has gone silent (throttle-safe).
      if (now - lastObsAt.current > SCAN_SILENCE_MS && now - lastScanStartAt.current > SCAN_RESTART_COOLDOWN_MS) {
        scanner.stop();
        startScan(now);
      }
    };

    const interval = setInterval(() => publish(Date.now()), TICK_MS);

    return () => {
      clearInterval(interval);
      scanner.destroy();
      scannerRef.current = null;
      peers.current.clear();
    };
  }, [enabled, onScanError]);
}
