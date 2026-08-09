/**
 * Compass heading source → store (TASKS.md P2-4).
 *
 * Uses `react-native-compass-heading`, which surfaces both a heading and an
 * Android accuracy value (0..3, mirroring SensorManager.SENSOR_STATUS_ACCURACY_*)
 * — exactly the two things payload byte 5/7 need. When the sensor is unavailable
 * we push `null`, which the encoder maps to the 0xFFFF sentinel and the alignment
 * math treats as the "trust proximity alone" fallback (CLAUDE.md §4.3).
 *
 * (CLAUDE.md §2 lists `react-native-sensors` "or a small native wrapper"; this
 * lib is the smallest thing that yields heading AND accuracy directly.)
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { useEffect } from 'react';
import CompassHeading from 'react-native-compass-heading';
import { useStore } from '../state/store.js';

/** Degrees of change before an update fires — keep small; republish gating is separate. */
const DEGREE_UPDATE_RATE = 1;

export function useHeading(): void {
  const setLocalHeading = useStore((s) => s.setLocalHeading);

  useEffect(() => {
    let active = true;
    try {
      CompassHeading.start(DEGREE_UPDATE_RATE, ({ heading, accuracy }: { heading: number; accuracy: number }) => {
        if (!active) return;
        // Normalise to 0..359.999 and clamp accuracy into the payload's 0..3.
        const norm = ((heading % 360) + 360) % 360;
        const acc = Math.max(0, Math.min(3, Math.round(accuracy)));
        setLocalHeading(norm, acc);
      });
    } catch {
      setLocalHeading(null, 0); // no compass → drive on proximity alone
    }
    return () => {
      active = false;
      try {
        CompassHeading.stop();
      } catch {
        /* no-op */
      }
    };
  }, [setLocalHeading]);
}
