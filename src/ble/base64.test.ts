import { describe, it, expect } from 'vitest';
import { bytesToBase64, base64ToBytes } from './base64.js';
import { encodePayload, PROTOCOL_VERSION } from './payload.js';

const enc = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const dec = (b: Uint8Array): string => String.fromCharCode(...b);

describe('base64 — RFC 4648 test vectors', () => {
  const vectors: Array<[string, string]> = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ];

  it('encodes the canonical vectors', () => {
    for (const [plain, b64] of vectors) {
      expect(bytesToBase64(enc(plain))).toBe(b64);
    }
  });

  it('decodes the canonical vectors', () => {
    for (const [plain, b64] of vectors) {
      expect(dec(base64ToBytes(b64))).toBe(plain);
    }
  });
});

describe('base64 — round trips', () => {
  it('survives every single byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect([...base64ToBytes(bytesToBase64(all))]).toEqual([...all]);
  });

  it('round-trips a real 24-byte advertisement payload', () => {
    const payload = encodePayload({
      version: PROTOCOL_VERSION,
      peerId: 0xa3f91c4e,
      headingDecideg: 1800,
      headingAccuracy: 3,
      txPower: -59,
      hue: 123,
      flags: 0x01,
      sequence: 7,
    });
    expect([...base64ToBytes(bytesToBase64(payload))]).toEqual([...payload]);
  });

  it('ignores whitespace embedded in the input', () => {
    expect(dec(base64ToBytes('Zm9v\nYmFy'))).toBe('foobar');
  });
});
