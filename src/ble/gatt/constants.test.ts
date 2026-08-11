import { describe, it, expect } from 'vitest';
import {
  BRIDGE_SERVICE_UUID,
  PAYLOAD_CHAR_UUID,
  isCanonicalUuid,
  shouldInitiateConnection,
} from './constants';

describe('gatt constants', () => {
  it('service and payload UUIDs are canonical lower-case 128-bit', () => {
    expect(isCanonicalUuid(BRIDGE_SERVICE_UUID)).toBe(true);
    expect(isCanonicalUuid(PAYLOAD_CHAR_UUID)).toBe(true);
  });

  it('service and payload UUIDs are distinct', () => {
    expect(BRIDGE_SERVICE_UUID).not.toBe(PAYLOAD_CHAR_UUID);
  });

  it('rejects non-canonical UUIDs', () => {
    expect(isCanonicalUuid('A0E1B5D2-7C3F-4E8A-9B10-2F6C1D4E7A90')).toBe(false); // upper-case
    expect(isCanonicalUuid('not-a-uuid')).toBe(false);
    expect(isCanonicalUuid('a0e1b5d2')).toBe(false); // 16-bit short form
  });
});

describe('shouldInitiateConnection (role tie-break)', () => {
  it('the lower peerId dials', () => {
    expect(shouldInitiateConnection(1, 2)).toBe(true);
    expect(shouldInitiateConnection(2, 1)).toBe(false);
  });

  it('equal ids: neither dials (no self-race)', () => {
    expect(shouldInitiateConnection(5, 5)).toBe(false);
  });

  it('compares as unsigned uint32 (high-bit ids)', () => {
    // 0xFFFF0000 must be treated as large positive, not negative.
    expect(shouldInitiateConnection(0x0000_0001, 0xffff_0000)).toBe(true);
    expect(shouldInitiateConnection(0xffff_0000, 0x0000_0001)).toBe(false);
  });
});
