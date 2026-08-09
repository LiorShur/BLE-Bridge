/**
 * Zustand store — the single source of shared UI state (CLAUDE.md §5).
 *
 * Holds the local device identity/heading, the tunable signal constants exposed
 * to the debug HUD, the derived primary {@link BondState} the AR scene reads, and
 * per-peer debug rows. The signal engine writes; the AR scene and HUD read.
 *
 * NOTE: depends on `zustand`; not part of the pure-logic test suite.
 */
import { create } from 'zustand';
import type { BondState } from '../signal/bond';
import type { PeerDebugRow } from '../signal/engine';
import type { SupportReport } from '../ble/advertiser';
import { getSessionPeerId } from '../ble/identity';
import { DEFAULT_ALPHA, DEFAULT_PATH_LOSS_N, D_NEAR, D_FAR } from '../signal/rssi';
import { DEFAULT_TOLERANCE } from '../signal/alignment';
import { DEFAULT_BOND_CONFIG } from '../signal/bond';
import { DEFAULT_TX_POWER } from '../calibration';

/** On-device tunable constants (HUD sliders, TASKS.md P2-8). */
export interface Tunables {
  alpha: number;
  pathLossN: number;
  dNear: number;
  dFar: number;
  toleranceDeg: number;
  formThreshold: number;
  breakThreshold: number;
  /** Alignment floor (0..1): proximity-led bonding, facing is a bonus. */
  alignFloor: number;
  /** Staleness window (ms) before the bridge starts fading. */
  staleMs: number;
  /** Fade duration (ms) once stale. */
  decayMs: number;
  /** Silence (ms) before the peer is dropped entirely. */
  removeMs: number;
}

export const DEFAULT_TUNABLES: Tunables = {
  alpha: DEFAULT_ALPHA,
  pathLossN: DEFAULT_PATH_LOSS_N,
  dNear: D_NEAR,
  dFar: D_FAR,
  toleranceDeg: DEFAULT_TOLERANCE,
  // Looser than the spec's 0.60/0.35 so bonding happens at a comfortable ~1–2 m
  // and survives movement instead of only at a few cm (field feedback).
  formThreshold: 0.5,
  breakThreshold: 0.3,
  // Proximity-led: a noisy/averted compass can't zero the bond; facing adds up
  // to the remaining 50%.
  alignFloor: 0.5,
  // Real-world tolerant staleness (looser than the spec's 2/0.8/5 s) so brief
  // radio gaps and duplicate-suppressing scanners don't collapse the bridge.
  staleMs: 4000,
  decayMs: 1500,
  removeMs: 10000,
};

export type { PeerDebugRow } from '../signal/engine';

const EMPTY_BOND: BondState = {
  proximity: 0,
  alignment: 0,
  strength: 0,
  bonded: false,
  peer: null,
};

export interface AppState {
  capability: SupportReport | null;
  localPeerId: number;
  localTxPower: number;
  localHeadingDeg: number | null;
  localHeadingAccuracy: number;
  hue: number;
  tunables: Tunables;
  /** Primary (strongest) peer projection. */
  bond: BondState;
  /** All active peers, strongest first — the multi-peer view the UI renders. */
  bonds: BondState[];
  peerRows: PeerDebugRow[];
  /** Whether this device is currently advertising, and last advertiser error. */
  advertising: boolean;
  advertiserError: string | null;
  /** Last BLE scan error (e.g. location services disabled), cleared on results. */
  scanError: string | null;
  hudVisible: boolean;

  setCapability: (report: SupportReport) => void;
  setLocalTxPower: (dbm: number) => void;
  setLocalHeading: (headingDeg: number | null, accuracy: number) => void;
  setTunable: <K extends keyof Tunables>(key: K, value: Tunables[K]) => void;
  setBond: (bond: BondState) => void;
  setBonds: (bonds: BondState[]) => void;
  setPeerRows: (rows: PeerDebugRow[]) => void;
  setAdvertiserStatus: (advertising: boolean, error: string | null) => void;
  setScanError: (error: string | null) => void;
  toggleHud: () => void;
}

/** A stable per-install hue derived from the session peer id. */
function hueForPeer(peerId: number): number {
  return peerId & 0xff;
}

export const useStore = create<AppState>((set) => {
  const localPeerId = getSessionPeerId();
  return {
    capability: null,
    localPeerId,
    localTxPower: DEFAULT_TX_POWER,
    localHeadingDeg: null,
    localHeadingAccuracy: 0,
    hue: hueForPeer(localPeerId),
    tunables: DEFAULT_TUNABLES,
    bond: EMPTY_BOND,
    bonds: [],
    peerRows: [],
    advertising: false,
    advertiserError: null,
    scanError: null,
    hudVisible: false,

    setCapability: (report) => set({ capability: report }),
    setLocalTxPower: (dbm) => set({ localTxPower: dbm }),
    setLocalHeading: (headingDeg, accuracy) =>
      set({ localHeadingDeg: headingDeg, localHeadingAccuracy: accuracy }),
    setTunable: (key, value) => set((s) => ({ tunables: { ...s.tunables, [key]: value } })),
    setBond: (bond) => set({ bond }),
    setBonds: (bonds) => set({ bonds }),
    setPeerRows: (rows) => set({ peerRows: rows }),
    setAdvertiserStatus: (advertising, error) => set({ advertising, advertiserError: error }),
    setScanError: (error) => set({ scanError: error }),
    toggleHud: () => set((s) => ({ hudVisible: !s.hudVisible })),
  };
});
