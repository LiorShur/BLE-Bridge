import { describe, it, expect } from 'vitest';
import { extractPayloadBytes, COMPANY_ID } from './manufacturer.js';
import { bytesToBase64 } from './base64.js';
import { encodePayload, PROTOCOL_VERSION } from './payload.js';

/** Frame a payload the way ble-plx presents it: LE company id, then bytes. */
function frame(companyId: number, payload: Uint8Array): string {
  const framed = new Uint8Array(2 + payload.length);
  framed[0] = companyId & 0xff;
  framed[1] = (companyId >> 8) & 0xff;
  framed.set(payload, 2);
  return bytesToBase64(framed);
}

const payload = encodePayload({
  version: PROTOCOL_VERSION,
  peerId: 0xa3f91c4e,
  headingDecideg: 1800,
  headingAccuracy: 3,
  txPower: -59,
  hue: 123,
  flags: 0x01,
  sequence: 5,
});

describe('extractPayloadBytes', () => {
  it('strips our little-endian company id and returns the payload', () => {
    const out = extractPayloadBytes(frame(COMPANY_ID, payload));
    expect(out).not.toBeNull();
    expect([...(out as Uint8Array)]).toEqual([...payload]);
  });

  it('rejects a different company id', () => {
    expect(extractPayloadBytes(frame(0x004c, payload))).toBeNull(); // e.g. Apple
  });

  it('rejects null/empty/short inputs', () => {
    expect(extractPayloadBytes(null)).toBeNull();
    expect(extractPayloadBytes(undefined)).toBeNull();
    expect(extractPayloadBytes('')).toBeNull();
    expect(extractPayloadBytes(bytesToBase64(new Uint8Array([0xff])))).toBeNull();
  });

  it('rejects a wrong protocol version even under our company id', () => {
    const bad = new Uint8Array(payload);
    bad[0] = 0x02;
    expect(extractPayloadBytes(frame(COMPANY_ID, bad))).toBeNull();
  });
});
