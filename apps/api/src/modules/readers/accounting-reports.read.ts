// Pure SELECT readers for accounting status and reports (decision 050), shared by the ordinary report endpoints and
// support access. Reading never activates books or seeds defaults.
import { Dec } from '@factoryos/core';
import { glAccount as account, accountingSettings, glEntry, journalVoucher } from '@factoryos/db';
import type { SupportPanelResult, SupportQuery } from '@factoryos/auth';
import { and, asc, eq, ne } from 'drizzle-orm';
import { detail, table } from '../support-access/support-access.present.js';
import type { SupportExecutor, SupportScope } from '../support-access/support-access.types.js';
import { SupportError } from '../support-access/support-access.store.js';
import type { ReadScope } from './inventory.read.js';

type Filters = { from?: string; to?: string; partyId?: string; accountId?: string };

export async function accountingStatus(db: SupportExecutor, s: ReadScope) {
  const [settings] = await db.select().from(accountingSettings).where(eq(accountingSettings.entityId, s.entityId));
  return { active: settings?.active ?? false, cutoverDate: settings?.cutoverDate ?? null, activatedAt: settings?.activatedAt ?? null };
}

async function entries(db: SupportExecutor, s: ReadScope) {
  return db
    .select({ entry: glEntry, voucher: journalVoucher })
    .from(glEntry)
    .innerJoin(journalVoucher, and(eq(journalVoucher.id, glEntry.voucherId), eq(journalVoucher.entityId, s.entityId)))
    .where(eq(glEntry.entityId, s.entityId))
    .orderBy(asc(glEntry.postingDate), asc(glEntry.createdAt), asc(glEntry.id));
}

/** Opening balances include every entry before `from`; totals cover all accounts before any page is cut. */
export async function trialBalance(db: SupportExecutor, s: ReadScope, q: Filters) {
  const accounts = await db.select().from(account).where(eq(account.entityId, s.entityId));
  const rows = await entries(db, s);
  let debit = Dec.ZERO,
    credit = Dec.ZERO;
  const result = accounts.map((a) => {
    let opening = Dec.ZERO,
      dr = Dec.ZERO,
      cr = Dec.ZERO;
    for (const { entry: e } of rows.filter((r) => r.entry.accountId === a.id && (!q.partyId || r.entry.partyId === q.partyId) && (!q.to || r.entry.postingDate <= q.to))) {
      if (q.from && e.postingDate < q.from) opening = opening.add(e.debit).sub(e.credit);
      else {
        dr = dr.add(e.debit);
        cr = cr.add(e.credit);
      }
    }
    const balance = opening.add(dr).sub(cr);
    if (balance.gt('0')) debit = debit.add(balance);
    else credit = credit.sub(balance);
    return { ...a, opening: opening.toString(), debit: dr.toString(), credit: cr.toString(), balance: balance.toString() };
  });
  return { accounting: await accountingStatus(db, s), accounts: result, debit: debit.toString(), credit: credit.toString(), from: q.from ?? null, to: q.to ?? null, currency: 'INR', precision: 6 };
}

/** Null when the account is not in this entity. */
export async function accountLedger(db: SupportExecutor, s: ReadScope, q: Filters & { accountId: string }) {
  const [a] = await db.select().from(account).where(and(eq(account.id, q.accountId), eq(account.entityId, s.entityId)));
  if (!a) return null;
  const rows = (await entries(db, s)).filter((r) => r.entry.accountId === q.accountId && (!q.partyId || r.entry.partyId === q.partyId) && (!q.to || r.entry.postingDate <= q.to));
  let opening = Dec.ZERO;
  for (const r of rows) if (q.from && r.entry.postingDate < q.from) opening = opening.add(r.entry.debit).sub(r.entry.credit);
  let balance = opening;
  const lines = rows
    .filter((r) => !q.from || r.entry.postingDate >= q.from)
    .map(({ entry, voucher }) => {
      balance = balance.add(entry.debit).sub(entry.credit);
      return { ...entry, number: voucher.number, narration: voucher.narration, sourceType: voucher.sourceType, sourceId: voucher.sourceId, reversalOf: voucher.reversalOf, balance: balance.toString() };
    });
  return { accounting: await accountingStatus(db, s), account: a, entries: lines, opening: opening.toString(), closing: balance.toString(), currency: 'INR', precision: 6, from: q.from ?? null, to: q.to ?? null };
}

export async function dayBook(db: SupportExecutor, s: ReadScope, q: Filters) {
  const vouchers = await db
    .select()
    .from(journalVoucher)
    .where(and(eq(journalVoucher.entityId, s.entityId), ne(journalVoucher.status, 'draft')))
    .orderBy(asc(journalVoucher.postingDate), asc(journalVoucher.submittedAt));
  const rows = await entries(db, s);
  return vouchers
    .filter((v) => (!q.from || v.postingDate >= q.from) && (!q.to || v.postingDate <= q.to))
    .filter((v) => !q.partyId || rows.some((r) => r.entry.voucherId === v.id && r.entry.partyId === q.partyId))
    .map((v) => ({
      ...v,
      debit: rows.filter((r) => r.entry.voucherId === v.id).reduce((sum, r) => sum.add(r.entry.debit), Dec.ZERO).toString(),
      credit: rows.filter((r) => r.entry.voucherId === v.id).reduce((sum, r) => sum.add(r.entry.credit), Dec.ZERO).toString(),
    }));
}

const TRIAL = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Account' },
  { key: 'opening', label: 'Opening' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Credit' },
  { key: 'balance', label: 'Balance' },
];
const LEDGER = [
  { key: 'postingDate', label: 'Date' },
  { key: 'number', label: 'Voucher' },
  { key: 'narration', label: 'Narration' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Credit' },
  { key: 'balance', label: 'Balance' },
];
const DAYBOOK = [
  { key: 'postingDate', label: 'Date' },
  { key: 'number', label: 'Voucher' },
  { key: 'narration', label: 'Narration' },
  { key: 'sourceType', label: 'Source' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Credit' },
];

export async function readAccounting(db: SupportExecutor, scope: SupportScope, query: Extract<SupportQuery, { area: 'accounting' }>): Promise<SupportPanelResult> {
  if (query.area !== 'accounting' || !scope.permissions.has('accounts.report.read')) throw new SupportError('SUPPORT_UNAVAILABLE', 'permission');
  if (query.panel === 'status') {
    const st = await accountingStatus(db, scope);
    return detail(
      [
        { label: 'Books active', value: st.active },
        { label: 'Cut-over date', value: st.cutoverDate },
        { label: 'Activated at', value: st.activatedAt ? new Date(st.activatedAt).toISOString() : null },
      ],
      [],
    );
  }
  if (query.panel === 'trial-balance') {
    const tb = await trialBalance(db, scope, { to: query.to });
    const result = table(TRIAL, tb.accounts, query);
    return detail(
      [
        { label: 'Total debit', value: tb.debit },
        { label: 'Total credit', value: tb.credit },
      ],
      [{ label: 'Accounts', table: (result as Extract<SupportPanelResult, { kind: 'table' }>).table }],
    );
  }
  if (query.panel === 'ledger') {
    const lg = await accountLedger(db, scope, { ...query, accountId: query.accountId! });
    if (!lg) throw new SupportError('SUPPORT_NOT_FOUND');
    const result = table(LEDGER, lg.entries, query);
    return detail(
      [
        { label: 'Account', value: `${lg.account.code} ${lg.account.name}` },
        { label: 'Opening', value: lg.opening },
        { label: 'Closing', value: lg.closing },
      ],
      [{ label: 'Entries', table: (result as Extract<SupportPanelResult, { kind: 'table' }>).table }],
    );
  }
  return table(DAYBOOK, await dayBook(db, scope, query), query);
}
