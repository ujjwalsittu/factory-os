import { Dec } from './decimal.js';

/** Job work and ITC-04 rules (decision 047; evidence in docs/compliance/itc04-evidence.md). */

export type JobWorkGoodsType = 'input' | 'capital_good';
export type Itc04Frequency = 'half_yearly' | 'annual';

/** ISO date plus whole years; 29 Feb falls back to 28 Feb so a deadline is never later than the law allows. */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const ny = y + years;
  const leap = (ny % 4 === 0 && ny % 100 !== 0) || ny % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${ny}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Sec 143(1)(a)/(b): inputs back within one year, capital goods within three, of being sent out.
 * Capital goods that are moulds/dies, jigs/fixtures or tools have no limit (null).
 */
export function jobWorkDueBy(sentOn: string, goodsType: JobWorkGoodsType, toolExempt: boolean): string | null {
  if (goodsType === 'capital_good') return toolExempt ? null : addYears(sentOn, 3);
  return addYears(sentOn, 1);
}

/** Sec 143(1) second proviso: the Commissioner may extend by at most one year (inputs) or two (capital goods). */
export function maxExtendedDueBy(dueBy: string, goodsType: JobWorkGoodsType): string {
  return addYears(dueBy, goodsType === 'capital_good' ? 2 : 1);
}

export type DeadlineState = 'open' | 'due_soon' | 'overdue';

/** Amber 30 days before the deadline, red after it (a deadline day itself is still in time). */
export function deadlineState(dueBy: string | null, today: string, warnDays = 30): DeadlineState {
  if (!dueBy) return 'open';
  if (today > dueBy) return 'overdue';
  const warnFrom = new Date(`${dueBy}T00:00:00Z`);
  warnFrom.setUTCDate(warnFrom.getUTCDate() - warnDays);
  return today >= warnFrom.toISOString().slice(0, 10) ? 'due_soon' : 'open';
}

export interface Itc04Period {
  /** e.g. "2026-27 H1", "2026-27" */
  label: string;
  from: string;
  to: string;
  /** Rule 45(3): twenty-fifth day of the month after the period. */
  due: string;
}

/**
 * Rule 45(3) as amended by Notification 35/2021: six months from 1 April / 1 October when the previous
 * FY's aggregate turnover exceeded ₹5 crore (half_yearly), else the financial year.
 */
export function itc04Period(date: string, frequency: Itc04Frequency): Itc04Period {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const fy = m >= 4 ? y : y - 1;
  const fyLabel = `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
  if (frequency === 'annual') return { label: fyLabel, from: `${fy}-04-01`, to: `${fy + 1}-03-31`, due: `${fy + 1}-04-25` };
  return m >= 4 && m <= 9
    ? { label: `${fyLabel} H1`, from: `${fy}-04-01`, to: `${fy}-09-30`, due: `${fy}-10-25` }
    : { label: `${fyLabel} H2`, from: `${fy}-10-01`, to: `${fy + 1}-03-31`, due: `${fy + 1}-04-25` };
}

/**
 * Splits a returned quantity over open challan lines, oldest first, exactly. Lines must be in the order to
 * consume; a quantity above the total open is refused.
 */
export function allocateOldestFirst<T extends { id: string; open: string }>(qty: string, lines: readonly T[]): { id: string; qty: string }[] {
  let left = Dec.of(qty);
  if (!left.gt('0')) throw new Error('Quantity must be positive');
  const out: { id: string; qty: string }[] = [];
  for (const l of lines) {
    if (left.isZero()) break;
    const open = Dec.of(l.open);
    if (!open.gt('0')) continue;
    const take = Dec.min(open, left);
    out.push({ id: l.id, qty: take.toString() });
    left = left.sub(take);
  }
  if (!left.isZero()) throw new Error(`Only ${Dec.of(qty).sub(left).toString()} is open at the job worker`);
  return out;
}

/** Rule 55(1): a delivery challan number is at most sixteen characters. */
export const MAX_CHALLAN_NO_LENGTH = 16;
