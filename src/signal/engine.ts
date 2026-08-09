/**
 * Per-peer signal reduction — PURE and unit-tested.
 *
 * Fuses a scan observation with the local heading into the numbers the AR layer
 * reads: smoothed RSSI → distance → proximity, mutual heading → alignment, then
 * the hysteresis/staleness bond machine. This is the orchestration that ties
 * together rssi.ts, alignment.ts, and bond.ts; keeping it free of React/RN means
 * the whole fusion can be proven off-device.
 *
 * `useBondEngine.ts` is the thin React wrapper that pumps scan results and a
 * timer tick through these functions and writes the store.
 */
import { smoothRssi, estimateDistance, proximityFromDistance } from './rssi';
import { computeAlignment } from './alignment';
import {
  initBondMachine,
  stepBond,
  toBondState,
  DEFAULT_BOND_CONFIG,
  type BondMachine,
  type BondState,
  type PeerSnapshot,
} from './bond';

export interface EngineTunables {
  alpha: number;
  pathLossN: number;
  dNear: number;
  dFar: number;
  toleranceDeg: number;
  formThreshold: number;
  breakThreshold: number;
  /**
   * Floor applied to alignment before it multiplies proximity, 0..1. With a
   * floor, a noisy/averted compass can't zero the bond — proximity leads and
   * facing is a bonus. 0 = strict spec (raw = proximity·alignment); 0.5 =
   * proximity-led. Defaults to 0 so the pure engine tests keep the strict rule.
   */
  alignFloor?: number;
  /** Optional staleness overrides; default to DEFAULT_BOND_CONFIG when omitted. */
  staleMs?: number;
  decayMs?: number;
  removeMs?: number;
}

/** A decoded peer advertisement as the engine consumes it. */
export interface EngineObservation {
  peerId: number;
  rssi: number;
  headingDeg: number | null;
  headingAccuracy: number;
  txPower: number;
  hue: number;
  flags: number;
  sequence: number;
  timestamp: number;
}

export interface LocalHeading {
  headingDeg: number | null;
  accuracy: number;
}

export interface PeerEngineState {
  peerId: number;
  machine: BondMachine;
  smoothedRssi: number | null;
  lastRssi: number;
  lastDistanceM: number;
  recentPacketTimes: number[];
  lastSeen: number;
}

/** HUD-facing snapshot of one peer's full signal chain. */
export interface PeerDebugRow {
  peerId: number;
  rssi: number;
  smoothedRssi: number;
  distanceM: number;
  proximity: number;
  alignment: number;
  raw: number;
  strength: number;
  bonded: boolean;
  headingDeg: number | null;
  headingAccuracy: number;
  txPower: number;
  hue: number;
  flags: number;
  sequence: number;
  packetsPerSecond: number;
  ageMs: number;
}

const PPS_WINDOW_MS = 1000;

export function initPeerEngine(peerId: number): PeerEngineState {
  return {
    peerId,
    machine: initBondMachine(),
    smoothedRssi: null,
    lastRssi: 0,
    lastDistanceM: Number.POSITIVE_INFINITY,
    recentPacketTimes: [],
    lastSeen: 0,
  };
}

function bondConfig(t: EngineTunables) {
  return {
    ...DEFAULT_BOND_CONFIG,
    formThreshold: t.formThreshold,
    breakThreshold: t.breakThreshold,
    staleMs: t.staleMs ?? DEFAULT_BOND_CONFIG.staleMs,
    decayMs: t.decayMs ?? DEFAULT_BOND_CONFIG.decayMs,
    removeMs: t.removeMs ?? DEFAULT_BOND_CONFIG.removeMs,
  };
}

/** Fold a fresh observation into a peer's state. */
export function ingestObservation(
  prev: PeerEngineState,
  obs: EngineObservation,
  local: LocalHeading,
  tunables: EngineTunables,
): PeerEngineState {
  const smoothedRssi = smoothRssi(obs.rssi, prev.smoothedRssi, tunables.alpha);
  const distanceM = estimateDistance(smoothedRssi, obs.txPower, tunables.pathLossN);
  const proximity = proximityFromDistance(distanceM, tunables.dNear, tunables.dFar);
  const rawAlignment = computeAlignment({
    headingA: local.headingDeg,
    headingB: obs.headingDeg,
    accuracyA: local.accuracy,
    accuracyB: obs.headingAccuracy,
    tolerance: tunables.toleranceDeg,
  });
  // Floor alignment so a jittery/averted compass can't collapse the bond.
  const floor = tunables.alignFloor ?? 0;
  const alignment = floor + (1 - floor) * rawAlignment;

  const peer: PeerSnapshot = {
    peerId: obs.peerId,
    heading: obs.headingDeg,
    headingAccuracy: obs.headingAccuracy,
    txPower: obs.txPower,
    hue: obs.hue,
    flags: obs.flags,
    sequence: obs.sequence,
  };

  const machine = stepBond(prev.machine, obs.timestamp, { proximity, alignment, peer }, bondConfig(tunables));

  const recentPacketTimes = [...prev.recentPacketTimes, obs.timestamp].filter(
    (t) => obs.timestamp - t < PPS_WINDOW_MS,
  );

  return {
    peerId: obs.peerId,
    machine,
    smoothedRssi,
    lastRssi: obs.rssi,
    lastDistanceM: distanceM,
    recentPacketTimes,
    lastSeen: obs.timestamp,
  };
}

/** Advance a peer with no fresh packet (staleness decay / removal). */
export function tickPeer(prev: PeerEngineState, now: number, tunables: EngineTunables): PeerEngineState {
  const machine = stepBond(prev.machine, now, null, bondConfig(tunables));
  const recentPacketTimes = prev.recentPacketTimes.filter((t) => now - t < PPS_WINDOW_MS);
  return { ...prev, machine, recentPacketTimes };
}

/** True once the peer has been dropped by the bond machine (5 s of silence). */
export function isRemoved(state: PeerEngineState): boolean {
  return state.machine.peer === null && state.machine.lastPacketAt === null;
}

export function toDebugRow(state: PeerEngineState, now: number): PeerDebugRow {
  const m = state.machine;
  const proximity = m.proximity;
  const alignment = m.alignment;
  return {
    peerId: state.peerId,
    rssi: state.lastRssi,
    smoothedRssi: state.smoothedRssi ?? state.lastRssi,
    distanceM: state.lastDistanceM,
    proximity,
    alignment,
    raw: proximity * alignment,
    strength: m.strength,
    bonded: m.bonded,
    headingDeg: m.peer?.heading ?? null,
    headingAccuracy: m.peer?.headingAccuracy ?? 0,
    txPower: m.peer?.txPower ?? 0,
    hue: m.peer?.hue ?? 0,
    flags: m.peer?.flags ?? 0,
    sequence: m.peer?.sequence ?? 0,
    packetsPerSecond: state.recentPacketTimes.length,
    ageMs: state.lastSeen === 0 ? 0 : now - state.lastSeen,
  };
}

/**
 * Pick the primary peer — the strongest current bond — and project it to a
 * {@link BondState}. The UI assumes a single peer (CLAUDE.md non-goals) even
 * though discovery handles N. Ties break on proximity.
 */
export function selectPrimaryBond(states: Iterable<PeerEngineState>): BondState {
  let best: PeerEngineState | null = null;
  for (const s of states) {
    if (s.machine.peer === null) continue;
    if (
      best === null ||
      s.machine.strength > best.machine.strength ||
      (s.machine.strength === best.machine.strength && s.machine.proximity > best.machine.proximity)
    ) {
      best = s;
    }
  }
  return best ? toBondState(best.machine) : { proximity: 0, alignment: 0, strength: 0, bonded: false, peer: null };
}

/**
 * Project every active peer to a {@link BondState}, strongest first. This is the
 * multi-peer view (owner scope change 2026-08-09): the UI renders one bridge per
 * returned entry. Removed peers (no snapshot) are omitted.
 */
export function selectAllBonds(states: Iterable<PeerEngineState>): BondState[] {
  const active: PeerEngineState[] = [];
  for (const s of states) {
    if (s.machine.peer !== null) active.push(s);
  }
  active.sort((a, b) => {
    if (b.machine.strength !== a.machine.strength) return b.machine.strength - a.machine.strength;
    return b.machine.proximity - a.machine.proximity;
  });
  return active.map((s) => toBondState(s.machine));
}
