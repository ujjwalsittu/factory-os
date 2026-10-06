import { Dec } from './decimal.js';
import { bankDate, bankMoney } from './bank-reconciliation-common.js';
import type { BankReportArithmetic, BookItem, NetMatchInput, OrdinaryMatchInput, ReconciliationInput, ResolvedMatch, StatementItem } from './bank-reconciliation-types.js';
const bookKey = (item: Pick<BookItem, 'kind' | 'id'>) => `${item.kind}:${item.id}`;
function itemMap<T extends StatementItem>(items: T[], key: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    bankDate(item.date);
    if (!item.id || map.has(key(item))) throw new Error('Duplicate or missing item identity');
    if (bankMoney(item.signedAmount).isZero()) throw new Error('Zero movement has no match capacity');
    map.set(key(item), item);
  }
  return map;
}
function take(used: Map<string, Dec>, key: string, amount: Dec, capacity: string) {
  const next = (used.get(key) ?? Dec.ZERO).add(amount);
  if (next.gt(bankMoney(capacity).abs())) throw new Error('Match exceeds remaining capacity');
  used.set(key, next);
}
export function validateBankMatch(input: OrdinaryMatchInput | NetMatchInput, statement: StatementItem[], book: BookItem[]): ResolvedMatch {
  const statements = itemMap(statement, x => x.id), books = itemMap(book, bookKey);
  if (input.kind === 'ordinary') {
    if (!input.edges.length) throw new Error('Match requires allocation edges');
    const sUsed = new Map<string, Dec>(), bUsed = new Map<string, Dec>();
    let groupSign: boolean | undefined;
    return { kind: 'ordinary', edges: input.edges.map(edge => {
      const s = statements.get(edge.statementRowId), b = books.get(`${edge.bookItemKind}:${edge.bookItemId}`);
      if (!s || !b) throw new Error('Match reference missing');
      const amount = bankMoney(edge.amount);
      if (!amount.gt(Dec.ZERO)) throw new Error('Allocation must be positive');
      if (bankMoney(s.signedAmount).isNeg() !== bankMoney(b.signedAmount).isNeg()) throw new Error('Match sign differs');
      const sign = bankMoney(s.signedAmount).isNeg();
      if (groupSign !== undefined && sign !== groupSign) throw new Error('Ordinary group must use one sign');
      groupSign = sign;
      take(sUsed, s.id, amount, s.signedAmount); take(bUsed, bookKey(b), amount, b.signedAmount);
      return { ...edge, amount: amount.toString(), effectiveDate: s.date > b.date ? s.date : b.date };
    }) };
  }
  if (!input.reason.trim() || input.statementRowIds.length < 2 || new Set(input.statementRowIds).size !== input.statementRowIds.length) throw new Error('Net group requires unique rows and a reason');
  const b = books.get(`gl:${input.bankEntryId}`);
  if (!b) throw new Error('Net book reference missing');
  const principal = bankMoney(input.source.principal), charge = bankMoney(input.source.charge);
  if (!principal.gt(Dec.ZERO) || !charge.gt(Dec.ZERO)) throw new Error('Net source principal and charge must be positive');
  let positive = Dec.ZERO, negative = Dec.ZERO, effectiveDate = b.date;
  for (const id of input.statementRowIds) {
    const s = statements.get(id);
    if (!s) throw new Error('Net statement reference missing');
    const amount = bankMoney(s.signedAmount);
    if (amount.isNeg()) negative = negative.add(amount.abs()); else positive = positive.add(amount);
    if (s.date > effectiveDate) effectiveDate = s.date;
  }
  const net = positive.sub(negative);
  if (net.isZero() || !positive.eq(principal) || !negative.eq(charge) || !net.eq(b.signedAmount)) throw new Error('Net vectors do not match source principal, charge and book amount');
  return { ...input, source: { principal: principal.toString(), charge: charge.toString() }, effectiveDate };
}

/** All active allocations reserve capacity; only date-effective allocations clear residuals. */
export function calculateBankReconciliation(input: ReconciliationInput): BankReportArithmetic {
  const asOf = bankDate(input.asOf), baselineDate = bankDate(input.baseline.date);
  if (asOf < baselineDate) throw new Error('As-of date precedes baseline');
  const book = [...input.baseline.outstanding, ...input.book];
  const books = itemMap(book, bookKey), statements = itemMap(input.statement, x => x.id);
  if (input.baseline.outstanding.some(x => x.kind !== 'opening' || x.date > baselineDate) || input.book.some(x => x.kind !== 'gl' || x.date <= baselineDate) || input.statement.some(x => x.date <= baselineDate)) throw new Error('Movement date or kind inconsistent with baseline');
  const openingBook = bankMoney(input.baseline.bookBalance), openingBank = bankMoney(input.baseline.bankBalance);
  const openingOutstanding = input.baseline.outstanding.reduce((sum, x) => sum.add(x.signedAmount), Dec.ZERO);
  if (!openingBook.sub(openingOutstanding).eq(openingBank)) throw new Error('Baseline balances do not reconcile');
  const sUsed = new Map<string, Dec>(), bUsed = new Map<string, Dec>(), sCleared = new Map<string, Dec>(), bCleared = new Map<string, Dec>();
  const reserve = (s: StatementItem, b: BookItem, amount: Dec, effectiveDate: string) => {
    take(sUsed, s.id, amount, s.signedAmount); take(bUsed, bookKey(b), amount, b.signedAmount);
    if (effectiveDate <= asOf) {
      sCleared.set(s.id, (sCleared.get(s.id) ?? Dec.ZERO).add(amount));
      bCleared.set(bookKey(b), (bCleared.get(bookKey(b)) ?? Dec.ZERO).add(amount));
    }
  };
  for (const supplied of input.matches) {
    // Revalidate persisted vectors against canonical current inputs rather than trusting stored dates.
    const match = validateBankMatch(supplied, input.statement, book);
    if (match.kind === 'ordinary') {
      for (const edge of match.edges) reserve(statements.get(edge.statementRowId)!, books.get(`${edge.bookItemKind}:${edge.bookItemId}`)!, bankMoney(edge.amount), edge.effectiveDate);
    } else {
      const b = books.get(`gl:${match.bankEntryId}`)!;
      take(bUsed, bookKey(b), bankMoney(b.signedAmount).abs(), b.signedAmount);
      if (match.effectiveDate <= asOf) bCleared.set(bookKey(b), (bCleared.get(bookKey(b)) ?? Dec.ZERO).add(bankMoney(b.signedAmount).abs()));
      for (const id of match.statementRowIds) {
        const s = statements.get(id)!, amount = bankMoney(s.signedAmount).abs();
        take(sUsed, id, amount, s.signedAmount);
        if (match.effectiveDate <= asOf) sCleared.set(id, (sCleared.get(id) ?? Dec.ZERO).add(amount));
      }
    }
  }
  const remaining = (item: StatementItem, cleared: Dec) => { const value = bankMoney(item.signedAmount); const amount = value.abs().sub(cleared); return (value.isNeg() ? amount.neg() : amount).toString(); };
  const bookResiduals = book.filter(x => x.date <= asOf).map(x => ({ ...x, remaining: remaining(x, bCleared.get(bookKey(x)) ?? Dec.ZERO) })).filter(x => !bankMoney(x.remaining).isZero());
  const statementResiduals = input.statement.filter(x => x.date <= asOf).map(x => ({ ...x, remaining: remaining(x, sCleared.get(x.id) ?? Dec.ZERO) })).filter(x => !bankMoney(x.remaining).isZero());
  const B = input.book.filter(x => x.date <= asOf).reduce((sum, x) => sum.add(x.signedAmount), openingBook);
  const S = input.statement.filter(x => x.date <= asOf).reduce((sum, x) => sum.add(x.signedAmount), openingBank);
  const U = bookResiduals.reduce((sum, x) => sum.add(x.remaining), Dec.ZERO), E = statementResiduals.reduce((sum, x) => sum.add(x.remaining), Dec.ZERO);
  return { B: B.toString(), U: U.toString(), E: E.toString(), S: S.toString(), difference: S.sub(B.sub(U).add(E)).toString(), coverageComplete: input.coverageComplete, bookResiduals, statementResiduals };
}
