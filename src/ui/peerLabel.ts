/**
 * Shared peer-labelling helpers for the UI. A peer is identified on-screen by a
 * short tag derived from its `peerId` plus its aura hue, so the identity chip on
 * a beam and the target chip in the reaction bar always read the same.
 *
 * NOTE: pure string/number helpers; no React Native dependency.
 */

/** Short human-readable tag for a peer id — the last 16 bits as hex (e.g. #1C4E). */
export function shortPeerTag(peerId: number): string {
  return '#' + (peerId & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}
