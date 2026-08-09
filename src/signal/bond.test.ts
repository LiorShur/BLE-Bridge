import { describe, it, expect } from 'vitest';
import {
  initBondMachine,
  stepBond,
  toBondState,
  DEFAULT_BOND_CONFIG,
  type BondMachine,
  type BondSample,
  type PeerSnapshot,
} from './bond.js';

const peer: PeerSnapshot = {
  peerId: 0xa3f91c4e,
  heading: 180,
  headingAccuracy: 3,
  txPower: -59,
  hue: 123,
  flags: 0x01,
  sequence: 0,
};

function sample(proximity: number, alignment: number): BondSample {
  return { proximity, alignment, peer };
}

/** raw = 0.81 → above formThreshold (0.6). */
const STRONG = sample(0.9, 0.9);
/** raw = 0.18 → below breakThreshold (0.35). */
const WEAK = sample(0.2, 0.9);
/** raw = 0.45 → between the thresholds. */
const MID = sample(0.5, 0.9);

describe('hysteresis — formation', () => {
  it('does not form on a single strong frame', () => {
    const s = stepBond(initBondMachine(), 0, STRONG);
    expect(s.bonded).toBe(false);
  });

  it('does not form before the dwell time elapses', () => {
    let s = stepBond(initBondMachine(), 0, STRONG);
    s = stepBond(s, 399, STRONG);
    expect(s.bonded).toBe(false);
  });

  it('forms once strong is sustained for the dwell time', () => {
    let s = stepBond(initBondMachine(), 0, STRONG);
    s = stepBond(s, 400, STRONG);
    expect(s.bonded).toBe(true);
    expect(toBondState(s).strength).toBeCloseTo(0.81, 6);
  });

  it('resets the dwell timer if strength dips between thresholds', () => {
    let s = stepBond(initBondMachine(), 0, STRONG);
    s = stepBond(s, 200, MID); // interrupts the sustained crossing
    s = stepBond(s, 400, STRONG); // aboveSince restarts at 400
    expect(s.bonded).toBe(false);
    s = stepBond(s, 800, STRONG);
    expect(s.bonded).toBe(true);
  });
});

describe('hysteresis — break', () => {
  function bonded(): BondMachine {
    let s = stepBond(initBondMachine(), 0, STRONG);
    s = stepBond(s, 400, STRONG);
    expect(s.bonded).toBe(true);
    return s;
  }

  it('does not break on a single weak frame', () => {
    let s = bonded();
    s = stepBond(s, 500, WEAK);
    expect(s.bonded).toBe(true);
  });

  it('breaks once weak is sustained for the dwell time', () => {
    let s = bonded();
    s = stepBond(s, 500, WEAK);
    s = stepBond(s, 900, WEAK); // 400 ms below break
    expect(s.bonded).toBe(false);
  });

  it('holds bonded indefinitely while strength sits between thresholds', () => {
    let s = bonded();
    for (let t = 500; t <= 5000; t += 100) {
      s = stepBond(s, t, MID);
    }
    expect(s.bonded).toBe(true); // never crossed the break threshold
  });
});

describe('staleness — decay and removal', () => {
  function freshAt1000(): BondMachine {
    let s = stepBond(initBondMachine(), 0, STRONG);
    s = stepBond(s, 400, STRONG); // bonded, strength 0.81
    s = stepBond(s, 1000, STRONG); // last packet at t=1000
    return s;
  }

  it('holds strength during the stale grace window', () => {
    let s = freshAt1000();
    s = stepBond(s, 1000 + 1999, null); // silence 1999 < 2000
    expect(s.strength).toBeCloseTo(0.81, 6);
    expect(s.peer).not.toBeNull();
  });

  it('decays strength linearly once stale', () => {
    let s = freshAt1000();
    s = stepBond(s, 1000 + 2000 + 400, null); // halfway through the 800 ms decay
    expect(s.strength).toBeCloseTo(0.81 * 0.5, 6);
  });

  it('reaches zero strength and drops bonded at the end of decay', () => {
    let s = freshAt1000();
    s = stepBond(s, 1000 + 2000 + 800, null);
    expect(s.strength).toBe(0);
    expect(s.bonded).toBe(false);
    expect(s.peer).not.toBeNull(); // still present, just faded
  });

  it('removes the peer entirely after removeMs of silence', () => {
    let s = freshAt1000();
    s = stepBond(s, 1000 + DEFAULT_BOND_CONFIG.removeMs, null);
    expect(s.peer).toBeNull();
    expect(s.strength).toBe(0);
    expect(s.bonded).toBe(false);
    expect(s.lastPacketAt).toBeNull();
  });

  it('a fresh packet during decay restores full strength', () => {
    let s = freshAt1000();
    s = stepBond(s, 1000 + 2000 + 400, null); // decaying
    expect(s.strength).toBeLessThan(0.81);
    s = stepBond(s, 1000 + 2000 + 500, STRONG); // packet arrives
    expect(s.strength).toBeCloseTo(0.81, 6);
    expect(s.peer).not.toBeNull();
  });
});

describe('ticks with no peer ever seen', () => {
  it('stays at zero strength with a null peer', () => {
    const s = stepBond(initBondMachine(), 5000, null);
    expect(s.strength).toBe(0);
    expect(s.peer).toBeNull();
    expect(s.bonded).toBe(false);
  });
});

describe('toBondState projection', () => {
  it('carries the public five-field contract', () => {
    let s = stepBond(initBondMachine(), 0, STRONG);
    s = stepBond(s, 400, STRONG);
    const state = toBondState(s);
    expect(state).toEqual({
      proximity: 0.9,
      alignment: 0.9,
      strength: expect.closeTo(0.81, 6),
      bonded: true,
      peer,
    });
  });
});
