/**
 * iOS peripheral driver (P-i2b). The counterpart of useAdvertiser for iOS: it
 * builds the 24-byte payload from store state and pushes it to the native
 * BlePeripheral module, which advertises the Bridge service UUID and serves the
 * payload as a GATT characteristic. This is how an iPhone becomes discoverable
 * and readable by an Android central (docs/GATT_SPEC.md §5).
 *
 * Heading comes from the native `Heading` module (Heading.swift, CoreLocation)
 * via the store, exactly like Android — so a facing-aware bond forms iPhone↔
 * Android. If the compass is unavailable the store holds null and the payload
 * carries the sentinel, which the alignment fallback treats as proximity-only.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { encodePayload, FLAG_AVAILABLE } from './payload';
import { bytesToBase64 } from './base64';
import {
  startIosPeripheral,
  updateIosPeripheralPayload,
  stopIosPeripheral,
  iosPeripheralStatus,
  iosPeripheralAvailable,
} from './gatt/iosPeripheral';

const TICK_MS = 1000;
const STATUS_POLL_MS = 1500;

export function useIosPeripheral(enabled: boolean): void {
  const sequence = useRef(0);
  const started = useRef(false);
  const lastStatusAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    // Definitive diagnosis: if the Swift module isn't compiled into the app, say
    // so in the HUD (advertising line) rather than sitting on "starting…".
    if (!iosPeripheralAvailable()) {
      useStore
        .getState()
        .setAdvertiserStatus(false, 'BlePeripheral module missing — check Xcode target + bridging header');
      return;
    }

    const buildBase64 = (): string => {
      const s = useStore.getState();
      const r = s.outgoingReaction;
      const a = s.outgoingAck;
      const headingDecideg =
        s.localHeadingDeg === null ? null : Math.round(s.localHeadingDeg * 10) % 3600;
      const bytes = encodePayload({
        version: 1,
        peerId: s.localPeerId,
        headingDecideg,
        headingAccuracy: s.localHeadingAccuracy,
        txPower: s.localTxPower,
        hue: s.hue,
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
      sequence.current = (sequence.current + 1) & 0xff;
      const b64 = buildBase64();
      if (!started.current) {
        started.current = true;
        await startIosPeripheral(b64);
      } else {
        await updateIosPeripheralPayload(b64);
      }
      if (now - lastStatusAt.current > STATUS_POLL_MS) {
        lastStatusAt.current = now;
        const st = await iosPeripheralStatus();
        const store = useStore.getState();
        store.setGattStatus({ serverRunning: st.running, subscribers: st.subscribers });
        store.setAdvertiserStatus(st.running, null);
      }
    };

    void tick(Date.now());
    const interval = setInterval(() => void tick(Date.now()), TICK_MS);

    return () => {
      clearInterval(interval);
      started.current = false;
      void stopIosPeripheral();
    };
  }, [enabled]);
}
