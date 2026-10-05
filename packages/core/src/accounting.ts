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
  let debits = Dec.ZERO, credits = Dec.ZERO;
  for (const line of lines) {
    if (!line.accountId.trim() || !amount.test(line.debit) || !amount.test(line.credit))
      throw new Error('Valid accounts and nonnegative decimal amounts (up to six places) are required');
    const dr = Dec.of(line.debit), cr = Dec.of(line.credit);
    if (dr.gt('0') === cr.gt('0')) throw new Error('Each line needs exactly one positive debit or credit');
    debits = debits.add(dr); credits = credits.add(cr);
  }
  if (!debits.eq(credits)) throw new Error(`Journal does not balance: debit ${debits} vs credit ${credits}`);
}
export function reverseLines(lines: AccountingLine[]): AccountingLine[] {
  assertBalanced(lines);
  return lines.map(line => ({ ...line, debit: line.credit, credit: line.debit }));
}
export function purchaseVariance(input: {
  qty: string; poRate: string; invoiceRate: string;
  poExchangeRate: string; invoiceExchangeRate: string;
}): { price: string; forex: string } {
  const q = Dec.of(input.qty), p = Dec.of(input.poRate), i = Dec.of(input.invoiceRate);
  const r = Dec.of(input.poExchangeRate), s = Dec.of(input.invoiceExchangeRate);
  return { price: q.mul(i.sub(p)).mul(r).toString(), forex: q.mul(i).mul(s.sub(r)).toString() };
}
