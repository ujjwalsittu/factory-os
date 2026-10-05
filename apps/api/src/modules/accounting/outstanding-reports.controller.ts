import { Inject, Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { type Database } from '@factoryos/db';
import { z } from 'zod';
import { Ctx, RequirePermission, TenantScoped, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf } from './accounting-lock.js';
import { BillService } from './bill.service.js';
import { BillInitializationService } from './bill-initialization.service.js';
@Controller('accounts')
export class OutstandingReportsController {
  constructor(@Inject(DB) private readonly db: Database, private readonly bills: BillService, private readonly initialization: BillInitializationService) {}
  @Get('bills')
  @TenantScoped()
  async list(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    if (!['accounts.settlement.read', 'accounts.voucher.read', 'accounts.report.read'].some(p => ctx.tenant.permissions.has(p))) throw new ForbiddenException('Settlement, journal or accounting report read permission required');
    const filters = parse(z.object({ partyId: z.uuid().optional(), side: z.enum(['receivable', 'payable']).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), asOf: z.iso.date().optional() }), query);
    return this.db.transaction(async tx => {
      const entityId = entityOf(ctx);
      await this.initialization.ensureIn(tx, ctx, entityId);
      return this.bills.listIn(tx, ctx, entityId, { ...filters, asOf: filters.asOf ?? businessDate() });
    });
  }
  @Get('trade-reconciliation')
  @RequirePermission('accounts.report.read')
  async reconciliation(@Ctx() ctx: TenantRequestContext) {
    return this.db.transaction(async tx => {
      const entityId = entityOf(ctx);
      await this.initialization.ensureIn(tx, ctx, entityId);
      return this.bills.reconciliationIn(tx, ctx, entityId);
    });
  }
}
