import { describe, expect, it } from 'vitest';
import { maasBillableMinutes, maasCharge, maasHours, maasMembershipSplit, maasRate, maasTermEnd, maasTermsError } from './maas.js';

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

describe('maas memberships (decision 056)', () => {
  it('splits billable minutes between remaining hours and overage', () => {
    expect(maasMembershipSplit(330, 6000)).toEqual({ coveredMinutes: 330, overageMinutes: 0 });
    expect(maasMembershipSplit(330, 120)).toEqual({ coveredMinutes: 120, overageMinutes: 210 });
    expect(maasMembershipSplit(330, 0)).toEqual({ coveredMinutes: 0, overageMinutes: 330 });
    expect(maasMembershipSplit(330, -30)).toEqual({ coveredMinutes: 0, overageMinutes: 330 });
    expect(() => maasMembershipSplit(1.5, 10)).toThrow();
  });

  it('ends a term the day before the same date months later', () => {
    expect(maasTermEnd('2026-10-11', 12)).toBe('2027-10-10');
    expect(maasTermEnd('2026-04-01', 12)).toBe('2027-03-31');
    expect(maasTermEnd('2026-01-31', 1)).toBe('2026-02-27');
    expect(maasTermEnd('2027-12-15', 3)).toBe('2028-03-14');
    expect(() => maasTermEnd('2026-10-11', 0)).toThrow();
  });
});
