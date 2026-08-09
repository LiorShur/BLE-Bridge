/**
 * Manufacturer-data framing — pure and testable.
 *
 * `react-native-ble-plx` returns `manufacturerData` as base64 whose first two
 * bytes are the company identifier in LITTLE-ENDIAN, followed by the
 * manufacturer-specific bytes. Our advertisement uses company id `0xFFFF`; this
 * module verifies and strips that prefix and returns just our payload bytes.
 *
 * Kept separate from scanner.ts (which imports React Native) so the framing math
 * can be unit-tested off-device.
 */
import { base64ToBytes } from './base64.js';
import { PROTOCOL_VERSION } from './payload.js';

/** Company identifier we advertise under (PAYLOAD_SPEC §1). */
export const COMPANY_ID = 0xffff;

/**
 * Verify the company id and return our payload bytes, or `null` if the
 * advertisement is not ours (wrong/missing company id, too short, or the first
 * payload byte is not our protocol version).
 */
export function extractPayloadBytes(manufacturerDataB64: string | null | undefined): Uint8Array | null {
  if (!manufacturerDataB64) return null;
  const bytes = base64ToBytes(manufacturerDataB64);
  if (bytes.length < 2) return null;
  const companyId = bytes[0]! | (bytes[1]! << 8); // little-endian
  if (companyId !== COMPANY_ID) return null;
  const payload = bytes.subarray(2);
  if (payload.length < 1 || payload[0] !== PROTOCOL_VERSION) return null; // cheap pre-filter
  return payload;
}
