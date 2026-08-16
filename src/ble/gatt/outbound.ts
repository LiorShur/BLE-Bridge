/**
 * Outbound reliability for the GATT messaging channel
 * (docs/GATT_MESSAGING_SPEC.md §2.3) — the PURE send-side state machine.
 *
 * GATT writes/notifies are ordered and reliable per-connection, but a write can
 * still fail and a notify can be missed under load, so messages are acked at the
 * app layer: hold each sent message "unacked" until its ACK arrives, retransmit on
 * a timeout, and give up (surface a failure) after a few tries.
 *
 * Clock is injected (a `now` millis argument) so this is deterministic and fully
 * unit-tested off-device — the RN service just supplies real time + the transport.
 */

interface Pending {
  frames: Uint8Array[];
  tries: number;
  /** Earliest time this message should be (re)sent. */
  nextAt: number;
}

export interface OutboundOptions {
  /** Delay before a retransmit (ms). */
  retryMs?: number;
  /** Total send attempts before the message is declared failed. */
  maxTries?: number;
}

export interface PollResult {
  /** Messages whose frames should be written to the transport right now. */
  send: { msgId: number; frames: Uint8Array[] }[];
  /** Messages that exhausted their retries — surface as a failed send. */
  failed: number[];
}

/**
 * Tracks unacked outbound messages and decides, on each `poll(now)`, which to
 * (re)send and which have failed. One instance per peer connection.
 */
export class OutboundQueue {
  private readonly retryMs: number;
  private readonly maxTries: number;
  private pending = new Map<number, Pending>();

  constructor(opts: OutboundOptions = {}) {
    this.retryMs = opts.retryMs ?? 1500;
    this.maxTries = opts.maxTries ?? 4;
  }

  /** Queue a message's frames for sending. It goes out on the next {@link poll}. */
  enqueue(msgId: number, frames: Uint8Array[], now: number): void {
    this.pending.set(msgId, { frames, tries: 0, nextAt: now });
  }

  /** Acknowledge a message; returns true if it was still pending. */
  ack(msgId: number): boolean {
    return this.pending.delete(msgId);
  }

  /**
   * Advance the clock: returns the messages due to be (re)sent now (their try
   * count is incremented and next retry scheduled) and the messages that have
   * exhausted retries (removed from the queue).
   */
  poll(now: number): PollResult {
    const send: PollResult['send'] = [];
    const failed: number[] = [];
    for (const [msgId, p] of this.pending) {
      if (now < p.nextAt) continue;
      if (p.tries >= this.maxTries) {
        failed.push(msgId);
        this.pending.delete(msgId);
        continue;
      }
      p.tries += 1;
      p.nextAt = now + this.retryMs;
      send.push({ msgId, frames: p.frames });
    }
    return { send, failed };
  }

  /** Number of messages still awaiting an ack. */
  pendingCount(): number {
    return this.pending.size;
  }

  /** True if this specific message is still awaiting an ack. */
  isPending(msgId: number): boolean {
    return this.pending.has(msgId);
  }
}
