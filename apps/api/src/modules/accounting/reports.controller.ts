import { type Database } from '@factoryos/db';
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  Ctx,
  RequirePermission,
  type TenantRequestContext,
} from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf } from './accounting-lock.js';
import { accountLedger, accountingStatus, dayBook, trialBalance } from '../readers/accounting-reports.read.js';

const scope = (ctx: TenantRequestContext) => ({ tenantId: ctx.tenant.tenantId, entityId: entityOf(ctx) });
const filters = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    partyId: z.uuid().optional(),
    accountId: z.uuid().optional(),
  })
  .refine(
    (q) => !q.from || !q.to || q.from <= q.to,
    'Start date must not be after end date',
  );
@Controller('accounts/reports')
export class AccountingReportsController {
  constructor(@Inject(DB) private readonly db: Database) {}
  @Get('status')
  @RequirePermission('accounts.report.read')
  async status(@Ctx() ctx: TenantRequestContext) {
    return accountingStatus(this.db, scope(ctx));
  }
  @Get('trial-balance')
  @RequirePermission('accounts.report.read')
  async trial(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    return trialBalance(this.db, scope(ctx), parse(filters, query));
  }
  @Get('ledger')
  @RequirePermission('accounts.report.read')
  async ledger(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const q = parse(filters, query);
    if (!q.accountId) throw new NotFoundException('Choose an account');
    const result = await accountLedger(this.db, scope(ctx), { ...q, accountId: q.accountId });
    if (!result) throw new NotFoundException('Account not found');
    return result;
  }
  @Get('day-book')
  @RequirePermission('accounts.report.read')
  async dayBook(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    return dayBook(this.db, scope(ctx), parse(filters, query));
  }
  @Get('trial-balance/export')
  @RequirePermission('accounts.report.export')
  exportTrial(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.trial(ctx, query);
  }
  @Get('ledger/export')
  @RequirePermission('accounts.report.export')
  exportLedger(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.ledger(ctx, query);
  }
  @Get('day-book/export')
  @RequirePermission('accounts.report.export')
  async exportDayBook(
    @Ctx() ctx: TenantRequestContext,
    @Query() query: unknown,
  ) {
    const q = parse(filters, query);
    return {
      accounting: await this.status(ctx),
      from: q.from ?? null,
      to: q.to ?? null,
      currency: 'INR',
      precision: 6,
      vouchers: await this.dayBook(ctx, query),
    };
  }
}
