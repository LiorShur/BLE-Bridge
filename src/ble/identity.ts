/**
 * Session peer identity — see docs/PAYLOAD_SPEC.md §4 and CLAUDE.md §3.3.
 *
 * `peerId` is a random uint32 generated once per app session and held in memory.
 * It is the ONLY valid peer key: the BLE device address randomises roughly every
 * 15 minutes and must never be used for identity.
 */

/** Reserved value meaning "unset"; never emitted. */
export const PEER_ID_UNSET = 0x00000000;

/**
 * Generate a non-zero random uint32 peer id.
 *
 * @param rand injectable [0,1) source (defaults to `Math.random`) so the
 *             generator is deterministic under test. Cryptographic randomness is
 *             unnecessary here — this only needs to avoid a collision between the
 *             two phones in a session, where a 32-bit space is ample.
 */
export function generatePeerId(rand: () => number = Math.random): number {
  let id = PEER_ID_UNSET;
  while (id === PEER_ID_UNSET) {
    id = Math.floor(rand() * 0x1_0000_0000) >>> 0;
  }
  return id;
}

let sessionPeerId: number | null = null;

/** The stable peer id for this app session, generated lazily on first read. */
export function getSessionPeerId(): number {
  if (sessionPeerId === null) sessionPeerId = generatePeerId();
  return sessionPeerId;
}

/** Test-only: reset the memoised session id. */
export function __resetSessionPeerId(): void {
  sessionPeerId = null;
}
