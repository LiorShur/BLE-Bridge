/**
 * RSSI smoothing, distance model, and proximity mapping — see CLAUDE.md §4.1–4.2.
 *
 * Pure functions. No I/O, no globals. The distance model uses the PEER's
 * advertised txPower (payload byte 8), never a local constant — that asymmetry
 * is the single biggest source of the two devices disagreeing on distance.
 */

/** Default EMA weight for the newest RSSI sample. */
export const DEFAULT_ALPHA = 0.2;

/** Default indoor path-loss exponent. */
export const DEFAULT_PATH_LOSS_N = 2.2;

/** Distance (m) at/below which proximity saturates to 1. */
export const D_NEAR = 0.5;

/** Distance (m) at/above which proximity is 0. */
export const D_FAR = 5.0;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Exponential moving average of RSSI in the dBm domain.
 *
 * Seed by passing `prev = null` for the first sample — the raw value is returned
 * unchanged, never blended toward 0 (a 0-seed would read as an impossibly strong
 * signal and take many samples to wash out).
 *
 * @param rssi   newest raw RSSI (dBm, negative)
 * @param prev   previous smoothed value, or `null` to seed
 * @param alpha  weight of the newest sample, 0..1
 */
export function smoothRssi(rssi: number, prev: number | null, alpha: number = DEFAULT_ALPHA): number {
  if (prev === null) return rssi;
  return alpha * rssi + (1 - alpha) * prev;
}

/**
 * Log-distance path-loss estimate: `d = 10 ^ ((txPower − rssi) / (10·n))`.
 *
 * @param smoothedRssi  smoothed RSSI (dBm)
 * @param peerTxPower   the PEER's calibrated 1 m reference (dBm, from their payload)
 * @param n             path-loss exponent (indoor default 2.2)
 * @returns distance in metres (a band estimate — never display it raw outside the HUD)
 */
export function estimateDistance(
  smoothedRssi: number,
  peerTxPower: number,
  n: number = DEFAULT_PATH_LOSS_N,
): number {
  return 10 ** ((peerTxPower - smoothedRssi) / (10 * n));
}

/**
 * Map an estimated distance to `proximity` in 0..1:
 * `clamp((D_FAR − d) / (D_FAR − D_NEAR), 0, 1)`.
 */
export function proximityFromDistance(
  distance: number,
  dNear: number = D_NEAR,
  dFar: number = D_FAR,
): number {
  return clamp01((dFar - distance) / (dFar - dNear));
}
