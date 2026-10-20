import { Dec, fyCode } from '@factoryos/core';
import type { TallyVoucher } from '@factoryos/core/tally';
import { TALLY_BASE_TYPES, tallyDocument, type TallyDocumentDraft, type TallyDocumentKind, type TallyDocumentLinks, type TaxHead } from '@factoryos/core/tally-documents';
import {
  batch,
  gstRegistration,
  hsnCode,
  item,
  party,
  purchaseInvoice,
  purchaseInvoiceLine,
  salesInvoice,
  salesInvoiceLine,
  salesNote,
  supplierNote,
  stockEntry,
  stockEntryLine,
  stockLedgerEntry,
  tallyBookMonth,
  tallyImport,
  tallyLedgerItem,
  tallyLink,
  tallyStaged,
  tallyVoucher,
  tallyVoucherTypeMap,
  warehouse,
} from '@factoryos/db';
import { BadRequestException } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { AuditService } from '../../common/audit.service.js';
import type { Db, Tx } from '../accounting/accounting-lock.js';
import type { OperationalPostings } from '../accounting/operational-postings.js';
import type { StockPostingService } from '../stock-posting.service.js';
import { voucherLabel } from './tally-vouchers.js';

/**
 * Decision 075: in a month kept in Tally (see tally-books.ts), each imported voucher of a mapped type becomes a
 * submitted FactoryOS document with Tally's number, date and amounts, posted through the same stock and accounting code
 * as a document entered here. Vouchers in other months stay history (decision 072).
 */

type StagedDocument = {
  kind: 'document';
  guid: string | null;
  alterId: number | null;
  name: string;
  payload: Record<string, unknown>;
  proposed: 'new' | 'update' | 'unchanged' | 'conflict' | 'skip';
  targetId: string | null;
  candidates: { id: string; label: string; reason: string }[];
  notes: string[];
};

const KIND_LABEL: Record<TallyDocumentKind, string> = {
  sales_invoice: 'Sales invoice',
  purchase_invoice: 'Purchase invoice',
  sales_credit_note: 'Customer credit note',
  supplier_debit_note: 'Supplier debit note',
};

/** What each voucher type of this entity becomes: the person's mapping, else Tally's base type, else nothing. */
export async function voucherTypeKinds(db: Db, entityId: string) {
  const rows = await db.select().from(tallyVoucherTypeMap).where(eq(tallyVoucherTypeMap.entityId, entityId));
  const mapped = new Map(rows.map((r) => [r.voucherType, r.documentKind as TallyDocumentKind | 'none']));
  return (type: string): TallyDocumentKind | null => {
    const k = mapped.get(type) ?? TALLY_BASE_TYPES[type] ?? null;
    return k === 'none' ? null : k;
  };
}

/**
 * One document row per voucher of a mapped type dated in a month kept in Tally. Each new one is checked against the
 * links and mappings as they stand: a voucher that cannot be made a document is a conflict naming why, unless the same
 * upload carries masters (their links only exist after commit, so commit checks again).
 */
export async function stageDocuments(tx: Db, tenantId: string, entityId: string, vouchers: TallyVoucher[], withMasters = false): Promise<StagedDocument[]> {
  const tallyMonths = new Set(
    (await tx.select({ month: tallyBookMonth.month }).from(tallyBookMonth).where(and(eq(tallyBookMonth.entityId, entityId), eq(tallyBookMonth.source, 'tally')))).map((r) => r.month),
  );
  if (!tallyMonths.size) return [];
  const kindOf = await voucherTypeKinds(tx, entityId);
  const inMonth = vouchers.filter((v) => v.guid && v.date && !v.deleted && !v.cancelled && !v.optional && tallyMonths.has(v.date.slice(0, 7)));
  const guids = inMonth.map((v) => v.guid!);
  const history = new Map<string, { alterId: number | null; documentId: string | null }>();
  for (let i = 0; i < guids.length; i += 1000)
    for (const r of await tx
      .select({ guid: tallyVoucher.guid, alterId: tallyVoucher.alterId, documentId: tallyVoucher.documentId })
      .from(tallyVoucher)
      .where(and(eq(tallyVoucher.entityId, entityId), inArray(tallyVoucher.guid, guids.slice(i, i + 1000)))))
      history.set(r.guid, r);
  const r = inMonth.length ? await resolver(tx, tenantId, entityId) : null;
  const links = r?.regs.length === 1 ? r.links(r.regs[0]!.stateCode) : null;
  const check = (v: TallyVoucher, kind: TallyDocumentKind) =>
    !links ? [r?.regs.length ? 'This entity has several GSTINs; documents from Tally need one GSTIN for the entity for now.' : 'Add the GST registration of this entity first.'] : (tallyDocument(v, kind, links).problems ?? []);
  const out: StagedDocument[] = [];
  for (const v of inMonth) {
    const kind = kindOf(v.type);
    const row = (s: Partial<StagedDocument>): StagedDocument => ({
      kind: 'document',
      guid: v.guid,
      alterId: v.alterId,
      name: `${kind ? KIND_LABEL[kind] : v.type} ${v.number ?? ''}`.trim(),
      payload: { documentKind: kind, voucherType: v.type, number: v.number, date: v.date, party: v.party },
      proposed: 'new',
      targetId: null,
      candidates: [],
      notes: [],
      ...s,
    });
    if (!kind) {
      out.push(row({ proposed: 'skip', notes: [`Voucher type "${v.type}" is not mapped to a FactoryOS document, so it stays history. Map it under Tally import → Mappings to bring it in.`] }));
      continue;
    }
    const prior = history.get(v.guid!);
    if (prior?.documentId) {
      const newer = (v.alterId ?? 0) > (prior.alterId ?? 0);
      out.push(
        newer
          ? row({ proposed: 'conflict', targetId: prior.documentId, notes: ['Edited in Tally after it was brought in. Cancel the FactoryOS document, then import again to bring the edited version.'] })
          : row({ proposed: 'unchanged', targetId: prior.documentId }),
      );
      continue;
    }
    const becomes = `Becomes a submitted ${KIND_LABEL[kind].toLowerCase()} with Tally's number and amounts.`;
    const problems = check ? check(v, kind) : [];
    if (!problems.length) out.push(row({ notes: [becomes] }));
    else if (withMasters) out.push(row({ notes: [becomes, ...problems.map((p) => `Checked again at commit, after the masters: ${p}`)] }));
    else out.push(row({ proposed: 'conflict', notes: problems }));
  }
  return out;
}

/** Name → FactoryOS record links, built once per commit from the master links and earlier imports. */
async function resolver(tx: Db, tenantId: string, entityId: string) {
  const links = await tx.select({ kind: tallyLink.kind, name: tallyLink.name, targetId: tallyLink.targetId }).from(tallyLink).where(eq(tallyLink.entityId, entityId));
  const byKind = (k: string) => new Map(links.filter((l) => l.kind === k).map((l) => [l.name, l.targetId]));
  const partyLinks = byKind('party'),
    itemLinks = byKind('stockitem'),
    godownLinks = byKind('godown');
  const parties = new Map(
    (await tx.select({ id: party.id, stateCode: party.stateCode, gstTreatment: party.gstTreatment }).from(party).where(eq(party.tenantId, tenantId))).map((p) => [p.id, p]),
  );
  const items = new Map(
    (await tx.select({ id: item.id, hsnCode: item.hsnCode, isStockItem: item.isStockItem, tracking: item.tracking }).from(item).where(eq(item.tenantId, tenantId))).map((i) => [i.id, i]),
  );
  const rates = new Map<string, string>();
  for (const h of await tx.select({ code: hsnCode.code, gstRate: hsnCode.gstRate }).from(hsnCode).where(eq(hsnCode.tenantId, tenantId)).orderBy(desc(hsnCode.effectiveFrom)))
    if (!rates.has(h.code)) rates.set(h.code, h.gstRate);
  const rateOf = (itemId: string) => {
    const code = items.get(itemId)?.hsnCode;
    return code ? (rates.get(code) ?? null) : null;
  };
  const services = new Map(
    (await tx.select({ ledger: tallyLedgerItem.ledger, itemId: tallyLedgerItem.itemId }).from(tallyLedgerItem).where(eq(tallyLedgerItem.entityId, entityId))).map((r) => [r.ledger, r.itemId]),
  );
  // Tax ledgers by duty head, from the ledger masters of committed imports; the name is the fallback.
  const heads = new Map<string, TaxHead>();
  const ledgerRows = await tx
    .select({ name: tallyStaged.name, payload: tallyStaged.payload })
    .from(tallyStaged)
    .innerJoin(tallyImport, eq(tallyImport.id, tallyStaged.importId))
    .where(and(eq(tallyStaged.entityId, entityId), eq(tallyStaged.kind, 'ledger'), eq(tallyImport.status, 'committed')));
  for (const r of ledgerRows) {
    const head = headOf(String((r.payload as { gstDutyHead?: string | null }).gstDutyHead ?? ''));
    if (head) heads.set(r.name, head);
  }
  const warehouses = new Map((await tx.select({ id: warehouse.id, name: warehouse.name }).from(warehouse).where(eq(warehouse.entityId, entityId))).map((w) => [w.name, w.id]));
  const regs = await tx.select().from(gstRegistration).where(eq(gstRegistration.entityId, entityId));
  return {
    regs,
    parties,
    items,
    links(stateCode: string): TallyDocumentLinks {
      return {
        party: (name) => {
          const id = partyLinks.get(name);
          const p = id ? parties.get(id) : null;
          return p ? { id: p.id, stateCode: p.stateCode } : null;
        },
        item: (name) => {
          const id = itemLinks.get(name);
          return id && items.has(id) ? { id, gstRate: rateOf(id) } : null;
        },
        serviceItem: (ledger) => {
          const id = services.get(ledger);
          return id ? { id, gstRate: rateOf(id) } : null;
        },
        taxHead: (ledger) => heads.get(ledger) ?? headOf(ledger),
        warehouse: (godown) => {
          const name = godown ?? 'Main Location';
          return godownLinks.get(name) ?? warehouses.get(name) ?? null;
        },
        ourStateCode: stateCode,
      };
    },
  };
}

/** TallyPrime writes CGST, SGST/UTGST, IGST and Cess; older releases write Central Tax, State Tax, Integrated Tax. */
function headOf(text: string): TaxHead | null {
  const t = text.toLowerCase();
  if (/\b(cgst|central tax)\b/.test(t)) return 'cgst';
  if (/\b(sgst|utgst|state tax|ut tax)\b/.test(t)) return 'sgst';
  if (/\b(igst|integrated tax)\b/.test(t)) return 'igst';
  if (/\bcess\b/.test(t)) return 'cess';
  return null;
}

/** A header tax shared across lines by taxable value; the last line takes the rounding. */
function shareTax(lines: { taxableValue: string }[], total: string) {
  const sum = lines.reduce((s, l) => s.add(l.taxableValue), Dec.ZERO);
  let left = Dec.of(total);
  return lines.map((l, i) => {
    if (i === lines.length - 1 || sum.isZero()) return left.toFixed(2);
    const part = Dec.of(Dec.of(total).mul(l.taxableValue).div(sum).toFixed(2));
    left = left.sub(part);
    return part.toFixed(2);
  });
}

/** The effective GST rate of a line when FactoryOS knows none: what Tally charged on it. */
const impliedRate = (d: TallyDocumentDraft) => {
  const tax = Dec.of(d.tax.cgst).add(d.tax.sgst).add(d.tax.igst);
  return Dec.of(d.taxableValue).isZero() ? '0' : tax.mul('100').div(d.taxableValue).toFixed(2);
};

export interface DocumentServices {
  stock: StockPostingService;
  accounting: OperationalPostings;
  audit: AuditService;
}

/**
 * Creates the documents of a commit, oldest first (purchases before sales on a day, so stock is there to ship). All or
 * nothing: any voucher that cannot be made a document stops the commit and is named with its reasons.
 */
export async function writeDocuments(tx: Tx, ctx: TenantRequestContext, entityId: string, importId: string, rows: (typeof tallyStaged.$inferSelect)[], s: DocumentServices) {
  const results = new Map<string, string>();
  const todo = rows.filter((r) => r.kind === 'document' && r.action === 'new');
  if (!todo.length) return results;
  const vouchers = new Map(rows.filter((r) => r.kind === 'voucher' && r.guid).map((r) => [r.guid!, r.payload as unknown as TallyVoucher]));
  const r = await resolver(tx, ctx.tenant.tenantId, entityId);
  if (r.regs.length !== 1)
    throw new BadRequestException(
      r.regs.length ? 'This entity has several GSTINs; documents from Tally need one GSTIN for the entity for now.' : 'Add the GST registration of this entity before bringing in Tally documents.',
    );
  const reg = r.regs[0]!;
  const links = r.links(reg.stateCode);
  // On one day: purchases first so stock is there to ship, notes last so the invoice they are against exists.
  const order = (k: unknown) => (k === 'purchase_invoice' ? 0 : k === 'sales_invoice' ? 1 : 2);
  const sorted = [...todo].sort((a, b) => {
    const pa = a.payload as { date: string; documentKind: string },
      pb = b.payload as { date: string; documentKind: string };
    return pa.date.localeCompare(pb.date) || order(pa.documentKind) - order(pb.documentKind);
  });
  const problems: string[] = [];
  const drafts: { row: (typeof rows)[number]; v: TallyVoucher; draft: TallyDocumentDraft }[] = [];
  for (const row of sorted) {
    const v = vouchers.get(row.guid!);
    const kind = (row.payload as { documentKind: TallyDocumentKind }).documentKind;
    if (!v) continue;
    const res = tallyDocument(v, kind, links);
    if (res.problems) problems.push(...res.problems.map((p) => `${voucherLabel(v)}: ${p}`));
    else drafts.push({ row, v, draft: res.draft });
  }
  if (problems.length)
    throw new BadRequestException({
      message: `${problems.length} problem${problems.length === 1 ? '' : 's'} with Tally vouchers in months kept in Tally. Link the masters or map the ledgers, then commit again.`,
      issues: problems.slice(0, 50).map((m) => ({ path: 'documents', message: m })),
    });

  let created = 0;
  for (const { row, v, draft } of drafts) {
    const id =
      draft.kind === 'sales_invoice'
        ? await salesInvoiceFrom(tx, ctx, entityId, reg, v, draft, r, s)
        : draft.kind === 'purchase_invoice'
          ? await purchaseInvoiceFrom(tx, ctx, entityId, reg, v, draft, r, s)
          : draft.kind === 'sales_credit_note'
            ? await salesNoteFrom(tx, ctx, entityId, reg, v, draft, r, s)
            : await supplierNoteFrom(tx, ctx, entityId, reg, v, draft, r, s);
    results.set(row.id, id);
    await tx.update(tallyVoucher).set({ documentKind: draft.kind, documentId: id }).where(and(eq(tallyVoucher.entityId, entityId), eq(tallyVoucher.guid, v.guid!)));
    created++;
  }
  await s.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'accounts.tally.documents', targetType: 'tally_import', targetId: importId, after: { created } }, tx);
  return results;
}

type Resolver = Awaited<ReturnType<typeof resolver>>;
type Registration = typeof gstRegistration.$inferSelect;

/** Batch by number for an item; a receipt may name a new one, a delivery must find it. */
async function batchId(tx: Tx, tenantId: string, itemId: string, batchNo: string | null) {
  if (!batchNo) return null;
  const [b] = await tx.select({ id: batch.id }).from(batch).where(and(eq(batch.itemId, itemId), eq(batch.batchNo, batchNo), eq(batch.tenantId, tenantId)));
  return b?.id ?? null;
}

function supplyTypeOf(treatment: string | undefined, igst: string, sales: boolean) {
  const paid = !Dec.of(igst).isZero();
  if (treatment === 'overseas') return sales ? (paid ? 'export_with_payment' : 'export_under_lut') : 'import';
  if (treatment === 'sez') return paid ? 'sez_with_payment' : 'sez_without_payment';
  return 'regular';
}

async function salesInvoiceFrom(tx: Tx, ctx: TenantRequestContext, entityId: string, reg: Registration, v: TallyVoucher, d: TallyDocumentDraft, r: Resolver, s: DocumentServices) {
  const tenantId = ctx.tenant.tenantId;
  const p = r.parties.get(d.partyId);
  const [dup] = await tx.select({ id: salesInvoice.id }).from(salesInvoice).where(and(eq(salesInvoice.gstRegistrationId, reg.id), eq(salesInvoice.number, d.number)));
  if (dup) throw new BadRequestException(`${voucherLabel(v)}: invoice number ${d.number} already exists for this GSTIN in FactoryOS.`);
  const totalTax = Dec.of(d.tax.cgst).add(d.tax.sgst).add(d.tax.igst).add(d.tax.cess).toFixed(2);
  const [inv] = await tx
    .insert(salesInvoice)
    .values({
      tenantId,
      entityId,
      number: d.number,
      status: 'submitted',
      customerId: d.partyId,
      gstRegistrationId: reg.id,
      supplyType: supplyTypeOf(p?.gstTreatment, d.tax.igst, true),
      placeOfSupplyStateCode: p?.gstTreatment === 'overseas' ? '96' : d.placeOfSupplyStateCode,
      invoiceDate: d.date,
      remarks: v.narration?.slice(0, 1000) ?? null,
      taxableValue: d.taxableValue,
      cgst: d.tax.cgst,
      sgst: d.tax.sgst,
      igst: d.tax.igst,
      cess: d.tax.cess,
      totalTax,
      grandTotal: d.grandTotal,
      source: 'tally',
      tallyGuid: v.guid,
      taxDifference: d.taxDifference,
      createdBy: ctx.user.id,
      submittedBy: ctx.user.id,
      submittedAt: new Date(),
    })
    .returning();
  const shares = (['cgst', 'sgst', 'igst', 'cess'] as const).map((h) => shareTax(d.lines, d.tax[h]));
  const fallbackRate = impliedRate(d);
  const lineRows = await tx
    .insert(salesInvoiceLine)
    .values(
      await Promise.all(
        d.lines.map(async (l, i) => ({
          invoiceId: inv!.id,
          lineNo: i + 1,
          itemId: l.itemId,
          hsnCode: r.items.get(l.itemId)?.hsnCode ?? null,
          qty: l.qty,
          rate: l.rate,
          gstRate: l.gstRate ?? fallbackRate,
          taxableValue: l.taxableValue,
          cgst: shares[0]![i]!,
          sgst: shares[1]![i]!,
          igst: shares[2]![i]!,
          cess: shares[3]![i]!,
          warehouseId: l.warehouseId,
          batchId: await batchId(tx, tenantId, l.itemId, l.batch),
        })),
      ),
    )
    .returning();
  // Goods leave stock with the invoice, as for one entered here.
  const stockLines = lineRows.filter((l) => r.items.get(l.itemId)?.isStockItem);
  let stockEntryId: string | null = null;
  if (stockLines.length) {
    for (const l of stockLines) {
      const tracked = r.items.get(l.itemId)?.tracking !== 'none';
      if (tracked && !l.batchId) throw new BadRequestException(`${voucherLabel(v)}: line ${l.lineNo} needs a batch FactoryOS knows.`);
    }
    const [entry] = await tx
      .insert(stockEntry)
      .values({ tenantId, entityId, purpose: 'delivery', postingDate: d.date, partyId: d.partyId, reference: d.number, remarks: `Shipped on sales invoice ${d.number} (from Tally)`, systemGenerated: true, source: 'tally', createdBy: ctx.user.id })
      .returning();
    await tx.insert(stockEntryLine).values(stockLines.map((l, i) => ({ entryId: entry!.id, lineNo: i + 1, itemId: l.itemId, qty: l.qty, fromWarehouseId: l.warehouseId, batchId: l.batchId })));
    await s.stock.submitIn(tx, ctx, entityId, entry!.id).catch((e: unknown) => {
      throw new BadRequestException(`${voucherLabel(v)}: can't ship the goods: ${e instanceof Error ? e.message : String(e)}`);
    });
    stockEntryId = entry!.id;
  }
  const [after] = await tx.update(salesInvoice).set({ stockEntryId }).where(eq(salesInvoice.id, inv!.id)).returning();
  await s.accounting.salesIn(tx, ctx, entityId, after!);
  return inv!.id;
}

async function purchaseInvoiceFrom(tx: Tx, ctx: TenantRequestContext, entityId: string, reg: Registration, v: TallyVoucher, d: TallyDocumentDraft, r: Resolver, s: DocumentServices) {
  const tenantId = ctx.tenant.tenantId;
  const p = r.parties.get(d.partyId);
  const [dup] = await tx.select({ id: purchaseInvoice.id }).from(purchaseInvoice).where(and(eq(purchaseInvoice.entityId, entityId), eq(purchaseInvoice.number, d.number), ne(purchaseInvoice.status, 'cancelled')));
  if (dup) throw new BadRequestException(`${voucherLabel(v)}: purchase invoice number ${d.number} already exists in FactoryOS.`);
  const totalTax = Dec.of(d.tax.cgst).add(d.tax.sgst).add(d.tax.igst).add(d.tax.cess).toFixed(2);
  const [inv] = await tx
    .insert(purchaseInvoice)
    .values({
      tenantId,
      entityId,
      number: d.number,
      status: 'submitted',
      supplierId: d.partyId,
      gstRegistrationId: reg.id,
      supplierInvoiceNo: (v.reference ?? d.number).slice(0, 60),
      supplierInvoiceDate: v.referenceDate ?? d.date,
      postingDate: d.date,
      placeOfSupplyStateCode: reg.stateCode,
      supplyType: supplyTypeOf(p?.gstTreatment, d.tax.igst, false),
      remarks: v.narration?.slice(0, 1000) ?? null,
      taxableValue: d.taxableValue,
      cgst: d.tax.cgst,
      sgst: d.tax.sgst,
      igst: d.tax.igst,
      cess: d.tax.cess,
      totalTax,
      grandTotal: d.grandTotal,
      source: 'tally',
      tallyGuid: v.guid,
      taxDifference: d.taxDifference,
      createdBy: ctx.user.id,
      submittedBy: ctx.user.id,
      submittedAt: new Date(),
    })
    .returning();
  const shares = (['cgst', 'sgst', 'igst', 'cess'] as const).map((h) => shareTax(d.lines, d.tax[h]));
  const fallbackRate = impliedRate(d);
  await tx.insert(purchaseInvoiceLine).values(
    d.lines.map((l, i) => ({
      invoiceId: inv!.id,
      lineNo: i + 1,
      itemId: l.itemId,
      hsnCode: r.items.get(l.itemId)?.hsnCode ?? null,
      qty: l.qty,
      rate: l.rate,
      gstRate: l.gstRate ?? fallbackRate,
      taxableValue: l.taxableValue,
      cgst: shares[0]![i]!,
      sgst: shares[1]![i]!,
      igst: shares[2]![i]!,
      cess: shares[3]![i]!,
    })),
  );
  // Stock comes in on a receipt at the invoice's own value, credited to GRNI, which the invoice then clears.
  const stockLines = d.lines.filter((l) => r.items.get(l.itemId)?.isStockItem);
  let receiptValue = Dec.ZERO;
  if (stockLines.length) {
    const [entry] = await tx
      .insert(stockEntry)
      .values({ tenantId, entityId, purpose: 'receipt', postingDate: d.date, partyId: d.partyId, reference: d.number, remarks: `Received on purchase invoice ${d.number} (from Tally)`, systemGenerated: true, source: 'tally', createdBy: ctx.user.id })
      .returning();
    await tx.insert(stockEntryLine).values(
      await Promise.all(
        stockLines.map(async (l, i) => {
          const known = await batchId(tx, tenantId, l.itemId, l.batch);
          const tracked = r.items.get(l.itemId)?.tracking !== 'none';
          return {
            entryId: entry!.id,
            lineNo: i + 1,
            itemId: l.itemId,
            qty: l.qty,
            toWarehouseId: l.warehouseId,
            rate: Dec.of(l.taxableValue).div(l.qty).toString(),
            batchId: known,
            newBatchNo: !known && tracked ? (l.batch ?? `TALLY-${d.number}`.slice(0, 40)) : null,
          };
        }),
      ),
    );
    await s.stock.submitIn(tx, ctx, entityId, entry!.id).catch((e: unknown) => {
      throw new BadRequestException(`${voucherLabel(v)}: can't receive the goods: ${e instanceof Error ? e.message : String(e)}`);
    });
    const [value] = await tx
      .select({ v: sql<string>`coalesce(sum(${stockLedgerEntry.value}), 0)::text` })
      .from(stockLedgerEntry)
      .where(and(eq(stockLedgerEntry.voucherType, 'stock_entry'), eq(stockLedgerEntry.voucherId, entry!.id), isNotNull(stockLedgerEntry.value)));
    receiptValue = Dec.of(value?.v ?? '0');
  }
  const [after] = await tx.select().from(purchaseInvoice).where(eq(purchaseInvoice.id, inv!.id));
  await s.accounting.tallyPurchaseIn(tx, ctx, entityId, after!, receiptValue);
  return inv!.id;
}

/**
 * Stages the document rows of an open import again from its vouchers, after a mapping changed or masters were linked.
 * The voucher rows and the person's other decisions are kept.
 */
export async function refreshDocuments(tx: Db, tenantId: string, entityId: string, importId: string) {
  const staged = await tx.select({ kind: tallyStaged.kind, payload: tallyStaged.payload, ordinal: tallyStaged.ordinal }).from(tallyStaged).where(eq(tallyStaged.importId, importId));
  const vouchers = staged.filter((r) => r.kind === 'voucher').map((r) => r.payload as unknown as TallyVoucher);
  const withMasters = staged.some((r) => !['voucher', 'document', 'opening', 'stock'].includes(r.kind));
  const next = staged.reduce((m, r) => Math.max(m, r.ordinal), -1) + 1;
  await tx.delete(tallyStaged).where(and(eq(tallyStaged.importId, importId), eq(tallyStaged.kind, 'document')));
  const docs = await stageDocuments(tx, tenantId, entityId, vouchers, withMasters);
  for (let i = 0; i < docs.length; i += 500)
    await tx.insert(tallyStaged).values(docs.slice(i, i + 500).map((d, j) => ({ ...d, tenantId, entityId, importId, ordinal: next + i + j, action: d.proposed })));
  const counts: Record<string, number> = {};
  for (const r of await tx
    .select({ kind: tallyStaged.kind, proposed: tallyStaged.proposed, n: sql<number>`count(*)::int` })
    .from(tallyStaged)
    .where(eq(tallyStaged.importId, importId))
    .groupBy(tallyStaged.kind, tallyStaged.proposed))
    counts[`${r.kind}.${r.proposed}`] = r.n;
  await tx.update(tallyImport).set({ counts }).where(eq(tallyImport.id, importId));
}

/** Refreshes every open import of the entity; a mapping applies to all of them. */
async function refreshOpenImports(tx: Db, tenantId: string, entityId: string) {
  for (const imp of await tx.select({ id: tallyImport.id }).from(tallyImport).where(and(eq(tallyImport.entityId, entityId), eq(tallyImport.status, 'read'))))
    await refreshDocuments(tx, tenantId, entityId, imp.id);
}

/** The voucher types seen in Tally history or mapped, what each becomes, and the ledgers booked as service items. */
export async function listMappings(db: Db, tenantId: string, entityId: string) {
  const seen = await db
    .select({ type: tallyVoucher.voucherType, n: sql<number>`count(*)::int` })
    .from(tallyVoucher)
    .where(eq(tallyVoucher.entityId, entityId))
    .groupBy(tallyVoucher.voucherType);
  // Types only waiting in an open import are listed too, so they can be mapped before the first commit.
  const waiting = await db
    .select({ type: sql<string>`${tallyStaged.payload}->>'voucherType'`, n: sql<number>`count(*)::int` })
    .from(tallyStaged)
    .innerJoin(tallyImport, eq(tallyImport.id, tallyStaged.importId))
    .where(and(eq(tallyStaged.entityId, entityId), eq(tallyStaged.kind, 'document'), eq(tallyImport.status, 'read')))
    .groupBy(sql`${tallyStaged.payload}->>'voucherType'`);
  const mapped = await db.select().from(tallyVoucherTypeMap).where(eq(tallyVoucherTypeMap.entityId, entityId));
  const types = new Map<string, { voucherType: string; vouchers: number; documentKind: TallyDocumentKind | 'none' | null; preset: boolean }>();
  for (const s of seen) types.set(s.type, { voucherType: s.type, vouchers: s.n, documentKind: TALLY_BASE_TYPES[s.type] ?? null, preset: s.type in TALLY_BASE_TYPES });
  for (const w of waiting)
    if (w.type && !types.has(w.type)) types.set(w.type, { voucherType: w.type, vouchers: w.n, documentKind: TALLY_BASE_TYPES[w.type] ?? null, preset: w.type in TALLY_BASE_TYPES });
  for (const m of mapped)
    types.set(m.voucherType, { voucherType: m.voucherType, vouchers: types.get(m.voucherType)?.vouchers ?? 0, documentKind: m.documentKind as TallyDocumentKind | 'none', preset: false });
  const ledgers = await db
    .select({ ledger: tallyLedgerItem.ledger, itemId: tallyLedgerItem.itemId, itemCode: item.code, itemName: item.name })
    .from(tallyLedgerItem)
    .innerJoin(item, and(eq(item.id, tallyLedgerItem.itemId), eq(item.tenantId, tenantId)))
    .where(eq(tallyLedgerItem.entityId, entityId))
    .orderBy(tallyLedgerItem.ledger);
  return { voucherTypes: [...types.values()].sort((a, b) => a.voucherType.localeCompare(b.voucherType)), ledgers };
}

export async function setVoucherType(tx: Tx, ctx: TenantRequestContext, entityId: string, audit: AuditService, voucherType: string, documentKind: TallyDocumentKind | 'none' | null) {
  const tenantId = ctx.tenant.tenantId;
  await tx.delete(tallyVoucherTypeMap).where(and(eq(tallyVoucherTypeMap.entityId, entityId), eq(tallyVoucherTypeMap.voucherType, voucherType)));
  if (documentKind) await tx.insert(tallyVoucherTypeMap).values({ tenantId, entityId, voucherType, documentKind, setBy: ctx.user.id });
  await refreshOpenImports(tx, tenantId, entityId);
  await audit.record(ctx, { tenantId, entityId, action: 'accounts.tally.mapping', targetType: 'tally_voucher_type', targetId: null, after: { voucherType, documentKind } }, tx);
}

export async function setLedgerItem(tx: Tx, ctx: TenantRequestContext, entityId: string, audit: AuditService, ledger: string, itemId: string | null) {
  const tenantId = ctx.tenant.tenantId;
  if (itemId) {
    const [found] = await tx.select({ id: item.id, isStockItem: item.isStockItem }).from(item).where(and(eq(item.id, itemId), eq(item.tenantId, tenantId)));
    if (!found) throw new BadRequestException('The chosen item is not available in this workspace');
    if (found.isStockItem) throw new BadRequestException('Choose a service item: a ledger booked as a line moves no stock');
  }
  await tx.delete(tallyLedgerItem).where(and(eq(tallyLedgerItem.entityId, entityId), eq(tallyLedgerItem.ledger, ledger)));
  if (itemId) await tx.insert(tallyLedgerItem).values({ tenantId, entityId, ledger, itemId, setBy: ctx.user.id });
  await refreshOpenImports(tx, tenantId, entityId);
  await audit.record(ctx, { tenantId, entityId, action: 'accounts.tally.mapping', targetType: 'tally_ledger', targetId: null, after: { ledger, itemId } }, tx);
}

/** Tally's lines as the note keeps them (075a), tax shared across lines by taxable value. */
function noteLines(d: TallyDocumentDraft, r: Resolver) {
  const shares = (['cgst', 'sgst', 'igst', 'cess'] as const).map((h) => shareTax(d.lines, d.tax[h]));
  const fallbackRate = impliedRate(d);
  return d.lines.map((l, i) => ({
    itemId: l.itemId,
    hsnCode: r.items.get(l.itemId)?.hsnCode ?? null,
    qty: l.qty,
    rate: l.rate,
    gstRate: l.gstRate ?? fallbackRate,
    taxableValue: l.taxableValue,
    cgst: shares[0]![i]!,
    sgst: shares[1]![i]!,
    igst: shares[2]![i]!,
    cess: shares[3]![i]!,
  }));
}

/** What an item's stock is carried at in the entity on a date: value over quantity in the stock ledger. */
async function averageCost(tx: Tx, entityId: string, itemId: string, date: string) {
  const [row] = await tx
    .select({ qty: sql<string>`coalesce(sum(${stockLedgerEntry.qty}), 0)::text`, value: sql<string>`coalesce(sum(${stockLedgerEntry.value}), 0)::text` })
    .from(stockLedgerEntry)
    .where(and(eq(stockLedgerEntry.entityId, entityId), eq(stockLedgerEntry.itemId, itemId), sql`${stockLedgerEntry.postingDate} <= ${date}`, isNotNull(stockLedgerEntry.value)));
  const qty = Dec.of(row?.qty ?? '0');
  return qty.gt('0') ? Dec.of(row!.value).div(qty) : null;
}

async function entryValue(tx: Tx, entryId: string) {
  const [value] = await tx
    .select({ v: sql<string>`coalesce(sum(${stockLedgerEntry.value}), 0)::text` })
    .from(stockLedgerEntry)
    .where(and(eq(stockLedgerEntry.voucherType, 'stock_entry'), eq(stockLedgerEntry.voucherId, entryId), isNotNull(stockLedgerEntry.value)));
  return Dec.of(value?.v ?? '0').abs();
}

const noteTotals = (d: TallyDocumentDraft) => ({
  taxableValue: d.taxableValue,
  cgst: d.tax.cgst,
  sgst: d.tax.sgst,
  igst: d.tax.igst,
  cess: d.tax.cess,
  grandTotal: d.grandTotal,
});

/** A Tally credit note: a value note against the FactoryOS invoice when there is one, goods returned at carrying cost. */
async function salesNoteFrom(tx: Tx, ctx: TenantRequestContext, entityId: string, reg: Registration, v: TallyVoucher, d: TallyDocumentDraft, r: Resolver, s: DocumentServices) {
  const tenantId = ctx.tenant.tenantId;
  const p = r.parties.get(d.partyId);
  const [dup] = await tx.select({ id: salesNote.id }).from(salesNote).where(and(eq(salesNote.gstRegistrationId, reg.id), eq(salesNote.number, d.number)));
  if (dup) throw new BadRequestException(`${voucherLabel(v)}: note number ${d.number} already exists for this GSTIN in FactoryOS.`);
  const [original] = d.billReference
    ? await tx
        .select({ id: salesInvoice.id })
        .from(salesInvoice)
        .where(and(eq(salesInvoice.entityId, entityId), eq(salesInvoice.customerId, d.partyId), eq(salesInvoice.number, d.billReference), ne(salesInvoice.status, 'cancelled')))
    : [];
  // Goods come back at what the item is carried at; Tally's selling value stays the note's.
  const stockLines = d.lines.filter((l) => r.items.get(l.itemId)?.isStockItem);
  let stockEntryId: string | null = null;
  let stockValue = Dec.ZERO;
  if (stockLines.length) {
    const rows = [];
    for (const [i, l] of stockLines.entries()) {
      const cost = await averageCost(tx, entityId, l.itemId, d.date);
      if (!cost) throw new BadRequestException(`${voucherLabel(v)}: line ${i + 1} returns an item FactoryOS has no cost for yet.`);
      const known = await batchId(tx, tenantId, l.itemId, l.batch);
      const tracked = r.items.get(l.itemId)?.tracking !== 'none';
      rows.push({ lineNo: i + 1, itemId: l.itemId, qty: l.qty, toWarehouseId: l.warehouseId, rate: cost.toString(), batchId: known, newBatchNo: !known && tracked ? (l.batch ?? `TALLY-${d.number}`.slice(0, 40)) : null });
    }
    const [entry] = await tx
      .insert(stockEntry)
      .values({ tenantId, entityId, purpose: 'receipt', postingDate: d.date, partyId: d.partyId, reference: d.number, remarks: `Returned on credit note ${d.number} (from Tally)`, systemGenerated: true, source: 'tally', createdBy: ctx.user.id })
      .returning();
    await tx.insert(stockEntryLine).values(rows.map((row) => ({ ...row, entryId: entry!.id })));
    await s.stock.submitIn(tx, ctx, entityId, entry!.id).catch((e: unknown) => {
      throw new BadRequestException(`${voucherLabel(v)}: can't take the goods back: ${e instanceof Error ? e.message : String(e)}`);
    });
    stockEntryId = entry!.id;
    stockValue = await entryValue(tx, entry!.id);
  }
  const [note] = await tx
    .insert(salesNote)
    .values({
      tenantId,
      entityId,
      originalInvoiceId: original?.id ?? null,
      kind: 'credit',
      taxTreatment: 'gst',
      number: d.number,
      status: 'submitted',
      customerId: d.partyId,
      gstRegistrationId: reg.id,
      postingDate: d.date,
      reason: (v.narration ?? 'Credit note from Tally').slice(0, 500),
      currency: 'INR',
      exchangeRate: '1',
      supplyType: supplyTypeOf(p?.gstTreatment, d.tax.igst, true),
      placeOfSupplyStateCode: p?.gstTreatment === 'overseas' ? '96' : d.placeOfSupplyStateCode,
      ...noteTotals(d),
      stockEntryId,
      source: 'tally',
      tallyGuid: v.guid,
      taxDifference: d.taxDifference,
      tallyBillReference: d.billReference,
      tallyLines: noteLines(d, r),
      createdBy: ctx.user.id,
      submittedBy: ctx.user.id,
      submittedAt: new Date(),
    })
    .returning();
  const posted = await s.accounting.tallySalesNoteIn(tx, ctx, entityId, note!, stockValue);
  await tx.update(salesNote).set(posted).where(eq(salesNote.id, note!.id));
  return note!.id;
}

/** A Tally debit note on a supplier: lowers what is owed; goods sent back leave stock at carrying cost. */
async function supplierNoteFrom(tx: Tx, ctx: TenantRequestContext, entityId: string, reg: Registration, v: TallyVoucher, d: TallyDocumentDraft, r: Resolver, s: DocumentServices) {
  const tenantId = ctx.tenant.tenantId;
  const fy = fyCode(new Date(`${d.date}T00:00:00Z`));
  const [dup] = await tx
    .select({ id: supplierNote.id })
    .from(supplierNote)
    .where(and(eq(supplierNote.entityId, entityId), eq(supplierNote.supplierId, d.partyId), eq(supplierNote.supplierFy, fy), sql`upper(${supplierNote.supplierNoteNo}) = upper(${d.number})`, ne(supplierNote.status, 'cancelled')));
  if (dup) throw new BadRequestException(`${voucherLabel(v)}: note ${d.number} already exists for this supplier in FactoryOS.`);
  const [original] = d.billReference
    ? await tx
        .select({ id: purchaseInvoice.id })
        .from(purchaseInvoice)
        .where(and(eq(purchaseInvoice.entityId, entityId), eq(purchaseInvoice.supplierId, d.partyId), eq(purchaseInvoice.supplierInvoiceNo, d.billReference), ne(purchaseInvoice.status, 'cancelled')))
    : [];
  const stockLines = d.lines.filter((l) => r.items.get(l.itemId)?.isStockItem);
  let stockValue = Dec.ZERO;
  if (stockLines.length) {
    const rows = [];
    for (const [i, l] of stockLines.entries()) {
      const known = await batchId(tx, tenantId, l.itemId, l.batch);
      if (r.items.get(l.itemId)?.tracking !== 'none' && !known) throw new BadRequestException(`${voucherLabel(v)}: line ${i + 1} needs a batch FactoryOS knows.`);
      rows.push({ lineNo: i + 1, itemId: l.itemId, qty: l.qty, fromWarehouseId: l.warehouseId, batchId: known });
    }
    const [entry] = await tx
      .insert(stockEntry)
      .values({ tenantId, entityId, purpose: 'adjustment', postingDate: d.date, partyId: d.partyId, reference: d.number, remarks: `Sent back on debit note ${d.number} (from Tally)`, systemGenerated: true, source: 'tally', createdBy: ctx.user.id })
      .returning();
    await tx.insert(stockEntryLine).values(rows.map((row) => ({ ...row, entryId: entry!.id })));
    await s.stock.submitIn(tx, ctx, entityId, entry!.id).catch((e: unknown) => {
      throw new BadRequestException(`${voucherLabel(v)}: can't send the goods back: ${e instanceof Error ? e.message : String(e)}`);
    });
    stockValue = await entryValue(tx, entry!.id);
  }
  const [note] = await tx
    .insert(supplierNote)
    .values({
      tenantId,
      entityId,
      originalInvoiceId: original?.id ?? null,
      supplierId: d.partyId,
      number: d.number,
      status: 'submitted',
      // FactoryOS records the supplier's side: our debit note lowers what we owe, as a supplier credit note does.
      kind: 'credit',
      taxTreatment: 'gst',
      supplierNoteNo: d.number,
      supplierNoteDate: d.date,
      supplierFy: fy,
      postingDate: d.date,
      reason: (v.narration ?? 'Debit note from Tally').slice(0, 500),
      currency: 'INR',
      exchangeRate: '1',
      taxEligibilityConfirmed: true,
      ...noteTotals(d),
      source: 'tally',
      tallyGuid: v.guid,
      taxDifference: d.taxDifference,
      tallyBillReference: d.billReference,
      tallyLines: noteLines(d, r),
      createdBy: ctx.user.id,
      submittedBy: ctx.user.id,
      submittedAt: new Date(),
    })
    .returning();
  const posted = await s.accounting.tallySupplierNoteIn(tx, ctx, entityId, note!, stockValue);
  await tx.update(supplierNote).set(posted).where(eq(supplierNote.id, note!.id));
  return note!.id;
}
