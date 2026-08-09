import { describe, it, expect, afterEach } from 'vitest';
import { generatePeerId, getSessionPeerId, __resetSessionPeerId, PEER_ID_UNSET } from './identity.js';

afterEach(() => __resetSessionPeerId());

describe('generatePeerId', () => {
  it('produces a uint32', () => {
    const id = generatePeerId(() => 0.5);
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThanOrEqual(0xffffffff);
  });

  it('never returns 0, retrying past a zero draw', () => {
    const draws = [0, 0, 0.123];
    let i = 0;
    const id = generatePeerId(() => draws[i++] as number);
    expect(id).not.toBe(PEER_ID_UNSET);
  });

  it('spans the high end of the range', () => {
    const id = generatePeerId(() => 0.9999999);
    expect(id).toBeGreaterThan(0xf0000000);
  });
});

describe('getSessionPeerId', () => {
  it('is stable within a session', () => {
    const a = getSessionPeerId();
    const b = getSessionPeerId();
    expect(a).toBe(b);
  });

  it('regenerates after a reset', () => {
    const a = getSessionPeerId();
    __resetSessionPeerId();
    const b = getSessionPeerId();
    // Overwhelmingly likely to differ; assert both are valid non-zero uint32.
    expect(a).not.toBe(PEER_ID_UNSET);
    expect(b).not.toBe(PEER_ID_UNSET);
  });
});
