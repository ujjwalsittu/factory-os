import { type Database, settlementAllocationDocument } from '@factoryos/db';
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf, lockAccounting } from './accounting-lock.js';
import { allocations } from './settlements.controller.js';
import { SettlementAllocationService } from './settlement-allocation.service.js';
const input = z.object({ settlementId: z.uuid(), postingDate: z.iso.date(), reason: z.string().trim().min(5).max(1000), allocations });
@Controller('accounts/settlement-allocations')
export class SettlementAllocationsController {
  constructor(@Inject(DB) private readonly db: Database, private readonly allocation: SettlementAllocationService) {}
  @Get()
  @RequirePermission('accounts.settlement.read')
  async list(@Ctx() ctx: TenantRequestContext) { return this.db.select().from(settlementAllocationDocument).where(and(eq(settlementAllocationDocument.entityId, entityOf(ctx)), eq(settlementAllocationDocument.tenantId, ctx.tenant.tenantId))).orderBy(desc(settlementAllocationDocument.createdAt)); }
  @Get(':id')
  @RequirePermission('accounts.settlement.read')
  async detail(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) { return this.db.transaction(async tx => { const entityId = entityOf(ctx); await lockAccounting(tx, entityId); return this.allocation.documentIn(tx, ctx, entityId, id); }); }
  @Post('preview')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.create')
  async preview(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) { const data = parse(input, body); return this.db.transaction(tx => this.allocation.previewIn(tx, ctx, entityOf(ctx), data)); }
  @Post()
  @RequirePermission('accounts.settlement.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) { const data = parse(input, body); return this.db.transaction(tx => this.allocation.createIn(tx, ctx, entityOf(ctx), data)); }
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.submit')
  async submit(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) { return this.db.transaction(tx => this.allocation.submitIn(tx, ctx, entityOf(ctx), id)); }
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.cancel')
  async cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(1000) }), body); await this.db.transaction(tx => this.allocation.cancelIn(tx, ctx, entityOf(ctx), id, reason)); return { ok: true }; }
}
