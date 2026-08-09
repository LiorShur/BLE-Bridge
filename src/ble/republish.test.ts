import { describe, it, expect } from 'vitest';
import { shouldRepublish, angularDeltaDeg, DEFAULT_REPUBLISH_CONFIG } from './republish';

const baseInput = {
  prevHeadingDeg: 100 as number | null,
  nextHeadingDeg: 100 as number | null,
  msSinceLastPublish: 0,
  hasPublished: true,
};

describe('angularDeltaDeg', () => {
  it('is 0 for identical headings', () => {
    expect(angularDeltaDeg(90, 90)).toBe(0);
  });
  it('takes the short way around the circle', () => {
    expect(angularDeltaDeg(359, 1)).toBeCloseTo(2, 6);
    expect(angularDeltaDeg(10, 350)).toBeCloseTo(20, 6);
  });
  it('maxes at 180', () => {
    expect(angularDeltaDeg(0, 180)).toBeCloseTo(180, 6);
  });
});

describe('shouldRepublish', () => {
  it('always publishes the first time', () => {
    expect(shouldRepublish({ ...baseInput, hasPublished: false })).toBe(true);
  });

  it('heartbeats at the max interval', () => {
    expect(shouldRepublish({ ...baseInput, msSinceLastPublish: DEFAULT_REPUBLISH_CONFIG.maxIntervalMs })).toBe(true);
  });

  it('does not republish for a sub-threshold heading change', () => {
    expect(shouldRepublish({ ...baseInput, prevHeadingDeg: 100, nextHeadingDeg: 103, msSinceLastPublish: 200 })).toBe(false);
  });

  it('republishes for a heading change beyond the threshold', () => {
    expect(shouldRepublish({ ...baseInput, prevHeadingDeg: 100, nextHeadingDeg: 110, msSinceLastPublish: 200 })).toBe(true);
  });

  it('treats the short way around the circle correctly', () => {
    // 359 -> 1 is only 2°, below threshold
    expect(shouldRepublish({ ...baseInput, prevHeadingDeg: 359, nextHeadingDeg: 1, msSinceLastPublish: 200 })).toBe(false);
  });

  it('republishes when heading availability flips', () => {
    expect(shouldRepublish({ ...baseInput, prevHeadingDeg: null, nextHeadingDeg: 100, msSinceLastPublish: 200 })).toBe(true);
    expect(shouldRepublish({ ...baseInput, prevHeadingDeg: 100, nextHeadingDeg: null, msSinceLastPublish: 200 })).toBe(true);
  });

  it('does not republish when heading stays unavailable within the interval', () => {
    expect(shouldRepublish({ ...baseInput, prevHeadingDeg: null, nextHeadingDeg: null, msSinceLastPublish: 200 })).toBe(false);
  });
});
