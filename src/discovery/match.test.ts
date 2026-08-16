import { describe, it, expect } from 'vitest';
import { computeMatch, isStrongMatch, rankCandidates, NUDGE_MIN_SHARED } from './match';

describe('computeMatch', () => {
  it('returns shared tags in MY order, with score = count', () => {
    const m = computeMatch(0x1234, ['jazz', 'ai', 'climbing'], ['climbing', 'jazz', 'coffee']);
    expect(m.shared).toEqual(['jazz', 'climbing']); // my order, not theirs
    expect(m.score).toBe(2);
    expect(m.peerId).toBe(0x1234);
  });

  it('is empty when there is no overlap', () => {
    const m = computeMatch(1, ['jazz'], ['ai']);
    expect(m.shared).toEqual([]);
    expect(m.score).toBe(0);
  });

  it('ignores unknown ids on either side', () => {
    const m = computeMatch(1, ['jazz', 'bogus'], ['jazz', 'also-bogus']);
    expect(m.shared).toEqual(['jazz']);
  });

  it('de-duplicates repeated ids before counting', () => {
    const m = computeMatch(1, ['jazz', 'jazz'], ['jazz', 'jazz']);
    expect(m.score).toBe(1);
  });
});

describe('isStrongMatch', () => {
  it('is true at or above the nudge threshold', () => {
    expect(isStrongMatch({ peerId: 1, shared: ['a', 'b'], score: NUDGE_MIN_SHARED })).toBe(true);
    expect(isStrongMatch({ peerId: 1, shared: ['a'], score: 1 })).toBe(NUDGE_MIN_SHARED <= 1);
  });

  it('is false below the threshold', () => {
    expect(isStrongMatch({ peerId: 1, shared: [], score: 0 })).toBe(false);
  });
});

describe('rankCandidates', () => {
  it('sorts by score desc, then proximity desc, without mutating', () => {
    const input = [
      { match: { peerId: 1, shared: ['a'], score: 1 }, proximity: 0.9 },
      { match: { peerId: 2, shared: ['a', 'b'], score: 2 }, proximity: 0.2 },
      { match: { peerId: 3, shared: ['a', 'b'], score: 2 }, proximity: 0.8 },
    ];
    const snapshot = JSON.stringify(input);
    const ranked = rankCandidates(input);
    expect(ranked.map((c) => c.match.peerId)).toEqual([3, 2, 1]); // (2,0.8) > (2,0.2) > (1,*)
    expect(JSON.stringify(input)).toBe(snapshot); // input untouched
  });

  it('keeps score-0 candidates (caller filters if wanted)', () => {
    const ranked = rankCandidates([{ match: { peerId: 9, shared: [], score: 0 }, proximity: 0.5 }]);
    expect(ranked).toHaveLength(1);
  });
});
