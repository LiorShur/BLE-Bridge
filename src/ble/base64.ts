/**
 * Base64 <-> bytes, dependency-free and pure.
 *
 * The native advertiser takes a base64 string (`startAdvertising`), and
 * `react-native-ble-plx` hands scan manufacturer-data back as base64 — so both
 * the transmit and receive paths cross this boundary. `Buffer`/`atob` are not
 * reliably present in the React Native JS runtime, so this is implemented by hand
 * and unit-tested against the RFC 4648 vectors.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const DECODE: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) map[ALPHABET[i] as string] = i;
  return map;
})();

/** Encode bytes to a standard (padded) base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? (bytes[i + 1] as number) : 0;
    const b2 = has2 ? (bytes[i + 2] as number) : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET[(triple >> 18) & 0x3f];
    out += ALPHABET[(triple >> 12) & 0x3f];
    out += has1 ? ALPHABET[(triple >> 6) & 0x3f] : '=';
    out += has2 ? ALPHABET[triple & 0x3f] : '=';
  }
  return out;
}

/**
 * Decode a base64 string to bytes. Ignores whitespace and padding; unknown
 * characters are skipped rather than throwing, since scan data occasionally
 * arrives with surprising framing.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  const byteLength = Math.floor((clean.length * 6) / 8);
  const bytes = new Uint8Array(byteLength);
  let buffer = 0;
  let bits = 0;
  let p = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = DECODE[clean[i] as string];
    if (v === undefined) continue; // skip whitespace / stray chars
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[p++] = (buffer >> bits) & 0xff;
    }
  }
  return p === bytes.length ? bytes : bytes.subarray(0, p);
}
