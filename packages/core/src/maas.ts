// Machine-hour MaaS billing (decision 055): actual minutes rounded up to the rate card's step, never below its
// minimum; billed in hours, which are exact decimals because the step divides an hour into tenths or quarters.
import { Dec } from './decimal.js';

/** Rounding steps that give exact hours (0.1, 0.2, 0.25, 0.5, 1). */
export const MAAS_ROUNDING_MINUTES = [6, 12, 15, 30, 60] as const;
export type MaasRoundingMinutes = (typeof MAAS_ROUNDING_MINUTES)[number];

export interface MaasRateCardTerms {
  standardRate: string;
  memberRate: string | null;
  minimumMinutes: number;
  roundingMinutes: number;
}

/** Problems with a rate card's terms, or null when they are usable. */
export function maasTermsError(t: MaasRateCardTerms): string | null {
  if (!(MAAS_ROUNDING_MINUTES as readonly number[]).includes(t.roundingMinutes)) return `Rounding must be one of ${MAAS_ROUNDING_MINUTES.join(', ')} minutes`;
  if (!Number.isInteger(t.minimumMinutes) || t.minimumMinutes < 0) return 'The minimum is whole minutes, zero or more';
  if (t.minimumMinutes % t.roundingMinutes !== 0) return `The minimum must be a multiple of the ${t.roundingMinutes}-minute rounding`;
  if (!Dec.of(t.standardRate).gt('0')) return 'The standard rate must be more than zero';
  if (t.memberRate !== null && !Dec.of(t.memberRate).gt('0')) return 'The member rate must be more than zero';
  return null;
}

/** Minutes to bill: actual rounded up to the step, at least the minimum. Zero actual still bills the minimum. */
export function maasBillableMinutes(actualMinutes: number, t: Pick<MaasRateCardTerms, 'minimumMinutes' | 'roundingMinutes'>): number {
  if (!Number.isInteger(actualMinutes) || actualMinutes < 0) throw new Error('Actual usage must be whole minutes, zero or more');
  const rounded = Math.ceil(actualMinutes / t.roundingMinutes) * t.roundingMinutes;
  return Math.max(rounded, t.minimumMinutes);
}

/** Billed hours as an exact decimal string (the step divides 60 into tenths or quarters). */
export function maasHours(billableMinutes: number): string {
  return Dec.of(billableMinutes).div('60').toFixed(2);
}

/** The hourly rate for a customer: the member rate when they are a member and one is set. */
export function maasRate(t: Pick<MaasRateCardTerms, 'standardRate' | 'memberRate'>, member: boolean): string {
  return member && t.memberRate !== null ? t.memberRate : t.standardRate;
}

/** Everything the invoice line needs, from actual minutes. */
export function maasCharge(actualMinutes: number, t: MaasRateCardTerms, member: boolean) {
  const billableMinutes = maasBillableMinutes(actualMinutes, t);
  const hours = maasHours(billableMinutes);
  const rate = maasRate(t, member);
  return { actualMinutes, billableMinutes, hours, rate, amount: Dec.of(hours).mul(rate).toFixed(2), memberRate: member && t.memberRate !== null };
}

/** Decision 056: billable minutes split between a membership's remaining hours and overage invoiced at the member rate. */
export function maasMembershipSplit(billableMinutes: number, remainingMinutes: number): { coveredMinutes: number; overageMinutes: number } {
  if (!Number.isInteger(billableMinutes) || billableMinutes < 0) throw new Error('Billable minutes must be whole, zero or more');
  const remaining = Math.max(0, Math.trunc(remainingMinutes));
  const coveredMinutes = Math.min(billableMinutes, remaining);
  return { coveredMinutes, overageMinutes: billableMinutes - coveredMinutes };
}

/** Last day of a term of `months` starting on `startsOn` (YYYY-MM-DD): the day before the same date `months` later. */
export function maasTermEnd(startsOn: string, months: number): string {
  if (!Number.isInteger(months) || months < 1) throw new Error('A term is at least one month');
  const [y, m, d] = startsOn.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  // Clamp to the target month's last day (31 Jan + 1 month → 28/29 Feb), then step back one day.
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  target.setUTCDate(target.getUTCDate() - 1);
  return target.toISOString().slice(0, 10);
}
