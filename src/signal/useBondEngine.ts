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
import { BleScanner, type ScanObservation } from '../ble/scanner.js';
import { useStore } from '../state/store.js';
import {
  initPeerEngine,
  ingestObservation,
  tickPeer,
  toDebugRow,
  isRemoved,
  selectPrimaryBond,
  type EngineObservation,
  type EngineTunables,
  type PeerEngineState,
} from './engine.js';

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

export function useBondEngine(enabled: boolean, onScanError?: (e: Error) => void): void {
  const peers = useRef<Map<number, PeerEngineState>>(new Map());
  const scannerRef = useRef<BleScanner | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const scanner = new BleScanner();
    scannerRef.current = scanner;

    const local = () => {
      const s = useStore.getState();
      return { headingDeg: s.localHeadingDeg, accuracy: s.localHeadingAccuracy };
    };

    scanner.start(
      (obs) => {
        const eo = toEngineObservation(obs);
        const prev = peers.current.get(eo.peerId) ?? initPeerEngine(eo.peerId);
        peers.current.set(eo.peerId, ingestObservation(prev, eo, local(), tunablesFromStore()));
      },
      (err) => onScanError?.(err),
    );

    const publish = (now: number): void => {
      const t = tunablesFromStore();
      for (const [id, state] of peers.current) {
        const ticked = tickPeer(state, now, t);
        if (isRemoved(ticked)) peers.current.delete(id);
        else peers.current.set(id, ticked);
      }
      const store = useStore.getState();
      store.setBond(selectPrimaryBond(peers.current.values()));
      store.setPeerRows([...peers.current.values()].map((s) => toDebugRow(s, now)));
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
