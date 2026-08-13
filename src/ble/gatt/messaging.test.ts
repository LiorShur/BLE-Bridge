import { describe, it, expect } from 'vitest';
import {
  encodeFrame,
  decodeFrame,
  frameMessage,
  ackFrame,
  Reassembler,
  MSG_TYPE,
  MSG_VERSION,
  FRAME_HEADER,
} from './messaging';

const enc = new TextEncoder();
const dec = new TextDecoder();
const bytes = (s: string): Uint8Array => enc.encode(s);

/** Feed a whole message's frames through a reassembler; return the last result. */
function pump(r: Reassembler, frames: Uint8Array[]): ReturnType<Reassembler['ingest']> {
  let last: ReturnType<Reassembler['ingest']> = null;
  for (const f of frames) last = r.ingest(f);
  return last;
}

describe('frame codec', () => {
  it('round-trips a frame', () => {
    const f = { version: MSG_VERSION, type: MSG_TYPE.TEXT, msgId: 1234, seq: 2, count: 5, payload: bytes('hello') };
    const d = decodeFrame(encodeFrame(f));
    expect(d).not.toBeNull();
    expect(d!.type).toBe(MSG_TYPE.TEXT);
    expect(d!.msgId).toBe(1234);
    expect(d!.seq).toBe(2);
    expect(d!.count).toBe(5);
    expect(dec.decode(d!.payload)).toBe('hello');
  });

  it('rejects a short buffer, bad version, and a truncated payload', () => {
    expect(decodeFrame(new Uint8Array(FRAME_HEADER - 1))).toBeNull();
    const good = encodeFrame({ version: MSG_VERSION, type: 1, msgId: 1, seq: 0, count: 1, payload: bytes('hi') });
    const badVersion = good.slice();
    badVersion[0] = 0x02;
    expect(decodeFrame(badVersion)).toBeNull();
    expect(decodeFrame(good.subarray(0, FRAME_HEADER + 1))).toBeNull(); // says 2 payload bytes, only 1 present
  });

  it('decodes at a non-zero byteOffset (subarray view)', () => {
    const framed = new Uint8Array(8 + FRAME_HEADER + 3);
    framed.set(encodeFrame({ version: MSG_VERSION, type: 1, msgId: 7, seq: 0, count: 1, payload: bytes('abc') }), 8);
    expect(dec.decode(decodeFrame(framed.subarray(8))!.payload)).toBe('abc');
  });
});

describe('frameMessage', () => {
  it('splits into ceil(len/chunk) frames that each fit the MTU', () => {
    const msg = bytes('x'.repeat(1000));
    const maxFrame = 100; // 90 payload bytes/frame
    const frames = frameMessage(MSG_TYPE.TEXT, 1, msg, maxFrame);
    expect(frames.length).toBe(Math.ceil(1000 / 90));
    expect(frames.every((f) => f.length <= maxFrame)).toBe(true);
  });

  it('emits exactly one frame for an empty message', () => {
    const frames = frameMessage(MSG_TYPE.TEXT, 9, new Uint8Array(0), 50);
    expect(frames.length).toBe(1);
    const d = decodeFrame(frames[0]!)!;
    expect(d.count).toBe(1);
    expect(d.payload.length).toBe(0);
  });

  it('handles a length that is an exact multiple of the chunk size', () => {
    const msg = bytes('y'.repeat(180)); // 2 × 90
    const frames = frameMessage(MSG_TYPE.TEXT, 2, msg, 100);
    expect(frames.length).toBe(2);
  });

  it('throws if the MTU cannot hold the header', () => {
    expect(() => frameMessage(MSG_TYPE.TEXT, 1, bytes('x'), FRAME_HEADER)).toThrow(RangeError);
  });
});

describe('Reassembler', () => {
  it('reassembles a single-frame message and asks to ack it', () => {
    const r = new Reassembler();
    const frames = frameMessage(MSG_TYPE.TEXT, 42, bytes('hi there'), 100);
    const res = pump(r, frames);
    expect(res?.message?.msgId).toBe(42);
    expect(res?.ack).toBe(42);
    expect(dec.decode(res!.message!.bytes)).toBe('hi there');
  });

  it('reassembles a multi-frame message, and only completes on the last frame', () => {
    const r = new Reassembler();
    const original = 'z'.repeat(500);
    const frames = frameMessage(MSG_TYPE.PROFILE, 5, bytes(original), 60);
    expect(frames.length).toBeGreaterThan(1);
    for (let i = 0; i < frames.length - 1; i++) expect(r.ingest(frames[i]!)).toBeNull();
    const res = r.ingest(frames[frames.length - 1]!);
    expect(res?.message?.type).toBe(MSG_TYPE.PROFILE);
    expect(dec.decode(res!.message!.bytes)).toBe(original);
  });

  it('tolerates out-of-order and duplicate chunks', () => {
    const r = new Reassembler();
    const original = 'abcdef'.repeat(50);
    const frames = frameMessage(MSG_TYPE.TEXT, 8, bytes(original), 40);
    const shuffled = [...frames].reverse();
    // inject a duplicate of the first-delivered frame
    shuffled.splice(1, 0, shuffled[0]!);
    let done: ReturnType<Reassembler['ingest']> = null;
    for (const f of shuffled) {
      const res = r.ingest(f);
      if (res?.message) done = res;
    }
    expect(dec.decode(done!.message!.bytes)).toBe(original);
  });

  it('emits {ack} with no message for an ACK frame', () => {
    const r = new Reassembler();
    const res = r.ingest(ackFrame(77));
    expect(res).toEqual({ ack: 77 });
  });

  it('re-acks but does NOT re-deliver a retransmitted, already-complete message', () => {
    const r = new Reassembler();
    const frames = frameMessage(MSG_TYPE.TEXT, 3, bytes('once'), 100);
    expect(pump(r, frames)?.message).toBeDefined();
    // sender didn't see our ack, resends the same frames
    const again = r.ingest(frames[0]!);
    expect(again?.ack).toBe(3);
    expect(again?.message).toBeUndefined();
  });

  it('drops an oversized message instead of buffering it', () => {
    const r = new Reassembler({ maxMessageBytes: 100 });
    const frames = frameMessage(MSG_TYPE.PROFILE, 1, bytes('q'.repeat(300)), 60);
    const res = pump(r, frames);
    expect(res?.message).toBeUndefined();
  });

  it('ignores a malformed frame whose seq is beyond its count', () => {
    const r = new Reassembler();
    const bad = encodeFrame({ version: MSG_VERSION, type: 1, msgId: 1, seq: 5, count: 3, payload: bytes('x') });
    expect(r.ingest(bad)).toBeNull();
  });

  it('interleaves two messages without cross-contamination', () => {
    const r = new Reassembler();
    const a = frameMessage(MSG_TYPE.TEXT, 100, bytes('A'.repeat(120)), 50);
    const b = frameMessage(MSG_TYPE.TEXT, 200, bytes('B'.repeat(120)), 50);
    // interleave a[0], b[0], a[1], b[1], ...
    const results: string[] = [];
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      if (a[i]) {
        const res = r.ingest(a[i]!);
        if (res?.message) results.push(dec.decode(res.message.bytes));
      }
      if (b[i]) {
        const res = r.ingest(b[i]!);
        if (res?.message) results.push(dec.decode(res.message.bytes));
      }
    }
    expect(results).toContain('A'.repeat(120));
    expect(results).toContain('B'.repeat(120));
  });
});
