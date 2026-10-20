import { Dec } from '@factoryos/core';
import type { TallyVoucher } from '@factoryos/core/tally';
import { tallyJournal, tallySettlement, tallyStockJournal, type TallyEntryLinks, type TallyJournalDraft, type TallyLedgerTarget, type TallySettlementDraft, type TallyStockDraft } from '@factoryos/core/tally-entries';
import { accountGroup, accountingSettings, batch, glAccount, party, partySettlement, stockEntry, stockEntryLine, tallyImport, tallyLink, tallyStaged } from '@factoryos/db';
import { BadRequestException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { Db, Tx } from '../accounting/accounting-lock.js';
import type { BillService, TradeSide } from '../accounting/bill.service.js';
import type { GlPostingService } from '../accounting/gl-posting.service.js';
import type { SettlementService } from '../accounting/settlement.service.js';
import type { StockPostingService } from '../stock-posting.service.js';
import { voucherLabel } from './tally-vouchers.js';

/**
 * Decision 075 PR 2: receipts, payments, journals (and contra) and stock journals from months kept in Tally. They are
 * made through the settlement service, the GL posting service and stock entries, as one entered here would be.
 */
export type EntryKind = 'receipt' | 'payment' | 'journal' | 'stock_journal';
export const ENTRY_KINDS: readonly EntryKind[] = ['receipt', 'payment', 'journal', 'stock_journal'];
export const ENTRY_BASE_TYPES: Readonly<Record<string, EntryKind>> = { Receipt: 'receipt', Payment: 'payment', Journal: 'journal', Contra: 'journal', 'Stock Journal': 'stock_journal' };
export const ENTRY_LABEL: Record<EntryKind, string> = { receipt: 'Receipt', payment: 'Payment', journal: 'Journal', stock_journal: 'Stock journal' };
export const isEntryKind = (k: unknown): k is EntryKind => ENTRY_KINDS.includes(k as EntryKind);

const CASH_GROUPS = ['Cash-in-Hand', 'Bank Accounts'];

interface TaxLedgerPayload {
  gstDutyHead?: string | null;
  taxType?: string | null;
  opening?: { side: 'debit' | 'credit' } | null;
}

/**
 * The tax role of a Tally tax ledger on a journal, receipt or payment. A line's side does not say input or output (a
 * GST payment debits the output ledger), so the direction comes from the name (Input/ITC or Output, Receivable or
 * Payable), else from the side of its opening balance; a ledger that says neither stays unlinked and is named.
 */
export function taxRoleOf(name: string, l: TaxLedgerPayload): string | null {
  const head = `${l.gstDutyHead ?? ''} ${name}`.toLowerCase();
  const kind = /\b(cgst|central tax)\b/.test(head) ? 'cgst' : /\b(sgst|utgst|state tax|ut tax)\b/.test(head) ? 'sgst' : /\b(igst|integrated tax)\b/.test(head) ? 'igst' : /\bcess\b/.test(head) ? 'cess' : null;
  const n = name.toLowerCase();
  const fromOpening = l.opening?.side ?? null;
  if (kind) {
    const input = /\b(input|itc)\b/.test(n) ? true : /\boutput\b/.test(n) ? false : fromOpening ? fromOpening === 'debit' : null;
    return input === null ? null : `${input ? 'input' : 'output'}_${kind}`;
  }
  const type = (l.taxType ?? '').toLowerCase();
  if (type === 'tds' || /\btds\b/.test(n)) return /receivable/.test(n) || (!/payable/.test(n) && fromOpening === 'debit') ? 'tds_receivable' : 'tds_payable';
  if (type === 'tcs' || /\btcs\b/.test(n)) return /receivable|recoverable/.test(n) || (!/payable/.test(n) && fromOpening === 'debit') ? 'tcs_recoverable' : 'tcs_payable';
  return null;
}

export type EntryResolver = Awaited<ReturnType<typeof entryResolver>>;

/** Ledger names → GL accounts (cash or bank or not) and parties, with the side each party's ledger sits on in Tally. */
export async function entryResolver(tx: Db, tenantId: string, entityId: string, base: Pick<TallyEntryLinks, 'item' | 'warehouse'>) {
  const links = await tx.select({ kind: tallyLink.kind, name: tallyLink.name, targetId: tallyLink.targetId }).from(tallyLink).where(eq(tallyLink.entityId, entityId));
  const accounts = new Map((await tx.select({ id: glAccount.id, groupId: glAccount.groupId, role: glAccount.role }).from(glAccount).where(eq(glAccount.entityId, entityId))).map((a) => [a.id, a]));
  const groups = new Map((await tx.select({ id: accountGroup.id, name: accountGroup.name, parentId: accountGroup.parentId }).from(accountGroup).where(eq(accountGroup.tenantId, tenantId))).map((g) => [g.id, g]));
  const cash = (groupId: string | null) => {
    for (let g = groupId, depth = 0; g && depth < 20; depth++) {
      const row = groups.get(g);
      if (!row) return false;
      if (CASH_GROUPS.includes(row.name)) return true;
      g = row.parentId;
    }
    return false;
  };
  const [settings] = await tx.select({ mappings: accountingSettings.mappings }).from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
  // Stock value moves only with stock: a journal posting to inventory or GRNI would leave the stock ledger behind.
  const stockAccounts = new Set([settings?.mappings?.inventory, settings?.mappings?.grni, ...[...accounts.values()].filter((a) => a.role === 'inventory' || a.role === 'grni').map((a) => a.id)].filter((x): x is string => !!x));
  const parties = new Map((await tx.select({ id: party.id, isCustomer: party.isCustomer, isSupplier: party.isSupplier }).from(party).where(eq(party.tenantId, tenantId))).map((p) => [p.id, p]));
  // The Tally group of each party ledger, from committed imports: under Sundry Creditors is a payable.
  const staged = await tx
    .select({ kind: tallyStaged.kind, name: tallyStaged.name, payload: tallyStaged.payload })
    .from(tallyStaged)
    .innerJoin(tallyImport, eq(tallyImport.id, tallyStaged.importId))
    .where(and(eq(tallyStaged.entityId, entityId), eq(tallyImport.status, 'committed')));
  const parentOf = new Map<string, string | null>();
  for (const s of staged) if (s.kind === 'group' || s.kind === 'party') parentOf.set(`${s.kind}:${s.name}`, ((s.payload as { parent?: string | null }).parent ?? null) || null);
  // Tax ledgers are not linked by the masters import (they are matched by duty head); here they go to the tax account
  // of their role. Accounts with a role, then the entity's mappings, as for opening balances.
  const roleAccount = new Map<string, string>([...accounts.values()].filter((a) => a.role).map((a) => [a.role!, a.id]));
  for (const [role, id] of Object.entries(settings?.mappings ?? {})) if (id) roleAccount.set(role, id);
  const taxLedgers = new Map<string, string>();
  for (const s of staged) {
    if (s.kind !== 'ledger') continue;
    const role = taxRoleOf(s.name, s.payload as TaxLedgerPayload);
    const id = role ? roleAccount.get(role) : undefined;
    if (id) taxLedgers.set(s.name, id);
  }
  const creditorLedger = (name: string) => {
    const seen = new Set<string>();
    for (let g = parentOf.get(`party:${name}`) ?? null; g && !seen.has(g); g = parentOf.get(`group:${g}`) ?? null) {
      if (g === 'Sundry Creditors') return true;
      if (g === 'Sundry Debtors') return false;
      seen.add(g);
    }
    return null;
  };
  const byName = new Map<string, TallyLedgerTarget>();
  for (const [name, id] of taxLedgers) byName.set(name, { kind: 'account', id, cash: false });
  for (const l of links) {
    if (l.kind === 'party' && parties.has(l.targetId)) byName.set(l.name, { kind: 'party', id: l.targetId });
    if (l.kind === 'ledger' && accounts.has(l.targetId)) byName.set(l.name, { kind: 'account', id: l.targetId, cash: cash(accounts.get(l.targetId)!.groupId) });
  }
  const sideByName = new Map<string, TradeSide>();
  for (const l of links)
    if (l.kind === 'party') {
      const p = parties.get(l.targetId);
      const creditor = creditorLedger(l.name) ?? (p ? p.isSupplier && !p.isCustomer : false);
      sideByName.set(l.name, creditor ? 'payable' : 'receivable');
    }
  return {
    links: { ledger: (name: string) => byName.get(name) ?? null, item: base.item, warehouse: base.warehouse } satisfies TallyEntryLinks,
    parties,
    stockAccounts,
    side: (ledger: string): TradeSide => sideByName.get(ledger) ?? 'receivable',
  };
}

export type EntryPlan =
  | { settlement: TallySettlementDraft; journal?: undefined; stock?: undefined; problems?: undefined }
  | { journal: TallyJournalDraft; sides: (TradeSide | null)[]; settlement?: undefined; stock?: undefined; problems?: undefined }
  | { stock: TallyStockDraft; settlement?: undefined; journal?: undefined; problems?: undefined }
  | { problems: string[]; settlement?: undefined; journal?: undefined; stock?: undefined };

/** What a voucher of an entry kind becomes, or why it cannot. Staging and commit use the same answer. */
export function planEntry(v: TallyVoucher, kind: EntryKind, r: EntryResolver): EntryPlan {
  if (kind === 'stock_journal') {
    const res = tallyStockJournal(v, r.links);
    return res.problems ? { problems: res.problems } : { stock: res.draft };
  }
  if (kind === 'receipt' || kind === 'payment') {
    const res = tallySettlement(v, kind, r.links);
    if (res.problems) return { problems: res.problems };
    // A receipt from a party that is not a customer (a supplier's refund) is booked as a journal, as Tally has it.
    const p = res.draft ? r.parties.get(res.draft.partyId) : null;
    if (res.draft && p && (kind === 'receipt' ? p.isCustomer : p.isSupplier)) return { settlement: res.draft };
  }
  const res = tallyJournal(v, r.links);
  if (res.problems) return { problems: res.problems };
  const problems: string[] = [];
  for (const l of v.lines) {
    const t = r.links.ledger(l.ledger);
    if (t?.kind === 'account' && r.stockAccounts.has(t.id)) problems.push(`The ledger "${l.ledger}" is a stock account in FactoryOS; stock value moves only with stock, so book it as a stock journal or purchase.`);
  }
  if (problems.length) return { problems };
  // Each party line's side comes from its Tally ledger, in the order the core lines are built.
  const sides: (TradeSide | null)[] = [];
  for (const l of res.draft.lines) {
    if (!l.partyId) {
      sides.push(null);
      continue;
    }
    const ledger = v.lines.find((x) => r.links.ledger(x.ledger)?.id === l.partyId)?.ledger;
    sides.push(ledger ? r.side(ledger) : 'receivable');
  }
  return { journal: res.draft, sides };
}

/**
 * The batch goods come in on. A tracked item without a Tally batch gets `TALLY-<number>`; that batch is looked up
 * first, since a re-synced voucher made it the first time (the reversal keeps the batch row).
 */
export async function inboundBatch(tx: Tx, tenantId: string, itemId: string, batchNo: string | null, tracked: boolean, number: string) {
  const name = batchNo ?? (tracked ? `TALLY-${number}`.slice(0, 40) : null);
  if (!name) return { batchId: null, newBatchNo: null };
  const [b] = await tx.select({ id: batch.id }).from(batch).where(and(eq(batch.itemId, itemId), eq(batch.batchNo, name), eq(batch.tenantId, tenantId)));
  return { batchId: b?.id ?? null, newBatchNo: b || !tracked ? null : name };
}

export interface EntryServices {
  tracked: (itemId: string) => boolean;
  settlements: SettlementService;
  bills: BillService;
  gl: GlPostingService;
  stock: StockPostingService;
}

export interface CreatedEntry {
  /** What the version row records: a receipt or payment, a journal (its GL voucher) or a stock entry. */
  documentKind: 'receipt' | 'payment' | 'tally_journal' | 'stock_entry';
  documentId: string;
}

/**
 * Creates the document of a planned entry. `versionId` is the version row's id, written after: a journal is posted
 * with it as its source, so a re-synced voucher posts again under a new version.
 */
export async function createEntry(tx: Tx, ctx: TenantRequestContext, entityId: string, v: TallyVoucher, plan: EntryPlan, versionId: string, s: EntryServices): Promise<CreatedEntry> {
  if (plan.settlement) return settlementFrom(tx, ctx, entityId, v, plan.settlement, s);
  if (plan.journal) return journalFrom(tx, ctx, entityId, v, plan.journal, plan.sides, versionId, s);
  if (plan.stock) return stockJournalFrom(tx, ctx, entityId, v, plan.stock, s);
  throw new BadRequestException(`${voucherLabel(v)}: ${plan.problems.join(' ')}`);
}

/** Open INR bills of the party on one side, by reference; two with one reference cannot be told apart. */
async function openBills(tx: Tx, s: EntryServices, entityId: string, partyId: string, side: TradeSide, date: string) {
  const bills = (await s.bills.list(tx, entityId, { partyId, side })).filter((b) => b.kind === 'bill' && b.currency === 'INR' && b.recognitionDate <= date && Dec.of(b.openAmount).gt('0'));
  return (v: TallyVoucher, reference: string) => {
    const same = bills.filter((b) => b.reference === reference);
    if (same.length > 1) throw new BadRequestException(`${voucherLabel(v)}: ${same.length} open bills of this party are referenced "${reference}"; settle it in FactoryOS or give the bills distinct references.`);
    return same[0] ?? null;
  };
}

async function settlementFrom(tx: Tx, ctx: TenantRequestContext, entityId: string, v: TallyVoucher, d: TallySettlementDraft, s: EntryServices): Promise<CreatedEntry> {
  await s.bills.syncIn(tx, ctx, entityId);
  const find = await openBills(tx, s, entityId, d.partyId, d.kind === 'receipt' ? 'receivable' : 'payable', d.date);
  // Each "Agst Ref" settles its own amount, up to what is open; the rest stays on account.
  const byBill = new Map<string, Dec>();
  const open = new Map<string, Dec>();
  for (const b of d.bills) {
    const bill = find(v, b.reference);
    if (!bill) continue;
    const left = open.get(bill.id) ?? Dec.of(bill.openAmount);
    const take = Dec.of(b.amount).gt(left) ? left : Dec.of(b.amount);
    if (!take.gt('0')) continue;
    byBill.set(bill.id, (byBill.get(bill.id) ?? Dec.ZERO).add(take));
    open.set(bill.id, left.sub(take));
  }
  const [row] = await tx
    .insert(partySettlement)
    .values({
      tenantId: ctx.tenant.tenantId,
      entityId,
      direction: d.kind,
      partyId: d.partyId,
      postingDate: d.date,
      currency: 'INR',
      exchangeRate: '1',
      accountId: d.accountId,
      amount: d.amount,
      narration: v.narration?.slice(0, 1000) ?? null,
      allocations: [...byBill].map(([billId, amount]) => ({ billId, amount: amount.toFixed(2) })),
      source: 'tally',
      tallyGuid: v.guid,
      createdBy: ctx.user.id,
    })
    .returning();
  await s.settlements.submitIn(tx, ctx, entityId, row!.id, { number: d.number }).catch((e: unknown) => {
    throw new BadRequestException(`${voucherLabel(v)}: ${e instanceof Error ? e.message : String(e)}`);
  });
  return { documentKind: d.kind, documentId: row!.id };
}

async function journalFrom(tx: Tx, ctx: TenantRequestContext, entityId: string, v: TallyVoucher, d: TallyJournalDraft, sides: (TradeSide | null)[], versionId: string, s: EntryServices): Promise<CreatedEntry> {
  await s.bills.syncIn(tx, ctx, entityId);
  const controls = { receivable: await s.bills.currentControl(tx, entityId, 'receivable'), payable: await s.bills.currentControl(tx, entityId, 'payable') };
  const onAccount = `Tally ${d.number}`;
  const lines: { accountId: string; debit: string; credit: string; partyId?: string; billReference?: string }[] = [];
  const finders = new Map<string, Awaited<ReturnType<typeof openBills>>>();
  const open = new Map<string, Dec>();
  for (const [i, l] of d.lines.entries()) {
    const side = sides[i];
    if (!l.partyId || !side) {
      lines.push({ accountId: l.accountId!, debit: l.debit, credit: l.credit });
      continue;
    }
    const accountId = controls[side];
    const reduces = side === 'receivable' ? Dec.of(l.credit).gt('0') : Dec.of(l.debit).gt('0');
    const amount = Dec.of(l.debit).add(l.credit);
    const put = (a: Dec, billReference: string) => {
      if (!a.gt('0')) return;
      const value = a.toFixed(2);
      lines.push({ accountId, partyId: l.partyId!, billReference, debit: Dec.of(l.debit).gt('0') ? value : '0', credit: Dec.of(l.credit).gt('0') ? value : '0' });
    };
    if (!l.billReference) {
      put(amount, onAccount);
      continue;
    }
    // A line settling a bill settles at most what is open; the rest stays on account, as on a receipt.
    const key = `${l.partyId}:${side}`;
    if (!finders.has(key)) finders.set(key, await openBills(tx, s, entityId, l.partyId, side, d.date));
    const bill = finders.get(key)!(v, l.billReference);
    if (!reduces || !bill) {
      put(amount, bill || !reduces ? l.billReference : onAccount);
      continue;
    }
    const left = open.get(bill.id) ?? Dec.of(bill.openAmount);
    const take = amount.gt(left) ? left : amount;
    open.set(bill.id, left.sub(take));
    put(take, bill.reference);
    put(amount.sub(take), onAccount);
  }
  await s.bills.checkJournalLinesIn(tx, entityId, lines).catch((e: unknown) => {
    throw new BadRequestException(`${voucherLabel(v)}: ${e instanceof Error ? e.message : String(e)}`);
  });
  const { voucherId } = await s.gl.postIn(tx, ctx, entityId, { type: 'tally_journal', id: versionId, purpose: 'main', number: d.number, narration: `${v.type} ${d.number} (from Tally): ${d.narration}`.slice(0, 1000) }, d.date, {
    lines,
    disposition: 'posted',
  });
  if (!voucherId) throw new BadRequestException(`${voucherLabel(v)}: activate accounting before bringing in journals from Tally.`);
  return { documentKind: 'tally_journal', documentId: voucherId };
}

async function stockJournalFrom(tx: Tx, ctx: TenantRequestContext, entityId: string, v: TallyVoucher, d: TallyStockDraft, s: EntryServices): Promise<CreatedEntry> {
  const tenantId = ctx.tenant.tenantId;
  const transfer = d.kind === 'transfer';
  const [entry] = await tx
    .insert(stockEntry)
    .values({
      tenantId,
      entityId,
      purpose: transfer ? 'transfer' : 'adjustment',
      postingDate: d.date,
      reference: d.number,
      remarks: `Stock journal ${d.number} (from Tally)${v.narration ? `: ${v.narration}` : ''}`.slice(0, 1000),
      systemGenerated: true,
      source: 'tally',
      createdBy: ctx.user.id,
    })
    .returning();
  const batchOf = async (itemId: string, batchNo: string | null) => {
    if (!batchNo) return null;
    const [b] = await tx.select({ id: batch.id }).from(batch).where(and(eq(batch.itemId, itemId), eq(batch.batchNo, batchNo), eq(batch.tenantId, tenantId)));
    return b?.id ?? null;
  };
  const rows = [];
  if (d.kind === 'transfer') {
    for (const m of d.moves) rows.push({ itemId: m.itemId, qty: m.qty, fromWarehouseId: m.from, toWarehouseId: m.to, batchId: await batchOf(m.itemId, m.batch) });
  } else {
    // What was consumed leaves first at FIFO cost; what was produced comes in at Tally's value.
    for (const l of d.out) rows.push({ itemId: l.itemId, qty: l.qty, fromWarehouseId: l.warehouseId, batchId: await batchOf(l.itemId, l.batch) });
    for (const l of d.in) {
      rows.push({ itemId: l.itemId, qty: l.qty, toWarehouseId: l.warehouseId, rate: Dec.of(l.value).div(l.qty).toString(), ...(await inboundBatch(tx, tenantId, l.itemId, l.batch, s.tracked(l.itemId), d.number)) });
    }
  }
  await tx.insert(stockEntryLine).values(rows.map((r, i) => ({ ...r, entryId: entry!.id, lineNo: i + 1 })));
  await s.stock.submitIn(tx, ctx, entityId, entry!.id).catch((e: unknown) => {
    throw new BadRequestException(`${voucherLabel(v)}: can't move the stock: ${e instanceof Error ? e.message : String(e)}`);
  });
  return { documentKind: 'stock_entry', documentId: entry!.id };
}
