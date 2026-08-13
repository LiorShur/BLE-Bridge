import { describe, it, expect } from 'vitest';
import {
  isBroadcasting,
  isBrowsing,
  showsNudges,
  VISIBILITY_OPTIONS,
  type Visibility,
} from './visibility';

const ALL: Visibility[] = ['off', 'open', 'curious', 'ghost'];

describe('visibility semantics', () => {
  it('broadcast (visible to others) is open|curious only', () => {
    expect(ALL.filter(isBroadcasting)).toEqual(['open', 'curious']);
  });

  it('browse (see others) is everything except off', () => {
    expect(ALL.filter(isBrowsing)).toEqual(['open', 'curious', 'ghost']);
  });

  it('nudges are open only', () => {
    expect(ALL.filter(showsNudges)).toEqual(['open']);
  });

  it('ghost browses without broadcasting (the reciprocity break)', () => {
    expect(isBrowsing('ghost')).toBe(true);
    expect(isBroadcasting('ghost')).toBe(false);
  });

  it('off is fully dark', () => {
    expect(isBroadcasting('off')).toBe(false);
    expect(isBrowsing('off')).toBe(false);
    expect(showsNudges('off')).toBe(false);
  });
});

describe('VISIBILITY_OPTIONS', () => {
  it('covers every mode exactly once', () => {
    const modes = VISIBILITY_OPTIONS.map((o) => o.mode);
    expect(new Set(modes)).toEqual(new Set(ALL));
    expect(modes).toHaveLength(ALL.length);
  });

  it('every option has copy', () => {
    for (const o of VISIBILITY_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.desc.length).toBeGreaterThan(0);
    }
  });
});
