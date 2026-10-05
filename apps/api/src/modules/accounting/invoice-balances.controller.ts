import { Dec } from '@factoryos/core';
import { accountingSettings, purchaseInvoice, salesInvoice, tradeBill, type Database } from '@factoryos/db';
import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { entityOf, lockAccounting } from './accounting-lock.js';
import { BillService } from './bill.service.js';

@Controller()
export class InvoiceBalancesController {
  constructor(@Inject(DB) private readonly db: Database, private readonly bills: BillService) {}

  @Get('sales-invoices/:id/balance')
  @RequirePermission('selling.sales_invoice.read')
  sales(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.balance(ctx, id, 'sales_invoice');
  }

  @Get('purchase-invoices/:id/balance')
  @RequirePermission('buying.purchase_invoice.read')
  purchases(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.balance(ctx, id, 'purchase_invoice');
  }

  private balance(ctx: TenantRequestContext, id: string, type: 'sales_invoice' | 'purchase_invoice') {
    return this.db.transaction(async tx => {
      const entityId = entityOf(ctx), tenantId = ctx.tenant.tenantId;
      await lockAccounting(tx, entityId);
      const table = type === 'sales_invoice' ? salesInvoice : purchaseInvoice;
      const [invoice] = await tx.select({ status: table.status, currency: table.currency, total: table.grandTotal }).from(table).where(and(eq(table.id, id), eq(table.tenantId, tenantId), eq(table.entityId, entityId)));
      if (!invoice) throw new NotFoundException('Invoice not found in this entity');
      const [settings] = await tx.select().from(accountingSettings).where(and(eq(accountingSettings.tenantId, tenantId), eq(accountingSettings.entityId, entityId)));
      if (!settings?.active) return { active: false, currency: invoice.currency, openAmount: invoice.status === 'submitted' ? Dec.of(invoice.total ?? '0').toString() : '0.000000', carryingInr: null };
      await this.bills.syncIn(tx, ctx, entityId);
      const identities = await tx.select({ id: tradeBill.id }).from(tradeBill).where(and(eq(tradeBill.tenantId, tenantId), eq(tradeBill.entityId, entityId), eq(tradeBill.sourceType, type), eq(tradeBill.sourceId, id)));
      const balances = await this.bills.list(tx, entityId, { billIds: identities.map(b => b.id) });
      return { active: true, currency: invoice.currency, openAmount: balances.reduce((s,b) => s.add(b.openAmount), Dec.ZERO).toString(), carryingInr: balances.reduce((s,b) => s.add(b.carryingInr), Dec.ZERO).toString() };
    });
  }
}
