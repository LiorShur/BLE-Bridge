/**
 * GattMessaging — the orchestration for the Tier 2 channel
 * (docs/GATT_MESSAGING_SPEC.md §4). Ties the PURE, tested pieces (frame codec +
 * Reassembler + OutboundQueue in messaging.ts / outbound.ts) to the two transport
 * directions:
 *
 *   - CENTRAL: when we hold a GATT link to a peer (gattClient), write frames to
 *     its message characteristic and receive its notifications.
 *   - PERIPHERAL: when a peer connected to US, notify frames (broadcast to
 *     subscribed centrals) and receive their writes via native events.
 *
 * A message is addressed by peerId; the sender's peerId also rides an envelope
 * inside the message so the receiver identifies the sender no matter which
 * transport delivered it. Reliability (ack + retransmit) is the OutboundQueue.
 *
 * LIMITATION (v0): messaging needs a GATT connection, so it works Android↔iPhone
 * and iPhone↔iPhone — NOT Android↔Android, which is connectionless by design
 * (CLAUDE.md §3.1). Reassembly assumes ~one active messaging peer per transport
 * channel, which holds for the pilot's 1:1 use.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite (the parts
 * that can be are — messaging.ts, outbound.ts).
 */
import type { EmitterSubscription } from 'react-native';
import type { GattClient } from './gattClient';
import { base64ToBytes, bytesToBase64 } from '../base64';
import {
  decodeFrame,
  frameMessage,
  ackFrame,
  encodeEnvelope,
  decodeEnvelope,
  Reassembler,
  MSG_TYPE,
  FRAME_HEADER,
  type MsgType,
} from './messaging';
import { OutboundQueue } from './outbound';
import { notifyGattMessage, onGattServerMessage, onGattServerMtu } from './gattServer';
import { notifyIosMessage, onIosPeripheralMessage, onIosPeripheralMtu } from './iosPeripheral';

const PUMP_MS = 300;
const DEFAULT_MTU = 23;
// A tiny gap between frames to let the radio breathe. Central writes are already
// ATT-flow-controlled (write-with-response), so this mainly smooths the notify path.
const FRAME_GAP_MS = 6;
// When a transport reports "not sent" (iOS notify queue full), wait this long before
// re-trying the SAME frame, up to MAX_FRAME_TRIES times. This is per-frame
// backpressure — the piece that lets a multi-frame photo survive a full TX buffer.
const BACKPRESSURE_MS = 60;
const MAX_FRAME_TRIES = 20;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type MessageHandler = (peerId: number, type: number, content: Uint8Array) => void;

export class GattMessaging {
  private readonly client: GattClient;
  private readonly localPeerId: () => number;
  // Longer retransmit window than the default so a multi-frame photo (which now
  // drains serially and can take >1 s) fully lands before its first retransmit.
  private readonly outbound = new OutboundQueue({ retryMs: 4000, maxTries: 6 });
  private readonly reassemblers = new Map<string, Reassembler>();
  private readonly targets = new Map<number, number>(); // msgId → peerId
  private peripheralMtu = DEFAULT_MTU;
  private nextMsgId = 1;
  private onMessageCb?: MessageHandler;
  private timer: ReturnType<typeof setInterval> | null = null;
  // Paced outbound frame queue (message frames only; acks go immediately).
  private outFrames: { peerId: number; msgId: number; b64: string; tries: number }[] = [];
  // msgIds whose frames are currently queued/draining, so a retransmit doesn't pile
  // a second copy on top of a send that's still in flight.
  private queuedMsgIds = new Set<number>();
  private draining = false;
  private subs: EmitterSubscription[] = [];

  constructor(client: GattClient, localPeerId: () => number) {
    this.client = client;
    this.localPeerId = localPeerId;

    // Inbound — central: notifications from a peer we dialed.
    client.setMessageSink((deviceId, b64) => this.onInbound(`c:${deviceId}`, deviceId, b64));
    // Inbound — peripheral: writes from a central connected to us.
    this.pushSub(onGattServerMessage((addr, b64) => this.onInbound(`a:${addr}`, null, b64)));
    this.pushSub(onIosPeripheralMessage((b64) => this.onInbound('i', null, b64)));
    // Peripheral notify size — chunk outbound peripheral frames to it.
    this.pushSub(onGattServerMtu((_addr, mtu) => (this.peripheralMtu = Math.max(this.peripheralMtu, mtu))));
    this.pushSub(onIosPeripheralMtu((mtu) => (this.peripheralMtu = Math.max(this.peripheralMtu, mtu))));

    this.timer = setInterval(() => this.pump(Date.now()), PUMP_MS);
  }

  onMessage(cb: MessageHandler): void {
    this.onMessageCb = cb;
  }

  /** Send `content` of `type` to `peerId`, reliably (acked + retransmitted). */
  send(peerId: number, type: MsgType, content: Uint8Array): void {
    const envelope = encodeEnvelope(this.localPeerId(), content);
    const msgId = this.allocMsgId();
    const maxFrame = Math.max(FRAME_HEADER + 1, this.mtuFor(peerId) - 3);
    const frames = frameMessage(type, msgId, envelope, maxFrame);
    this.targets.set(msgId, peerId >>> 0);
    this.outbound.enqueue(msgId, frames, Date.now());
    this.pump(Date.now());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.outFrames = [];
    this.queuedMsgIds.clear();
    for (const s of this.subs) s.remove();
    this.subs = [];
    this.reassemblers.clear();
    this.targets.clear();
  }

  // ---- internals ----------------------------------------------------------

  private pushSub(s: EmitterSubscription | null): void {
    if (s) this.subs.push(s);
  }

  private allocMsgId(): number {
    const id = this.nextMsgId;
    this.nextMsgId = (this.nextMsgId % 0xffff) + 1; // 1..65535, never 0
    return id;
  }

  private mtuFor(peerId: number): number {
    const deviceId = this.client.deviceIdForPeer(peerId);
    return deviceId ? this.client.peerMtu(deviceId) : this.peripheralMtu;
  }

  private pump(now: number): void {
    const { send, failed } = this.outbound.poll(now);
    for (const s of send) {
      const peerId = this.targets.get(s.msgId);
      if (peerId === undefined) continue;
      // Skip a message whose frames are still queued/draining from a prior (re)send
      // — piling a second copy on top only congests the radio and never helps.
      if (this.queuedMsgIds.has(s.msgId)) continue;
      this.queuedMsgIds.add(s.msgId);
      for (const frame of s.frames) {
        this.outFrames.push({ peerId, msgId: s.msgId, b64: bytesToBase64(frame), tries: 0 });
      }
    }
    for (const msgId of failed) {
      this.targets.delete(msgId);
      this.dropQueuedMsg(msgId);
    }
    this.kickDrain();
  }

  /** Start the serialized drain if it isn't already running. */
  private kickDrain(): void {
    if (this.draining || this.outFrames.length === 0) return;
    this.draining = true;
    void this.drainLoop();
  }

  /**
   * Send queued frames one at a time, AWAITING each so we pace to the transport
   * instead of bursting. A frame the transport couldn't send (iOS notify queue
   * full) is put back and retried after a short wait, up to MAX_FRAME_TRIES; only
   * then is the whole message's remainder dropped (the ack/retransmit re-sends it).
   */
  private async drainLoop(): Promise<void> {
    try {
      for (;;) {
        const next = this.outFrames.shift();
        if (!next) break;
        const ok = await this.writeFrameTo(next.peerId, next.b64);
        if (!ok) {
          next.tries += 1;
          if (next.tries <= MAX_FRAME_TRIES) {
            this.outFrames.unshift(next); // hold this frame; the radio buffer is full
            await delay(BACKPRESSURE_MS);
            continue;
          }
          this.dropQueuedMsg(next.msgId); // give up on this send; retransmit will retry
          continue;
        }
        // Last frame of this message just left → clear its mark so a later
        // retransmit (if still unacked) is allowed to re-enqueue it.
        if (!this.outFrames.some((f) => f.msgId === next.msgId)) this.queuedMsgIds.delete(next.msgId);
        if (FRAME_GAP_MS > 0) await delay(FRAME_GAP_MS);
      }
    } finally {
      this.draining = false;
      // A retransmit may have queued more frames while we were awaiting — pick them up.
      if (this.outFrames.length > 0) this.kickDrain();
    }
  }

  /** Remove any queued frames for a message and clear its in-flight mark. */
  private dropQueuedMsg(msgId: number): void {
    this.outFrames = this.outFrames.filter((f) => f.msgId !== msgId);
    this.queuedMsgIds.delete(msgId);
  }

  /**
   * Route one frame to a peer and report whether the transport accepted it: central
   * write (ATT-flow-controlled) if we dialed the peer, else peripheral notify. On
   * the notify path iOS reports a full queue as `false`; a no-op module resolves
   * `true` so it never stalls the drain on the platform it isn't running on.
   */
  private writeFrameTo(peerId: number, b64: string): Promise<boolean> {
    const deviceId = this.client.deviceIdForPeer(peerId);
    if (deviceId) return this.client.writeMessageFrame(deviceId, b64);
    return Promise.all([notifyGattMessage(b64), notifyIosMessage(b64)]).then(([a, i]) => a && i);
  }

  private ackToChannel(channelKey: string, deviceId: string | null, ackB64: string): void {
    if (channelKey.startsWith('c:') && deviceId) {
      void this.client.writeMessageFrame(deviceId, ackB64);
    } else {
      void notifyGattMessage(ackB64);
      void notifyIosMessage(ackB64);
    }
  }

  private onInbound(channelKey: string, deviceId: string | null, b64: string): void {
    const bytes = base64ToBytes(b64);
    const frame = decodeFrame(bytes);
    if (!frame) return;

    // An ACK for a message WE sent → stop retransmitting it.
    if (frame.type === MSG_TYPE.ACK) {
      this.outbound.ack(frame.msgId);
      this.targets.delete(frame.msgId);
      return;
    }

    let r = this.reassemblers.get(channelKey);
    if (!r) {
      r = new Reassembler();
      this.reassemblers.set(channelKey, r);
    }
    const res = r.ingest(bytes);
    if (!res) return;

    if (res.message) {
      const { senderPeerId, content } = decodeEnvelope(res.message.bytes);
      this.onMessageCb?.(senderPeerId, res.message.type, content);
      this.ackToChannel(channelKey, deviceId, bytesToBase64(ackFrame(res.message.msgId)));
    } else if (res.ack !== undefined) {
      // A retransmitted, already-complete message (our earlier ack was lost) — re-ack.
      this.ackToChannel(channelKey, deviceId, bytesToBase64(ackFrame(res.ack)));
    }
  }
}
