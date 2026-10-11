import { describe, expect, it } from 'vitest';
import { maasBillableMinutes, maasCharge, maasHours, maasRate, maasTermsError } from './maas.js';

const terms = { standardRate: '2500', memberRate: '2000', minimumMinutes: 120, roundingMinutes: 15 };

describe('maas billing (decision 055)', () => {
  it('rounds actual minutes up to the step and never bills below the minimum', () => {
    expect(maasBillableMinutes(0, terms)).toBe(120);
    expect(maasBillableMinutes(61, terms)).toBe(120);
    expect(maasBillableMinutes(120, terms)).toBe(120);
    expect(maasBillableMinutes(121, terms)).toBe(135);
    expect(maasBillableMinutes(324, terms)).toBe(330);
  });

  it('refuses fractional or negative actual minutes', () => {
    expect(() => maasBillableMinutes(-1, terms)).toThrow();
    expect(() => maasBillableMinutes(1.5, terms)).toThrow();
  });

  it('gives exact hours for every allowed step', () => {
    expect(maasHours(330)).toBe('5.50');
    expect(maasHours(6)).toBe('0.10');
    expect(maasHours(12)).toBe('0.20');
    expect(maasHours(15)).toBe('0.25');
    expect(maasHours(90)).toBe('1.50');
  });

  it('uses the member rate for members when one is set', () => {
    expect(maasRate(terms, true)).toBe('2000');
    expect(maasRate(terms, false)).toBe('2500');
    expect(maasRate({ ...terms, memberRate: null }, true)).toBe('2500');
  });

  it('prices a booking: 5 h 24 min actual on a 15-minute step', () => {
    expect(maasCharge(324, terms, false)).toEqual({ actualMinutes: 324, billableMinutes: 330, hours: '5.50', rate: '2500', amount: '13750.00', memberRate: false });
    expect(maasCharge(324, terms, true).amount).toBe('11000.00');
  });

  it('validates the terms', () => {
    expect(maasTermsError(terms)).toBeNull();
    expect(maasTermsError({ ...terms, roundingMinutes: 7 })).toMatch(/Rounding/);
    expect(maasTermsError({ ...terms, minimumMinutes: 100 })).toMatch(/multiple/);
    expect(maasTermsError({ ...terms, standardRate: '0' })).toMatch(/standard rate/);
    expect(maasTermsError({ ...terms, memberRate: '-1' })).toMatch(/member rate/);
    expect(maasTermsError({ ...terms, minimumMinutes: 0 })).toBeNull();
  });
});
