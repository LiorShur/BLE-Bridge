/**
 * Bridge GATT identifiers — see docs/GATT_SPEC.md.
 *
 * The cross-platform (interop) path discovers by the Bridge SERVICE UUID and
 * exchanges the existing 24-byte payload as the PAYLOAD characteristic value.
 * These are fixed PoC UUIDs; replace before any public release.
 *
 * PURE constants, no React Native dependency.
 */

/** 128-bit Bridge service, advertised in the scan response and scanned for. */
export const BRIDGE_SERVICE_UUID = 'a0e1b5d2-7c3f-4e8a-9b10-2f6c1d4e7a90';

/**
 * Payload characteristic (read + notify). Its value IS the 24-byte payload from
 * payload.ts — reactions/ack included — so the codec is reused unchanged.
 */
export const PAYLOAD_CHAR_UUID = 'a0e1b5d2-7c3f-4e8a-9b10-2f6c1d4e7a91';

/** Canonical lower-case 128-bit UUID matcher (8-4-4-4-12 hex). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True if `s` is a canonical lower-case 128-bit UUID string. */
export function isCanonicalUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/**
 * Role tie-break (GATT_SPEC §3): the numerically lower peerId is the central and
 * initiates the connection. Returns true if THIS device (localPeerId) should dial
 * the peer. Equal ids should never happen (peerId is non-zero and unique enough),
 * but if they did neither dials — avoids a self-race.
 */
export function shouldInitiateConnection(localPeerId: number, peerId: number): boolean {
  return (localPeerId >>> 0) < (peerId >>> 0);
}
