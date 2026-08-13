/**
 * Minimal UTF-8 codec — PURE + unit tested.
 *
 * React Native (Hermes on RN 0.74) doesn't reliably expose TextEncoder/
 * TextDecoder, and the messaging channel needs to turn chat strings into bytes and
 * back deterministically. This is a small, correct UTF-8 implementation covering
 * the BMP + surrogate pairs (emoji). Malformed input decodes leniently rather than
 * throwing.
 */

/** Encode a JS string to UTF-8 bytes. */
export function utf8Encode(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

/** Decode UTF-8 bytes to a JS string (lenient on malformed sequences). */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  const at = (j: number): number => bytes[j] ?? 0;
  while (i < bytes.length) {
    const b = at(i++);
    let cp: number;
    if (b < 0x80) {
      cp = b;
    } else if (b < 0xe0) {
      cp = ((b & 0x1f) << 6) | (at(i++) & 0x3f);
    } else if (b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((at(i++) & 0x3f) << 6) | (at(i++) & 0x3f);
    } else {
      cp = ((b & 0x07) << 18) | ((at(i++) & 0x3f) << 12) | ((at(i++) & 0x3f) << 6) | (at(i++) & 0x3f);
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      out += String.fromCharCode(cp);
    }
  }
  return out;
}
