import { describe, it, expect } from 'vitest';
import { computeAlignment, DEFAULT_TOLERANCE } from './alignment';

const HIGH = 3; // trusted accuracy

describe('computeAlignment', () => {
  it('is 1 when the two phones face exactly opposite (180° apart)', () => {
    expect(computeAlignment({ headingA: 0, headingB: 180, accuracyA: HIGH, accuracyB: HIGH })).toBe(1);
  });

  it('handles the wrap-around case (350° vs 170° is perfect opposition)', () => {
    expect(computeAlignment({ headingA: 350, headingB: 170, accuracyA: HIGH, accuracyB: HIGH })).toBeCloseTo(1, 6);
  });

  it('is 0 when the phones face the same direction', () => {
    expect(computeAlignment({ headingA: 90, headingB: 90, accuracyA: HIGH, accuracyB: HIGH })).toBe(0);
  });

  it('falls off linearly across the tolerance band', () => {
    // 22.5° away from opposition, with 45° tolerance → 0.5
    const a = computeAlignment({ headingA: 0, headingB: 180 - 22.5, accuracyA: HIGH, accuracyB: HIGH });
    expect(a).toBeCloseTo(0.5, 6);
  });

  it('clamps to 0 past the tolerance edge', () => {
    // 60° from opposition, tolerance 45 → would be negative, clamped to 0
    expect(computeAlignment({ headingA: 0, headingB: 120, accuracyA: HIGH, accuracyB: HIGH })).toBe(0);
  });

  it('is symmetric in its two headings', () => {
    const ab = computeAlignment({ headingA: 30, headingB: 190, accuracyA: HIGH, accuracyB: HIGH });
    const ba = computeAlignment({ headingA: 190, headingB: 30, accuracyA: HIGH, accuracyB: HIGH });
    expect(ab).toBeCloseTo(ba, 9);
  });

  it('respects a custom tolerance', () => {
    // 45° from opposition with a 90° tolerance → 0.5
    const a = computeAlignment({ headingA: 0, headingB: 135, accuracyA: HIGH, accuracyB: HIGH, tolerance: 90 });
    expect(a).toBeCloseTo(0.5, 6);
    expect(DEFAULT_TOLERANCE).toBe(45);
  });

  describe('low-confidence fallback → alignment = 1', () => {
    it('falls back when a heading is unavailable (null)', () => {
      expect(computeAlignment({ headingA: null, headingB: 180, accuracyA: HIGH, accuracyB: HIGH })).toBe(1);
      expect(computeAlignment({ headingA: 0, headingB: null, accuracyA: HIGH, accuracyB: HIGH })).toBe(1);
    });

    it('falls back when either accuracy is below medium (<2)', () => {
      // Same-direction headings would otherwise give 0; fallback forces 1.
      expect(computeAlignment({ headingA: 90, headingB: 90, accuracyA: 1, accuracyB: HIGH })).toBe(1);
      expect(computeAlignment({ headingA: 90, headingB: 90, accuracyA: HIGH, accuracyB: 0 })).toBe(1);
    });

    it('does NOT fall back at exactly medium accuracy', () => {
      expect(computeAlignment({ headingA: 90, headingB: 90, accuracyA: 2, accuracyB: 2 })).toBe(0);
    });
  });
});
