import { Dec } from '@factoryos/core';
import { accountingSettings, glEntry, journalVoucher, openingWorksheet, purchaseInvoice, salesInvoice, tradeBill, tradeBillEffect, tradeSubledgerState } from '@factoryos/db';
import { ConflictException, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { lockAccounting, type Tx } from './accounting-lock.js';
import { BillService, type BillSourceEffect } from './bill.service.js';

/** Reconcile source evidence without reconstructing or modifying historical GL. */
@Injectable()
export class BillInitializationService {
  constructor(private readonly bills: BillService) {}
  async ensureIn(tx: Tx, ctx: TenantRequestContext, entityId: string) {
    await lockAccounting(tx, entityId);
    const [s] = await tx.select().from(accountingSettings).where(and(eq(accountingSettings.entityId, entityId), eq(accountingSettings.tenantId, ctx.tenant.tenantId)));
    if (!s?.active) return;
    const controls = await this.bills.controlAccountsIn(tx, ctx, entityId);
    const [w] = await tx.select().from(openingWorksheet).where(and(eq(openingWorksheet.entityId, entityId), eq(openingWorksheet.tenantId, ctx.tenant.tenantId)));
    if (w) {
      const entries = s.openingVoucherId ? await tx.select().from(glEntry).where(and(eq(glEntry.entityId, entityId), eq(glEntry.voucherId, s.openingVoucherId))) : [];
      for (const [i, b] of w.bills.entries()) {
        const side = b.side === 'debit' ? 'receivable' : 'payable';
        const ids = [...new Set(entries.filter(e => e.partyId === b.partyId && controls.get(e.accountId) === side).map(e => e.accountId))];
        if (ids.length !== 1) throw new ConflictException(`Opening bill ${b.reference} has ambiguous control provenance`);
        const currency = b.currency ?? 'INR', amount = currency === 'INR' ? Dec.of(b.amount) : Dec.of(b.amount).div(b.exchangeRate!);
        if (b.originalAmount && amount.gt(b.originalAmount)) throw new ConflictException(`Opening bill ${b.reference} exceeds original amount`);
        let dueDate: string | null = null, msmeCategory: string | null = null;
        if (b.invoiceId && side === 'receivable') { const [inv] = await tx.select().from(salesInvoice).where(and(eq(salesInvoice.id, b.invoiceId), eq(salesInvoice.entityId, entityId))); dueDate = inv?.dueDate ?? null; }
        if (b.invoiceId && side === 'payable') { const [inv] = await tx.select().from(purchaseInvoice).where(and(eq(purchaseInvoice.id, b.invoiceId), eq(purchaseInvoice.entityId, entityId))); dueDate = inv?.dueDate ?? null; msmeCategory = inv?.msmeCategory ?? null; }
        await this.bills.recordSourceIn(tx, ctx, entityId, { type: b.invoiceId ? (side === 'receivable' ? 'sales_invoice' : 'purchase_invoice') : 'opening_bill', id: b.invoiceId ?? w.id, purpose: 'opening' }, [{ partyId: b.partyId, side, accountId: ids[0]!, reference: b.reference, currency, recognitionDate: s.cutoverDate!, postingDate: s.cutoverDate!, dueDate, msmeCategory, amount: amount.toString(), carryingInr: Dec.of(b.amount).toString(), originKey: `opening:${i}` }]);
      }
    }
    const vouchers = await tx.select().from(journalVoucher).where(and(eq(journalVoucher.entityId, entityId), eq(journalVoucher.tenantId, ctx.tenant.tenantId))).orderBy(asc(journalVoucher.submittedAt));
    for (const v of vouchers) {
      if (v.sourceType === 'opening' || ['settlement', 'settlement_allocation'].includes(v.sourceType) || v.status === 'draft') continue;
      if (v.reversalOf) { await this.bills.reverseSourceIn(tx, ctx, entityId, { type: v.sourceType, id: v.sourceId, purpose: 'main' }, v.postingDate); continue; }
      const entries = await tx.select().from(glEntry).where(and(eq(glEntry.entityId, entityId), eq(glEntry.voucherId, v.id)));
      for (const e of entries) {
        const side = controls.get(e.accountId);
        if (!side) continue;
        if (!e.partyId) throw new ConflictException(`Trade entry ${e.id} has no party`);
        const [prior] = await tx.select().from(tradeBillEffect).where(and(eq(tradeBillEffect.entityId, entityId), eq(tradeBillEffect.sourceType, v.sourceType), eq(tradeBillEffect.sourceId, v.sourceId), eq(tradeBillEffect.originKey, e.id)));
        if (prior) continue;
        const carrying = side === 'receivable' ? Dec.of(e.debit).sub(e.credit) : Dec.of(e.credit).sub(e.debit);
        let currency = 'INR', amount = carrying, dueDate: string | null = null, msmeCategory: string | null = null;
        if (v.sourceType === 'sales_invoice') {
          const [inv] = await tx.select().from(salesInvoice).where(and(eq(salesInvoice.id, v.sourceId), eq(salesInvoice.entityId, entityId)));
          if (!inv) throw new ConflictException(`Invoice ${v.sourceId} is missing`);
          currency = inv.currency; amount = Dec.of(inv.grandTotal ?? '0'); dueDate = inv.dueDate;
        }
        if (v.sourceType === 'purchase_invoice') {
          const [inv] = await tx.select().from(purchaseInvoice).where(and(eq(purchaseInvoice.id, v.sourceId), eq(purchaseInvoice.entityId, entityId)));
          if (!inv) throw new ConflictException(`Invoice ${v.sourceId} is missing`);
          currency = inv.currency; amount = Dec.of(inv.grandTotal ?? '0'); dueDate = inv.dueDate; msmeCategory = inv.msmeCategory;
        }
        let billId: string | undefined;
        if (v.sourceType === 'manual') {
          const candidates = await tx.select().from(tradeBill).where(and(eq(tradeBill.entityId, entityId), eq(tradeBill.partyId, e.partyId), eq(tradeBill.side, side), eq(tradeBill.accountId, e.accountId), eq(tradeBill.reference, e.billReference ?? ''), eq(tradeBill.currency, 'INR')));
          if (candidates.length === 1) billId = candidates[0]!.id;
        }
        const effect: BillSourceEffect = { ...(billId && { billId }), partyId: e.partyId, side, accountId: e.accountId, reference: e.billReference ?? v.number ?? v.id, currency, amount: amount.toString(), carryingInr: carrying.toString(), recognitionDate: v.postingDate, postingDate: v.postingDate, dueDate, msmeCategory, originKey: e.id };
        await this.bills.recordSourceIn(tx, ctx, entityId, { type: v.sourceType, id: v.sourceId, purpose: v.purpose }, [effect]);
      }
    }
    await this.bills.assertReconciledIn(tx, ctx, entityId);
    await tx.insert(tradeSubledgerState).values({ tenantId: ctx.tenant.tenantId, entityId, version: 1 }).onConflictDoNothing();
  }
}
