/**
 * Visual binding math + effect configuration for the AR bridge.
 *
 * Kept as PURE functions and plain config objects (no Viro imports) so the
 * easing and colour mapping — the bits that decide how the effect *feels* — are
 * unit-testable. `BridgeScene.tsx` consumes these; nothing here imports React or
 * Viro. See CLAUDE.md §4 and TASKS.md P3-x.
 */

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/** Ease-out cubic, for snappy-but-soft parameter changes. */
export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}

/**
 * Frame-rate-independent exponential approach toward `target`.
 *
 * `tau` is the time constant in ms (time to cover ~63% of the remaining gap).
 * Used so no raw state value drives a visual directly — every binding is eased
 * over 200–400 ms (TASKS.md P3-7).
 */
export function smoothTowards(current: number, target: number, dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return target;
  const k = 1 - Math.exp(-dtMs / tauMs);
  return current + (target - current) * k;
}

/** Payload hue byte (0..255) → degrees (0..360). */
export function hueByteToDegrees(hue: number): number {
  return (hue * 360) / 255;
}

export interface Rgb {
  r: number; // 0..1
  g: number; // 0..1
  b: number; // 0..1
}

/** Fully-saturated, full-value HSV→RGB for a hue in degrees. */
export function hueToRgb(hueDeg: number): Rgb {
  const h = ((hueDeg % 360) + 360) % 360 / 60;
  const c = 1;
  const x = c * (1 - Math.abs((h % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 1) [r, g, b] = [c, x, 0];
  else if (h < 2) [r, g, b] = [x, c, 0];
  else if (h < 3) [r, g, b] = [0, c, x];
  else if (h < 4) [r, g, b] = [0, x, c];
  else if (h < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r, g, b };
}

/** `#rrggbb` from an RGB in 0..1. */
export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number): string =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Convenience: payload hue byte → `#rrggbb`. */
export function hueByteToHex(hue: number): string {
  return rgbToHex(hueToRgb(hueByteToDegrees(hue)));
}

/** Easing time constants (ms) for the various bindings. Tunable via the HUD. */
export const EASING = {
  strengthTauMs: 250,
  proximityTauMs: 300,
  alignmentTauMs: 200,
} as const;

/** Static bridge/particle configuration. Emission + velocity scale with strength. */
export const BRIDGE_EFFECT = {
  /** Peer position default until Cloud Anchors/UWB land (TASKS.md P3-1): 2 m along −Z. */
  defaultPeerPositionZ: -2,
  particles: {
    minEmissionRate: 4, // ambient shimmer floor (pre-bond)
    maxEmissionRate: 120, // at full strength
    minVelocity: 0.2,
    maxVelocity: 1.6,
  },
  material: {
    minEmissiveIntensity: 0.15, // faint when far
    maxEmissiveIntensity: 1.0, // bright when adjacent
  },
} as const;

/** Emission rate for a given bond strength (ambient floor preserved). */
export function emissionRateFor(strength: number): number {
  const { minEmissionRate, maxEmissionRate } = BRIDGE_EFFECT.particles;
  return lerp(minEmissionRate, maxEmissionRate, easeOutCubic(strength));
}

/** Emissive intensity bound to proximity (colour temperature/brightness). */
export function emissiveIntensityFor(proximity: number): number {
  const { minEmissiveIntensity, maxEmissiveIntensity } = BRIDGE_EFFECT.material;
  return lerp(minEmissiveIntensity, maxEmissiveIntensity, proximity);
}
