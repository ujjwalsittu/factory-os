import {
  Dec,
  allocateProportion,
  purchaseVariance,
  type AccountingLine,
  type PostingPlan,
} from '@factoryos/core';
import {
  item,
  purchaseInvoiceLine,
  salesInvoice,
  stockEntry,
  stockEntryLine,
  type purchaseInvoice,
  type landedCostVoucher,
} from '@factoryos/db';
import { BadRequestException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AcquisitionCostService } from './acquisition-cost.service.js';
import { GlPostingService } from './gl-posting.service.js';
import { ReceiptAllocationService } from './receipt-allocation.service.js';
import type { Tx } from './accounting-lock.js';
class Lines {
  readonly entries: AccountingLine[] = [];
  constructor(private readonly mappings: Record<string, string>) {}
  add(role: string, debit: Dec | string, ref: Partial<AccountingLine> = {}) {
    const n = Dec.of(debit);
    if (n.isZero()) return;
    const accountId = this.mappings[role];
    if (!accountId)
      throw new BadRequestException(`Missing accounting mapping: ${role}`);
    this.entries.push({
      ...ref,
      accountId,
      debit: n.gt('0') ? n.toString() : '0',
      credit: n.lt('0') ? n.neg().toString() : '0',
    });
  }
  plan(): PostingPlan {
    if (this.entries.length) {
      const residual = this.entries.reduce(
        (s, l) => s.add(l.credit).sub(l.debit),
        Dec.ZERO,
      );
      this.add('rounding', residual);
    }
    return {
      lines: this.entries,
      disposition: this.entries.length ? 'posted' : 'no_value_change',
    };
  }
}
@Injectable()
export class OperationalPostings {
  constructor(
    private readonly gl: GlPostingService,
    private readonly allocation: ReceiptAllocationService,
    private readonly cost: AcquisitionCostService,
  ) {}
  async stockIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    entry: typeof stockEntry.$inferSelect,
  ) {
    const settings = await this.gl.active(tx, entityId);
    if (!settings) return;
    const lines = new Lines(settings.mappings),
      rows = await tx
        .select()
        .from(stockEntryLine)
        .where(eq(stockEntryLine.entryId, entry.id));
    if (entry.purpose !== 'transfer')
      for (const row of rows) {
        if (row.ownerPartyId) continue;
        const value = Dec.of(row.value ?? '0');
        // Work orders (decision 044): stock moves between inventory and work in progress.
        if (entry.purpose === 'production_issue') {
          lines.add('wip', value);
          lines.add('inventory', value.neg());
        } else if (entry.purpose === 'production_return' || entry.purpose === 'production_output') {
          lines.add('inventory', value);
          lines.add('wip', value.neg());
        } else if (
          entry.purpose === 'receipt' ||
          (entry.purpose === 'adjustment' && row.toWarehouseId)
        ) {
          lines.add('inventory', value);
          lines.add(entry.purchaseOrderId ? 'grni' : 'adjustment', value.neg());
        } else {
          lines.add(
            entry.purpose === 'delivery'
              ? 'cogs'
              : entry.purpose === 'scrap'
                ? 'scrap'
                : entry.purpose === 'issue'
                  ? 'production'
                  : 'adjustment',
            value,
          );
          lines.add('inventory', value.neg());
        }
      }
    await this.gl.postIn(
      tx,
      ctx,
      entityId,
      {
        type: 'stock_entry',
        id: entry.id,
        purpose: 'main',
        number: entry.number,
      },
      entry.postingDate,
      lines.plan(),
    );
  }
  /** A posting by account role, e.g. job-card absorption or a work order's close variance (decision 044). */
  async rolesIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    source: { type: string; id: string; purpose: string; number: string | null },
    postingDate: string,
    amounts: [role: string, debit: Dec | string][],
  ) {
    const settings = await this.gl.active(tx, entityId);
    if (!settings) return;
    const lines = new Lines(settings.mappings);
    for (const [role, debit] of amounts) lines.add(role, debit);
    await this.gl.postIn(tx, ctx, entityId, source, postingDate, lines.plan());
  }
  async purchaseIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    invoice: typeof purchaseInvoice.$inferSelect,
  ) {
    const settings = await this.gl.active(tx, entityId);
    if (!settings) return;
    const lines = new Lines(settings.mappings),
      rate = Dec.of(invoice.exchangeRate);
    const allocations = await this.allocation.allocateIn(
      tx,
      ctx,
      entityId,
      invoice.id,
    );
    const rows = await tx
      .select({ line: purchaseInvoiceLine, item })
      .from(purchaseInvoiceLine)
      .innerJoin(item, eq(item.id, purchaseInvoiceLine.itemId))
      .where(eq(purchaseInvoiceLine.invoiceId, invoice.id));
    const taxCosts: { receiptLineId: string; amount: string }[] = [];
    for (const { line, item: it } of rows) {
      if (it.isStockItem) {
        const matched = allocations.filter((a) => a.invoiceLineId === line.id);
        for (const a of matched) {
          lines.add('grni', a.baseCost);
          const variance = purchaseVariance({
            qty: a.qty,
            poRate: a.poRate,
            invoiceRate: line.rate,
            poExchangeRate: a.poExchangeRate,
            invoiceExchangeRate: invoice.exchangeRate,
          });
          lines.add(
            'price_variance',
            Dec.of(variance.price).add(
              Dec.of(a.qty).mul(a.poRate).mul(a.poExchangeRate).sub(a.baseCost),
            ),
          );
          lines.add('forex', variance.forex);
        }
        if (!invoice.itcEligible) {
          const total = Dec.of(line.cgst ?? '0')
            .add(line.sgst ?? '0')
            .add(line.igst ?? '0')
            .add(line.cess ?? '0')
            .mul(rate);
          let remainder = total;
          matched.forEach((a, index) => {
            const amount =
              index === matched.length - 1
                ? remainder
                : Dec.min(
                    remainder,
                    Dec.of(
                      allocateProportion(total.toString(), a.qty, line.qty),
                    ),
                  );
            remainder = remainder.sub(amount);
            taxCosts.push({
              receiptLineId: a.receiptLineId,
              amount: amount.toString(),
            });
          });
        }
      } else {
        lines.add('purchases', Dec.of(line.taxableValue ?? '0').mul(rate));
        if (!invoice.itcEligible)
          lines.add(
            'noncreditable_tax',
            Dec.of(line.cgst ?? '0')
              .add(line.sgst ?? '0')
              .add(line.igst ?? '0')
              .add(line.cess ?? '0')
              .mul(rate),
          );
      }
    }
    if (taxCosts.length) {
      const cost = await this.cost.applyIn(
        tx,
        ctx,
        entityId,
        { type: 'purchase_invoice', id: invoice.id, purpose: 'main' },
        invoice.postingDate,
        taxCosts,
      );
      lines.add('inventory', cost.inventory);
      lines.add('production', cost.consumed);
      lines.add('rounding', cost.rounding);
    }
    for (const tax of ['cgst', 'sgst', 'igst', 'cess'] as const) {
      const amount = Dec.of(invoice[tax] ?? '0').mul(rate);
      if (invoice.itcEligible)
        lines.add(
          `${invoice.reverseCharge ? 'pending' : 'input'}_${tax}`,
          amount,
          { gstRegistrationId: invoice.gstRegistrationId ?? undefined },
        );
      if (invoice.reverseCharge)
        lines.add(`rcm_${tax}`, amount.neg(), {
          gstRegistrationId: invoice.gstRegistrationId ?? undefined,
        });
    }
    lines.add(
      'creditors',
      Dec.of(invoice.grandTotal ?? '0')
        .mul(rate)
        .neg(),
      { partyId: invoice.supplierId, billReference: invoice.supplierInvoiceNo },
    );
    await this.gl.postIn(
      tx,
      ctx,
      entityId,
      {
        type: 'purchase_invoice',
        id: invoice.id,
        purpose: 'main',
        number: invoice.number,
        currency: invoice.currency,
        exchangeRate: invoice.exchangeRate,
      },
      invoice.postingDate,
      lines.plan(),
    );
  }
  async salesIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    invoice: typeof salesInvoice.$inferSelect,
  ) {
    const settings = await this.gl.active(tx, entityId);
    if (!settings) return;
    const lines = new Lines(settings.mappings),
      rate = Dec.of(invoice.exchangeRate);
    lines.add('debtors', Dec.of(invoice.grandTotal ?? '0').mul(rate), {
      partyId: invoice.customerId,
      billReference: invoice.number ?? invoice.id,
    });
    lines.add(
      'sales',
      Dec.of(invoice.taxableValue ?? '0')
        .mul(rate)
        .neg(),
    );
    for (const tax of ['cgst', 'sgst', 'igst', 'cess'] as const)
      lines.add(
        `output_${tax}`,
        Dec.of(invoice[tax] ?? '0')
          .mul(rate)
          .neg(),
        { gstRegistrationId: invoice.gstRegistrationId ?? undefined },
      );
    await this.gl.postIn(
      tx,
      ctx,
      entityId,
      {
        type: 'sales_invoice',
        id: invoice.id,
        purpose: 'main',
        number: invoice.number,
        currency: invoice.currency,
        exchangeRate: invoice.exchangeRate,
      },
      invoice.invoiceDate,
      lines.plan(),
    );
  }
  async landedIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    voucher: typeof landedCostVoucher.$inferSelect,
    chargesInventory: string,
    chargesConsumed: string,
    taxCost: { inventory: string; consumed: string; rounding: string },
    chargesRounding: string,
  ) {
    const settings = await this.gl.active(tx, entityId);
    if (!settings) return;
    const lines = new Lines(settings.mappings);
    lines.add('inventory', Dec.of(chargesInventory).add(taxCost.inventory));
    lines.add('production', Dec.of(chargesConsumed).add(taxCost.consumed));
    lines.add('rounding', Dec.of(chargesRounding).add(taxCost.rounding));
    lines.add('landed_clearing', Dec.of(voucher.totalCharges ?? '0').neg());
    for (const tax of ['igst', 'cess'] as const) {
      const amount = Dec.of(
        tax === 'igst'
          ? (voucher.importIgst ?? '0')
          : (voucher.importCess ?? '0'),
      );
      if (voucher.customsItcEligible) lines.add(`input_${tax}`, amount);
      lines.add('customs_clearing', amount.neg());
    }
    await this.gl.postIn(
      tx,
      ctx,
      entityId,
      {
        type: 'landed_cost',
        id: voucher.id,
        purpose: 'main',
        number: voucher.number,
      },
      voucher.postingDate,
      lines.plan(),
    );
  }
  async cancelPurchaseIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    invoiceId: string,
    reason: string,
  ) {
    await this.gl.reverseIn(
      tx,
      ctx,
      entityId,
      { type: 'purchase_invoice', id: invoiceId, purpose: 'main' },
      reason,
    );
    if (!(await this.gl.active(tx, entityId))) return;
    await this.cost.reverseIn(tx, ctx, entityId, {
      type: 'purchase_invoice',
      id: invoiceId,
      purpose: 'main',
    });
    await this.allocation.reverseIn(tx, ctx, entityId, invoiceId);
  }
}
