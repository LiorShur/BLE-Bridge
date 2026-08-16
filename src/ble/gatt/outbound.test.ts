import { describe, it, expect } from 'vitest';
import { OutboundQueue } from './outbound';

const f = (n: number): Uint8Array[] => [new Uint8Array([n])];

describe('OutboundQueue', () => {
  it('sends an enqueued message on the next poll', () => {
    const q = new OutboundQueue();
    q.enqueue(1, f(1), 0);
    const r = q.poll(0);
    expect(r.send.map((s) => s.msgId)).toEqual([1]);
    expect(r.failed).toEqual([]);
    expect(q.isPending(1)).toBe(true); // still awaiting ack
  });

  it('does not resend before the retry interval, then resends after it', () => {
    const q = new OutboundQueue({ retryMs: 1000, maxTries: 4 });
    q.enqueue(1, f(1), 0);
    q.poll(0); // first send (tries=1, nextAt=1000)
    expect(q.poll(500).send).toEqual([]); // too soon
    expect(q.poll(1000).send.map((s) => s.msgId)).toEqual([1]); // retransmit
  });

  it('stops resending once acked', () => {
    const q = new OutboundQueue({ retryMs: 1000 });
    q.enqueue(1, f(1), 0);
    q.poll(0);
    expect(q.ack(1)).toBe(true);
    expect(q.poll(1000).send).toEqual([]);
    expect(q.pendingCount()).toBe(0);
    expect(q.ack(1)).toBe(false); // already gone
  });

  it('fails a message after maxTries and removes it', () => {
    const q = new OutboundQueue({ retryMs: 100, maxTries: 3 });
    q.enqueue(1, f(1), 0);
    let t = 0;
    // three sends at t=0,100,200; at t=300 it's out of tries → failed
    expect(q.poll(t).send).toHaveLength(1); // try 1
    expect(q.poll((t += 100)).send).toHaveLength(1); // try 2
    expect(q.poll((t += 100)).send).toHaveLength(1); // try 3
    const r = q.poll((t += 100));
    expect(r.send).toEqual([]);
    expect(r.failed).toEqual([1]);
    expect(q.pendingCount()).toBe(0);
  });

  it('handles several messages independently', () => {
    const q = new OutboundQueue({ retryMs: 1000 });
    q.enqueue(1, f(1), 0);
    q.enqueue(2, f(2), 0);
    q.poll(0);
    q.ack(1);
    const r = q.poll(1000);
    expect(r.send.map((s) => s.msgId)).toEqual([2]); // only the unacked one resends
  });
});
