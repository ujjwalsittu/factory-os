import { describe, expect, it } from 'vitest';
import * as core from './index.js';

describe('settlement carrying values', () => {
  it('consumes only the allocated share of a foreign bill', () => {
    expect(core.consumeCarryingValue('100', '8000', '40')).toBe('3200.000000');
    expect(core.consumeCarryingValue('60', '4800', '60')).toBe('4800.000000');
  });
  it('exhausts the final six-place residual rather than recalculating a rate', () => {
    const first = core.consumeCarryingValue('3', '1', '1');
    const second = core.consumeCarryingValue('2', core.Dec.of('1').sub(first).toString(), '1');
    const last = core.consumeCarryingValue('1', core.Dec.of('1').sub(first).sub(second).toString(), '1');
    expect(core.Dec.of(first).add(second).add(last).toString()).toBe('1.000000');
    expect(last).toBe('0.333333');
  });
  it.each([
    ['100', '8000', '0'], ['100', '8000', '-1'], ['100', '8000', '101'],
    ['0', '0', '1'], ['1', '-1', '1'], ['1.0000001', '1', '1'],
  ])('rejects invalid allocation %s / %s / %s', (open, carrying, allocated) => {
    expect(() => core.consumeCarryingValue(open, carrying, allocated)).toThrow();
  });
  it('permits a zero carrying share on a positive low-value balance', () => {
    expect(core.consumeCarryingValue('2', '0.000001', '0.000001')).toBe('0.000000');
  });
});

describe('realized settlement FX', () => {
  it.each([
    ['receipt', '3320', '3200', '-120.000000'],
    ['payment', '3320', '3200', '120.000000'],
    ['receipt', '3120', '3200', '80.000000'],
    ['payment', '3120', '3200', '-80.000000'],
    ['receipt', '3200', '3200', '0.000000'],
  ] as const)('%s cash %s carrying %s yields expense %s', (direction, cash, carrying, expected) => {
    expect(core.settlementDifference(direction, cash, carrying)).toBe(expected);
  });
  it('rejects negative values and excessive precision', () => {
    expect(() => core.settlementDifference('payment', '-1', '1')).toThrow();
    expect(() => core.settlementDifference('receipt', '1', '1.0000001')).toThrow();
  });
});
