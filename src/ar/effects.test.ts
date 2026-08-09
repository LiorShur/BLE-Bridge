import { describe, it, expect } from 'vitest';
import {
  clamp01,
  lerp,
  easeOutCubic,
  smoothTowards,
  hueByteToDegrees,
  hueToRgb,
  rgbToHex,
  hueByteToHex,
  emissionRateFor,
  emissiveIntensityFor,
  BRIDGE_EFFECT,
} from './effects';

describe('scalar helpers', () => {
  it('clamp01 bounds to [0,1]', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(9)).toBe(1);
  });

  it('lerp interpolates and clamps t', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, -1)).toBe(0);
    expect(lerp(0, 10, 2)).toBe(10);
  });

  it('easeOutCubic maps endpoints and stays in range', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    const mid = easeOutCubic(0.5);
    expect(mid).toBeGreaterThan(0.5); // ease-out is above the diagonal early
    expect(mid).toBeLessThan(1);
  });
});

describe('smoothTowards', () => {
  it('moves partway toward the target in one step', () => {
    const v = smoothTowards(0, 1, 250, 250); // dt == tau → ~63%
    expect(v).toBeGreaterThan(0.6);
    expect(v).toBeLessThan(0.65);
  });

  it('converges to the target over many steps', () => {
    let v = 0;
    for (let i = 0; i < 200; i++) v = smoothTowards(v, 1, 16, 250);
    expect(v).toBeCloseTo(1, 3);
  });

  it('snaps immediately for a non-positive tau', () => {
    expect(smoothTowards(0.2, 0.9, 16, 0)).toBe(0.9);
  });
});

describe('colour mapping', () => {
  it('maps the hue byte across the full circle', () => {
    expect(hueByteToDegrees(0)).toBe(0);
    expect(hueByteToDegrees(255)).toBeCloseTo(360, 6);
  });

  it('produces pure primaries at cardinal hues', () => {
    expect(rgbToHex(hueToRgb(0))).toBe('#ff0000');
    expect(rgbToHex(hueToRgb(120))).toBe('#00ff00');
    expect(rgbToHex(hueToRgb(240))).toBe('#0000ff');
  });

  it('hueByteToHex round-trips through the pipeline', () => {
    expect(hueByteToHex(0)).toBe('#ff0000');
  });
});

describe('effect bindings', () => {
  it('emission rate spans the configured band with strength', () => {
    expect(emissionRateFor(0)).toBeCloseTo(BRIDGE_EFFECT.particles.minEmissionRate, 6);
    expect(emissionRateFor(1)).toBeCloseTo(BRIDGE_EFFECT.particles.maxEmissionRate, 6);
    expect(emissionRateFor(0.5)).toBeGreaterThan(BRIDGE_EFFECT.particles.minEmissionRate);
  });

  it('keeps an ambient emission floor at zero strength (pre-bond shimmer)', () => {
    expect(emissionRateFor(0)).toBeGreaterThan(0);
  });

  it('emissive intensity tracks proximity endpoints', () => {
    expect(emissiveIntensityFor(0)).toBeCloseTo(BRIDGE_EFFECT.material.minEmissiveIntensity, 6);
    expect(emissiveIntensityFor(1)).toBeCloseTo(BRIDGE_EFFECT.material.maxEmissiveIntensity, 6);
  });
});
