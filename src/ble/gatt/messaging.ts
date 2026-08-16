/**
 * GATT messaging protocol — the PURE core of the Tier 2 data channel
 * (docs/GATT_MESSAGING_SPEC.md §2).
 *
 * A message (a chat string, a profile blob) is chunked into FRAMES that each fit
 * one MTU write/notify; the receiver reassembles by message id and acks. This
 * layer is transport-agnostic — it only turns messages into frame bytes and back,
 * exactly like payload.ts turns state into advertisement bytes. No React Native,
 * no radio; fully unit-tested off-device.
 *
 * Frame layout (big-endian, 10-byte header):
 *   0  u8   version (0x01)
 *   1  u8   type    (1 TEXT · 2 PROFILE · 3 ACK)
 *   2  u16  msgId
 *   4  u16  seq     (0-based chunk index)
 *   6  u16  count   (total chunks; 0 for ACK)
 *   8  u16  payloadLen
 *   10 …    payload
 */

export const MSG_VERSION = 0x01;
export const FRAME_HEADER = 10;

export const MSG_TYPE = {
  TEXT: 1,
  PROFILE: 2,
  ACK: 3,
  /** A small profile photo thumbnail (raw JPEG bytes), sent as a separate message
   *  so the tiny name/interests PROFILE still arrives instantly. */
  PHOTO: 4,
} as const;
export type MsgType = (typeof MSG_TYPE)[keyof typeof MSG_TYPE];

const U16_MAX = 0xffff;

export interface Frame {
  version: number;
  type: number;
  msgId: number;
  seq: number;
  count: number;
  payload: Uint8Array;
}

function assertU16(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > U16_MAX) {
    throw new RangeError(`${name} must be a uint16 (0..${U16_MAX}), got ${value}`);
  }
}

/** Encode one frame to bytes. Strict: throws on out-of-range fields. */
export function encodeFrame(frame: Frame): Uint8Array {
  assertU16(frame.msgId, 'msgId');
  assertU16(frame.seq, 'seq');
  assertU16(frame.count, 'count');
  assertU16(frame.payload.length, 'payloadLen');
  const buf = new Uint8Array(FRAME_HEADER + frame.payload.length);
  const view = new DataView(buf.buffer);
  view.setUint8(0, frame.version);
  view.setUint8(1, frame.type);
  view.setUint16(2, frame.msgId, false);
  view.setUint16(4, frame.seq, false);
  view.setUint16(6, frame.count, false);
  view.setUint16(8, frame.payload.length, false);
  buf.set(frame.payload, FRAME_HEADER);
  return buf;
}

/**
 * Decode a frame. Returns null (never throws) on any malformed input — short
 * buffer, unknown version, or a payloadLen that overruns the buffer.
 */
export function decodeFrame(bytes: Uint8Array): Frame | null {
  if (bytes.length < FRAME_HEADER) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  if (version !== MSG_VERSION) return null;
  const type = view.getUint8(1);
  const msgId = view.getUint16(2, false);
  const seq = view.getUint16(4, false);
  const count = view.getUint16(6, false);
  const payloadLen = view.getUint16(8, false);
  if (bytes.length < FRAME_HEADER + payloadLen) return null; // truncated
  const payload = bytes.slice(FRAME_HEADER, FRAME_HEADER + payloadLen);
  return { version, type, msgId, seq, count, payload };
}

/**
 * Split a message into frame BYTES, each ≤ `maxFrameBytes` (the negotiated MTU
 * minus ATT overhead — the caller passes the live value). A zero-length message
 * still yields one frame (`count=1, seq=0, payloadLen=0`).
 */
export function frameMessage(
  type: MsgType,
  msgId: number,
  bytes: Uint8Array,
  maxFrameBytes: number,
): Uint8Array[] {
  if (!Number.isInteger(maxFrameBytes) || maxFrameBytes <= FRAME_HEADER) {
    throw new RangeError(`maxFrameBytes must exceed the ${FRAME_HEADER}-byte header, got ${maxFrameBytes}`);
  }
  const chunkPayload = maxFrameBytes - FRAME_HEADER;
  const count = bytes.length === 0 ? 1 : Math.ceil(bytes.length / chunkPayload);
  assertU16(count, 'count');
  assertU16(msgId, 'msgId');
  const frames: Uint8Array[] = [];
  for (let seq = 0; seq < count; seq++) {
    const start = seq * chunkPayload;
    const payload = bytes.subarray(start, start + chunkPayload);
    frames.push(encodeFrame({ version: MSG_VERSION, type, msgId, seq, count, payload }));
  }
  return frames;
}

/**
 * Message envelope: a 4-byte big-endian sender peerId prefixed to the content,
 * BEFORE chunking. Because inbound frames don't carry a peer identity at the
 * transport layer (a peripheral notify is a broadcast; an iOS write has no stable
 * sender handle), the envelope is how the receiver knows who sent a message
 * regardless of which transport/connection delivered it (GATT_MESSAGING_SPEC).
 */
export function encodeEnvelope(senderPeerId: number, content: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + content.length);
  new DataView(out.buffer).setUint32(0, senderPeerId >>> 0, false);
  out.set(content, 4);
  return out;
}

/** Split a reassembled envelope back into its sender peerId and content. */
export function decodeEnvelope(bytes: Uint8Array): { senderPeerId: number; content: Uint8Array } {
  if (bytes.length < 4) return { senderPeerId: 0, content: bytes };
  const senderPeerId = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  return { senderPeerId, content: bytes.slice(4) };
}

/** A header-only ACK frame confirming receipt of `msgId`. */
export function ackFrame(msgId: number): Uint8Array {
  return encodeFrame({ version: MSG_VERSION, type: MSG_TYPE.ACK, msgId, seq: 0, count: 0, payload: new Uint8Array(0) });
}

/** A fully-reassembled message handed up to the app. */
export interface CompleteMessage {
  type: number;
  msgId: number;
  bytes: Uint8Array;
}

/** What ingesting one frame produced: a finished message and/or an ack to send. */
export interface IngestResult {
  message?: CompleteMessage;
  /** A msgId we should ACK back to the sender (on completion, or a re-send). */
  ack?: number;
}

interface Partial {
  type: number;
  count: number;
  chunks: Map<number, Uint8Array>;
  bytes: number;
}

export interface ReassemblerOptions {
  /** Drop a message whose reassembled size would exceed this (bytes). */
  maxMessageBytes?: number;
  /** Max simultaneously-partial messages before the oldest is evicted (LRU). */
  maxInFlight?: number;
  /** How many recently-completed msgIds to remember for de-dupe / re-ack. */
  recentDoneCap?: number;
}

/**
 * Per-connection frame reassembler. One instance per peer. Clockless: staleness is
 * handled by LRU eviction (maxInFlight) rather than timers, so it stays pure and
 * deterministic. Never throws; malformed frames are ignored.
 */
export class Reassembler {
  private readonly maxMessageBytes: number;
  private readonly maxInFlight: number;
  private readonly recentDoneCap: number;
  // insertion-ordered → first key is the oldest (LRU).
  private partials = new Map<number, Partial>();
  private recentlyDone = new Map<number, true>();

  constructor(opts: ReassemblerOptions = {}) {
    this.maxMessageBytes = opts.maxMessageBytes ?? 64 * 1024;
    this.maxInFlight = opts.maxInFlight ?? 8;
    this.recentDoneCap = opts.recentDoneCap ?? 16;
  }

  ingest(bytes: Uint8Array): IngestResult | null {
    const frame = decodeFrame(bytes);
    if (!frame) return null;

    if (frame.type === MSG_TYPE.ACK) return { ack: frame.msgId };

    // A frame for a message we already completed: our ACK was likely lost and the
    // sender retransmitted. Re-ack, but never re-deliver the duplicate.
    if (this.recentlyDone.has(frame.msgId)) return { ack: frame.msgId };

    if (frame.count === 0 || frame.seq >= frame.count) return null; // malformed

    let entry = this.partials.get(frame.msgId);
    if (!entry) {
      this.evictIfFull();
      entry = { type: frame.type, count: frame.count, chunks: new Map(), bytes: 0 };
      this.partials.set(frame.msgId, entry);
    }
    if (entry.count !== frame.count) return null; // inconsistent re-frame — ignore
    if (entry.chunks.has(frame.seq)) return null; // duplicate chunk

    entry.chunks.set(frame.seq, frame.payload);
    entry.bytes += frame.payload.length;
    if (entry.bytes > this.maxMessageBytes) {
      this.partials.delete(frame.msgId); // oversized — abandon
      return null;
    }
    if (entry.chunks.size < entry.count) return null; // still partial

    // Complete: concatenate in seq order.
    const out = new Uint8Array(entry.bytes);
    let offset = 0;
    for (let seq = 0; seq < entry.count; seq++) {
      const chunk = entry.chunks.get(seq);
      if (!chunk) {
        // Shouldn't happen (size === count with unique 0..count-1 seqs), but never
        // emit a half-built message.
        this.partials.delete(frame.msgId);
        return null;
      }
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.partials.delete(frame.msgId);
    this.markDone(frame.msgId);
    return { message: { type: entry.type, msgId: frame.msgId, bytes: out }, ack: frame.msgId };
  }

  private evictIfFull(): void {
    while (this.partials.size >= this.maxInFlight) {
      const oldest = this.partials.keys().next().value;
      if (oldest === undefined) break;
      this.partials.delete(oldest);
    }
  }

  private markDone(msgId: number): void {
    this.recentlyDone.set(msgId, true);
    while (this.recentlyDone.size > this.recentDoneCap) {
      const oldest = this.recentlyDone.keys().next().value;
      if (oldest === undefined) break;
      this.recentlyDone.delete(oldest);
    }
  }
}
