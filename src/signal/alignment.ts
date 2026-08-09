/**
 * Heading-opposition alignment — see CLAUDE.md §4.3.
 *
 * The direction to the peer is never computed. When two people face each other
 * their phone headings are ~180° apart, so alignment is a pure function of the
 * two headings: 1 when opposed, falling to 0 as they deviate past TOLERANCE.
 *
 * Pure. Headings are in DEGREES here; the caller converts wire decidegrees first.
 */

/** Default angular tolerance (degrees) around perfect opposition. */
export const DEFAULT_TOLERANCE = 45;

/**
 * Minimum heading accuracy (payload byte 7) to trust the compass. Below this we
 * fall back to `alignment = 1` and let proximity alone drive the effect — a
 * degraded effect beats a broken one.
 */
export const MIN_TRUSTED_ACCURACY = 2;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export interface AlignmentInput {
  /** Local phone heading in degrees, or `null` if unavailable. */
  headingA: number | null;
  /** Peer phone heading in degrees, or `null` if unavailable. */
  headingB: number | null;
  /** Local heading accuracy 0..3. */
  accuracyA: number;
  /** Peer heading accuracy 0..3. */
  accuracyB: number;
  /** Angular tolerance in degrees; defaults to 45. */
  tolerance?: number;
}

/**
 * Compute alignment in 0..1.
 *
 * Fallback (CLAUDE.md §4.3): if either heading is `null` (the 0xFFFF sentinel)
 * or either accuracy is below {@link MIN_TRUSTED_ACCURACY}, return 1 so the
 * effect runs on proximity alone rather than freezing on a bad compass.
 */
export function computeAlignment(input: AlignmentInput): number {
  const { headingA, headingB, accuracyA, accuracyB } = input;
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;

  if (
    headingA === null ||
    headingB === null ||
    accuracyA < MIN_TRUSTED_ACCURACY ||
    accuracyB < MIN_TRUSTED_ACCURACY
  ) {
    return 1;
  }

  // Signed difference folded into −180..180, then distance from perfect opposition.
  const delta = mod360(headingA - headingB + 540) - 180; // −180..180
  const error = 180 - Math.abs(delta); // 0 when exactly facing
  return clamp01(1 - error / tolerance);
}

/** Positive modulo — JS `%` keeps the sign of the dividend, which breaks the fold. */
function mod360(x: number): number {
  return ((x % 360) + 360) % 360;
}
