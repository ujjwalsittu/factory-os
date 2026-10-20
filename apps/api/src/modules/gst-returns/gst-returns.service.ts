import { createHash } from 'node:crypto';
import { Dec } from '@factoryos/core';
import {
  buildGstr1,
  buildGstr3b,
  checkAgainstLedger,
  checkDocumentSeries,
  checkGstr1Against3b,
  documentSummary,
  HEADS,
  type Check,
  type GstLine,
  type Gstr1,
  type Gstr3b,
  type InwardDoc,
  type IssuedDocument,
  type OutwardDoc,
  type Taxes,
  type Treatment,
} from '@factoryos/core/gst-returns';
import {
  accountingSettings,
  bankChargeDocument,
  glAccount,
  glEntry,
  gstRegistration,
  gstReturn,
  gstReturnLine,
  item,
  journalVoucher,
  landedCostVoucher,
  party,
  purchaseInvoice,
  purchaseInvoiceLine,
  salesInvoice,
  salesInvoiceLine,
  salesNote,
  salesNoteLine,
  supplierNote,
  uom,
  type Database,
} from '@factoryos/db';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import type { Db, Tx } from '../accounting/accounting-lock.js';

export type ReturnKind = 'gstr1' | 'gstr3b';
const KINDS: ReturnKind[] = ['gstr1', 'gstr3b'];
const monthEnd = (period: string) => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const inr = (v: string | null | undefined, rate: string | null | undefined) => Dec.of(v ?? '0').mul(rate ?? '1').toFixed(2);

/** One document a return was prepared from, with where it landed. */
interface Placed {
  documentType: 'sales_invoice' | 'sales_note' | 'purchase_invoice' | 'supplier_note' | 'bank_charge' | 'landed_cost';
  documentId: string;
  number: string;
  date: string;
  late: string | null;
}

export interface Prepared {
  gstr1: Gstr1 & { documents: ReturnType<typeof documentSummary> };
  gstr3b: Gstr3b;
  checks: Check[];
  attention: Gstr1['attention'];
  sources: Placed[];
}

/**
 * Decision 074 PR 1: GSTR-1 and GSTR-3B per GSTIN and month, prepared from submitted documents and moved through
 * maker-checker. Documents are never edited here; a filed return keeps its snapshot and shows later changes.
 */
@Injectable()
export class GstReturnsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── gathering ─────────────────────────

  private async registration(db: Db, entityId: string, id: string) {
    const [reg] = await db.select().from(gstRegistration).where(and(eq(gstRegistration.id, id), eq(gstRegistration.entityId, entityId)));
    if (!reg) throw new NotFoundException('GST registration not found');
    return reg;
  }

  /** Months of this GSTIN whose return of a kind is filed: documents dated there that missed it come in late. */
  private async filedPeriods(db: Db, regId: string, kind: ReturnKind, before: string) {
    const rows = await db
      .select({ id: gstReturn.id, period: gstReturn.period })
      .from(gstReturn)
      .where(and(eq(gstReturn.gstRegistrationId, regId), eq(gstReturn.kind, kind), eq(gstReturn.status, 'filed'), sql`${gstReturn.period} < ${before}`));
    const inFiled = new Set<string>();
    if (rows.length)
      for (const l of await db.select({ id: gstReturnLine.documentId }).from(gstReturnLine).where(inArray(gstReturnLine.returnId, rows.map((r) => r.id)))) inFiled.add(l.id);
    // A document already brought into a later open or filed return of this kind is not late again elsewhere.
    const elsewhere = new Set(
      (
        await db
          .select({ id: gstReturnLine.documentId })
          .from(gstReturnLine)
          .innerJoin(gstReturn, eq(gstReturn.id, gstReturnLine.returnId))
          .where(and(eq(gstReturn.gstRegistrationId, regId), eq(gstReturn.kind, kind), ne(gstReturn.period, before), sql`${gstReturnLine.late} is not null`))
      ).map((r) => r.id),
    );
    return { periods: new Set(rows.map((r) => r.period)), inFiled, elsewhere };
  }

  /** The window of dates a return reads: its month, plus earlier filed months for late documents. */
  private within(date: string, period: string, filed: Awaited<ReturnType<GstReturnsService['filedPeriods']>>, id: string) {
    const month = date.slice(0, 7);
    if (month === period) return { take: true, late: null as string | null };
    if (month < period && filed.periods.has(month) && !filed.inFiled.has(id) && !filed.elsewhere.has(id)) return { take: true, late: month };
    return { take: false, late: null };
  }

  private async outward(db: Db, entityId: string, regId: string, period: string) {
    const filed = await this.filedPeriods(db, regId, 'gstr1', period);
    const end = monthEnd(period);
    const uqcOf = async (itemIds: string[]) =>
      new Map(
        itemIds.length
          ? (await db.select({ id: item.id, uqc: uom.gstUqc }).from(item).leftJoin(uom, eq(uom.id, item.stockUomId)).where(inArray(item.id, itemIds))).map((r) => [r.id, r.uqc])
          : [],
      );
    const docs: OutwardDoc[] = [];
    const placed: Placed[] = [];
    const issued: IssuedDocument[] = [];
    // Invoices.
    const invoices = await db
      .select({ inv: salesInvoice, treatment: party.gstTreatment })
      .from(salesInvoice)
      .innerJoin(party, eq(party.id, salesInvoice.customerId))
      .where(and(eq(salesInvoice.entityId, entityId), eq(salesInvoice.gstRegistrationId, regId), inArray(salesInvoice.status, ['submitted', 'cancelled']), sql`${salesInvoice.invoiceDate} <= ${end}`));
    const invLines = invoices.length
      ? await db.select().from(salesInvoiceLine).where(inArray(salesInvoiceLine.invoiceId, invoices.map((i) => i.inv.id)))
      : [];
    const uqc = await uqcOf([...new Set(invLines.map((l) => l.itemId))]);
    const invById = new Map(invoices.map((i) => [i.inv.id, i.inv]));
    for (const { inv, treatment } of invoices) {
      if (inv.invoiceDate.slice(0, 7) === period && inv.number) issued.push({ nature: 'invoice', number: inv.number, cancelled: inv.status === 'cancelled' });
      if (inv.status !== 'submitted') continue;
      const w = this.within(inv.invoiceDate, period, filed, inv.id);
      if (!w.take) continue;
      const rate = inv.exchangeRate;
      docs.push({
        type: 'invoice',
        id: inv.id,
        number: inv.number ?? inv.id,
        date: inv.invoiceDate,
        counterpartyGstin: inv.customerGstin,
        treatment: treatment as Treatment,
        supplyType: inv.supplyType,
        placeOfSupply: inv.placeOfSupplyStateCode,
        reverseCharge: inv.reverseCharge,
        portCode: inv.portCode,
        shippingBillNo: inv.shippingBillNo,
        shippingBillDate: inv.shippingBillDate,
        value: inr(inv.grandTotal, rate),
        lines: invLines
          .filter((l) => l.invoiceId === inv.id)
          .map((l) => ({ hsn: l.hsnCode, uqc: uqc.get(l.itemId) ?? null, qty: l.qty, gstRate: l.gstRate, taxable: inr(l.taxableValue, rate), igst: inr(l.igst, rate), cgst: inr(l.cgst, rate), sgst: inr(l.sgst, rate), cess: inr(l.cess, rate) })),
      });
      placed.push({ documentType: 'sales_invoice', documentId: inv.id, number: inv.number ?? inv.id, date: inv.invoiceDate, late: w.late });
    }
    // Notes; a note from Tally reads its own lines (075a).
    const notes = await db
      .select({ note: salesNote, treatment: party.gstTreatment })
      .from(salesNote)
      .innerJoin(party, eq(party.id, salesNote.customerId))
      .where(and(eq(salesNote.entityId, entityId), eq(salesNote.gstRegistrationId, regId), inArray(salesNote.status, ['submitted', 'cancelled']), eq(salesNote.taxTreatment, 'gst'), sql`${salesNote.postingDate} <= ${end}`));
    const noteLines = notes.length
      ? await db
          .select({ l: salesNoteLine, src: salesInvoiceLine })
          .from(salesNoteLine)
          .innerJoin(salesInvoiceLine, eq(salesInvoiceLine.id, salesNoteLine.invoiceLineId))
          .where(inArray(salesNoteLine.noteId, notes.map((n) => n.note.id)))
      : [];
    const noteUqc = await uqcOf([...new Set([...noteLines.map((x) => x.src.itemId), ...notes.flatMap((n) => (n.note.tallyLines ?? []).map((t) => t.itemId))])]);
    const originals = new Map(
      (await (async () => {
        const ids = notes.map((n) => n.note.originalInvoiceId).filter((x): x is string => !!x && !invById.has(x));
        return ids.length ? db.select().from(salesInvoice).where(inArray(salesInvoice.id, ids)) : [];
      })()).map((i) => [i.id, i]),
    );
    for (const { note, treatment } of notes) {
      const nature = note.kind === 'credit' ? 'credit_note' : 'debit_note';
      if (note.postingDate.slice(0, 7) === period && note.number) issued.push({ nature, number: note.number, cancelled: note.status === 'cancelled' });
      if (note.status !== 'submitted') continue;
      const w = this.within(note.postingDate, period, filed, note.id);
      if (!w.take) continue;
      const rate = note.exchangeRate;
      const orig = note.originalInvoiceId ? (invById.get(note.originalInvoiceId) ?? originals.get(note.originalInvoiceId)) : null;
      const lines: GstLine[] = note.tallyLines
        ? note.tallyLines.map((t) => ({ hsn: t.hsnCode, uqc: noteUqc.get(t.itemId) ?? null, qty: t.qty, gstRate: t.gstRate, taxable: inr(t.taxableValue, rate), igst: inr(t.igst, rate), cgst: inr(t.cgst, rate), sgst: inr(t.sgst, rate), cess: inr(t.cess, rate) }))
        : noteLines
            .filter((x) => x.l.noteId === note.id)
            .map(({ l, src }) => ({ hsn: src.hsnCode, uqc: noteUqc.get(src.itemId) ?? null, qty: l.qty, gstRate: src.gstRate, taxable: inr(l.taxableValue, rate), igst: inr(l.igst, rate), cgst: inr(l.cgst, rate), sgst: inr(l.sgst, rate), cess: inr(l.cess, rate) }));
      docs.push({
        type: nature,
        id: note.id,
        number: note.number ?? note.id,
        date: note.postingDate,
        counterpartyGstin: note.customerGstin,
        treatment: treatment as Treatment,
        supplyType: note.supplyType,
        placeOfSupply: note.placeOfSupplyStateCode,
        reverseCharge: false,
        portCode: null,
        shippingBillNo: null,
        shippingBillDate: null,
        value: inr(note.grandTotal, rate),
        original: orig ? { number: orig.number ?? orig.id, date: orig.invoiceDate, value: inr(orig.grandTotal, orig.exchangeRate) } : null,
        lines,
      });
      placed.push({ documentType: 'sales_note', documentId: note.id, number: note.number ?? note.id, date: note.postingDate, late: w.late });
    }
    return { docs, placed, issued };
  }

  private async inward(db: Db, entityId: string, regId: string, regCount: number, period: string) {
    const filed = await this.filedPeriods(db, regId, 'gstr3b', period);
    const end = monthEnd(period);
    const docs: InwardDoc[] = [];
    const placed: Placed[] = [];
    const pis = await db
      .select({ pi: purchaseInvoice, treatment: party.gstTreatment, state: party.stateCode })
      .from(purchaseInvoice)
      .innerJoin(party, eq(party.id, purchaseInvoice.supplierId))
      .where(and(eq(purchaseInvoice.entityId, entityId), eq(purchaseInvoice.gstRegistrationId, regId), eq(purchaseInvoice.status, 'submitted'), sql`${purchaseInvoice.postingDate} <= ${end}`));
    const piLines = pis.length ? await db.select().from(purchaseInvoiceLine).where(inArray(purchaseInvoiceLine.invoiceId, pis.map((p) => p.pi.id))) : [];
    const piById = new Map(pis.map((p) => [p.pi.id, p]));
    for (const { pi, treatment, state } of pis) {
      const w = this.within(pi.postingDate, period, filed, pi.id);
      if (!w.take) continue;
      const rate = pi.exchangeRate;
      docs.push({
        id: pi.id,
        number: pi.supplierInvoiceNo ?? pi.number ?? pi.id,
        kind: 'purchase_invoice',
        reverseCharge: pi.reverseCharge,
        importOfServices: pi.supplyType === 'import' && pi.reverseCharge,
        itcEligible: pi.itcEligible,
        supplierState: state,
        composition: treatment === 'composition',
        lines: piLines.filter((l) => l.invoiceId === pi.id).map((l) => ({ gstRate: l.gstRate, taxable: inr(l.taxableValue, rate), igst: inr(l.igst, rate), cgst: inr(l.cgst, rate), sgst: inr(l.sgst, rate), cess: inr(l.cess, rate) })),
      });
      placed.push({ documentType: 'purchase_invoice', documentId: pi.id, number: pi.supplierInvoiceNo ?? pi.number ?? pi.id, date: pi.postingDate, late: w.late });
    }
    // Supplier notes carry no GSTIN of ours: their original invoice's, else the entity's only one.
    const notes = await db
      .select({ n: supplierNote, state: party.stateCode, treatment: party.gstTreatment, origReg: purchaseInvoice.gstRegistrationId })
      .from(supplierNote)
      .innerJoin(party, eq(party.id, supplierNote.supplierId))
      .leftJoin(purchaseInvoice, eq(purchaseInvoice.id, supplierNote.originalInvoiceId))
      .where(and(eq(supplierNote.entityId, entityId), eq(supplierNote.status, 'submitted'), eq(supplierNote.taxTreatment, 'gst'), sql`${supplierNote.postingDate} <= ${end}`));
    for (const { n, state, treatment, origReg } of notes) {
      if ((origReg ?? (regCount === 1 ? regId : null)) !== regId) continue;
      const w = this.within(n.postingDate, period, filed, n.id);
      if (!w.take) continue;
      const rate = n.exchangeRate;
      const t = { igst: inr(n.igst, rate), cgst: inr(n.cgst, rate), sgst: inr(n.sgst, rate), cess: inr(n.cess, rate) };
      const taxed = HEADS.some((h) => !Dec.of(t[h]).isZero());
      const orig = n.originalInvoiceId ? piById.get(n.originalInvoiceId)?.pi : null;
      docs.push({
        id: n.id,
        number: n.supplierNoteNo,
        kind: n.kind === 'credit' ? 'supplier_credit_note' : 'supplier_debit_note',
        reverseCharge: orig?.reverseCharge ?? false,
        importOfServices: false,
        itcEligible: orig?.itcEligible ?? true,
        supplierState: state,
        composition: treatment === 'composition',
        lines: [{ gstRate: taxed ? '1' : '0', taxable: inr(n.taxableValue, rate), ...t }],
      });
      placed.push({ documentType: 'supplier_note', documentId: n.id, number: n.supplierNoteNo, date: n.postingDate, late: w.late });
    }
    // Bank charges with GST, and import IGST on the Bill of Entry: single-GSTIN entities only for now.
    if (regCount === 1) {
      for (const b of await db
        .select()
        .from(bankChargeDocument)
        .where(and(eq(bankChargeDocument.entityId, entityId), eq(bankChargeDocument.status, 'submitted'), sql`${bankChargeDocument.gstAmount} > 0`, sql`${bankChargeDocument.postingDate} <= ${end}`))) {
        const w = this.within(b.postingDate, period, filed, b.id);
        if (!w.take) continue;
        const g = ((b.evidence as { gst?: Partial<Taxes> }).gst ?? {}) as Partial<Taxes>;
        docs.push({
          id: b.id,
          number: b.referenceKey,
          kind: 'bank_charge',
          reverseCharge: false,
          importOfServices: false,
          itcEligible: true,
          supplierState: null,
          composition: false,
          lines: [{ gstRate: '18', taxable: Dec.of(b.baseAmount).toFixed(2), igst: Dec.of(g.igst ?? '0').toFixed(2), cgst: Dec.of(g.cgst ?? '0').toFixed(2), sgst: Dec.of(g.sgst ?? '0').toFixed(2), cess: Dec.of(g.cess ?? '0').toFixed(2) }],
        });
        placed.push({ documentType: 'bank_charge', documentId: b.id, number: b.referenceKey, date: b.postingDate, late: w.late });
      }
      for (const l of await db
        .select()
        .from(landedCostVoucher)
        .where(and(eq(landedCostVoucher.entityId, entityId), eq(landedCostVoucher.status, 'submitted'), sql`coalesce(${landedCostVoucher.importIgst}, 0) > 0`, sql`${landedCostVoucher.postingDate} <= ${end}`))) {
        const w = this.within(l.postingDate, period, filed, l.id);
        if (!w.take) continue;
        docs.push({
          id: l.id,
          number: l.boeNo ?? l.number ?? l.id,
          kind: 'bill_of_entry',
          reverseCharge: false,
          importOfServices: false,
          itcEligible: l.customsItcEligible !== false,
          supplierState: null,
          composition: false,
          lines: [{ gstRate: '18', taxable: Dec.of(l.assessableValue ?? '0').toFixed(2), igst: Dec.of(l.importIgst ?? '0').toFixed(2), cgst: '0.00', sgst: '0.00', cess: Dec.of(l.importCess ?? '0').toFixed(2) }],
        });
        placed.push({ documentType: 'landed_cost', documentId: l.id, number: l.boeNo ?? l.number ?? l.id, date: l.postingDate, late: w.late });
      }
    }
    return { docs, placed };
  }

  /**
   * The GST ledgers' movement for the GSTIN in the month, per head: output (credit less debit) and input including
   * reverse-charge credit awaiting payment (debit less credit). Vouchers whose source is not in the return are named.
   */
  private async ledger(db: Db, entityId: string, regId: string, regCount: number, period: string, sources: Set<string>) {
    const [settings] = await db.select().from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
    if (!settings?.active) return null;
    const accounts = await db.select({ id: glAccount.id, role: glAccount.role }).from(glAccount).where(eq(glAccount.entityId, entityId));
    const roleOf = new Map<string, string>();
    for (const a of accounts) if (a.role) roleOf.set(a.id, a.role);
    for (const [role, id] of Object.entries(settings.mappings ?? {})) if (id) roleOf.set(id, role);
    const out: Taxes = { igst: '0', cgst: '0', sgst: '0', cess: '0' };
    const inp: Taxes = { igst: '0', cgst: '0', sgst: '0', cess: '0' };
    const unexplained = { out: new Set<string>(), inp: new Set<string>() };
    const ids = [...roleOf].filter(([, r]) => /^(output|input|pending)_(igst|cgst|sgst|cess)$/.test(r)).map(([id]) => id);
    if (!ids.length) return { out, inp, unexplained: { out: [], inp: [] } };
    const rows = await db
      .select({ accountId: glEntry.accountId, debit: glEntry.debit, credit: glEntry.credit, reg: glEntry.gstRegistrationId, sourceType: journalVoucher.sourceType, sourceId: journalVoucher.sourceId, number: journalVoucher.number })
      .from(glEntry)
      .innerJoin(journalVoucher, eq(journalVoucher.id, glEntry.voucherId))
      .where(and(eq(glEntry.entityId, entityId), inArray(glEntry.accountId, ids), sql`to_char(${glEntry.postingDate}, 'YYYY-MM') = ${period}`));
    for (const r of rows) {
      if (r.reg ? r.reg !== regId : regCount !== 1) continue;
      const [kind, head] = roleOf.get(r.accountId)!.split('_') as [string, keyof Taxes];
      const move = Dec.of(r.debit).sub(r.credit);
      const explained = sources.has(r.sourceId);
      if (kind === 'output') {
        out[head] = Dec.of(out[head]).sub(move).toFixed(2);
        if (!explained) unexplained.out.add(r.number ?? r.sourceType);
      } else {
        inp[head] = Dec.of(inp[head]).add(move).toFixed(2);
        if (!explained) unexplained.inp.add(r.number ?? r.sourceType);
      }
    }
    return { out, inp, unexplained: { out: [...unexplained.out], inp: [...unexplained.inp] } };
  }

  /** Both returns of a GSTIN and month, computed from the books as they stand. */
  async compute(db: Db, entityId: string, regId: string, period: string): Promise<Prepared> {
    const reg = await this.registration(db, entityId, regId);
    const regCount = (await db.select({ id: gstRegistration.id }).from(gstRegistration).where(eq(gstRegistration.entityId, entityId))).length;
    const o = await this.outward(db, entityId, regId, period);
    const i = await this.inward(db, entityId, regId, regCount, period);
    // Aggregate turnover above ₹5 crore needs 6-digit HSN; FactoryOS does not hold the turnover yet, so 4 is asked.
    const g1 = buildGstr1(o.docs, reg.stateCode, { turnoverAboveFiveCrore: false });
    const g3 = buildGstr3b(g1, o.docs, i.docs, reg.stateCode);
    const documents = documentSummary(o.issued);
    const checks: Check[] = [checkGstr1Against3b(g1, g3, o.docs), checkDocumentSeries(documents)];
    const sources = new Set([...o.placed, ...i.placed].map((p) => p.documentId));
    const ledger = await this.ledger(db, entityId, regId, regCount, period, sources);
    if (ledger) {
      const rc = new Set(o.docs.filter((d) => d.reverseCharge).map((d) => d.id));
      const outTax: Taxes = { igst: '0', cgst: '0', sgst: '0', cess: '0' };
      for (const e of g1.entries) if (!rc.has(e.documentId)) for (const h of HEADS) outTax[h] = Dec.of(outTax[h]).add(e.amounts[h]).toFixed(2);
      for (const r of g1.b2cs) for (const h of HEADS) outTax[h] = Dec.of(outTax[h]).add(r[h]).toFixed(2);
      checks.push(checkAgainstLedger('Output tax equals the output GST ledgers', outTax, ledger.out, ledger.unexplained.out));
      const t4 = g3['4'];
      const inTax = [t4.a1, t4.a2, t4.a3, t4.a5].reduce((s, t) => Object.fromEntries(HEADS.map((h) => [h, Dec.of(s[h]).add(t[h]).toFixed(2)])) as Taxes, { igst: '0', cgst: '0', sgst: '0', cess: '0' } as Taxes);
      checks.push(checkAgainstLedger('Eligible input tax equals the input GST ledgers', inTax, ledger.inp, ledger.unexplained.inp));
    } else checks.push({ name: 'General ledger', ok: true, detail: 'Accounting is not active for this entity; no ledger check.' });
    return { gstr1: { ...g1, documents }, gstr3b: g3, checks, attention: g1.attention, sources: [...o.placed, ...i.placed] };
  }

  computeNow(entityId: string, regId: string, period: string) {
    return this.compute(this.db, entityId, regId, period);
  }

  // ───────────────────────── returns and workflow ─────────────────────────

  async registrations(entityId: string) {
    return this.db.select({ id: gstRegistration.id, gstin: gstRegistration.gstin, stateCode: gstRegistration.stateCode }).from(gstRegistration).where(eq(gstRegistration.entityId, entityId)).orderBy(gstRegistration.gstin);
  }

  async list(entityId: string) {
    return this.db
      .select({ id: gstReturn.id, gstRegistrationId: gstReturn.gstRegistrationId, gstin: gstRegistration.gstin, period: gstReturn.period, kind: gstReturn.kind, status: gstReturn.status, preparedAt: gstReturn.preparedAt, arn: gstReturn.arn, filedOn: gstReturn.filedOn })
      .from(gstReturn)
      .innerJoin(gstRegistration, eq(gstRegistration.id, gstReturn.gstRegistrationId))
      .where(eq(gstReturn.entityId, entityId))
      .orderBy(sql`${gstReturn.period} desc`, gstReturn.kind);
  }

  private async lockReturn(tx: Tx, entityId: string, id: string) {
    const [r] = await tx.select().from(gstReturn).where(and(eq(gstReturn.id, id), eq(gstReturn.entityId, entityId))).for('update');
    if (!r) throw new NotFoundException('GST return not found');
    return r;
  }

  /** Prepares (or re-prepares) both returns of a GSTIN and month as drafts. A reviewed one goes back to draft. */
  async prepare(ctx: TenantRequestContext, entityId: string, regId: string, period: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gst-return:${regId}:${period}`}))`);
      const p = await this.compute(tx, entityId, regId, period);
      const out = [];
      for (const kind of KINDS) {
        const [prior] = await tx.select().from(gstReturn).where(and(eq(gstReturn.gstRegistrationId, regId), eq(gstReturn.period, period), eq(gstReturn.kind, kind))).for('update');
        if (prior && (prior.status === 'approved' || prior.status === 'filed'))
          throw new ConflictException(`The ${kind === 'gstr1' ? 'GSTR-1' : 'GSTR-3B'} for ${period} is ${prior.status}; it is not prepared again.`);
        const snapshot = kind === 'gstr1' ? { gstr1: p.gstr1, checks: p.checks, attention: p.attention } : { gstr3b: p.gstr3b, checks: p.checks };
        const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
        const values = { snapshot: snapshot as Record<string, unknown>, snapshotHash: hash, status: 'draft', preparedBy: ctx.user.id, preparedAt: new Date(), reviewedBy: null, reviewedAt: null };
        const [row] = prior
          ? await tx.update(gstReturn).set(values).where(eq(gstReturn.id, prior.id)).returning()
          : await tx.insert(gstReturn).values({ ...values, tenantId: ctx.tenant.tenantId, entityId, gstRegistrationId: regId, period, kind }).returning();
        await tx.delete(gstReturnLine).where(eq(gstReturnLine.returnId, row!.id));
        const lines = this.linesFor(kind, p).map((l) => ({ ...l, returnId: row!.id }));
        for (let i = 0; i < lines.length; i += 500) await tx.insert(gstReturnLine).values(lines.slice(i, i + 500));
        await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'gst_return.prepare', targetType: 'gst_return', targetId: row!.id, after: { period, kind, hash, documents: lines.length } }, tx);
        out.push(row!);
      }
      return out;
    });
  }

  /** The frozen place of each document in a return: GSTR-1 by section, 3B by the documents it read. */
  private linesFor(kind: ReturnKind, p: Prepared) {
    const bySource = new Map(p.sources.map((s) => [s.documentId, s]));
    const line = (s: Placed, section: string, figures: Record<string, unknown>) => ({ section, documentType: s.documentType, documentId: s.documentId, documentNumber: s.number, documentDate: s.date, late: s.late, figures });
    if (kind === 'gstr1') {
      const out = p.gstr1.entries.map((e) => line(bySource.get(e.documentId)!, e.section, { amounts: e.amounts, byRate: e.byRate }));
      const listed = new Set(p.gstr1.entries.map((e) => e.documentId));
      // B2CS and nil supplies are summaries; their documents are recorded too, so later changes show.
      for (const s of p.sources) if ((s.documentType === 'sales_invoice' || s.documentType === 'sales_note') && !listed.has(s.documentId)) out.push(line(s, 'summary', {}));
      return out;
    }
    // 3B reads outward documents for 3.1 and inward ones for 4; both are recorded so later changes show.
    return p.sources.map((s) => line(s, s.documentType === 'sales_invoice' || s.documentType === 'sales_note' ? 'outward' : 'inward', {}));
  }

  async get(entityId: string, id: string) {
    const [r] = await this.db.select().from(gstReturn).where(and(eq(gstReturn.id, id), eq(gstReturn.entityId, entityId)));
    if (!r) throw new NotFoundException('GST return not found');
    const [reg] = await this.db.select().from(gstRegistration).where(eq(gstRegistration.id, r.gstRegistrationId));
    const lines = await this.db.select().from(gstReturnLine).where(eq(gstReturnLine.returnId, id)).orderBy(gstReturnLine.section, gstReturnLine.documentDate, gstReturnLine.documentNumber);
    return { ...r, gstin: reg!.gstin, lines, changedSinceFiling: r.status === 'filed' ? await this.changes(r, lines) : [] };
  }

  /** For a filed return: each document whose current figures differ from what was filed, or that is now cancelled. */
  private async changes(r: typeof gstReturn.$inferSelect, lines: (typeof gstReturnLine.$inferSelect)[]) {
    const now = await this.compute(this.db, r.entityId, r.gstRegistrationId, r.period);
    const current = new Map<string, Record<string, unknown>>();
    if (r.kind === 'gstr1') for (const e of now.gstr1.entries) current.set(e.documentId, { amounts: e.amounts, byRate: e.byRate });
    const present = new Set(now.sources.map((s) => s.documentId));
    const out: { documentId: string; documentType: string; number: string; what: string }[] = [];
    for (const l of lines) {
      if (!present.has(l.documentId)) out.push({ documentId: l.documentId, documentType: l.documentType, number: l.documentNumber, what: 'Cancelled or no longer in this month since filing' });
      else if (r.kind === 'gstr1' && l.section !== 'summary' && JSON.stringify(current.get(l.documentId)) !== JSON.stringify(l.figures))
        out.push({ documentId: l.documentId, documentType: l.documentType, number: l.documentNumber, what: 'Its figures changed since filing' });
    }
    const filedIds = new Set(lines.map((l) => l.documentId));
    for (const s of now.sources) if (!filedIds.has(s.documentId) && !s.late) out.push({ documentId: s.documentId, documentType: s.documentType, number: s.number, what: 'Added to this month after filing' });
    return out;
  }

  async review(ctx: TenantRequestContext, entityId: string, id: string) {
    return this.step(ctx, entityId, id, 'draft', 'reviewed', { reviewedBy: ctx.user.id, reviewedAt: new Date() });
  }

  async approve(ctx: TenantRequestContext, entityId: string, id: string) {
    return this.db.transaction(async (tx) => {
      const r = await this.lockReturn(tx, entityId, id);
      if (r.preparedBy === ctx.user.id) throw new ForbiddenException('The person who prepared a return cannot approve it (maker-checker).');
      return this.stepIn(tx, ctx, entityId, r, 'reviewed', 'approved', { approvedBy: ctx.user.id, approvedAt: new Date() });
    });
  }

  async file(ctx: TenantRequestContext, entityId: string, id: string, arn: string, filedOn: string) {
    return this.step(ctx, entityId, id, 'approved', 'filed', { filedBy: ctx.user.id, filedAt: new Date(), arn, filedOn });
  }

  private step(ctx: TenantRequestContext, entityId: string, id: string, from: string, to: string, set: Partial<typeof gstReturn.$inferInsert>) {
    return this.db.transaction(async (tx) => this.stepIn(tx, ctx, entityId, await this.lockReturn(tx, entityId, id), from, to, set));
  }

  private async stepIn(tx: Tx, ctx: TenantRequestContext, entityId: string, r: typeof gstReturn.$inferSelect, from: string, to: string, set: Partial<typeof gstReturn.$inferInsert>) {
    if (r.status !== from) throw new ConflictException(`The return is ${r.status}; only a ${from} return can become ${to}.`);
    if (to === 'reviewed' || to === 'approved') {
      // Reviewed and approved figures must still be the books' figures.
      const now = await this.compute(tx, entityId, r.gstRegistrationId, r.period);
      const snapshot = r.kind === 'gstr1' ? { gstr1: now.gstr1, checks: now.checks, attention: now.attention } : { gstr3b: now.gstr3b, checks: now.checks };
      if (createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') !== r.snapshotHash)
        throw new ConflictException('The books changed since this return was prepared. Prepare it again, then review.');
      if (r.kind === 'gstr1' && (r.snapshot as { attention?: { blocking: boolean }[] }).attention?.some((a) => a.blocking))
        throw new ConflictException('Documents need attention before the return can move on.');
    }
    const [after] = await tx.update(gstReturn).set({ ...set, status: to }).where(eq(gstReturn.id, r.id)).returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: `gst_return.${to === 'reviewed' ? 'review' : to === 'approved' ? 'approve' : 'file'}`, targetType: 'gst_return', targetId: r.id, after: { status: to, arn: after!.arn } }, tx);
    return after!;
  }

  // ───────────────────────── filed-month warning (decision 074: warn, don't lock) ─────────────────────────

  /**
   * A document dated in a month whose GSTR-1 or 3B is filed changes only after a warning names the return and the
   * person confirms with a reason; the change is audited. Without confirmation the call is refused with 409.
   */
  async assertFiledMonth(tx: Tx, ctx: TenantRequestContext, entityId: string, regId: string | null, date: string, what: string, confirm: { confirmFiledReturn?: boolean; reason?: string | null } | undefined, targetId: string) {
    const filed = await tx
      .select({ kind: gstReturn.kind, period: gstReturn.period, arn: gstReturn.arn })
      .from(gstReturn)
      .where(and(eq(gstReturn.entityId, entityId), eq(gstReturn.period, date.slice(0, 7)), eq(gstReturn.status, 'filed'), regId ? eq(gstReturn.gstRegistrationId, regId) : sql`true`));
    if (!filed.length) return;
    const names = filed.map((f) => `${f.kind === 'gstr1' ? 'GSTR-1' : 'GSTR-3B'} for ${f.period} (ARN ${f.arn})`).join(' and ');
    if (!confirm?.confirmFiledReturn || !confirm.reason || confirm.reason.trim().length < 5)
      throw new ConflictException({ message: `${names} is already filed. Changing this ${what} needs your confirmation and a reason; it will show on the filed return as changed since filing.`, code: 'gst_return_filed', returns: filed });
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'gst_return.filed_month_change', targetType: what.replace(/ /g, '_'), targetId, reason: confirm.reason, after: { returns: filed } }, tx);
  }

  /** The filed-month warning for a document by type and id: its date and GSTIN are read here. */
  async assertDocumentFiled(tx: Tx, ctx: TenantRequestContext, entityId: string, type: 'sales_invoice' | 'purchase_invoice' | 'sales_note' | 'supplier_note', id: string, body: unknown) {
    let found: { date: string; reg: string | null; what: string } | undefined;
    if (type === 'sales_invoice') {
      const [r] = await tx.select({ date: salesInvoice.invoiceDate, reg: salesInvoice.gstRegistrationId }).from(salesInvoice).where(and(eq(salesInvoice.id, id), eq(salesInvoice.entityId, entityId)));
      found = r && { ...r, what: 'sales invoice' };
    } else if (type === 'purchase_invoice') {
      const [r] = await tx.select({ date: purchaseInvoice.postingDate, reg: purchaseInvoice.gstRegistrationId }).from(purchaseInvoice).where(and(eq(purchaseInvoice.id, id), eq(purchaseInvoice.entityId, entityId)));
      found = r && { ...r, what: 'purchase invoice' };
    } else if (type === 'sales_note') {
      const [r] = await tx.select({ date: salesNote.postingDate, reg: salesNote.gstRegistrationId, treatment: salesNote.taxTreatment }).from(salesNote).where(and(eq(salesNote.id, id), eq(salesNote.entityId, entityId)));
      found = r && r.treatment === 'gst' ? { date: r.date, reg: r.reg, what: 'customer note' } : undefined;
    } else {
      const [r] = await tx
        .select({ date: supplierNote.postingDate, reg: purchaseInvoice.gstRegistrationId, treatment: supplierNote.taxTreatment })
        .from(supplierNote)
        .leftJoin(purchaseInvoice, eq(purchaseInvoice.id, supplierNote.originalInvoiceId))
        .where(and(eq(supplierNote.id, id), eq(supplierNote.entityId, entityId)));
      found = r && r.treatment === 'gst' ? { date: r.date, reg: r.reg, what: 'supplier note' } : undefined;
    }
    if (found) await this.assertFiledMonth(tx, ctx, entityId, found.reg, found.date, found.what, GstReturnsService.confirmation(body), id);
  }

  /** Parses the optional confirmation fields a document action may carry. */
  static confirmation(body: unknown): { confirmFiledReturn?: boolean; reason?: string | null } {
    const b = (body ?? {}) as { confirmFiledReturn?: unknown; filedReturnReason?: unknown; reason?: unknown };
    if (b.confirmFiledReturn !== undefined && typeof b.confirmFiledReturn !== 'boolean') throw new BadRequestException('confirmFiledReturn must be true or false');
    const reason = typeof b.filedReturnReason === 'string' ? b.filedReturnReason : typeof b.reason === 'string' ? b.reason : null;
    return { confirmFiledReturn: b.confirmFiledReturn === true, reason };
  }
}
