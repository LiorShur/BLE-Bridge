import { describe, it, expect } from 'vitest';
import { REACTIONS, reactionById } from './reactions';

describe('reactions catalog', () => {
  it('has unique ids in the wire range 1..255', () => {
    const ids = REACTIONS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(255);
    }
  });

  it('looks up by id and returns undefined for 0/unknown', () => {
    expect(reactionById(1)?.label).toBe('love');
    expect(reactionById(0)).toBeUndefined();
    expect(reactionById(999)).toBeUndefined();
  });
});
