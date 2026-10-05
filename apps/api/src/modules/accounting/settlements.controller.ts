import { type Database, partySettlement, settlementAllocationDocument, settlementAllocationEffect } from '@factoryos/db';
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf, lockAccounting } from './accounting-lock.js';
import { SettlementService } from './settlement.service.js';
export const decimal = z.string().regex(/^\d{1,18}(\.\d{1,6})?$/, 'Decimal string with at most 18 whole digits and six places');
export const allocations = z.array(z.object({ billId: z.uuid(), amount: decimal })).max(200);
export const settlementInput = z.object({ direction: z.enum(['receipt','payment']), partyId: z.uuid(), postingDate: z.iso.date(), currency: z.string().regex(/^[A-Z]{3}$/), exchangeRate: decimal, accountId: z.uuid(), amount: decimal, bankReference: z.string().trim().max(120), narration: z.string().trim().min(5).max(1000), allocations });
const cancellation = z.object({ reason: z.string().trim().min(5).max(1000) });
@Controller('accounts/settlements')
export class SettlementsController {
  constructor(@Inject(DB) private readonly db: Database, private readonly settlements: SettlementService) {}
  @Get()
  @RequirePermission('accounts.settlement.read')
  async list(@Ctx() ctx: TenantRequestContext) { return this.db.select().from(partySettlement).where(and(eq(partySettlement.entityId, entityOf(ctx)), eq(partySettlement.tenantId, ctx.tenant.tenantId))).orderBy(desc(partySettlement.createdAt)); }
  @Get(':id')
  @RequirePermission('accounts.settlement.read')
  async detail(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.transaction(async tx => {
      const entityId = entityOf(ctx); await lockAccounting(tx, entityId);
      const d = await this.settlements.documentIn(tx, ctx, entityId, id);
      const allocationDocuments = await tx.select().from(settlementAllocationDocument).where(and(eq(settlementAllocationDocument.entityId, entityId), eq(settlementAllocationDocument.settlementId, id)));
      const allocationEffects = await tx.select().from(settlementAllocationEffect).where(and(eq(settlementAllocationEffect.entityId, entityId), eq(settlementAllocationEffect.settlementId, id)));
      return { ...d, allocationDocuments, allocationEffects };
    });
  }
  @Post('preview')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.create')
  async preview(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) { const input = parse(settlementInput, body); return this.db.transaction(tx => this.settlements.previewIn(tx, ctx, entityOf(ctx), input)); }
  @Post()
  @RequirePermission('accounts.settlement.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) { const input = parse(settlementInput, body); return this.db.transaction(tx => this.settlements.saveIn(tx, ctx, entityOf(ctx), null, input)); }
  @Put(':id')
  @RequirePermission('accounts.settlement.update')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { const input = parse(settlementInput, body); return this.db.transaction(tx => this.settlements.saveIn(tx, ctx, entityOf(ctx), id, input)); }
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.submit')
  async submit(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) { return this.db.transaction(tx => this.settlements.submitIn(tx, ctx, entityOf(ctx), id)); }
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.cancel')
  async cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { const { reason } = parse(cancellation, body); await this.db.transaction(tx => this.settlements.cancelIn(tx, ctx, entityOf(ctx), id, reason)); return { ok: true }; }
}
