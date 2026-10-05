import { Dec } from '@factoryos/core';
import {
  accountingSettings,
  item,
  openingWorksheet,
  purchaseInvoiceLine,
  purchaseOrder,
  purchaseOrderLine,
  receiptInvoiceAllocation,
  stockEntry,
  stockEntryLine,
} from '@factoryos/db';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { Tx } from './accounting-lock.js';
export interface ReceiptAllocation {
  invoiceLineId: string;
  receiptLineId: string;
  qty: string;
  baseCost: string;
  poRate: string;
  poExchangeRate: string;
}
@Injectable()
export class ReceiptAllocationService {
  async allocateIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    invoiceId: string,
  ): Promise<ReceiptAllocation[]> {
    const [settings] = await tx
      .select()
      .from(accountingSettings)
      .where(eq(accountingSettings.entityId, entityId));
    const [opening] = await tx
      .select()
      .from(openingWorksheet)
      .where(eq(openingWorksheet.entityId, entityId));
    const lines = await tx
      .select({ line: purchaseInvoiceLine, item })
      .from(purchaseInvoiceLine)
      .innerJoin(item, eq(item.id, purchaseInvoiceLine.itemId))
      .where(eq(purchaseInvoiceLine.invoiceId, invoiceId));
    const result: ReceiptAllocation[] = [];
    for (const { line, item: it } of lines) {
      if (!it.isStockItem) continue;
      if (!line.poLineId)
        throw new BadRequestException(
          'Stock invoices require a PO and submitted goods receipt when accounting is active',
        );
      const receipts = await tx
        .select({
          line: stockEntryLine,
          entry: stockEntry,
          poLine: purchaseOrderLine,
          po: purchaseOrder,
        })
        .from(stockEntryLine)
        .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
        .innerJoin(
          purchaseOrderLine,
          eq(purchaseOrderLine.id, stockEntryLine.poLineId),
        )
        .innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.poId))
        .where(
          and(
            eq(stockEntry.entityId, entityId),
            eq(stockEntry.status, 'submitted'),
            eq(stockEntry.purpose, 'receipt'),
            eq(stockEntryLine.poLineId, line.poLineId),
            isNull(stockEntryLine.ownerPartyId),
          ),
        )
        .orderBy(
          asc(stockEntry.postingDate),
          asc(stockEntry.createdAt),
          asc(stockEntryLine.lineNo),
        );
      let remaining = Dec.of(line.qty);
      for (const r of receipts) {
        const baseline = opening?.receiptBaselines.find(
          (b) => b.receiptLineId === r.line.id,
        );
        const historical =
          settings?.activatedAt &&
          r.entry.submittedAt &&
          r.entry.submittedAt <= settings.activatedAt;
        const totalQty = historical
          ? Dec.of(baseline?.qty ?? '0')
          : Dec.of(r.line.qty);
        const allocations = await tx
          .select()
          .from(receiptInvoiceAllocation)
          .where(
            and(
              eq(receiptInvoiceAllocation.entityId, entityId),
              eq(receiptInvoiceAllocation.receiptLineId, r.line.id),
            ),
          );
        const used = allocations.reduce((s, a) => s.add(a.qty), Dec.ZERO),
          available = totalQty.sub(used);
        if (!available.gt('0')) continue;
        const take = remaining.gt(available) ? available : remaining;
        const baseRate = Dec.of(r.line.value ?? '0').div(r.line.qty);
        const allocation = {
          invoiceLineId: line.id,
          receiptLineId: r.line.id,
          qty: take.toString(),
          baseCost: take.mul(baseRate).toString(),
          poRate: r.poLine.rate,
          poExchangeRate: r.po.exchangeRate,
        };
        await tx.insert(receiptInvoiceAllocation).values({
          tenantId: ctx.tenant.tenantId,
          entityId,
          invoiceId,
          receiptLineId: allocation.receiptLineId,
          qty: allocation.qty,
          baseCost: allocation.baseCost,
          poRate: allocation.poRate,
          poExchangeRate: allocation.poExchangeRate,
        });
        result.push(allocation);
        remaining = remaining.sub(take);
        if (remaining.isZero()) break;
      }
      if (!remaining.isZero())
        throw new ConflictException(
          `Insufficient unbilled receipt allocation for invoice line ${line.lineNo}`,
        );
    }
    return result;
  }
  async reverseIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    invoiceId: string,
  ) {
    const rows = await tx
      .select()
      .from(receiptInvoiceAllocation)
      .where(
        and(
          eq(receiptInvoiceAllocation.entityId, entityId),
          eq(receiptInvoiceAllocation.invoiceId, invoiceId),
          isNull(receiptInvoiceAllocation.reversalOf),
        ),
      );
    for (const r of rows)
      await tx.insert(receiptInvoiceAllocation).values({
        tenantId: ctx.tenant.tenantId,
        entityId,
        invoiceId,
        receiptLineId: r.receiptLineId,
        qty: Dec.of(r.qty).neg().toString(),
        baseCost: Dec.of(r.baseCost).neg().toString(),
        poRate: r.poRate,
        poExchangeRate: r.poExchangeRate,
        reversalOf: r.id,
      });
  }
}
