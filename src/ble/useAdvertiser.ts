/**
 * Owns the outgoing advertisement: builds the payload from store state and
 * republishes it under the PAYLOAD_SPEC §7 policy (TASKS.md P1-6, P2-5).
 *
 * A republish is a native stop→start, so this deliberately does NOT run at
 * sensor rate — it polls a few times a second and only republishes when the
 * heading has moved >5° or 1 s has elapsed. The sequence counter increments on
 * every republish so a receiver can measure our refresh rate.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { encodePayload, FLAG_AVAILABLE } from './payload';
import { bytesToBase64 } from './base64';
import { shouldRepublish } from './republish';
import { startAdvertising, updatePayload, stopAdvertising, AdvertiseError } from './advertiser';

const POLL_MS = 250;

export interface UseAdvertiserResult {
  error: AdvertiseError | null;
}

export function useAdvertiser(enabled: boolean, onError?: (e: AdvertiseError) => void): void {
  const sequence = useRef(0);
  const lastHeading = useRef<number | null>(null);
  const lastPublishAt = useRef(0);
  const hasPublished = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const buildBase64 = (headingDeg: number | null, accuracy: number): string => {
      const state = useStore.getState();
      const headingDecideg = headingDeg === null ? null : Math.round(headingDeg * 10) % 3600;
      const bytes = encodePayload({
        version: 1,
        peerId: state.localPeerId,
        headingDecideg,
        headingAccuracy: accuracy,
        txPower: state.localTxPower,
        hue: state.hue,
        flags: FLAG_AVAILABLE,
        sequence: sequence.current & 0xff,
      });
      return bytesToBase64(bytes);
    };

    const tick = async (now: number): Promise<void> => {
      const { localHeadingDeg, localHeadingAccuracy } = useStore.getState();
      const due = shouldRepublish({
        prevHeadingDeg: lastHeading.current,
        nextHeadingDeg: localHeadingDeg,
        msSinceLastPublish: now - lastPublishAt.current,
        hasPublished: hasPublished.current,
      });
      if (!due) return;

      sequence.current = (sequence.current + 1) & 0xff;
      const b64 = buildBase64(localHeadingDeg, localHeadingAccuracy);
      try {
        if (!hasPublished.current) {
          await startAdvertising(b64);
        } else {
          await updatePayload(b64);
        }
        if (cancelled) return;
        hasPublished.current = true;
        lastHeading.current = localHeadingDeg;
        lastPublishAt.current = now;
      } catch (e) {
        if (e instanceof AdvertiseError) onError?.(e);
      }
    };

    const interval = setInterval(() => {
      void tick(Date.now());
    }, POLL_MS);
    // Fire an immediate first publish rather than waiting a full poll.
    void tick(Date.now());

    return () => {
      cancelled = true;
      clearInterval(interval);
      void stopAdvertising();
      hasPublished.current = false;
    };
  }, [enabled, onError]);
}
