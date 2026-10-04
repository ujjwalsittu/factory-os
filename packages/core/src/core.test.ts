import { describe, expect, it } from 'vitest';
import { consumeFifo, Dec, dec, formatSeries, fyCode, InsufficientStockError, isValidSeriesPattern } from './index.js';

describe('Dec', () => {
  it('parses and prints canonically', () => {
    expect(dec('12.5').toString()).toBe('12.500000');
    expect(dec('-0.0000005').toString()).toBe('-0.000001');
    expect(dec(3n).toString()).toBe('3.000000');
  });
  it('avoids float error', () => {
    expect(dec('0.1').add('0.2').eq('0.3')).toBe(true);
  });
  it('multiplies and divides with half-away-from-zero rounding', () => {
    expect(dec('1.5').mul('2.25').toString()).toBe('3.375000');
    expect(dec('10').div('3').toString()).toBe('3.333333');
    expect(dec('2').div('3').toString()).toBe('0.666667');
    expect(dec('-2').div('3').toString()).toBe('-0.666667');
  });
  it('formats money', () => {
    expect(dec('1234.565').toFixed(2)).toBe('1234.57');
    expect(dec('-1.005').toFixed(2)).toBe('-1.01');
  });
  it('rejects junk', () => {
    expect(() => dec('1e5')).toThrow();
    expect(() => dec(Number.NaN)).toThrow();
  });
});

describe('consumeFifo', () => {
  const layers = [
    { id: 'a', qty: dec('10'), rate: dec('100') },
    { id: 'b', qty: dec('5'), rate: dec('120') },
  ];
  it('consumes oldest layers first', () => {
    const r = consumeFifo(layers, dec('12'));
    expect(r.consumed.map((c) => [c.layerId, c.qty.toString()])).toEqual([
      ['a', '10.000000'],
      ['b', '2.000000'],
    ]);
    expect(r.value.toString()).toBe('1240.000000');
  });
  it('does not mutate input', () => {
    consumeFifo(layers, dec('3'));
    expect(layers[0]!.qty.toString()).toBe('10.000000');
  });
  it('refuses negative stock', () => {
    expect(() => consumeFifo(layers, dec('16'))).toThrow(InsufficientStockError);
  });
  it('skips empty layers', () => {
    const r = consumeFifo([{ id: 'z', qty: Dec.ZERO, rate: dec('1') }, ...layers], dec('1'));
    expect(r.consumed[0]!.layerId).toBe('a');
  });
});

describe('series', () => {
  it('formats numbers', () => {
    expect(formatSeries('{ENTITY}/GRN/{FY}/{#####}', { entityCode: 'AZ', fy: '26-27', counter: 42 })).toBe('AZ/GRN/26-27/00042');
  });
  it('computes Indian FY codes', () => {
    expect(fyCode(new Date('2026-04-01T00:00:00Z'))).toBe('26-27');
    expect(fyCode(new Date('2027-03-31T00:00:00Z'))).toBe('26-27');
    expect(fyCode(new Date('2099-12-31T00:00:00Z'))).toBe('99-00');
  });
  it('validates patterns', () => {
    expect(isValidSeriesPattern('{ENTITY}/{FY}/{####}')).toBe(true);
    expect(isValidSeriesPattern('{ENTITY}/{FY}')).toBe(false);
    expect(isValidSeriesPattern('{##}')).toBe(false);
  });
});
