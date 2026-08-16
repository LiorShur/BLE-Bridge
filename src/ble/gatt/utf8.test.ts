import { describe, it, expect } from 'vitest';
import { utf8Encode, utf8Decode } from './utf8';

const ref = new TextEncoder();
const refDec = new TextDecoder();

describe('utf8 codec', () => {
  const samples = ['', 'hello', 'café', 'こんにちは', 'a🧗b✨', 'Ωμέγα', 'mixed 123 – ok'];

  it('matches the platform TextEncoder for a range of strings', () => {
    for (const s of samples) {
      expect(Array.from(utf8Encode(s))).toEqual(Array.from(ref.encode(s)));
    }
  });

  it('round-trips through encode → decode', () => {
    for (const s of samples) {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });

  it('decodes bytes the same as the platform TextDecoder', () => {
    for (const s of samples) {
      const bytes = ref.encode(s);
      expect(utf8Decode(bytes)).toBe(refDec.decode(bytes));
    }
  });

  it('preserves an emoji surrogate pair round-trip', () => {
    expect(utf8Decode(utf8Encode('🌉'))).toBe('🌉');
  });
});
