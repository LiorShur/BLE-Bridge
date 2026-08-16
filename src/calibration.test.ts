import { describe, it, expect } from 'vitest';
import { resolveTxPower, DEFAULT_TX_POWER, TX_POWER_BY_MODEL } from './calibration';

describe('resolveTxPower', () => {
  it('falls back to the default for an unknown model', () => {
    expect(resolveTxPower('Definitely Not A Phone')).toBe(DEFAULT_TX_POWER);
  });

  it('falls back to the default for null/undefined', () => {
    expect(resolveTxPower(null)).toBe(DEFAULT_TX_POWER);
    expect(resolveTxPower(undefined)).toBe(DEFAULT_TX_POWER);
  });

  it('returns the calibrated value when the model is known', () => {
    const [model, value] = Object.entries(TX_POWER_BY_MODEL)[0] ?? ['__none__', DEFAULT_TX_POWER];
    expect(resolveTxPower(model)).toBe(value);
  });

  it('always returns a valid int8', () => {
    const v = resolveTxPower('anything');
    expect(v).toBeGreaterThanOrEqual(-128);
    expect(v).toBeLessThanOrEqual(127);
  });
});
