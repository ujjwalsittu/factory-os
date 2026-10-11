// Phase 3e (decision 059): EarthNow subscriptions. Periods are anchored on the start date; the fee of a period is
// invoiced in advance, reports and alerts beyond the bundle are overage on the next invoice, and an upgrade's fee
// difference is prorated by days.
import { Dec } from './decimal.js';

export type SubscriptionPeriod = 'month' | 'quarter' | 'year';
export const SUBSCRIPTION_PERIOD_MONTHS: Record<SubscriptionPeriod, number> = { month: 1, quarter: 3, year: 12 };

const DAY = 86400e3;
const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return { y, m, d };
};
const iso = (t: Date) => t.toISOString().slice(0, 10);

/** Start of period `k` (0-based) of a subscription starting on `startsOn`; month ends clamp (31 Jan → 28/29 Feb → 31 Mar). */
export function subscriptionPeriodStart(startsOn: string, period: SubscriptionPeriod, k: number): string {
  if (!Number.isInteger(k) || k < 0) throw new Error('A period index is whole and not negative');
  const { y, m, d } = utc(startsOn);
  const t = new Date(Date.UTC(y, m - 1 + k * SUBSCRIPTION_PERIOD_MONTHS[period], 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return iso(t);
}

/** Last day of period `k`: the day before the next period starts. */
export function subscriptionPeriodEnd(startsOn: string, period: SubscriptionPeriod, k: number): string {
  return iso(new Date(Date.parse(`${subscriptionPeriodStart(startsOn, period, k + 1)}T00:00:00Z`) - DAY));
}

/** Index of the period containing `on`, or -1 before the start. */
export function subscriptionPeriodIndex(startsOn: string, period: SubscriptionPeriod, on: string): number {
  if (on < startsOn) return -1;
  const a = utc(startsOn);
  const b = utc(on);
  let k = Math.floor(((b.y - a.y) * 12 + (b.m - a.m)) / SUBSCRIPTION_PERIOD_MONTHS[period]);
  while (k > 0 && subscriptionPeriodStart(startsOn, period, k) > on) k--;
  while (subscriptionPeriodStart(startsOn, period, k + 1) <= on) k++;
  return k;
}

/** Days from `from` to `to`, both counted. */
export const inclusiveDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;

/** Upgrade charge: the fee difference for the days left in the period (the effective day counted), to the paisa. */
export function subscriptionProration(oldFee: string, newFee: string, periodStart: string, periodEnd: string, effectiveOn: string): string {
  if (effectiveOn < periodStart || effectiveOn > periodEnd) throw new Error('The change must fall inside the period');
  const diff = Dec.of(newFee).sub(oldFee);
  if (!diff.gt('0')) return '0.00';
  return diff.mul(String(inclusiveDays(effectiveOn, periodEnd))).div(String(inclusiveDays(periodStart, periodEnd))).toFixed(2);
}

/** Units beyond the bundle and what they cost. */
export function subscriptionOverage(used: number, included: number, rate: string): { extra: number; amount: string } {
  if (!Number.isInteger(used) || !Number.isInteger(included) || included < 0) throw new Error('Counts are whole numbers');
  const extra = Math.max(0, used - included);
  return { extra, amount: Dec.of(rate).mul(String(extra)).toFixed(2) };
}
