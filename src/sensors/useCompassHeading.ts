/**
 * REAL compass heading source (Stage 2). Inert until then: nothing imports this
 * and `react-native-compass-heading` is not a Stage-1 dependency, so it is not
 * bundled and cannot affect the Stage-1 build. Excluded from tsconfig.app until
 * the dep is added.
 *
 * Uses `react-native-compass-heading`, which surfaces both a heading and an
 * Android accuracy value (0..3, mirroring SensorManager.SENSOR_STATUS_ACCURACY_*)
 * — exactly what payload bytes 5/7 need. When the sensor is unavailable we push
 * `null`, which the encoder maps to the 0xFFFF sentinel and the alignment math
 * treats as the "trust proximity alone" fallback (CLAUDE.md §4.3).
 */
import { useEffect } from 'react';
// eslint-disable-next-line import/no-unresolved -- Stage-2 dependency, added later
import CompassHeading from 'react-native-compass-heading';
import { useStore } from '../state/store';

const DEGREE_UPDATE_RATE = 1;

export function useCompassHeading(): void {
  const setLocalHeading = useStore((s) => s.setLocalHeading);

  useEffect(() => {
    let active = true;
    try {
      CompassHeading.start(DEGREE_UPDATE_RATE, ({ heading, accuracy }: { heading: number; accuracy: number }) => {
        if (!active) return;
        const norm = ((heading % 360) + 360) % 360;
        const acc = Math.max(0, Math.min(3, Math.round(accuracy)));
        setLocalHeading(norm, acc);
      });
    } catch {
      setLocalHeading(null, 0);
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
