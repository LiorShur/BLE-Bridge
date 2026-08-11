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
import { startAdvertising, updatePayload, stopAdvertising, setInteropMode, AdvertiseError } from './advertiser';
import { BRIDGE_SERVICE_UUID } from './gatt/constants';
import { startGattServer, updateGattPayload, stopGattServer, gattServerStatus } from './gatt/gattServer';

const POLL_MS = 250;

export interface UseAdvertiserResult {
  error: AdvertiseError | null;
}

export function useAdvertiser(
  enabled: boolean,
  gattEnabled: boolean,
  onError?: (e: AdvertiseError) => void,
): void {
  const sequence = useRef(0);
  const lastHeading = useRef<number | null>(null);
  const lastPublishAt = useRef(0);
  const hasPublished = useRef(false);
  const inFlight = useRef(false);
  const lastReactionNonce = useRef(0);
  const lastAckKey = useRef('');
  const gattServerStarted = useRef(false);
  const lastStatusPollAt = useRef(0);

  // GATT peripheral lifecycle — SEPARATE from the advertising effect so toggling
  // the interop path never tears down (and MIUI-throttles) the working
  // advertiser. setInteropMode only changes what the NEXT republish emits.
  useEffect(() => {
    if (!enabled) return;
    void setInteropMode(gattEnabled, gattEnabled ? BRIDGE_SERVICE_UUID : null);
    if (!gattEnabled) {
      gattServerStarted.current = false;
      void stopGattServer();
    }
    return () => {
      // On full unmount, restore connectionless advertising + tear the server.
      void setInteropMode(false, null);
      gattServerStarted.current = false;
      void stopGattServer();
    };
  }, [enabled, gattEnabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const REACTION_BROADCAST_MS = 2000;
    const STATUS_POLL_MS = 1500;

    const buildBase64 = (headingDeg: number | null, accuracy: number): string => {
      const state = useStore.getState();
      const headingDecideg = headingDeg === null ? null : Math.round(headingDeg * 10) % 3600;
      const r = state.outgoingReaction;
      const a = state.outgoingAck;
      const bytes = encodePayload({
        version: 1,
        peerId: state.localPeerId,
        headingDecideg,
        headingAccuracy: accuracy,
        txPower: state.localTxPower,
        hue: state.hue,
        flags: FLAG_AVAILABLE,
        sequence: sequence.current & 0xff,
        reactionTarget: r?.targetPeerId ?? 0,
        reactionId: r?.reactionId ?? 0,
        reactionNonce: r?.nonce ?? 0,
        ackTarget: a?.targetPeerId ?? 0,
        ackNonce: a?.nonce ?? 0,
      });
      return bytesToBase64(bytes);
    };

    const tick = async (now: number): Promise<void> => {
      // Serialize: never overlap a stop→start cycle with another. Overlapping
      // republishes were a real source of advertising gaps (bridge flicker).
      if (inFlight.current) return;

      const store = useStore.getState();
      const { localHeadingDeg, localHeadingAccuracy } = store;

      // Retire a reaction / ack that has been broadcast long enough (receivers
      // only need to catch it once, via the nonce).
      if (store.outgoingReaction && now - store.outgoingReaction.sentAt > REACTION_BROADCAST_MS) {
        store.clearOutgoingReaction();
      }
      if (store.outgoingAck && now - store.outgoingAck.sentAt > REACTION_BROADCAST_MS) {
        store.clearOutgoingAck();
      }
      const fresh = useStore.getState();
      const reactionNonce = fresh.outgoingReaction?.nonce ?? 0;
      const reactionChanged = reactionNonce !== lastReactionNonce.current;
      const ackKey = fresh.outgoingAck ? `${fresh.outgoingAck.targetPeerId}:${fresh.outgoingAck.nonce}` : '';
      const ackChanged = ackKey !== lastAckKey.current;

      const due =
        reactionChanged ||
        ackChanged ||
        shouldRepublish({
          prevHeadingDeg: lastHeading.current,
          nextHeadingDeg: localHeadingDeg,
          msSinceLastPublish: now - lastPublishAt.current,
          hasPublished: hasPublished.current,
        });
      if (!due) return;

      inFlight.current = true;
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
        lastReactionNonce.current = reactionNonce;
        lastAckKey.current = ackKey;
        useStore.getState().setAdvertiserStatus(true, null);

        // Interop: mirror the same payload out over the GATT server (notify).
        // gattEnabled is read LIVE so the toggle takes effect without re-mounting.
        if (useStore.getState().gattEnabled) {
          if (!gattServerStarted.current) {
            gattServerStarted.current = true;
            void startGattServer(b64);
          } else {
            void updateGattPayload(b64);
          }
          if (now - lastStatusPollAt.current > STATUS_POLL_MS) {
            lastStatusPollAt.current = now;
            void gattServerStatus().then((s) =>
              useStore.getState().setGattStatus({ serverRunning: s.running, subscribers: s.subscribers }),
            );
          }
        }
      } catch (e) {
        if (e instanceof AdvertiseError) {
          useStore.getState().setAdvertiserStatus(false, e.code);
          onError?.(e);
        }
      } finally {
        inFlight.current = false;
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
