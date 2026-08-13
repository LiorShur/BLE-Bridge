import { describe, it, expect } from 'vitest';
import {
  INTERESTS,
  BUCKETS,
  CATALOGS,
  DEFAULT_CATALOG_ID,
  MAX_INTERESTS,
  interestById,
  bucketById,
  isValidInterestId,
  normaliseInterests,
  bucketForPrimary,
  getCatalog,
  catalogInterests,
} from './interests';

const ALL = CATALOGS.flatMap((c) => c.interests);

describe('interest catalog integrity', () => {
  it('has unique, non-empty tag ids GLOBALLY across all catalogs', () => {
    const ids = ALL.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length); // no collision between catalogs
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it('has unique bucket ids in the wire range 1..255', () => {
    const ids = BUCKETS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id >= 1 && id <= 255)).toBe(true);
  });

  it('every interest in every catalog rolls up to a real shared bucket', () => {
    for (const i of ALL) {
      expect(bucketById(i.bucket), `${i.id} → bucket ${i.bucket}`).toBeDefined();
    }
  });

  it('has a generic default catalog', () => {
    expect(getCatalog(DEFAULT_CATALOG_ID)).toBeDefined();
    expect(CATALOGS.some((c) => c.id === DEFAULT_CATALOG_ID)).toBe(true);
  });
});

describe('catalogs', () => {
  it('getCatalog resolves known ids and misses unknown ones', () => {
    expect(getCatalog('generic')?.label).toBeTruthy();
    expect(getCatalog('nope')).toBeUndefined();
  });

  it('catalogInterests returns the catalog set, falling back to the default', () => {
    expect(catalogInterests('generic')).toBe(INTERESTS);
    expect(catalogInterests('unknown')).toBe(catalogInterests(DEFAULT_CATALOG_ID));
    expect(catalogInterests('tech-conf').length).toBeGreaterThan(0);
  });

  it('resolves an interest id from a NON-default catalog via the union', () => {
    const evt = CATALOGS.find((c) => c.id !== DEFAULT_CATALOG_ID);
    const tag = evt?.interests[0];
    expect(tag).toBeDefined();
    expect(interestById(tag!.id)?.label).toBe(tag!.label);
    expect(isValidInterestId(tag!.id)).toBe(true);
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
