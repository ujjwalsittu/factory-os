import { Dec } from '@factoryos/core';
import { accountingSettings, purchaseInvoice, salesInvoice, tradeBill, type Database } from '@factoryos/db';
import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { entityOf } from './accounting-lock.js';
import { BillService } from './bill.service.js';
import { BillInitializationService } from './bill-initialization.service.js';
@Controller()
export class OperationalBillBalancesController {
  constructor(@Inject(DB) private readonly db: Database, private readonly bills: BillService, private readonly initialization: BillInitializationService) {}
  @Get('sales-invoices/:id/balance')
  @RequirePermission('selling.sales_invoice.read')
  sales(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) { return this.balance(ctx, id, 'sales_invoice'); }
  @Get('purchase-invoices/:id/balance')
  @RequirePermission('buying.purchase_invoice.read')
  purchases(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) { return this.balance(ctx, id, 'purchase_invoice'); }
  private async balance(ctx: TenantRequestContext, id: string, type: 'sales_invoice' | 'purchase_invoice') {
    return this.db.transaction(async tx => {
      const entityId = entityOf(ctx), table = type === 'sales_invoice' ? salesInvoice : purchaseInvoice;
      const [invoice] = await tx.select({ status: table.status, currency: table.currency, exchangeRate: table.exchangeRate, grandTotal: table.grandTotal }).from(table).where(and(eq(table.id, id), eq(table.entityId, entityId), eq(table.tenantId, ctx.tenant.tenantId)));
      if (!invoice) throw new NotFoundException('Invoice not found in this entity');
      await this.initialization.ensureIn(tx, ctx, entityId);
      const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
      if (!settings?.active) {
        const amount = invoice.status === 'submitted' ? Dec.of(invoice.grandTotal ?? '0') : Dec.ZERO;
        return { active: false, currency: invoice.currency, openAmount: amount.toString(), carryingInr: amount.mul(invoice.exchangeRate).toString() };
      }
      const identities = await tx.select().from(tradeBill).where(and(eq(tradeBill.entityId, entityId), eq(tradeBill.tenantId, ctx.tenant.tenantId), eq(tradeBill.sourceType, type), eq(tradeBill.sourceId, id)));
      let open = Dec.ZERO, carrying = Dec.ZERO;
      for (const b of identities) { const balance = await this.bills.balanceIn(tx, ctx, entityId, b.id); open = open.add(balance.openAmount); carrying = carrying.add(balance.carryingInr); }
      return { active: true, currency: invoice.currency, openAmount: open.toString(), carryingInr: carrying.toString() };
    });
  }
}
