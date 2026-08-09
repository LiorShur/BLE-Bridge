/**
 * Per-model txPower calibration table — see docs/PAYLOAD_SPEC.md §3 and
 * TASKS.md P2-2.
 *
 * `txPower` is the calibrated RSSI (dBm) measured at exactly 1 m for a given
 * device model. Each device advertises its OWN value; the receiver uses the
 * PEER's advertised value in the distance model, never a local constant. These
 * numbers are placeholders until measured on the real test devices — see
 * docs/CALIBRATION.md — but the plumbing is correct today.
 */

/** Fallback when a model has not been calibrated. Typical BLE ~-59 dBm at 1 m. */
export const DEFAULT_TX_POWER = -59;

/**
 * Measured 1 m reference RSSI by `Build.MODEL` string. VALUES ARE PLACEHOLDERS
 * pending on-device calibration (P2-2). Keep in sync with docs/CALIBRATION.md.
 */
export const TX_POWER_BY_MODEL: Readonly<Record<string, number>> = {
  // 'Pixel 6': -59,
  // 'Pixel 7': -61,
  // 'SM-S911B': -63, // Galaxy S23
};

/**
 * Resolve the local device's advertised txPower. Returns the calibrated value
 * for the model when known, otherwise {@link DEFAULT_TX_POWER}. Result is always
 * a valid int8.
 */
export function resolveTxPower(model: string | undefined | null): number {
  if (model && model in TX_POWER_BY_MODEL) {
    return TX_POWER_BY_MODEL[model] as number;
  }
  return DEFAULT_TX_POWER;
}
