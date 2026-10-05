import { Dec } from '@factoryos/core';
import { type Database, glAccount, journalVoucher, party, partySettlement, settlementAllocationDocument } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Header, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf, lockAccounting } from './accounting-lock.js';
import { BillService, type TradeSide } from './bill.service.js';
import { SettlementService } from './settlement.service.js';

const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount with up to 2 decimals'));
const rate = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,6})?$/, 'Rate with up to 6 decimals'));
const allocation = z.object({ billId: z.string().uuid(), amount: money });
const settlementInput = z.object({
  direction: z.enum(['receipt', 'payment']),
  partyId: z.string().uuid(),
  postingDate: z.string().date(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('INR'),
  exchangeRate: rate.default('1'),
  accountId: z.string().uuid(),
  amount: money,
  bankReference: z.string().trim().max(60).nullable().optional(),
  narration: z.string().trim().max(500).nullable().optional(),
  allocations: z.array(allocation).max(200).default([]),
});
const allocationInput = z.object({
  settlementId: z.string().uuid(),
  postingDate: z.string().date(),
  reason: z.string().trim().min(3).max(500),
  allocations: z.array(allocation).min(1).max(200),
});
const reasonInput = z.object({ reason: z.string().trim().min(5).max(500) });
const BUCKETS = [
  { key: 'not_due', label: 'Not due', max: 0 },
  { key: '1_30', label: '1–30 days', max: 30 },
  { key: '31_60', label: '31–60 days', max: 60 },
  { key: '61_90', label: '61–90 days', max: 90 },
  { key: 'over_90', label: 'Over 90 days', max: Infinity },
] as const;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Customer receipts, supplier payments, later allocations and bill-wise outstanding (decision 036). */
@Controller('accounts')
export class SettlementsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settlements: SettlementService,
    private readonly bills: BillService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── bills ─────────────────────────

  /** Open bills of a party for the allocation picker (brings the subledger up to date first). */
  @Get('bills')
  @RequirePermission('accounts.settlement.read')
  async openBills(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const f = parse(z.object({ partyId: z.string().uuid(), side: z.enum(['receivable', 'payable']), currency: z.string().optional(), kind: z.enum(['bill', 'advance']).default('bill') }), query);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      await this.bills.syncIn(tx, ctx, entityId);
      return (await this.bills.list(tx, entityId, { partyId: f.partyId, side: f.side, ...(f.currency && { currency: f.currency }), kind: [f.kind], openOnly: true })).filter((b) => Dec.of(b.openAmount).gt('0'));
    });
  }

  // ───────────────────────── receipts and payments ─────────────────────────

  @Get('settlements')
  @RequirePermission('accounts.settlement.read')
  async list(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const f = parse(z.object({ direction: z.enum(['receipt', 'payment']).optional(), status: z.enum(['draft', 'submitted', 'cancelled']).optional(), partyId: z.string().uuid().optional() }), query);
    const where: SQL[] = [eq(partySettlement.entityId, entityId)];
    if (f.direction) where.push(eq(partySettlement.direction, f.direction));
    if (f.status) where.push(eq(partySettlement.status, f.status));
    if (f.partyId) where.push(eq(partySettlement.partyId, f.partyId));
    const rows = await this.db
      .select({ s: partySettlement, partyName: party.name, accountName: glAccount.name })
      .from(partySettlement)
      .innerJoin(party, eq(party.id, partySettlement.partyId))
      .innerJoin(glAccount, eq(glAccount.id, partySettlement.accountId))
      .where(and(...where))
      .orderBy(desc(partySettlement.createdAt))
      .limit(500);
    return rows.map((r) => ({ ...r.s, partyName: r.partyName, accountName: r.accountName, allocated: r.s.allocations.reduce((x, a) => x.add(a.amount), Dec.ZERO).toFixed(2) }));
  }

  @Get('settlements/:id')
  @RequirePermission('accounts.settlement.read')
  async get(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [r] = await this.db
      .select({ s: partySettlement, partyName: party.name, accountName: glAccount.name })
      .from(partySettlement)
      .innerJoin(party, eq(party.id, partySettlement.partyId))
      .innerJoin(glAccount, eq(glAccount.id, partySettlement.accountId))
      .where(and(eq(partySettlement.id, id), eq(partySettlement.entityId, entityId)));
    if (!r) throw new NotFoundException('Receipt or payment not found');
    const billIds = [...r.s.allocations.map((a) => a.billId), ...(r.s.advanceBillId ? [r.s.advanceBillId] : [])];
    const bills = await this.bills.list(this.db, entityId, { billIds });
    const later = await this.db.select().from(settlementAllocationDocument).where(eq(settlementAllocationDocument.settlementId, id)).orderBy(desc(settlementAllocationDocument.createdAt));
    const vouchers = await this.db
      .select({ id: journalVoucher.id, number: journalVoucher.number, reversalOf: journalVoucher.reversalOf })
      .from(journalVoucher)
      .where(and(eq(journalVoucher.entityId, entityId), eq(journalVoucher.sourceType, 'settlement'), eq(journalVoucher.sourceId, id)));
    return {
      ...r.s,
      partyName: r.partyName,
      accountName: r.accountName,
      allocations: r.s.allocations.map((a) => ({ ...a, reference: bills.find((b) => b.id === a.billId)?.reference ?? null })),
      advance: bills.find((b) => b.id === r.s.advanceBillId) ?? null,
      laterAllocations: later,
      vouchers,
    };
  }

  @Post('settlements/preview')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.read')
  async preview(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(settlementInput, body);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      await this.bills.syncIn(tx, ctx, entityId);
      return this.settlements.previewIn(tx, ctx, entityId, input);
    });
  }

  @Post('settlements')
  @RequirePermission('accounts.settlement.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(settlementInput, body);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      await this.bills.syncIn(tx, ctx, entityId);
      await this.settlements.previewIn(tx, ctx, entityId, input);
      const [s] = await tx
        .insert(partySettlement)
        .values({ ...input, bankReference: input.bankReference ?? null, narration: input.narration ?? null, tenantId: ctx.tenant.tenantId, entityId, createdBy: ctx.user.id })
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: `${input.direction}.create`, targetType: 'party_settlement', targetId: s!.id, after: input }, tx);
      return s;
    });
  }

  @Put('settlements/:id')
  @RequirePermission('accounts.settlement.create')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(settlementInput, body);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const [s] = await tx.select().from(partySettlement).where(and(eq(partySettlement.id, id), eq(partySettlement.entityId, entityId))).for('update');
      if (!s) throw new NotFoundException('Receipt or payment not found');
      if (s.status !== 'draft') throw new ConflictException('Submitted documents are not editable');
      if (s.direction !== input.direction) throw new BadRequestException('A receipt cannot become a payment');
      await this.bills.syncIn(tx, ctx, entityId);
      await this.settlements.previewIn(tx, ctx, entityId, input);
      await tx.update(partySettlement).set({ ...input, bankReference: input.bankReference ?? null, narration: input.narration ?? null, updatedAt: new Date() }).where(eq(partySettlement.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: `${input.direction}.update`, targetType: 'party_settlement', targetId: id, after: input }, tx);
      return { ok: true };
    });
  }

  @Delete('settlements/:id')
  @RequirePermission('accounts.settlement.create')
  async remove(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [s] = await this.db.delete(partySettlement).where(and(eq(partySettlement.id, id), eq(partySettlement.entityId, entityId), eq(partySettlement.status, 'draft'))).returning();
    if (!s) throw new ConflictException('Only drafts can be deleted');
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: `${s.direction}.delete_draft`, targetType: 'party_settlement', targetId: id });
    return { ok: true };
  }

  @Post('settlements/:id/submit')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.submit')
  async submit(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction((tx) => this.settlements.submitIn(tx, ctx, entityId, id));
  }

  @Post('settlements/:id/cancel')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.cancel')
  async cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(reasonInput, body);
    await this.db.transaction((tx) => this.settlements.cancelIn(tx, ctx, entityId, id, reason));
    return { ok: true };
  }

  // ───────────────────────── later allocations ─────────────────────────

  @Get('settlement-allocations/:id')
  @RequirePermission('accounts.settlement.read')
  async getAllocation(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [d] = await this.db.select().from(settlementAllocationDocument).where(and(eq(settlementAllocationDocument.id, id), eq(settlementAllocationDocument.entityId, entityId)));
    if (!d) throw new NotFoundException('Allocation not found');
    const bills = await this.bills.list(this.db, entityId, { billIds: d.allocations.map((a) => a.billId) });
    return { ...d, allocations: d.allocations.map((a) => ({ ...a, reference: bills.find((b) => b.id === a.billId)?.reference ?? null })) };
  }

  @Post('settlement-allocations/preview')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.read')
  async previewAllocation(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(allocationInput, body);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      await this.bills.syncIn(tx, ctx, entityId);
      return this.settlements.allocationPreviewIn(tx, ctx, entityId, input);
    });
  }

  /** Allocations are created and submitted in one step; a rejected one is simply recreated. */
  @Post('settlement-allocations')
  @RequirePermission('accounts.settlement.submit')
  async allocate(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(allocationInput, body);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      await this.bills.syncIn(tx, ctx, entityId);
      await this.settlements.allocationPreviewIn(tx, ctx, entityId, input);
      const [d] = await tx.insert(settlementAllocationDocument).values({ ...input, tenantId: ctx.tenant.tenantId, entityId, createdBy: ctx.user.id }).returning();
      return this.settlements.allocationSubmitIn(tx, ctx, entityId, d!.id);
    });
  }

  @Post('settlement-allocations/:id/cancel')
  @HttpCode(200)
  @RequirePermission('accounts.settlement.cancel')
  async cancelAllocation(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(reasonInput, body);
    await this.db.transaction((tx) => this.settlements.allocationCancelIn(tx, ctx, entityId, id, reason));
    return { ok: true };
  }

  // ───────────────────────── outstanding, ageing, reconciliation ─────────────────────────

  private async outstanding(ctx: TenantRequestContext, query: unknown) {
    const entityId = entityOf(ctx);
    const f = parse(
      z.object({
        side: z.enum(['receivable', 'payable']).default('receivable'),
        partyId: z.string().uuid().optional(),
        currency: z.string().trim().toUpperCase().optional(),
        asOf: z.string().date().optional(),
        overdue: z.enum(['true']).optional(),
        msme: z.enum(['true']).optional(),
      }),
      query,
    );
    const asOf = f.asOf ?? businessDate();
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      await this.bills.syncIn(tx, ctx, entityId);
      const all = await this.bills.list(tx, entityId, { side: f.side as TradeSide, ...(f.partyId && { partyId: f.partyId }), ...(f.currency && { currency: f.currency }), asOf, openOnly: true });
      const names = new Map((all.length ? await tx.select({ id: party.id, name: party.name }).from(party).where(inArray(party.id, [...new Set(all.map((b) => b.partyId))])) : []).map((p) => [p.id, p.name]));
      const rows = all
        .filter((b) => b.kind === 'bill' && Dec.of(b.carryingInr).gt('0'))
        .map((b) => {
          const overdueDays = b.dueDate ? Math.max(0, daysBetween(b.dueDate, asOf)) : 0;
          const bucket = BUCKETS.find((x) => overdueDays <= x.max)!;
          return { ...b, partyName: names.get(b.partyId) ?? '', overdueDays, bucket: bucket.key, msmeUnclassified: f.side === 'payable' && !b.dueDate };
        })
        .filter((b) => (!f.overdue || b.overdueDays > 0) && (!f.msme || ['micro', 'small'].includes(b.msmeCategory ?? '')));
      const onAccount = all.filter((b) => b.kind !== 'bill' && Dec.of(b.carryingInr).gt('0')).map((b) => ({ ...b, partyName: names.get(b.partyId) ?? '' }));
      const sum = (xs: { carryingInr: string }[]) => xs.reduce((s, x) => s.add(x.carryingInr), Dec.ZERO);
      const gross = sum(rows);
      const credits = sum(onAccount);
      return {
        side: f.side,
        asOf,
        bills: rows,
        onAccount,
        buckets: BUCKETS.map((b) => ({ key: b.key, label: b.label, inr: sum(rows.filter((r) => r.bucket === b.key)).toFixed(2) })),
        totals: { grossInr: gross.toFixed(2), onAccountInr: credits.toFixed(2), netInr: gross.sub(credits).toFixed(2) },
        note: f.side === 'payable' ? 'MSME due dates come from supplier invoice dates (acceptance dates are not recorded); this is balance visibility, not a Sec 43B(h) / MSME-1 computation.' : null,
      };
    });
  }

  @Get('outstanding')
  @RequirePermission('accounts.report.read')
  async outstandingReport(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.outstanding(ctx, query);
  }

  @Get('outstanding/export')
  @RequirePermission('accounts.report.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async outstandingExport(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const r = await this.outstanding(ctx, query);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Party', 'Reference', 'Kind', 'Currency', 'Open amount', 'Carrying INR', 'Recognised', 'Due', 'Days overdue', 'Bucket'];
    const body = [...r.bills, ...r.onAccount.map((b) => ({ ...b, overdueDays: '', bucket: 'on_account' }))].map((b) => [b.partyName, b.reference, b.kind, b.currency, b.openAmount, b.carryingInr, b.recognitionDate, b.dueDate ?? '', b.overdueDays, b.bucket].map(esc).join(','));
    return [`# ${r.side} outstanding as of ${r.asOf} (exact six-place values)`, head.map(esc).join(','), ...body].join('\n');
  }

  @Get('trade-reconciliation')
  @RequirePermission('accounts.report.read')
  async reconciliation(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      await this.bills.syncIn(tx, ctx, entityId);
      const rows = await this.bills.reconciliation(tx, entityId);
      const names = new Map((rows.length ? await tx.select({ id: party.id, name: party.name }).from(party).where(inArray(party.id, [...new Set(rows.map((r) => r.partyId).filter((x): x is string => !!x))])) : []).map((p) => [p.id, p.name]));
      return rows.map((r) => ({ ...r, partyName: r.partyId ? (names.get(r.partyId) ?? '') : null }));
    });
  }
}
