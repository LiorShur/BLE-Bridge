/**
 * Advertisement republish policy — see docs/PAYLOAD_SPEC.md §7.
 *
 * Changing the advertised payload requires a native stop→start, so republishing
 * at sensor rate would churn the radio and can trip platform rate limits.
 * Republish only when the heading has moved more than `headingDeltaDeg`, or when
 * `maxIntervalMs` has elapsed since the last publish. Pure and unit-tested.
 */

export interface RepublishConfig {
  /** Republish if the heading changed by more than this many degrees. */
  headingDeltaDeg: number;
  /** Republish at least this often (ms) regardless of heading. */
  maxIntervalMs: number;
}

export const DEFAULT_REPUBLISH_CONFIG: RepublishConfig = {
  headingDeltaDeg: 5,
  // Keepalive republish cadence. Each republish is a native stop→start, so we
  // don't want it too frequent (radio churn / brief gaps), but duplicate-
  // suppressing scanners only deliver a callback when the payload changes (the
  // incrementing sequence byte), so it must stay well under the receiver's
  // staleness window. 1.5 s pairs with a ~4 s stale window (see bond timings).
  maxIntervalMs: 1500,
};

export interface RepublishInput {
  /** Heading at the last publish, in degrees, or `null` if it was unavailable. */
  prevHeadingDeg: number | null;
  /** Current heading in degrees, or `null` if unavailable. */
  nextHeadingDeg: number | null;
  /** Milliseconds since the last publish. */
  msSinceLastPublish: number;
  /** Whether anything has been published yet this session. */
  hasPublished: boolean;
}

/** Smallest absolute angular difference between two headings, 0..180 degrees. */
export function angularDeltaDeg(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

/**
 * Decide whether the outgoing payload should be republished now.
 *
 * The very first publish, the max-interval heartbeat, and a change in heading
 * *availability* all force a republish; otherwise it gates on the angular delta.
 */
export function shouldRepublish(
  input: RepublishInput,
  config: RepublishConfig = DEFAULT_REPUBLISH_CONFIG,
): boolean {
  if (!input.hasPublished) return true;
  if (input.msSinceLastPublish >= config.maxIntervalMs) return true;

  const { prevHeadingDeg, nextHeadingDeg } = input;
  if (prevHeadingDeg === null && nextHeadingDeg === null) return false;
  if (prevHeadingDeg === null || nextHeadingDeg === null) return true; // availability flipped

  return angularDeltaDeg(prevHeadingDeg, nextHeadingDeg) > config.headingDeltaDeg;
}
