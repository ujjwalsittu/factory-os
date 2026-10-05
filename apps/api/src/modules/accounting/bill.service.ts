import { Dec } from '@factoryos/core';
import {
  accountingSettings,
  glAccount,
  glEntry,
  journalVoucher,
  openingWorksheet,
  purchaseInvoice,
  salesInvoice,
  tradeBill,
  tradeBillEffect,
  tradeSubledgerState,
} from '@factoryos/db';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte, notInArray, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { businessDate, type Db, type Tx } from './accounting-lock.js';

export type TradeSide = 'receivable' | 'payable';
export type BillKind = 'bill' | 'advance' | 'journal_credit';
export interface BillBalance {
  id: string;
  kind: BillKind;
  partyId: string;
  side: TradeSide;
  accountId: string;
  reference: string;
  sourceType: string;
  sourceId: string | null;
  currency: string;
  originalAmount: string;
  recognitionDate: string;
  dueDate: string | null;
  msmeCategory: string | null;
  /** Document currency still open (always ≥ 0 for a consistent subledger). */
  openAmount: string;
  /** INR carrying value of what is open. */
  carryingInr: string;
}
export interface PartyPosition {
  grossOpenInr: string;
  onAccountInr: string;
  netInr: string;
  overdueInr: string;
  overdueCount: number;
}
export interface NewEffect {
  billId: string;
  sourceType: string;
  sourceId: string;
  originKey: string;
  postingDate: string;
  /** Side-signed: + increases what is owed, − settles it. */
  amount: string;
  carryingInr: string;
}

/** Vouchers whose trade-control lines are written as bill effects by their own service, not by GL sync. */
const SELF_RECORDED = ['settlement', 'settlement_allocation', 'opening', 'sales_note', 'sales_note_application', 'sales_return', 'supplier_note', 'supplier_note_application', 'purchase_return', 'supplier_return_resolution'];
const INVOICE_SOURCES: Record<string, TradeSide> = { sales_invoice: 'receivable', purchase_invoice: 'payable' };

/**
 * Bill-wise receivables and payables, derived from posted GL (decision 036). The GL stays the book of record:
 * every trade-control line becomes exactly one immutable effect, so the subledger reconciles by construction.
 */
@Injectable()
export class BillService {
  /** Trade control accounts (current and historical mappings) and the side each represents. */
  async controls(tx: Db, entityId: string): Promise<Map<string, TradeSide>> {
    const [s] = await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
    const out = new Map<string, TradeSide>();
    const roleSide: Record<string, TradeSide> = { debtors: 'receivable', creditors: 'payable' };
    for (const [role, side] of Object.entries(roleSide)) {
      const current = s?.mappings?.[role];
      if (current) out.set(current, side);
      for (const id of s?.controlHistory?.[role] ?? []) out.set(id, side);
    }
    const byRole = await tx
      .select({ id: glAccount.id, role: glAccount.role })
      .from(glAccount)
      .where(and(eq(glAccount.entityId, entityId), inArray(glAccount.role, ['debtors', 'creditors'])));
    for (const a of byRole) out.set(a.id, roleSide[a.role!]!);
    return out;
  }

  async currentControl(tx: Db, entityId: string, side: TradeSide): Promise<string> {
    const [s] = await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
    const id = s?.mappings?.[side === 'receivable' ? 'debtors' : 'creditors'];
    if (!id) throw new BadRequestException(`Map the ${side === 'receivable' ? 'Sundry Debtors' : 'Sundry Creditors'} control account first`);
    return id;
  }

  /**
   * Bring the subledger up to date with posted GL. Idempotent: each GL line and opening bill has a unique
   * origin key, so repeated or concurrent calls (serialised by the entity accounting lock) never duplicate.
   * Caller holds the accounting lock and accounting is active.
   */
  async syncIn(tx: Tx, ctx: TenantRequestContext, entityId: string): Promise<void> {
    const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
    if (!settings?.active) return;
    const tenantId = ctx.tenant.tenantId;
    const [state] = await tx.select().from(tradeSubledgerState).where(eq(tradeSubledgerState.entityId, entityId));
    if (!state) await this.seedOpening(tx, tenantId, entityId, settings.cutoverDate!);

    const controls = await this.controls(tx, entityId);
    if (!controls.size) return;
    const pending = await tx
      .select({ e: glEntry, v: journalVoucher })
      .from(glEntry)
      .innerJoin(journalVoucher, eq(journalVoucher.id, glEntry.voucherId))
      .where(
        and(
          eq(glEntry.entityId, entityId),
          inArray(glEntry.accountId, [...controls.keys()]),
          notInArray(journalVoucher.sourceType, SELF_RECORDED),
          sql`not exists (select 1 from trade_bill_effect f where f.entity_id = ${entityId} and f.origin_key = 'gl:' || "gl_entry"."id")`,
        ),
      )
      .orderBy(asc(glEntry.createdAt), asc(glEntry.id));
    // Match legacy references against all invoice identities, not just invoices
    // whose entries happen to sort before a journal adjustment.
    for (const { e, v } of pending) {
      if (INVOICE_SOURCES[v.sourceType] && !v.reversalOf && e.partyId)
        await this.invoiceBill(tx, tenantId, entityId, v.sourceType, v.sourceId, e.accountId, e.partyId, e.postingDate);
    }
    for (const { e, v } of pending) {
      const side = controls.get(e.accountId)!;
      const inr = side === 'receivable' ? Dec.of(e.debit).sub(e.credit) : Dec.of(e.credit).sub(e.debit);
      const base = { tenantId, entityId, sourceType: v.sourceType, sourceId: v.sourceId, originKey: `gl:${e.id}`, glEntryId: e.id, postingDate: e.postingDate };

      // A reversal negates exactly what its original line recorded, on the same bill.
      if (v.reversalOf) {
        const [orig] = await tx
          .select({ f: tradeBillEffect })
          .from(tradeBillEffect)
          .innerJoin(glEntry, eq(glEntry.id, tradeBillEffect.glEntryId))
          .where(
            and(
              eq(glEntry.voucherId, v.reversalOf),
              eq(glEntry.accountId, e.accountId),
              eq(glEntry.debit, e.credit),
              eq(glEntry.credit, e.debit),
              e.partyId ? eq(glEntry.partyId, e.partyId) : sql`${glEntry.partyId} is null`,
              sql`not exists (select 1 from trade_bill_effect r where r.reversal_of = ${tradeBillEffect.id})`,
            ),
          )
          .limit(1);
        if (orig) {
          await tx.insert(tradeBillEffect).values({ ...base, billId: orig.f.billId, amount: Dec.of(orig.f.amount).neg().toString(), carryingInr: Dec.of(orig.f.carryingInr).neg().toString(), reversalOf: orig.f.id });
          continue;
        }
      }
      if (!e.partyId) continue; // trade controls always carry a party (validated at posting)

      const invoiceSide = INVOICE_SOURCES[v.sourceType];
      if (invoiceSide) {
        const billId = await this.invoiceBill(tx, tenantId, entityId, v.sourceType, v.sourceId, e.accountId, e.partyId, e.postingDate);
        const [existing] = await tx.select({ n: sql<number>`count(*)::int` }).from(tradeBillEffect).where(eq(tradeBillEffect.billId, billId));
        const doc = await this.invoiceDoc(tx, v.sourceType, v.sourceId);
        const amount = existing!.n === 0 && doc ? Dec.of(doc.grandTotal ?? '0') : inr.div(v.exchangeRate);
        await tx.insert(tradeBillEffect).values({ ...base, billId, amount: amount.toString(), carryingInr: inr.toString() });
        continue;
      }

      // Manual (and any other) journal lines: an exact, unambiguous INR bill of the same party/side/account gets
      // the adjustment; anything else becomes its own visible journal-origin item.
      const reference = e.billReference ?? `JV ${v.number ?? v.id}`;
      const matches = await tx
        .select()
        .from(tradeBill)
        .where(
          and(
            eq(tradeBill.entityId, entityId),
            eq(tradeBill.partyId, e.partyId),
            eq(tradeBill.side, side),
            eq(tradeBill.accountId, e.accountId),
            eq(tradeBill.kind, 'bill'),
            eq(tradeBill.currency, 'INR'),
            eq(tradeBill.reference, reference),
          ),
        );
      let billId = matches.length === 1 ? matches[0]!.id : null;
      if (!billId) {
        const [b] = await tx
          .insert(tradeBill)
          .values({
            tenantId,
            entityId,
            side,
            kind: inr.isNeg() ? 'journal_credit' : 'bill',
            partyId: e.partyId,
            accountId: e.accountId,
            reference,
            sourceType: v.sourceType,
            sourceId: v.sourceId,
            originKey: `journal:${e.id}`,
            currency: 'INR',
            originalAmount: inr.abs().toString(),
            recognitionDate: e.postingDate,
          })
          .returning();
        billId = b!.id;
      }
      await tx.insert(tradeBillEffect).values({ ...base, billId, amount: inr.toString(), carryingInr: inr.toString() });
    }
  }

  /** Opening bills come from the reviewed worksheet (its GL lines may be per-party totals). Once per entity. */
  private async seedOpening(tx: Tx, tenantId: string, entityId: string, cutover: string) {
    const [w] = await tx.select().from(openingWorksheet).where(eq(openingWorksheet.entityId, entityId));
    const controls = { receivable: await this.currentControl(tx, entityId, 'receivable').catch(() => null), payable: await this.currentControl(tx, entityId, 'payable').catch(() => null) };
    for (const [i, b] of (w?.bills ?? []).entries()) {
      const side: TradeSide = b.side === 'debit' ? 'receivable' : 'payable';
      const accountId = controls[side];
      if (!accountId) continue;
      const inr = Dec.of(b.amount);
      if (inr.isZero()) continue;
      const currency = b.currency ?? 'INR';
      // A partly settled foreign bill: its residual INR at the reviewed invoice rate gives the open document amount.
      const open = currency === 'INR' || !b.exchangeRate ? inr : inr.div(b.exchangeRate);
      const original = b.originalAmount ? Dec.of(b.originalAmount) : open;
      if (open.gt(original)) throw new ConflictException(`Opening bill ${b.reference}: open amount exceeds its original amount`);
      const invoiceType = side === 'receivable' ? 'sales_invoice' : 'purchase_invoice';
      const doc = b.invoiceId ? await this.invoiceDoc(tx, invoiceType, b.invoiceId) : null;
      const [bill] = await tx
        .insert(tradeBill)
        .values({
          tenantId,
          entityId,
          side,
          kind: 'bill',
          partyId: b.partyId,
          accountId,
          reference: b.reference,
          sourceType: b.invoiceId ? invoiceType : 'opening',
          sourceId: b.invoiceId ?? null,
          originKey: b.invoiceId ? `${invoiceType}:${b.invoiceId}` : `opening:${i}`,
          currency,
          originalAmount: original.toString(),
          recognitionDate: cutover,
          dueDate: doc?.dueDate ?? null,
          msmeCategory: doc?.msmeCategory ?? null,
        })
        .returning();
      await tx.insert(tradeBillEffect).values({ tenantId, entityId, billId: bill!.id, sourceType: 'opening', sourceId: null, originKey: `opening:${i}`, postingDate: cutover, amount: open.toString(), carryingInr: inr.toString() });
    }
    await tx.insert(tradeSubledgerState).values({ entityId, tenantId }).onConflictDoNothing();
  }

  private async invoiceDoc(tx: Db, type: string, id: string) {
    if (type === 'sales_invoice') {
      const [s] = await tx.select().from(salesInvoice).where(eq(salesInvoice.id, id));
      return s ? { number: s.number, grandTotal: s.grandTotal, currency: s.currency, date: s.invoiceDate, dueDate: s.dueDate, msmeCategory: null as string | null } : null;
    }
    const [p] = await tx.select().from(purchaseInvoice).where(eq(purchaseInvoice.id, id));
    return p ? { number: p.supplierInvoiceNo, grandTotal: p.grandTotal, currency: p.currency, date: p.supplierInvoiceDate, dueDate: p.dueDate, msmeCategory: p.msmeCategory } : null;
  }

  private async invoiceBill(tx: Tx, tenantId: string, entityId: string, type: string, id: string, accountId: string, partyId: string, postingDate: string) {
    const originKey = `${type}:${id}`;
    const [found] = await tx.select().from(tradeBill).where(and(eq(tradeBill.entityId, entityId), eq(tradeBill.originKey, originKey)));
    if (found) return found.id;
    const doc = await this.invoiceDoc(tx, type, id);
    const [b] = await tx
      .insert(tradeBill)
      .values({
        tenantId,
        entityId,
        side: INVOICE_SOURCES[type]!,
        kind: 'bill',
        partyId,
        accountId,
        reference: doc?.number ?? id,
        sourceType: type,
        sourceId: id,
        originKey,
        currency: doc?.currency ?? 'INR',
        originalAmount: doc?.grandTotal ?? '0',
        recognitionDate: postingDate,
        dueDate: doc?.dueDate ?? null,
        msmeCategory: doc?.msmeCategory ?? null,
      })
      .returning();
    return b!.id;
  }

  /** Balances derived from effects up to `asOf` (default: everything). */
  async list(
    tx: Db,
    entityId: string,
    f: { side?: TradeSide; partyId?: string; currency?: string; billIds?: string[]; asOf?: string; kind?: BillKind[]; openOnly?: boolean } = {},
  ): Promise<BillBalance[]> {
    const where = [eq(tradeBill.entityId, entityId)];
    if (f.side) where.push(eq(tradeBill.side, f.side));
    if (f.partyId) where.push(eq(tradeBill.partyId, f.partyId));
    if (f.currency) where.push(eq(tradeBill.currency, f.currency));
    if (f.billIds) where.push(inArray(tradeBill.id, f.billIds.length ? f.billIds : ['00000000-0000-0000-0000-000000000000']));
    if (f.kind) where.push(inArray(tradeBill.kind, f.kind));
    const rows = await tx
      .select({
        bill: tradeBill,
        amount: sql<string>`coalesce(sum(${tradeBillEffect.amount}), 0)`,
        carrying: sql<string>`coalesce(sum(${tradeBillEffect.carryingInr}), 0)`,
      })
      .from(tradeBill)
      .leftJoin(tradeBillEffect, and(eq(tradeBillEffect.billId, tradeBill.id), f.asOf ? lte(tradeBillEffect.postingDate, f.asOf) : sql`true`))
      .where(and(...where))
      .groupBy(tradeBill.id)
      .orderBy(asc(tradeBill.recognitionDate), asc(tradeBill.reference));
    return rows
      .map(({ bill: b, amount, carrying }) => {
        const sign = b.kind === 'bill' ? Dec.of('1') : Dec.of('-1');
        return {
          id: b.id,
          kind: b.kind as BillKind,
          partyId: b.partyId,
          side: b.side as TradeSide,
          accountId: b.accountId,
          reference: b.reference,
          sourceType: b.sourceType,
          sourceId: b.sourceId,
          currency: b.currency,
          originalAmount: b.originalAmount,
          recognitionDate: b.recognitionDate,
          dueDate: b.dueDate,
          msmeCategory: b.msmeCategory,
          openAmount: Dec.of(amount).mul(sign).toFixed(6),
          carryingInr: Dec.of(carrying).mul(sign).toFixed(6),
        };
      })
      .filter((b) => (f.asOf ? b.recognitionDate <= f.asOf : true) && (!f.openOnly || !Dec.of(b.openAmount).isZero() || !Dec.of(b.carryingInr).isZero()));
  }

  /** Customer/supplier exposure: gross open bills, money on account, net (floored at 0), overdue. */
  async positionIn(tx: Db, entityId: string, partyId: string, side: TradeSide, asOf = businessDate()): Promise<PartyPosition> {
    const bills = await this.list(tx, entityId, { partyId, side, asOf });
    let gross = Dec.ZERO;
    let onAccount = Dec.ZERO;
    let overdue = Dec.ZERO;
    let overdueCount = 0;
    for (const b of bills) {
      const c = Dec.of(b.carryingInr);
      if (b.kind === 'bill') {
        if (!c.gt('0')) continue;
        gross = gross.add(c);
        if (b.dueDate && b.dueDate < asOf) {
          overdue = overdue.add(c);
          overdueCount += 1;
        }
      } else if (c.gt('0')) onAccount = onAccount.add(c);
    }
    const net = gross.sub(onAccount);
    return { grossOpenInr: gross.toFixed(2), onAccountInr: onAccount.toFixed(2), netInr: (net.isNeg() ? Dec.ZERO : net).toFixed(2), overdueInr: overdue.toFixed(2), overdueCount };
  }

  async addEffects(tx: Tx, ctx: TenantRequestContext, entityId: string, effects: NewEffect[]) {
    if (!effects.length) return;
    await tx.insert(tradeBillEffect).values(effects.map((e) => ({ ...e, tenantId: ctx.tenant.tenantId, entityId })));
  }

  /** Negate every surviving effect a source wrote (exact recorded values, current business date). */
  async reverseSourceEffects(tx: Tx, ctx: TenantRequestContext, entityId: string, sourceType: string, sourceId: string, postingDate: string) {
    const rows = await tx
      .select()
      .from(tradeBillEffect)
      .where(
        and(
          eq(tradeBillEffect.entityId, entityId),
          eq(tradeBillEffect.sourceType, sourceType),
          eq(tradeBillEffect.sourceId, sourceId),
          sql`${tradeBillEffect.reversalOf} is null`,
          sql`not exists (select 1 from trade_bill_effect r where r.reversal_of = "trade_bill_effect"."id")`,
        ),
      );
    if (!rows.length) return;
    await tx.insert(tradeBillEffect).values(
      rows.map((r) => ({
        tenantId: ctx.tenant.tenantId,
        entityId,
        billId: r.billId,
        sourceType,
        sourceId,
        originKey: `${r.originKey}:reversal`,
        postingDate,
        amount: Dec.of(r.amount).neg().toString(),
        carryingInr: Dec.of(r.carryingInr).neg().toString(),
        reversalOf: r.id,
      })),
    );
  }

  /**
   * An invoice or journal can't be cancelled while receipts, payments, allocations or journal adjustments still
   * settle a bill it created. Names the dependent documents.
   */
  async assertSourceCancellableIn(tx: Tx, entityId: string, sourceType: string, sourceId: string) {
    const dependents = await tx.execute<{ source_type: string; number: string | null }>(sql`
      select distinct f.source_type,
        coalesce(
          (select s.number from party_settlement s where s.id = f.source_id),
          (select a.number from settlement_allocation_document a where a.id = f.source_id),
          (select v.number from journal_voucher v where v.source_type = f.source_type and v.source_id = f.source_id and v.reversal_of is null limit 1)
        ) as number
      from trade_bill b
      join trade_bill_effect f on f.bill_id = b.id
      where b.entity_id = ${entityId} and b.source_type = ${sourceType} and b.source_id = ${sourceId}
        and not (f.source_type = ${sourceType} and f.source_id = ${sourceId})
        and f.reversal_of is null
        and not exists (select 1 from trade_bill_effect r where r.reversal_of = f.id)`);
    if (dependents.rows.length) {
      const names = dependents.rows.map((d) => d.number ?? d.source_type).join(', ');
      throw new ConflictException(`Settled by ${names}. Cancel those first.`);
    }
  }

  /**
   * New manual journal lines on trade controls: a reference matching an existing INR bill adjusts it (never below
   * zero, never ambiguous); foreign bills are settled through receipts/payments; other references become new items.
   */
  async checkJournalLinesIn(tx: Tx, entityId: string, lines: { accountId: string; debit: string; credit: string; partyId?: string; billReference?: string }[]) {
    const controls = await this.controls(tx, entityId);
    for (const l of lines) {
      const side = controls.get(l.accountId);
      if (!side || !l.partyId || !l.billReference) continue;
      const delta = side === 'receivable' ? Dec.of(l.debit).sub(l.credit) : Dec.of(l.credit).sub(l.debit);
      const matches = await this.list(tx, entityId, { partyId: l.partyId, side });
      const same = matches.filter((b) => b.reference === l.billReference && b.kind === 'bill');
      if (same.length > 1) throw new BadRequestException(`More than one bill is referenced "${l.billReference}" for this party; use a distinct reference or settle through a receipt/payment`);
      const bill = same[0];
      if (!bill) continue;
      if (bill.currency !== 'INR') throw new BadRequestException(`${bill.reference} is a ${bill.currency} bill; settle it through a receipt or payment`);
      if (bill.accountId !== l.accountId) throw new BadRequestException(`${bill.reference} sits on another control account`);
      if (Dec.of(bill.carryingInr).add(delta).isNeg()) throw new BadRequestException(`${bill.reference} has only ₹${Dec.of(bill.carryingInr).toFixed(2)} open`);
    }
  }

  /** Per control account and party: GL net vs subledger net. Differences are reported, never netted away. */
  async reconciliation(tx: Db, entityId: string) {
    const controls = await this.controls(tx, entityId);
    if (!controls.size) return [];
    const gl = await tx
      .select({ accountId: glEntry.accountId, partyId: glEntry.partyId, debit: sql<string>`sum(${glEntry.debit})`, credit: sql<string>`sum(${glEntry.credit})` })
      .from(glEntry)
      .where(and(eq(glEntry.entityId, entityId), inArray(glEntry.accountId, [...controls.keys()])))
      .groupBy(glEntry.accountId, glEntry.partyId);
    const sub = await tx
      .select({ accountId: tradeBill.accountId, partyId: tradeBill.partyId, net: sql<string>`coalesce(sum(${tradeBillEffect.carryingInr}), 0)` })
      .from(tradeBill)
      .innerJoin(tradeBillEffect, eq(tradeBillEffect.billId, tradeBill.id))
      .where(eq(tradeBill.entityId, entityId))
      .groupBy(tradeBill.accountId, tradeBill.partyId);
    const key = (a: string, p: string | null) => `${a}:${p ?? ''}`;
    const out = new Map<string, { accountId: string; partyId: string | null; side: TradeSide; glInr: Dec; subledgerInr: Dec }>();
    for (const g of gl) {
      const side = controls.get(g.accountId)!;
      const net = side === 'receivable' ? Dec.of(g.debit).sub(g.credit) : Dec.of(g.credit).sub(g.debit);
      out.set(key(g.accountId, g.partyId), { accountId: g.accountId, partyId: g.partyId, side, glInr: net, subledgerInr: Dec.ZERO });
    }
    for (const s of sub) {
      const k = key(s.accountId, s.partyId);
      const row = out.get(k) ?? { accountId: s.accountId, partyId: s.partyId, side: controls.get(s.accountId) ?? 'receivable', glInr: Dec.ZERO, subledgerInr: Dec.ZERO };
      row.subledgerInr = row.subledgerInr.add(s.net);
      out.set(k, row);
    }
    return [...out.values()].map((r) => ({ ...r, glInr: r.glInr.toFixed(6), subledgerInr: r.subledgerInr.toFixed(6), difference: r.glInr.sub(r.subledgerInr).toFixed(6) }));
  }

  async assertReconciledIn(tx: Tx, entityId: string) {
    const bad = (await this.reconciliation(tx, entityId)).filter((r) => !Dec.of(r.difference).isZero());
    if (bad.length) {
      throw new ConflictException(`The receivable/payable subledger differs from the GL for ${bad.length} party balance(s); see Accounts → Outstanding → Reconciliation before recording settlements`);
    }
  }
}
