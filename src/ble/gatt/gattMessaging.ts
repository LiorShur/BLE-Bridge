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

export type MessageHandler = (peerId: number, type: number, content: Uint8Array) => void;

export class GattMessaging {
  private readonly client: GattClient;
  private readonly localPeerId: () => number;
  private readonly outbound = new OutboundQueue();
  private readonly reassemblers = new Map<string, Reassembler>();
  private readonly targets = new Map<number, number>(); // msgId → peerId
  private peripheralMtu = DEFAULT_MTU;
  private nextMsgId = 1;
  private onMessageCb?: MessageHandler;
  private timer: ReturnType<typeof setInterval> | null = null;
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
      for (const frame of s.frames) this.sendFrameTo(peerId, bytesToBase64(frame));
    }
    for (const msgId of failed) this.targets.delete(msgId);
  }

  /** Route one frame to a peer: central write if we dialed it, else peripheral notify. */
  private sendFrameTo(peerId: number, b64: string): void {
    const deviceId = this.client.deviceIdForPeer(peerId);
    if (deviceId) {
      void this.client.writeMessageFrame(deviceId, b64);
    } else {
      // We're the peripheral for this peer — broadcast. Each notify is a no-op on
      // the platform whose native module is absent, so calling both is safe.
      void notifyGattMessage(b64);
      void notifyIosMessage(b64);
    }
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
