import { purchaseInvoice, salesInvoice, salesNote, settlementAllocationDocument, stockEntry, supplierNote, tallyDocumentVersion, tallyVoucher } from '@factoryos/db';
import { ConflictException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { AuditService } from '../../common/audit.service.js';
import { businessDate, type Db, type Tx } from '../accounting/accounting-lock.js';
import type { BillService } from '../accounting/bill.service.js';
import type { GlPostingService } from '../accounting/gl-posting.service.js';
import type { SettlementService } from '../accounting/settlement.service.js';
import type { StockPostingService } from '../stock-posting.service.js';

/**
 * Decision 075a/075b: one reversal for every document a Tally voucher became, used to re-sync an edited voucher and to
 * switch a month back to FactoryOS. Each kind is reversed through the same GL, bill and stock reversals as a cancel
 * here; a document something later depends on is refused, naming the dependents.
 */
export type Version = typeof tallyDocumentVersion.$inferSelect;

export interface ReversalServices {
  stock: StockPostingService;
  gl: GlPostingService;
  bills: BillService;
  settlements: SettlementService;
  audit: AuditService;
}

const LABEL: Record<string, string> = {
  sales_invoice: 'Sales invoice',
  purchase_invoice: 'Purchase invoice',
  sales_credit_note: 'Customer credit note',
  supplier_debit_note: 'Supplier debit note',
  receipt: 'Receipt',
  payment: 'Payment',
  tally_journal: 'Journal',
  stock_entry: 'Stock journal',
};

/** Newest dependents first: notes, then money and journals, then sales, stock journals, then purchases. */
const RANK: Record<string, number> = { sales_credit_note: 0, supplier_debit_note: 0, receipt: 1, payment: 1, tally_journal: 1, sales_invoice: 2, stock_entry: 3, purchase_invoice: 4 };

/** The (type, id) a document's bills and bill effects carry. */
function billSource(v: Version): string | null {
  switch (v.documentKind) {
    case 'sales_invoice':
    case 'purchase_invoice':
      return `${v.documentKind}:${v.documentId}`;
    case 'sales_credit_note':
      return `sales_note:${v.documentId}`;
    case 'supplier_debit_note':
      return `supplier_note:${v.documentId}`;
    case 'receipt':
    case 'payment':
      return `settlement:${v.documentId}`;
    case 'tally_journal':
      return `tally_journal:${v.id}`;
    default:
      return null;
  }
}

/** The stock entries a document moved stock on. */
async function stockEntriesOf(tx: Db, v: Version) {
  const ids = v.parts.filter((p) => p.kind === 'stock_entry').map((p) => p.id);
  if (v.documentKind === 'stock_entry') ids.push(v.documentId);
  if (v.documentKind === 'sales_invoice') {
    const [inv] = await tx.select({ id: salesInvoice.stockEntryId }).from(salesInvoice).where(eq(salesInvoice.id, v.documentId));
    if (inv?.id) ids.push(inv.id);
  }
  if (v.documentKind === 'sales_credit_note') {
    const [note] = await tx.select({ id: salesNote.stockEntryId }).from(salesNote).where(eq(salesNote.id, v.documentId));
    if (note?.id) ids.push(note.id);
  }
  return ids;
}

/** A readable label for a document: its kind and number. */
export async function versionLabel(tx: Db, v: Version) {
  const number = async () => {
    switch (v.documentKind) {
      case 'sales_invoice':
        return (await tx.select({ n: salesInvoice.number }).from(salesInvoice).where(eq(salesInvoice.id, v.documentId)))[0]?.n;
      case 'purchase_invoice':
        return (await tx.select({ n: purchaseInvoice.number }).from(purchaseInvoice).where(eq(purchaseInvoice.id, v.documentId)))[0]?.n;
      case 'sales_credit_note':
        return (await tx.select({ n: salesNote.number }).from(salesNote).where(eq(salesNote.id, v.documentId)))[0]?.n;
      case 'supplier_debit_note':
        return (await tx.select({ n: supplierNote.number }).from(supplierNote).where(eq(supplierNote.id, v.documentId)))[0]?.n;
      case 'stock_entry':
        return (await tx.select({ n: stockEntry.reference }).from(stockEntry).where(eq(stockEntry.id, v.documentId)))[0]?.n;
      default: {
        const r = await tx.execute<{ n: string | null }>(sql`select coalesce((select number from party_settlement where id = ${v.documentId}), (select source_number from journal_voucher where id = ${v.documentId})) as n`);
        return r.rows[0]?.n;
      }
    }
  };
  return `${LABEL[v.documentKind] ?? v.documentKind} ${(await number()) ?? ''}`.trim();
}

/**
 * Documents outside `versions` (and outside `exclude`, those reversed together with them) that depend on them: a
 * receipt, payment, allocation, journal or note settling one of their bills, a note against one of their invoices, or
 * a stock movement that consumed a FIFO layer their stock created (decision 028).
 */
export async function dependentsOf(tx: Db, entityId: string, versions: Version[], exclude: Version[] = versions) {
  const keys = versions.map(billSource).filter((k): k is string => !!k);
  const skip = [...new Set([...versions, ...exclude].map(billSource).filter((k): k is string => !!k))];
  const out = new Set<string>();
  if (keys.length) {
    const rows = await tx.execute<{ label: string }>(sql`
      select distinct coalesce(
        (select case s.direction when 'receipt' then 'Receipt ' else 'Payment ' end || coalesce(s.number, '') from party_settlement s where f.source_type = 'settlement' and s.id = f.source_id),
        (select 'Allocation ' || coalesce(a.number, '') from settlement_allocation_document a where f.source_type = 'settlement_allocation' and a.id = f.source_id),
        (select 'Customer note ' || coalesce(n.number, '') from sales_note n where f.source_type = 'sales_note' and n.id = f.source_id),
        (select 'Supplier note ' || coalesce(n.number, '') from supplier_note n where f.source_type = 'supplier_note' and n.id = f.source_id),
        (select 'Journal ' || coalesce(v.source_number, v.number) from journal_voucher v where v.source_type = f.source_type and v.source_id = f.source_id and v.reversal_of is null limit 1),
        f.source_type) as label
      from trade_bill b
      join trade_bill_effect f on f.bill_id = b.id
      where b.entity_id = ${entityId} and b.source_id is not null
        and (b.source_type || ':' || b.source_id::text) = any(${`{${keys.join(',')}}`}::text[])
        and not ((f.source_type || ':' || coalesce(f.source_id::text, '')) = any(${`{${skip.join(',')}}`}::text[]))
        and f.reversal_of is null
        and not exists (select 1 from trade_bill_effect r where r.reversal_of = f.id)`);
    for (const r of rows.rows) out.add(r.label);
  }
  // Notes entered here against an invoice from Tally.
  const ids = (k: string) => versions.filter((v) => v.documentKind === k).map((v) => v.documentId);
  const excluded = new Set([...versions, ...exclude].map((v) => v.documentId));
  if (ids('sales_invoice').length)
    for (const n of await tx.select({ id: salesNote.id, number: salesNote.number }).from(salesNote).where(and(inArray(salesNote.originalInvoiceId, ids('sales_invoice')), ne(salesNote.status, 'cancelled'))))
      if (!excluded.has(n.id)) out.add(`Customer note ${n.number ?? ''}`.trim());
  if (ids('purchase_invoice').length)
    for (const n of await tx.select({ id: supplierNote.id, number: supplierNote.number }).from(supplierNote).where(and(inArray(supplierNote.originalInvoiceId, ids('purchase_invoice')), ne(supplierNote.status, 'cancelled'))))
      if (!excluded.has(n.id)) out.add(`Supplier note ${n.number ?? ''}`.trim());
  // Stock issued from layers these documents received.
  const entries = (await Promise.all(versions.map((v) => stockEntriesOf(tx, v)))).flat();
  const own = [...new Set([...entries, ...(await Promise.all(exclude.map((v) => stockEntriesOf(tx, v)))).flat()])];
  if (entries.length) {
    const rows = await tx.execute<{ label: string }>(sql`
      select distinct coalesce(
        (select 'Stock entry ' || coalesce(e.number, e.reference, e.purpose::text) from stock_entry e where e.id = sle.voucher_id),
        sle.voucher_type) as label
      from fifo_consumption c
      join fifo_layer l on l.id = c.layer_id
      join stock_ledger_entry sle on sle.seq = c.sle_seq
      where l.voucher_id = any(${`{${entries.join(',')}}`}::uuid[])
        and not (sle.voucher_id = any(${`{${own.join(',')}}`}::uuid[]))
        and sle.is_reversal = false
        and not exists (select 1 from stock_entry e where e.id = sle.voucher_id and e.status = 'cancelled')`);
    for (const r of rows.rows) out.add(r.label);
  }
  return [...out].sort();
}

/** Reverses one document from Tally with the same reversals as a cancel, then marks its version reversed. */
export async function reverseVersion(tx: Tx, ctx: TenantRequestContext, entityId: string, v: Version, reason: string, s: ReversalServices) {
  const id = v.documentId;
  const cancelled = { status: 'cancelled' as const, cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() };
  const cancelStock = async () => {
    for (const entryId of await stockEntriesOf(tx, v)) {
      const [e] = await tx.select({ status: stockEntry.status }).from(stockEntry).where(eq(stockEntry.id, entryId));
      if (e?.status === 'submitted') await s.stock.cancelIn(tx, ctx, entityId, entryId, reason);
    }
  };
  switch (v.documentKind) {
    case 'sales_invoice':
      await s.gl.reverseIn(tx, ctx, entityId, { type: 'sales_invoice', id, purpose: 'main' }, reason);
      await cancelStock();
      await tx.update(salesInvoice).set(cancelled).where(eq(salesInvoice.id, id));
      break;
    case 'purchase_invoice':
      await s.gl.reverseIn(tx, ctx, entityId, { type: 'purchase_invoice', id, purpose: 'main' }, reason);
      await cancelStock();
      await tx.update(purchaseInvoice).set(cancelled).where(eq(purchaseInvoice.id, id));
      break;
    case 'sales_credit_note':
    case 'supplier_debit_note': {
      const sales = v.documentKind === 'sales_credit_note';
      const [applied] = await tx
        .select({ number: settlementAllocationDocument.number })
        .from(settlementAllocationDocument)
        .where(and(sales ? eq(settlementAllocationDocument.creditNoteId, id) : eq(settlementAllocationDocument.supplierNoteId, id), eq(settlementAllocationDocument.status, 'submitted')));
      if (applied) throw new ConflictException(`Allocation ${applied.number ?? ''} applies this note. Cancel it first.`);
      const type = sales ? 'sales_note' : 'supplier_note';
      await s.gl.reverseIn(tx, ctx, entityId, { type, id, purpose: 'main' }, reason);
      await s.bills.reverseSourceEffects(tx, ctx, entityId, type, id, businessDate());
      await cancelStock();
      if (sales) await tx.update(salesNote).set(cancelled).where(eq(salesNote.id, id));
      else await tx.update(supplierNote).set(cancelled).where(eq(supplierNote.id, id));
      break;
    }
    case 'receipt':
    case 'payment':
      await s.settlements.cancelIn(tx, ctx, entityId, id, reason, { fromTally: true });
      break;
    case 'tally_journal':
      await s.gl.reverseIn(tx, ctx, entityId, { type: 'tally_journal', id: v.id, purpose: 'main' }, reason);
      break;
    case 'stock_entry':
      await cancelStock();
      break;
    default:
      throw new ConflictException(`A ${v.documentKind} from Tally cannot be reversed`);
  }
  await tx.update(tallyDocumentVersion).set({ reversedAt: new Date(), reversedReason: reason }).where(eq(tallyDocumentVersion.id, v.id));
  await s.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'accounts.tally.reverse', targetType: v.documentKind, targetId: id, reason }, tx);
}

/** The current versions of documents, newest-dependent first (the order they are reversed in). */
export async function versionsOf(tx: Db, entityId: string, documentIds: string[]) {
  const rows = await tx
    .select({ v: tallyDocumentVersion, date: tallyVoucher.date })
    .from(tallyDocumentVersion)
    .innerJoin(tallyVoucher, and(eq(tallyVoucher.entityId, tallyDocumentVersion.entityId), eq(tallyVoucher.guid, tallyDocumentVersion.guid)))
    .where(and(eq(tallyDocumentVersion.entityId, entityId), inArray(tallyDocumentVersion.documentId, documentIds), isNull(tallyDocumentVersion.reversedAt)))
    .orderBy(desc(tallyVoucher.date), desc(tallyDocumentVersion.createdAt));
  return rows.sort((a, b) => (RANK[a.v.documentKind] ?? 9) - (RANK[b.v.documentKind] ?? 9)).map((r) => r.v);
}

/** Current documents from Tally dated in a month, newest-dependent first, so nothing is reversed before what needs it. */
export async function versionsInMonth(tx: Db, entityId: string, month: string) {
  const rows = await tx
    .select({ v: tallyDocumentVersion, date: tallyVoucher.date })
    .from(tallyDocumentVersion)
    .innerJoin(tallyVoucher, and(eq(tallyVoucher.entityId, tallyDocumentVersion.entityId), eq(tallyVoucher.guid, tallyDocumentVersion.guid)))
    .where(and(eq(tallyDocumentVersion.entityId, entityId), isNull(tallyDocumentVersion.reversedAt), sql`to_char(${tallyVoucher.date}, 'YYYY-MM') = ${month}`))
    .orderBy(desc(tallyVoucher.date), desc(tallyDocumentVersion.createdAt));
  return rows.sort((a, b) => (RANK[a.v.documentKind] ?? 9) - (RANK[b.v.documentKind] ?? 9)).map((r) => ({ ...r.v, date: r.date }));
}

/** What switching a month back to FactoryOS reverses, and what outside it would stop that. */
export async function switchBackPreview(tx: Db, entityId: string, month: string) {
  const versions = await versionsInMonth(tx, entityId, month);
  const documents = [];
  for (const v of versions) documents.push({ kind: v.documentKind, documentId: v.documentId, date: v.date, label: await versionLabel(tx, v) });
  return { month, documents, dependents: versions.length ? await dependentsOf(tx, entityId, versions) : [] };
}

/** Reverses every document from Tally in the month (refused while anything outside depends on them). */
export async function reverseMonth(tx: Tx, ctx: TenantRequestContext, entityId: string, month: string, s: ReversalServices) {
  const versions = await versionsInMonth(tx, entityId, month);
  if (!versions.length) return 0;
  const dependents = await dependentsOf(tx, entityId, versions);
  if (dependents.length) throw new ConflictException(`${month} can't go back to FactoryOS while later documents depend on its Tally documents: ${dependents.join(', ')}. Cancel those first.`);
  const reason = `${month} switched back to FactoryOS`;
  for (const v of versions) {
    await reverseVersion(tx, ctx, entityId, v, reason, s);
    // The voucher stays history; it is no longer a document.
    await tx.update(tallyVoucher).set({ documentKind: null, documentId: null }).where(and(eq(tallyVoucher.entityId, entityId), eq(tallyVoucher.guid, v.guid), eq(tallyVoucher.documentId, v.documentId)));
  }
  return versions.length;
}

/** Every document the voucher behind a document became, oldest first (decision 075a: re-syncs keep both). */
export async function documentVersions(db: Db, entityId: string, documentId: string) {
  const [own] = await db.select({ guid: tallyDocumentVersion.guid }).from(tallyDocumentVersion).where(and(eq(tallyDocumentVersion.entityId, entityId), eq(tallyDocumentVersion.documentId, documentId)));
  if (!own) return { versions: [] };
  const versions = await db
    .select({
      documentKind: tallyDocumentVersion.documentKind,
      documentId: tallyDocumentVersion.documentId,
      alterId: tallyDocumentVersion.alterId,
      reversedAt: tallyDocumentVersion.reversedAt,
      reversedReason: tallyDocumentVersion.reversedReason,
      replacedBy: tallyDocumentVersion.replacedBy,
      createdAt: tallyDocumentVersion.createdAt,
    })
    .from(tallyDocumentVersion)
    .where(and(eq(tallyDocumentVersion.entityId, entityId), eq(tallyDocumentVersion.guid, own.guid)))
    .orderBy(asc(tallyDocumentVersion.createdAt));
  return { versions };
}
