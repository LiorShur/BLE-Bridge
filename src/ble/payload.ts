/**
 * Advertisement payload codec — see docs/PAYLOAD_SPEC.md.
 *
 * Wire format is 12 used bytes + 12 reserved (zero) = 24 bytes total, the whole
 * available manufacturer-data budget. All multi-byte fields are big-endian.
 *
 * These functions are PURE and have no dependency on React Native, the radio, or
 * platform endianness (DataView is used explicitly). They are the one part of the
 * BLE path that can be fully proven off-device — treat the tests as the spec.
 */

/** Protocol version. Currently the only value a decoder accepts. */
export const PROTOCOL_VERSION = 0x01;

/** `heading` sentinel meaning "compass unavailable". */
export const HEADING_UNAVAILABLE = 0xffff;

/** Reserved peerId meaning "unset"; rejected by the decoder. */
export const PEER_ID_UNSET = 0x00000000;

/** Highest valid heading in decidegrees (359.9°). */
export const HEADING_MAX = 3599;

/** Number of meaningful bytes written before the reserved block. */
export const USED_BYTES = 12;

/** Total payload length written by {@link encodePayload}. */
export const PAYLOAD_BYTES = 24;

/** Maximum payload the native advertiser will accept (the whole budget). */
export const MAX_PAYLOAD_BYTES = 24;

/**
 * Decoded wire fields. `heading` stays in decidegrees here (the wire unit); the
 * signal layer converts to degrees at its own boundary. `null` means the sender
 * advertised the {@link HEADING_UNAVAILABLE} sentinel.
 */
export interface DecodedPayload {
  version: number;
  /** uint32, never 0 (0 is rejected). Session identity — see PAYLOAD_SPEC §4. */
  peerId: number;
  /** Decidegrees 0..3599, or `null` when the sender's compass is unavailable. */
  headingDecideg: number | null;
  /** 0 unreliable · 1 low · 2 medium · 3 high. */
  headingAccuracy: number;
  /** Signed dBm — the sender's calibrated RSSI at 1 m. */
  txPower: number;
  /** 0..255 aura colour seed; degrees = hue × 360 / 255. */
  hue: number;
  /** Raw flags bitfield; unknown bits are preserved, not masked. */
  flags: number;
  /** 0..255, wraps; lets the receiver measure refresh rate. */
  sequence: number;
  /**
   * Reaction addressing (bytes 12–17, formerly reserved — version stays 1 so old
   * builds ignore them, per PAYLOAD_SPEC §6). A reaction is "for" a specific peer.
   */
  reactionTarget: number; // uint32: peerId this reaction targets (0 = none)
  reactionId: number; // uint8: which reaction (0 = none) — see reactions.ts
  reactionNonce: number; // uint8: increments per fresh send, so receivers fire once
  /**
   * Delivery ack (bytes 18–22): "I received your reaction". ackTarget echoes the
   * original sender's peerId; ackNonce echoes the reactionNonce being confirmed.
   */
  ackTarget: number; // uint32 (0 = none)
  ackNonce: number; // uint8
}

/** Fields accepted by {@link encodePayload}. Reaction/ack fields default to 0. */
export interface PayloadFields {
  version: number;
  peerId: number;
  headingDecideg: number | null;
  headingAccuracy: number;
  txPower: number;
  hue: number;
  flags: number;
  sequence: number;
  reactionTarget?: number;
  reactionId?: number;
  reactionNonce?: number;
  ackTarget?: number;
  ackNonce?: number;
}

/** Byte offset of the reaction block (bytes 12–17). */
export const REACTION_OFFSET = 12;
/** Byte offset of the delivery-ack block (bytes 18–22). */
export const ACK_OFFSET = 18;
/** Minimum buffer length to carry the reaction block / the ack block. */
const REACTION_END = 18;
const ACK_END = 23;

/** `flags` bitfield masks — see PAYLOAD_SPEC §5. */
export const FLAG_AVAILABLE = 0x01;
export const FLAG_ALREADY_BRIDGED = 0x02;
export const FLAG_STATIONARY = 0x04;

function assertUint(value: number, bits: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > (2 ** bits - 1)) {
    throw new RangeError(`${name} must be a uint${bits} (0..${2 ** bits - 1}), got ${value}`);
  }
}

/**
 * Encode fields into the 24-byte advertisement payload. Throws `RangeError` on
 * any out-of-range field so an invalid packet can never reach the radio — the
 * decoder is the tolerant side of the contract, the encoder is the strict side.
 */
export function encodePayload(fields: PayloadFields): Uint8Array {
  const { version, peerId, headingDecideg, headingAccuracy, txPower, hue, flags, sequence } = fields;

  if (version !== PROTOCOL_VERSION) {
    throw new RangeError(`version must be ${PROTOCOL_VERSION}, got ${version}`);
  }
  assertUint(peerId, 32, 'peerId');
  if (peerId === PEER_ID_UNSET) {
    throw new RangeError('peerId must not be 0 (reserved as "unset")');
  }
  if (headingDecideg !== null && (!Number.isInteger(headingDecideg) || headingDecideg < 0 || headingDecideg > HEADING_MAX)) {
    throw new RangeError(`headingDecideg must be 0..${HEADING_MAX} or null, got ${headingDecideg}`);
  }
  if (!Number.isInteger(headingAccuracy) || headingAccuracy < 0 || headingAccuracy > 3) {
    throw new RangeError(`headingAccuracy must be 0..3, got ${headingAccuracy}`);
  }
  if (!Number.isInteger(txPower) || txPower < -128 || txPower > 127) {
    throw new RangeError(`txPower must be an int8 (-128..127), got ${txPower}`);
  }
  assertUint(hue, 8, 'hue');
  assertUint(flags, 8, 'flags');
  assertUint(sequence, 8, 'sequence');

  const reactionTarget = fields.reactionTarget ?? 0;
  const reactionId = fields.reactionId ?? 0;
  const reactionNonce = fields.reactionNonce ?? 0;
  const ackTarget = fields.ackTarget ?? 0;
  const ackNonce = fields.ackNonce ?? 0;
  assertUint(reactionTarget, 32, 'reactionTarget');
  assertUint(reactionId, 8, 'reactionId');
  assertUint(reactionNonce, 8, 'reactionNonce');
  assertUint(ackTarget, 32, 'ackTarget');
  assertUint(ackNonce, 8, 'ackNonce');

  const buf = new Uint8Array(PAYLOAD_BYTES); // trailing reserved block stays zero
  const view = new DataView(buf.buffer);
  view.setUint8(0, version);
  view.setUint32(1, peerId, false); // big-endian
  view.setUint16(5, headingDecideg ?? HEADING_UNAVAILABLE, false);
  view.setUint8(7, headingAccuracy);
  view.setInt8(8, txPower);
  view.setUint8(9, hue);
  view.setUint8(10, flags);
  view.setUint8(11, sequence);
  view.setUint32(REACTION_OFFSET, reactionTarget, false);
  view.setUint8(REACTION_OFFSET + 4, reactionId);
  view.setUint8(REACTION_OFFSET + 5, reactionNonce);
  view.setUint32(ACK_OFFSET, ackTarget, false);
  view.setUint8(ACK_OFFSET + 4, ackNonce);
  return buf;
}

/**
 * Decode a received advertisement payload. Returns `null` — never throws — for
 * any packet that fails the PAYLOAD_SPEC §6 rejection rules, so a malformed or
 * foreign packet is simply dropped by the scan loop.
 *
 * Tolerates (does not reject): buffers longer than 24 bytes, non-zero reserved
 * bytes, and unknown flag bits — this is what keeps the format forward-compatible.
 */
export function decodePayload(bytes: Uint8Array): DecodedPayload | null {
  // §6.1 — too short to contain the used fields.
  if (bytes.length < USED_BYTES) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const version = view.getUint8(0);
  if (version !== PROTOCOL_VERSION) return null; // §6.2

  const peerId = view.getUint32(1, false);
  if (peerId === PEER_ID_UNSET) return null; // §6.5

  const rawHeading = view.getUint16(5, false);
  let headingDecideg: number | null;
  if (rawHeading === HEADING_UNAVAILABLE) {
    headingDecideg = null;
  } else if (rawHeading > HEADING_MAX) {
    return null; // §6.3 — out of range and not the sentinel
  } else {
    headingDecideg = rawHeading;
  }

  const headingAccuracy = view.getUint8(7);
  if (headingAccuracy > 3) return null; // §6.4

  const txPower = view.getInt8(8); // signed — -59 is 0xC5, not 0x3B
  const hue = view.getUint8(9);
  const flags = view.getUint8(10);
  const sequence = view.getUint8(11);

  // Reaction block (bytes 12–17) and ack block (bytes 18–22). Absent on
  // short/old packets → default 0.
  let reactionTarget = 0;
  let reactionId = 0;
  let reactionNonce = 0;
  let ackTarget = 0;
  let ackNonce = 0;
  if (bytes.length >= REACTION_END) {
    reactionTarget = view.getUint32(REACTION_OFFSET, false);
    reactionId = view.getUint8(REACTION_OFFSET + 4);
    reactionNonce = view.getUint8(REACTION_OFFSET + 5);
  }
  if (bytes.length >= ACK_END) {
    ackTarget = view.getUint32(ACK_OFFSET, false);
    ackNonce = view.getUint8(ACK_OFFSET + 4);
  }

  return {
    version,
    peerId,
    headingDecideg,
    headingAccuracy,
    txPower,
    hue,
    flags,
    sequence,
    reactionTarget,
    reactionId,
    reactionNonce,
    ackTarget,
    ackNonce,
  };
}

/** Convert wire decidegrees to degrees, preserving the `null` sentinel. */
export function headingToDegrees(headingDecideg: number | null): number | null {
  return headingDecideg === null ? null : headingDecideg / 10;
}
