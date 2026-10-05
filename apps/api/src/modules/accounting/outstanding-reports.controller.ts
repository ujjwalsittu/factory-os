import { Inject, Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { accountingSettings, party, type Database } from '@factoryos/db';
import { Dec } from '@factoryos/core';
import { and, eq } from 'drizzle-orm';
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
  @Get('outstanding')
  @RequirePermission('accounts.report.read')
  async outstanding(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) { return this.outstandingData(ctx, query); }
  @Get('outstanding/export')
  @RequirePermission('accounts.report.export')
  async export(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) { return this.outstandingData(ctx, query); }
  private async outstandingData(ctx: TenantRequestContext, query: unknown) {
    const filters = parse(z.object({ partyId: z.uuid().optional(), side: z.enum(['receivable','payable']).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), asOf: z.iso.date().optional(), overdue: z.enum(['true','false']).optional(), msme: z.enum(['true','false']).optional() }), query);
    return this.db.transaction(async tx => {
      const entityId = entityOf(ctx), asOf = filters.asOf ?? businessDate();
      await this.initialization.ensureIn(tx, ctx, entityId);
      const [settings] = await tx.select().from(accountingSettings).where(and(eq(accountingSettings.entityId, entityId), eq(accountingSettings.tenantId, ctx.tenant.tenantId)));
      const parties = await tx.select().from(party).where(eq(party.tenantId, ctx.tenant.tenantId));
      const bills = await this.bills.listIn(tx, ctx, entityId, { ...filters, asOf, overdue: filters.overdue === 'true', msme: filters.msme === 'true' });
      const rows = bills.map(b => {
        const ageDays = b.dueDate ? Math.max(0, Math.trunc((Date.parse(asOf) - Date.parse(b.dueDate)) / 86400000)) : null;
        const ageingBucket = ageDays === null ? 'Unclassified' : ageDays === 0 ? 'Not due' : ageDays <= 30 ? '1–30' : ageDays <= 60 ? '31–60' : ageDays <= 90 ? '61–90' : '>90';
        return { ...b, partyName: parties.find(p => p.id === b.partyId)?.name ?? 'Unknown party', ageDays, ageingBucket, kind: Dec.of(b.openAmount).lt('0') ? 'On account / journal credit' : b.sourceType === 'manual' ? 'Journal bill' : 'Bill' };
      });
      const totals = new Map<string, { partyId: string; partyName: string; side: string; gross: Dec; credits: Dec }>();
      for (const r of rows) {
        const key = `${r.partyId}:${r.side}`;
        const t = totals.get(key) ?? { partyId: r.partyId, partyName: r.partyName, side: r.side, gross: Dec.ZERO, credits: Dec.ZERO };
        if (Dec.of(r.carryingInr).lt('0')) t.credits = t.credits.sub(r.carryingInr); else t.gross = t.gross.add(r.carryingInr);
        totals.set(key, t);
      }
      return { active: settings?.active ?? false, cutoverDate: settings?.cutoverDate ?? null, asOf, rows, positions: [...totals.values()].map(t => ({ partyId: t.partyId, partyName: t.partyName, side: t.side, grossOpenInr: t.gross.toString(), onAccountInr: t.credits.toString(), netInr: t.gross.sub(t.credits).toString() })), msmeBasis: 'MSME due dates use stored supplier invoice dates and terms; acceptance-date statutory compliance and MSME-1/43B(h) calculations are not covered. Unlinked openings without metadata remain unclassified.' };
    });
  }
}
