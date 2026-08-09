/**
 * Bond strength: hysteresis + staleness decay — see CLAUDE.md §3.4 and §4.4.
 *
 * This is a pure state machine. Time is injected (`now` in ms) rather than read
 * from a clock, so the whole thing is deterministic and unit-testable with a
 * simulated time source (task P2-7).
 *
 * The machine is fed once per frame with either a fresh sample (a scan result
 * arrived and was turned into proximity/alignment) or `null` (a tick with no new
 * packet, used to drive staleness decay).
 */

/**
 * A peer as seen by the signal/AR layers. Opaque to this module beyond being
 * carried through in {@link BondState}. Identity is `peerId`, never the BLE
 * device address (PAYLOAD_SPEC §4).
 */
export interface PeerSnapshot {
  /** uint32 payload identity — the ONLY stable peer key. */
  peerId: number;
  /** Peer heading in degrees, or `null` if unavailable. */
  heading: number | null;
  /** Peer heading accuracy 0..3. */
  headingAccuracy: number;
  /** Peer's calibrated 1 m txPower (dBm). */
  txPower: number;
  /** Aura colour seed 0..255. */
  hue: number;
  /** Raw flags bitfield. */
  flags: number;
  /** Last advertisement sequence counter seen. */
  sequence: number;
}

/** The single interface every downstream layer reads — CLAUDE.md §3.4. */
export interface BondState {
  proximity: number; // 0..1
  alignment: number; // 0..1
  strength: number; // 0..1, hysteresis-smoothed product
  bonded: boolean; // has crossed the formation threshold
  peer: PeerSnapshot | null;
}

export interface BondConfig {
  /** raw must exceed this (sustained) to form. */
  formThreshold: number;
  /** raw must fall below this (sustained) to break. */
  breakThreshold: number;
  /** Dwell time (ms) a threshold crossing must be sustained. */
  dwellMs: number;
  /** Silence (ms) after which strength begins decaying. */
  staleMs: number;
  /** Duration (ms) over which strength decays to 0 once stale. */
  decayMs: number;
  /** Silence (ms) after which the peer is dropped entirely. */
  removeMs: number;
}

export const DEFAULT_BOND_CONFIG: BondConfig = {
  formThreshold: 0.6,
  breakThreshold: 0.35,
  dwellMs: 400,
  staleMs: 2000,
  decayMs: 800,
  removeMs: 5000,
};

/** Internal machine state. Immutable-style: {@link stepBond} returns a new object. */
export interface BondMachine {
  bonded: boolean;
  strength: number;
  proximity: number;
  alignment: number;
  /** When `raw` first rose above formThreshold continuously; null otherwise. */
  aboveSince: number | null;
  /** When `raw` first fell below breakThreshold continuously; null otherwise. */
  belowSince: number | null;
  /** Timestamp of the last fresh sample, or null if never/removed. */
  lastPacketAt: number | null;
  /** Strength at the last fresh sample — the value staleness decays from. */
  lastFreshStrength: number;
  peer: PeerSnapshot | null;
}

export function initBondMachine(): BondMachine {
  return {
    bonded: false,
    strength: 0,
    proximity: 0,
    alignment: 0,
    aboveSince: null,
    belowSince: null,
    lastPacketAt: null,
    lastFreshStrength: 0,
    peer: null,
  };
}

/** A fresh signal sample derived from a scan result. */
export interface BondSample {
  proximity: number; // 0..1
  alignment: number; // 0..1
  peer: PeerSnapshot;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Advance the machine by one frame.
 *
 * @param state   previous machine state (not mutated)
 * @param now     current time in ms (monotonic; injected for testability)
 * @param sample  a fresh sample, or `null` for a tick with no new packet
 * @param config  thresholds/timings (defaults to {@link DEFAULT_BOND_CONFIG})
 */
export function stepBond(
  state: BondMachine,
  now: number,
  sample: BondSample | null,
  config: BondConfig = DEFAULT_BOND_CONFIG,
): BondMachine {
  const next: BondMachine = { ...state };

  if (sample !== null) {
    const proximity = clamp01(sample.proximity);
    const alignment = clamp01(sample.alignment);
    const raw = clamp01(proximity * alignment);

    next.proximity = proximity;
    next.alignment = alignment;
    next.peer = sample.peer;
    next.lastPacketAt = now;
    next.strength = raw;
    next.lastFreshStrength = raw;

    if (raw > config.formThreshold) {
      next.belowSince = null;
      next.aboveSince = state.aboveSince ?? now;
      if (!next.bonded && now - next.aboveSince >= config.dwellMs) {
        next.bonded = true;
      }
    } else if (raw < config.breakThreshold) {
      next.aboveSince = null;
      next.belowSince = state.belowSince ?? now;
      if (next.bonded && now - next.belowSince >= config.dwellMs) {
        next.bonded = false;
      }
    } else {
      // Between thresholds: hold current bonded state, reset dwell timers so a
      // future crossing must sustain afresh.
      next.aboveSince = null;
      next.belowSince = null;
    }
    return next;
  }

  // Tick with no fresh packet — drive staleness.
  if (state.lastPacketAt === null) {
    return next; // no peer has ever been seen
  }

  const silence = now - state.lastPacketAt;

  if (silence >= config.removeMs) {
    // Peer gone: reset to a clean slate.
    return initBondMachine();
  }

  if (silence > config.staleMs) {
    const t = (silence - config.staleMs) / config.decayMs;
    next.strength = t >= 1 ? 0 : state.lastFreshStrength * (1 - t);
    if (next.strength === 0) {
      next.bonded = false;
      next.aboveSince = null;
      next.belowSince = null;
    }
    return next;
  }

  // Within the stale grace window: hold last known strength and bonded state.
  next.strength = state.lastFreshStrength;
  return next;
}

/** Project the machine onto the public {@link BondState}. */
export function toBondState(state: BondMachine): BondState {
  return {
    proximity: state.proximity,
    alignment: state.alignment,
    strength: state.strength,
    bonded: state.bonded,
    peer: state.peer,
  };
}
