/**
 * Compass heading source (Stage 2) — reads our native `Heading` module
 * (android/.../ble/HeadingModule.kt), which surfaces a heading plus an Android
 * accuracy value (0..3, mirroring SensorManager.SENSOR_STATUS_ACCURACY_*) —
 * exactly what payload bytes 5/7 need.
 *
 * When the sensor is unavailable we push `null`, which the encoder maps to the
 * 0xFFFF sentinel and the alignment math treats as the "trust proximity alone"
 * fallback (CLAUDE.md §4.3).
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { useEffect } from 'react';
import { NativeModules, NativeEventEmitter } from 'react-native';
import { useStore } from '../state/store';

interface NativeHeading {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function useCompassHeading(): void {
  const setLocalHeading = useStore((s) => s.setLocalHeading);

  useEffect(() => {
    const mod = NativeModules.Heading as NativeHeading | undefined;
    if (!mod) {
      setLocalHeading(null, 0);
      return;
    }
    const emitter = new NativeEventEmitter(NativeModules.Heading);
    const sub = emitter.addListener('Heading:update', (e: { heading: number; accuracy: number }) => {
      const norm = ((e.heading % 360) + 360) % 360;
      const acc = Math.max(0, Math.min(3, Math.round(e.accuracy)));
      setLocalHeading(norm, acc);
    });
    mod.start().catch(() => setLocalHeading(null, 0));

    return () => {
      sub.remove();
      mod.stop().catch(() => {
        /* no-op */
      });
    };
  }, [setLocalHeading]);
}
