import { describe, it, expect } from 'vitest';
import {
  smoothRssi,
  estimateDistance,
  proximityFromDistance,
  DEFAULT_ALPHA,
  DEFAULT_PATH_LOSS_N,
  D_NEAR,
  D_FAR,
} from './rssi.js';

describe('smoothRssi (EMA, dBm domain)', () => {
  it('seeds with the first sample rather than blending toward 0', () => {
    expect(smoothRssi(-63, null)).toBe(-63);
  });

  it('blends toward the newest sample with weight alpha', () => {
    // 0.2 * -50 + 0.8 * -60 = -58
    expect(smoothRssi(-50, -60, 0.2)).toBeCloseTo(-58, 6);
  });

  it('uses DEFAULT_ALPHA when alpha is omitted', () => {
    expect(smoothRssi(-50, -60)).toBeCloseTo(0.2 * -50 + 0.8 * -60, 6);
    expect(DEFAULT_ALPHA).toBe(0.2);
  });

  it('converges toward a constant input stream', () => {
    let s: number | null = null;
    for (let i = 0; i < 100; i++) s = smoothRssi(-70, s);
    expect(s).toBeCloseTo(-70, 3);
  });
});

describe('estimateDistance (log-distance path loss)', () => {
  it('returns exactly 1 m when RSSI equals the peer txPower', () => {
    expect(estimateDistance(-59, -59)).toBeCloseTo(1, 6);
  });

  it('increases as the signal weakens below txPower', () => {
    const near = estimateDistance(-59, -59);
    const far = estimateDistance(-79, -59);
    expect(far).toBeGreaterThan(near);
  });

  it('matches the closed form for a known input', () => {
    // d = 10 ^ ((−59 − (−79)) / (10 · 2.2)) = 10 ^ (20/22)
    expect(estimateDistance(-79, -59, 2.2)).toBeCloseTo(10 ** (20 / 22), 6);
  });

  it('uses the PEER txPower, so different references give different distances', () => {
    const strongRef = estimateDistance(-70, -55); // peer claims -55 @ 1m
    const weakRef = estimateDistance(-70, -63); // peer claims -63 @ 1m
    expect(strongRef).not.toBeCloseTo(weakRef, 3);
    expect(DEFAULT_PATH_LOSS_N).toBe(2.2);
  });
});

describe('proximityFromDistance', () => {
  it('saturates to 1 at or nearer than D_NEAR', () => {
    expect(proximityFromDistance(D_NEAR)).toBe(1);
    expect(proximityFromDistance(0.1)).toBe(1);
  });

  it('is 0 at or beyond D_FAR', () => {
    expect(proximityFromDistance(D_FAR)).toBe(0);
    expect(proximityFromDistance(10)).toBe(0);
  });

  it('is linear in between', () => {
    const mid = (D_NEAR + D_FAR) / 2; // 2.75 m
    expect(proximityFromDistance(mid)).toBeCloseTo(0.5, 6);
  });
});
