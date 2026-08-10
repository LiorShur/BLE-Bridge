import { describe, it, expect } from 'vitest';
import {
  encodePayload,
  decodePayload,
  headingToDegrees,
  PROTOCOL_VERSION,
  HEADING_UNAVAILABLE,
  HEADING_MAX,
  PAYLOAD_BYTES,
  USED_BYTES,
  type PayloadFields,
} from './payload';

const base: PayloadFields = {
  version: PROTOCOL_VERSION,
  peerId: 0xa3f91c4e,
  headingDecideg: 3600 - 1 - 0, // set explicitly per-case below
  headingAccuracy: 3,
  txPower: -59,
  hue: 123,
  flags: 0x01,
  sequence: 42,
};

function withHeading(h: number | null): PayloadFields {
  return { ...base, headingDecideg: h };
}

describe('encodePayload', () => {
  it('produces the full 24-byte payload with a zeroed reserved block', () => {
    const bytes = encodePayload(withHeading(3600 - 1)); // 3599
    expect(bytes.length).toBe(PAYLOAD_BYTES);
    for (let i = USED_BYTES; i < PAYLOAD_BYTES; i++) {
      expect(bytes[i]).toBe(0);
    }
  });

  it('matches the reference big-endian encoding from PAYLOAD_SPEC §2', () => {
    // Reference row uses heading 0x0E0F (3599) — the spec's 0x0E10 was a
    // deliberate out-of-range example, corrected to the valid max here.
    const bytes = encodePayload({
      version: 0x01,
      peerId: 0xa3f91c4e,
      headingDecideg: 3599,
      headingAccuracy: 3,
      txPower: -59,
      hue: 123,
      flags: 0x01,
      sequence: 42,
    });
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('01a3f91c4e0e0f03c57b012a' + '00'.repeat(12));
  });

  it('encodes txPower as a signed int8 (-59 → 0xC5, not 0x3B)', () => {
    const bytes = encodePayload({ ...base, txPower: -59, headingDecideg: 0 });
    expect(bytes[8]).toBe(0xc5);
  });

  it('encodes the heading-unavailable sentinel as 0xFFFF', () => {
    const bytes = encodePayload(withHeading(null));
    expect(bytes[5]).toBe(0xff);
    expect(bytes[6]).toBe(0xff);
  });

  it('rejects out-of-range headings at encode time', () => {
    expect(() => encodePayload(withHeading(3600))).toThrow(RangeError);
    expect(() => encodePayload(withHeading(-1))).toThrow(RangeError);
  });

  it('rejects a zero peerId', () => {
    expect(() => encodePayload({ ...base, peerId: 0, headingDecideg: 0 })).toThrow(RangeError);
  });

  it('rejects a txPower outside int8 range', () => {
    expect(() => encodePayload({ ...base, txPower: 200, headingDecideg: 0 })).toThrow(RangeError);
    expect(() => encodePayload({ ...base, txPower: -200, headingDecideg: 0 })).toThrow(RangeError);
  });

  it('rejects an unrecognised version', () => {
    expect(() => encodePayload({ ...base, version: 2, headingDecideg: 0 })).toThrow(RangeError);
  });
});

describe('decodePayload', () => {
  it('round-trips every field', () => {
    const original = {
      version: 0x01,
      peerId: 0x0102abcd,
      headingDecideg: 1274,
      headingAccuracy: 2,
      txPower: -71,
      hue: 200,
      flags: 0b00000101,
      sequence: 250,
      reactionTarget: 0xdeadbeef,
      reactionId: 3,
      reactionNonce: 17,
    };
    const decoded = decodePayload(encodePayload(original));
    expect(decoded).toEqual(original);
  });

  it('defaults reaction fields to 0 when omitted', () => {
    const decoded = decodePayload(encodePayload(withHeading(500)));
    expect(decoded?.reactionTarget).toBe(0);
    expect(decoded?.reactionId).toBe(0);
    expect(decoded?.reactionNonce).toBe(0);
  });

  it('round-trips the reaction block (targeted reaction)', () => {
    const bytes = encodePayload({ ...base, headingDecideg: 0, reactionTarget: 0xa3f91c4e, reactionId: 5, reactionNonce: 42 });
    const decoded = decodePayload(bytes);
    expect(decoded?.reactionTarget).toBe(0xa3f91c4e);
    expect(decoded?.reactionId).toBe(5);
    expect(decoded?.reactionNonce).toBe(42);
  });

  it('reads reaction fields as 0 from an old 12-byte packet', () => {
    const full = encodePayload({ ...base, headingDecideg: 0, reactionId: 9, reactionNonce: 1 });
    const short = full.subarray(0, 12); // pre-reaction sender
    const decoded = decodePayload(short);
    expect(decoded?.peerId).toBe(base.peerId);
    expect(decoded?.reactionId).toBe(0);
  });

  it('round-trips the heading-unavailable sentinel to null', () => {
    const decoded = decodePayload(encodePayload(withHeading(null)));
    expect(decoded?.headingDecideg).toBeNull();
  });

  it('round-trips boundary headings 0 and 3599', () => {
    expect(decodePayload(encodePayload(withHeading(0)))?.headingDecideg).toBe(0);
    expect(decodePayload(encodePayload(withHeading(HEADING_MAX)))?.headingDecideg).toBe(HEADING_MAX);
  });

  it('round-trips extreme txPower values', () => {
    expect(decodePayload(encodePayload({ ...base, txPower: -128, headingDecideg: 0 }))?.txPower).toBe(-128);
    expect(decodePayload(encodePayload({ ...base, txPower: 127, headingDecideg: 0 }))?.txPower).toBe(127);
  });

  // ---- §6 rejection rules ----

  it('rejects a buffer shorter than 12 bytes', () => {
    expect(decodePayload(new Uint8Array(11))).toBeNull();
  });

  it('rejects an unrecognised version byte', () => {
    const bytes = encodePayload(withHeading(0));
    bytes[0] = 0x02;
    expect(decodePayload(bytes)).toBeNull();
  });

  it('rejects an out-of-range heading that is not the sentinel', () => {
    const bytes = encodePayload(withHeading(0));
    // 0x0E10 = 3600, one past the max, and not 0xFFFF.
    bytes[5] = 0x0e;
    bytes[6] = 0x10;
    expect(decodePayload(bytes)).toBeNull();
  });

  it('rejects a headingAccuracy above 3', () => {
    const bytes = encodePayload(withHeading(0));
    bytes[7] = 4;
    expect(decodePayload(bytes)).toBeNull();
  });

  it('rejects a zero peerId', () => {
    const bytes = encodePayload(withHeading(0));
    bytes[1] = bytes[2] = bytes[3] = bytes[4] = 0;
    expect(decodePayload(bytes)).toBeNull();
  });

  // ---- §6 tolerance rules (must NOT reject) ----

  it('tolerates a buffer longer than 24 bytes', () => {
    const short = encodePayload(withHeading(500));
    const long = new Uint8Array(40);
    long.set(short, 0);
    const decoded = decodePayload(long);
    expect(decoded?.peerId).toBe(base.peerId);
    expect(decoded?.headingDecideg).toBe(500);
  });

  it('tolerates non-zero reserved bytes', () => {
    const bytes = encodePayload(withHeading(500));
    bytes[12] = 0xde;
    bytes[23] = 0xad;
    expect(decodePayload(bytes)?.peerId).toBe(base.peerId);
  });

  it('tolerates and preserves unknown flag bits', () => {
    const bytes = encodePayload({ ...base, flags: 0xf1, headingDecideg: 0 });
    expect(decodePayload(bytes)?.flags).toBe(0xf1);
  });

  it('decodes correctly at a non-zero byteOffset (subarray view)', () => {
    const framed = new Uint8Array(PAYLOAD_BYTES + 8);
    framed.set(encodePayload(withHeading(900)), 8);
    const view = framed.subarray(8);
    expect(decodePayload(view)?.headingDecideg).toBe(900);
  });
});

describe('headingToDegrees', () => {
  it('converts decidegrees to degrees and preserves null', () => {
    expect(headingToDegrees(3599)).toBeCloseTo(359.9, 6);
    expect(headingToDegrees(0)).toBe(0);
    expect(headingToDegrees(null)).toBeNull();
  });

  it('agrees with the wire sentinel constant', () => {
    expect(HEADING_UNAVAILABLE).toBe(0xffff);
  });
});
