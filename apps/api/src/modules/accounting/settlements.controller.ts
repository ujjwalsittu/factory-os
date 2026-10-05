import { Dec } from '@factoryos/core';
import {
  accountingSettings,
  glAccount,
  party,
  type Database,
  partySettlement,
  settlementAllocationDocument,
  settlementAllocationEffect,
  tradeBill,
} from '@factoryos/db';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  Ctx,
  RequirePermission,
  TenantScoped,
  type TenantRequestContext,
} from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf, lockAccounting } from './accounting-lock.js';
import { SettlementService } from './settlement.service.js';
export const decimal = z
  .string()
  .regex(
    /^\d{1,18}(\.\d{1,6})?$/,
    'Decimal string with at most 18 whole digits and six places',
  );
export const allocations = z
  .array(z.object({ billId: z.uuid(), amount: decimal }))
  .max(200);
export const settlementInput = z.object({
  direction: z.enum(['receipt', 'payment']),
  partyId: z.uuid(),
  postingDate: z.iso.date(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  exchangeRate: decimal,
  accountId: z.uuid(),
  amount: decimal,
  bankReference: z.string().trim().max(120),
  narration: z.string().trim().min(5).max(1000),
  allocations,
});
const cancellation = z.object({ reason: z.string().trim().min(5).max(1000) });
@Controller('accounts/settlements')
export class SettlementsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settlements: SettlementService,
  ) {}
  @Get()
  @RequirePermission('accounts.settlement.read')
  async list(@Ctx() ctx: TenantRequestContext) {
    return this.db
      .select()
      .from(partySettlement)
      .where(
        and(
          eq(partySettlement.entityId, entityOf(ctx)),
          eq(partySettlement.tenantId, ctx.tenant.tenantId),
        ),
      )
      .orderBy(desc(partySettlement.createdAt));
  }
  @Get('choices')
  @TenantScoped()
  async choices(@Ctx() ctx: TenantRequestContext) {
    if (
      ![
        'accounts.settlement.read',
        'accounts.settlement.create',
        'accounts.settlement.update',
      ].some((p) => ctx.tenant.permissions.has(p))
    )
      throw new ForbiddenException('Settlement permission required');
    return this.db.transaction(async (tx) => {
      const entityId = entityOf(ctx);
      const [s] = await tx
        .select()
        .from(accountingSettings)
        .where(
          and(
            eq(accountingSettings.entityId, entityId),
            eq(accountingSettings.tenantId, ctx.tenant.tenantId),
          ),
        );
      const parties = await tx
        .select({
          id: party.id,
          code: party.code,
          name: party.name,
          isCustomer: party.isCustomer,
          isSupplier: party.isSupplier,
          isActive: party.isActive,
        })
        .from(party)
        .where(eq(party.tenantId, ctx.tenant.tenantId));
      const accounts = (
        await this.settlements.cashBankAccountsIn(tx, ctx, entityId)
      ).map((a) => ({
        id: a.id,
        name: a.name,
        code: a.code,
        isActive: a.isActive,
      }));
      return {
        active: s?.active ?? false,
        cutoverDate: s?.cutoverDate ?? null,
        parties,
        accounts,
      };
    });
  }
  @Get(':id/export')
  @RequirePermission('accounts.settlement.export')
  async export(
    @Ctx() ctx: TenantRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.detail(ctx, id);
  }
  @Get(':id')
  @RequirePermission('accounts.settlement.read')
  async detail(
    @Ctx() ctx: TenantRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.db.transaction(async (tx) => {
      const entityId = entityOf(ctx);
      await lockAccounting(tx, entityId);
      const d = await this.settlements.documentIn(tx, ctx, entityId, id);
      const allocationDocuments = await tx
        .select()
        .from(settlementAllocationDocument)
        .where(
          and(
            eq(settlementAllocationDocument.entityId, entityId),
            eq(settlementAllocationDocument.settlementId, id),
          ),
        );
      const allocationEffects = await tx
        .select()
        .from(settlementAllocationEffect)
        .where(
          and(
            eq(settlementAllocationEffect.entityId, entityId),
            eq(settlementAllocationEffect.settlementId, id),
          ),
        );
      const [p] = await tx
        .select({ name: party.name })
        .from(party)
        .where(
          and(
            eq(party.id, d.draft.partyId),
            eq(party.tenantId, ctx.tenant.tenantId),
          ),
        );
      const [account] = await tx
        .select({ name: glAccount.name })
        .from(glAccount)
        .where(
          and(
            eq(glAccount.id, d.draft.accountId),
            eq(glAccount.entityId, entityId),
          ),
        );
      const bills = await tx
        .select({ id: tradeBill.id, reference: tradeBill.reference })
        .from(tradeBill)
        .where(
          and(
            eq(tradeBill.entityId, entityId),
            eq(tradeBill.tenantId, ctx.tenant.tenantId),
          ),
        );
      const inline = allocationEffects.filter(
        (a) => !a.reversalOf && !a.allocationDocumentId,
      );
      const allocated = inline.reduce((s, a) => s.add(a.amount), Dec.ZERO),
        carrying = inline.reduce((s, a) => s.add(a.carryingInr), Dec.ZERO),
        amount = Dec.of(d.draft.amount),
        rate = Dec.of(d.draft.exchangeRate),
        unapplied = amount.sub(allocated),
        cash = amount.mul(rate);
      const forex =
        d.draft.direction === 'receipt'
          ? carrying.sub(allocated.mul(rate))
          : allocated.mul(rate).sub(carrying);
      const net =
        d.draft.direction === 'receipt'
          ? cash.sub(carrying).sub(unapplied.mul(rate)).add(forex)
          : carrying.add(unapplied.mul(rate)).sub(cash).add(forex);
      const postedPreview =
        d.status === 'draft'
          ? null
          : {
              amount: amount.toString(),
              allocated: allocated.toString(),
              unapplied: unapplied.toString(),
              cashInr: cash.toString(),
              carryingInr: carrying.toString(),
              forexInr: forex.toString(),
              roundingInr: net.neg().toString(),
              lines: [],
            };
      return {
        ...d,
        partyName: p?.name ?? 'Unknown party',
        accountName: account?.name ?? 'Unknown account',
        allocationDocuments,
        allocationEffects: allocationEffects.map((a) => ({
          ...a,
          billReference: bills.find((b) => b.id === a.billId)?.reference,
        })),
        postedPreview,
        available: await this.settlements.availableIn(
          tx,
          ctx,
          entityId,
          d.onAccountBillId,
        ),
      };
    });
  }
  @Post('preview')
  @HttpCode(200)
  @TenantScoped()
  async preview(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    if (
      ![
        'accounts.settlement.create',
        'accounts.settlement.update',
        'accounts.settlement.submit',
      ].some((p) => ctx.tenant.permissions.has(p))
    )
      throw new ForbiddenException('Settlement preview permission required');
    const input = parse(settlementInput, body);
    return this.db.transaction((tx) =>
      this.settlements.previewIn(tx, ctx, entityOf(ctx), input),
    );
  }
  @Post()
  @RequirePermission('accounts.settlement.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const input = parse(settlementInput, body);
    return this.db.transaction((tx) =>
      this.settlements.saveIn(tx, ctx, entityOf(ctx), null, input),
    );
  }
  @Put(':id')
  @RequirePermission('accounts.settlement.update')
  async update(
    @Ctx() ctx: TenantRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = parse(settlementInput, body);
    return this.db.transaction((tx) =>
      this.settlements.saveIn(tx, ctx, entityOf(ctx), id, input),
    );
  }
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.submit')
  async submit(
    @Ctx() ctx: TenantRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.db.transaction((tx) =>
      this.settlements.submitIn(tx, ctx, entityOf(ctx), id),
    );
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.cancel')
  async cancel(
    @Ctx() ctx: TenantRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { reason } = parse(cancellation, body);
    await this.db.transaction((tx) =>
      this.settlements.cancelIn(tx, ctx, entityOf(ctx), id, reason),
    );
    return { ok: true };
  }
}
