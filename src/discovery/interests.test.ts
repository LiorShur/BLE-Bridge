import { describe, it, expect } from 'vitest';
import {
  INTERESTS,
  BUCKETS,
  MAX_INTERESTS,
  interestById,
  bucketById,
  isValidInterestId,
  normaliseInterests,
  bucketForPrimary,
} from './interests';

describe('interest catalog integrity', () => {
  it('has unique, non-empty tag ids', () => {
    const ids = INTERESTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it('has unique bucket ids in the wire range 1..255', () => {
    const ids = BUCKETS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id >= 1 && id <= 255)).toBe(true);
  });

  it('every interest rolls up to a real bucket', () => {
    for (const i of INTERESTS) {
      expect(bucketById(i.bucket), `${i.id} → bucket ${i.bucket}`).toBeDefined();
    }
  });
});

describe('lookups', () => {
  it('interestById finds a known tag and misses an unknown one', () => {
    expect(interestById('climbing')?.label).toBe('Rock climbing');
    expect(interestById('nope')).toBeUndefined();
  });

  it('isValidInterestId reflects catalog membership', () => {
    expect(isValidInterestId('ai')).toBe(true);
    expect(isValidInterestId('not-a-tag')).toBe(false);
  });
});

describe('normaliseInterests', () => {
  it('drops unknown ids and de-duplicates, preserving order', () => {
    expect(normaliseInterests(['ai', 'bogus', 'ai', 'jazz'])).toEqual(['ai', 'jazz']);
  });

  it('caps at MAX_INTERESTS', () => {
    const many = INTERESTS.slice(0, MAX_INTERESTS + 3).map((i) => i.id);
    expect(normaliseInterests(many)).toHaveLength(MAX_INTERESTS);
  });

  it('returns an empty array for all-unknown input', () => {
    expect(normaliseInterests(['x', 'y'])).toEqual([]);
  });
});

describe('bucketForPrimary', () => {
  it('returns the tag’s bucket id', () => {
    const jazz = interestById('jazz')!;
    expect(bucketForPrimary('jazz')).toBe(jazz.bucket);
  });

  it('returns 0 (unset) for null/undefined/unknown', () => {
    expect(bucketForPrimary(null)).toBe(0);
    expect(bucketForPrimary(undefined)).toBe(0);
    expect(bucketForPrimary('mystery')).toBe(0);
  });
});
