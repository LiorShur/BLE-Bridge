import { describe, it, expect } from 'vitest';
import { encodeProfile, decodeProfile } from './profileCodec';

describe('profile codec', () => {
  it('round-trips name + interests + headline', () => {
    const p = { name: 'Lior', interests: ['ai', 'climbing'], headline: 'building a BLE toy' };
    const d = decodeProfile(encodeProfile(p));
    expect(d).toEqual(p);
  });

  it('round-trips with no headline', () => {
    const d = decodeProfile(encodeProfile({ name: 'Sam', interests: ['jazz'] }));
    expect(d).toEqual({ name: 'Sam', interests: ['jazz'] });
  });

  it('handles empty interests', () => {
    const d = decodeProfile(encodeProfile({ name: 'Ana', interests: [] }));
    expect(d).toEqual({ name: 'Ana', interests: [] });
  });

  it('preserves unicode / emoji in the name and headline', () => {
    const p = { name: 'Zoé 🌉', interests: ['travel'], headline: 'café ☕ hopper' };
    expect(decodeProfile(encodeProfile(p))).toEqual(p);
  });

  it('returns null for a missing/blank name', () => {
    expect(decodeProfile(encodeProfile({ name: '', interests: ['ai'] }))).toBeNull();
  });

  it('returns null for non-JSON bytes', () => {
    expect(decodeProfile(new Uint8Array([0xff, 0x00, 0x10]))).toBeNull();
  });

  it('caps oversized fields', () => {
    const long = 'x'.repeat(100);
    const many = Array.from({ length: 20 }, (_, i) => `tag${i}`);
    const d = decodeProfile(encodeProfile({ name: long, interests: many, headline: long }))!;
    expect(d.name.length).toBe(40);
    expect(d.interests.length).toBe(8);
    expect(d.headline!.length).toBe(60);
  });

  it('drops non-string interest entries defensively', () => {
    // Simulate a hand-built blob with mixed types.
    const bytes = new TextEncoder().encode(JSON.stringify({ n: 'X', i: ['ok', 5, null, 'ok2'], h: '' }));
    expect(decodeProfile(bytes)).toEqual({ name: 'X', interests: ['ok', 'ok2'] });
  });
});
