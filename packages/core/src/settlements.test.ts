import { describe, expect, it } from 'vitest';
import { consumeCarryingValue, settlementDifference } from './settlements.js';

describe('consumeCarryingValue', () => {
  it('takes the proportional share of the remaining carrying value', () => {
    expect(consumeCarryingValue('100', '8000', '40')).toBe('3200.000000');
  });
  it('exhausts the exact remainder on the final allocation', () => {
    expect(consumeCarryingValue('60', '4800', '60')).toBe('4800.000000');
    expect(consumeCarryingValue('3', '100', '3')).toBe('100.000000');
  });
  it('rounds once and leaves the residual for the final allocation', () => {
    const first = consumeCarryingValue('3', '100', '1');
    expect(first).toBe('33.333333');
    expect(consumeCarryingValue('2', '66.666667', '2')).toBe('66.666667');
  });
  it('rejects zero, negative and over-allocation', () => {
    expect(() => consumeCarryingValue('100', '8000', '0')).toThrow();
    expect(() => consumeCarryingValue('100', '8000', '-1')).toThrow();
    expect(() => consumeCarryingValue('100', '8000', '100.01')).toThrow();
  });
});

describe('settlementDifference', () => {
  it('receipt at a higher rate is an exchange gain (negative)', () => {
    expect(settlementDifference('receipt', '3320', '3200')).toBe('-120.000000');
  });
  it('payment at a higher rate is an exchange loss (positive)', () => {
    expect(settlementDifference('payment', '3320', '3200')).toBe('120.000000');
  });
  it('lower rates invert the signs', () => {
    expect(settlementDifference('receipt', '3100', '3200')).toBe('100.000000');
    expect(settlementDifference('payment', '3100', '3200')).toBe('-100.000000');
  });
});
