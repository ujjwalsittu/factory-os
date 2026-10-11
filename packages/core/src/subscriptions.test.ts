import { describe, expect, it } from 'vitest';
import { inclusiveDays, subscriptionOverage, subscriptionPeriodEnd, subscriptionPeriodIndex, subscriptionPeriodStart, subscriptionProration } from './subscriptions.js';

describe('subscription periods (decision 059)', () => {
  it('anchors periods on the start date and clamps month ends', () => {
    expect([0, 1, 2, 3].map((k) => subscriptionPeriodStart('2026-01-31', 'month', k))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(subscriptionPeriodEnd('2026-01-31', 'month', 0)).toBe('2026-02-27');
    expect(subscriptionPeriodStart('2026-04-01', 'quarter', 3)).toBe('2027-01-01');
    expect(subscriptionPeriodEnd('2026-04-01', 'year', 0)).toBe('2027-03-31');
  });

  it('finds the period containing a date', () => {
    expect(subscriptionPeriodIndex('2026-04-15', 'month', '2026-04-14')).toBe(-1);
    expect(subscriptionPeriodIndex('2026-04-15', 'month', '2026-04-15')).toBe(0);
    expect(subscriptionPeriodIndex('2026-04-15', 'month', '2026-05-14')).toBe(0);
    expect(subscriptionPeriodIndex('2026-04-15', 'month', '2026-05-15')).toBe(1);
    expect(subscriptionPeriodIndex('2026-01-31', 'month', '2026-02-28')).toBe(1);
    expect(subscriptionPeriodIndex('2026-04-01', 'quarter', '2026-12-31')).toBe(2);
  });

  it('prorates an upgrade by days left, the effective day counted', () => {
    expect(inclusiveDays('2026-04-01', '2026-04-30')).toBe(30);
    expect(subscriptionProration('30000', '45000', '2026-04-01', '2026-04-30', '2026-04-21')).toBe('5000.00');
    expect(subscriptionProration('30000', '45000', '2026-04-01', '2026-04-30', '2026-04-01')).toBe('15000.00');
    expect(subscriptionProration('45000', '30000', '2026-04-01', '2026-04-30', '2026-04-21')).toBe('0.00');
    expect(() => subscriptionProration('1', '2', '2026-04-01', '2026-04-30', '2026-05-01')).toThrow();
  });

  it('charges only units beyond the bundle', () => {
    expect(subscriptionOverage(3, 4, '5000')).toEqual({ extra: 0, amount: '0.00' });
    expect(subscriptionOverage(7, 4, '5000')).toEqual({ extra: 3, amount: '15000.00' });
    expect(() => subscriptionOverage(1.5, 4, '1')).toThrow();
  });
});
