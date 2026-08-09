import { describe, it, expect } from 'vitest';
import {
  initPeerEngine,
  ingestObservation,
  tickPeer,
  toDebugRow,
  isRemoved,
  selectPrimaryBond,
  type EngineObservation,
  type EngineTunables,
  type LocalHeading,
} from './engine.js';

const tunables: EngineTunables = {
  alpha: 0.2,
  pathLossN: 2.2,
  dNear: 0.5,
  dFar: 5.0,
  toleranceDeg: 45,
  formThreshold: 0.6,
  breakThreshold: 0.35,
};

const facing: LocalHeading = { headingDeg: 0, accuracy: 3 };

function obs(overrides: Partial<EngineObservation> = {}): EngineObservation {
  return {
    peerId: 0xa3f91c4e,
    rssi: -59, // == txPower → ~1 m
    headingDeg: 180, // opposite the local 0° → aligned
    headingAccuracy: 3,
    txPower: -59,
    hue: 123,
    flags: 0x01,
    sequence: 1,
    timestamp: 0,
    ...overrides,
  };
}

describe('ingestObservation', () => {
  it('derives high proximity and full alignment when close and facing', () => {
    const s = ingestObservation(initPeerEngine(0xa3f91c4e), obs({ timestamp: 0 }), facing, tunables);
    const row = toDebugRow(s, 0);
    expect(row.proximity).toBeGreaterThan(0.8);
    expect(row.alignment).toBe(1);
    expect(row.distanceM).toBeCloseTo(1, 3);
  });

  it('forms a bond only after the dwell time', () => {
    let s = ingestObservation(initPeerEngine(1), obs({ timestamp: 0 }), facing, tunables);
    expect(s.machine.bonded).toBe(false);
    s = ingestObservation(s, obs({ timestamp: 400, sequence: 2 }), facing, tunables);
    expect(s.machine.bonded).toBe(true);
  });

  it('drops alignment when the peer turns away', () => {
    const s = ingestObservation(initPeerEngine(1), obs({ headingDeg: 0 }), facing, tunables);
    expect(toDebugRow(s, 0).alignment).toBe(0); // both facing 0° → not opposed
  });

  it('counts packets per second within the window', () => {
    let s = initPeerEngine(1);
    s = ingestObservation(s, obs({ timestamp: 0 }), facing, tunables);
    s = ingestObservation(s, obs({ timestamp: 200, sequence: 2 }), facing, tunables);
    s = ingestObservation(s, obs({ timestamp: 500, sequence: 3 }), facing, tunables);
    expect(toDebugRow(s, 500).packetsPerSecond).toBe(3);
  });
});

describe('tickPeer — staleness', () => {
  it('removes the peer after 5 s of silence', () => {
    let s = ingestObservation(initPeerEngine(1), obs({ timestamp: 1000 }), facing, tunables);
    s = tickPeer(s, 1000 + 5000, tunables);
    expect(isRemoved(s)).toBe(true);
    expect(selectPrimaryBond([s]).peer).toBeNull();
  });

  it('decays strength during the stale window before removal', () => {
    let s = ingestObservation(initPeerEngine(1), obs({ timestamp: 1000 }), facing, tunables);
    s = ingestObservation(s, obs({ timestamp: 1400, sequence: 2 }), facing, tunables); // bonded
    const strongBefore = s.machine.strength;
    s = tickPeer(s, 1400 + 2000 + 400, tunables); // mid-decay
    expect(s.machine.strength).toBeLessThan(strongBefore);
    expect(s.machine.strength).toBeGreaterThan(0);
  });
});

describe('selectPrimaryBond', () => {
  it('returns the empty bond when there are no peers', () => {
    expect(selectPrimaryBond([])).toEqual({ proximity: 0, alignment: 0, strength: 0, bonded: false, peer: null });
  });

  it('picks the strongest peer', () => {
    const strong = ingestObservation(initPeerEngine(1), obs({ peerId: 1, rssi: -55, timestamp: 0 }), facing, tunables);
    const weak = ingestObservation(initPeerEngine(2), obs({ peerId: 2, rssi: -85, timestamp: 0 }), facing, tunables);
    const primary = selectPrimaryBond([weak, strong]);
    expect(primary.peer?.peerId).toBe(1);
  });
});
