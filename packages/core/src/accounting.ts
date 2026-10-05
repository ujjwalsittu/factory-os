import { Dec } from './decimal.js';

export interface AccountingLine {
  accountId: string;
  debit: string;
  credit: string;
  partyId?: string;
  billReference?: string;
  gstRegistrationId?: string;
}
export interface PostingPlan {
  lines: AccountingLine[];
  disposition: 'posted' | 'no_value_change';
}
const amount = /^\d+(?:\.\d{1,6})?$/;
export function assertBalanced(lines: AccountingLine[]): void {
  if (lines.length < 2) throw new Error('A journal needs at least two lines');
  let debits = Dec.ZERO,
    credits = Dec.ZERO;
  for (const line of lines) {
    if (
      !line.accountId.trim() ||
      !amount.test(line.debit) ||
      !amount.test(line.credit)
    )
      throw new Error(
        'Valid accounts and nonnegative decimal amounts (up to six places) are required',
      );
    const dr = Dec.of(line.debit),
      cr = Dec.of(line.credit);
    if (dr.gt('0') === cr.gt('0'))
      throw new Error('Each line needs exactly one positive debit or credit');
    debits = debits.add(dr);
    credits = credits.add(cr);
  }
  if (!debits.eq(credits))
    throw new Error(
      `Journal does not balance: debit ${debits} vs credit ${credits}`,
    );
}
export function reverseLines(lines: AccountingLine[]): AccountingLine[] {
  assertBalanced(lines);
  return lines.map((line) => ({
    ...line,
    debit: line.credit,
    credit: line.debit,
  }));
}
export function purchaseVariance(input: {
  qty: string;
  poRate: string;
  invoiceRate: string;
  poExchangeRate: string;
  invoiceExchangeRate: string;
}): { price: string; forex: string } {
  const q = Dec.of(input.qty),
    p = Dec.of(input.poRate),
    i = Dec.of(input.invoiceRate);
  const r = Dec.of(input.poExchangeRate),
    s = Dec.of(input.invoiceExchangeRate);
  return {
    price: q.mul(i.sub(p)).mul(r).toString(),
    forex: q.mul(i).mul(s.sub(r)).toString(),
  };
}

export function splitAcquisitionCost(input: {
  amount: string;
  quantity: string;
  remaining: string;
  oldRate: string;
}): { newRate: string; inventory: string; consumed: string; rounding: string } {
  const amount = Dec.of(input.amount),
    quantity = Dec.of(input.quantity),
    remaining = Dec.of(input.remaining),
    oldRate = Dec.of(input.oldRate);
  if (
    amount.lt('0') ||
    !quantity.gt('0') ||
    remaining.lt('0') ||
    remaining.gt(quantity) ||
    oldRate.lt('0')
  )
    throw new Error('Invalid acquisition-cost allocation');
  // A six-place layer rate cannot represent every cost increment. Never
  // capitalize more than the on-hand share; report the residual separately.
  const target = Dec.of(
    allocateProportion(
      amount.toString(),
      remaining.toString(),
      quantity.toString(),
    ),
  );
  let lo = 0n,
    hi = remaining.gt('0') ? (amount.raw * 1000000n) / quantity.raw : 0n;
  const inventoryAt = (increment: bigint) =>
    remaining
      .mul(Dec.of(scaled(oldRate.raw + increment)))
      .sub(remaining.mul(oldRate));
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (inventoryAt(mid).gt(target)) hi = mid - 1n;
    else lo = mid;
  }
  const newRate = Dec.of(scaled(oldRate.raw + lo)),
    inventory = inventoryAt(lo);
  return {
    newRate: newRate.toString(),
    inventory: inventory.toString(),
    consumed: amount.sub(target).toString(),
    rounding: target.sub(inventory).toString(),
  };
}
function scaled(raw: bigint): string {
  return `${raw / 1000000n}.${String(raw % 1000000n).padStart(6, '0')}`;
}
/** One exact proportional division, rounded once at the six-place boundary. */
export function allocateProportion(
  total: string,
  part: string,
  whole: string,
): string {
  const t = Dec.of(total),
    p = Dec.of(part),
    w = Dec.of(whole);
  if (t.lt('0') || p.lt('0') || !w.gt('0') || p.gt(w))
    throw new Error('Invalid proportional allocation');
  return scaled((t.raw * p.raw + w.raw / 2n) / w.raw);
}
