// Phase 3b studio memberships (decision 056): plans (a pool of machine-hours for a term) and customers' memberships,
// whose fee is invoiced upfront as a draft through the sales invoice path. Bookings draw hours at billing.
import { maasTermEnd } from '@factoryos/core';
import { item, maasBooking, maasMembership, maasMembershipDraw, maasPlan, party, salesInvoice, type Database, user } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql, sum } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf, type Tx } from '../accounting/accounting-lock.js';
import { SellingController } from '../selling.controller.js';
import { StockPostingService } from '../stock-posting.service.js';
import { membershipDrawn } from './memberships.js';

const planInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,29}$/, 'Up to 30 letters, digits, . _ -'),
  name: z.string().trim().min(2).max(120),
  includedHours: z.number().int().min(1).max(10000),
  termMonths: z.number().int().min(1).max(60),
  fee: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Rupees with up to 2 decimals')),
  serviceItemId: z.uuid(),
});
const membershipInput = z.object({ customerId: z.uuid(), planId: z.uuid(), startsOn: z.iso.date(), invoiceDate: z.iso.date().optional() });
const reasonInput = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });

@Controller('services')
export class MembershipsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
    private readonly selling: SellingController,
  ) {}

  // ── Plans ──

  @Get('plans')
  @RequirePermission('services.membership.read')
  async plans(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const rows = await this.db
      .select({ p: maasPlan, itemCode: item.code })
      .from(maasPlan)
      .innerJoin(item, eq(item.id, maasPlan.serviceItemId))
      .where(eq(maasPlan.entityId, entityId))
      .orderBy(desc(maasPlan.isActive), asc(maasPlan.code));
    return rows.map((r) => ({ ...r.p, itemCode: r.itemCode }));
  }

  @Post('plans')
  @RequirePermission('services.membership.create')
  async createPlan(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(planInput, body);
    const [svc] = await this.db.select().from(item).where(and(eq(item.id, input.serviceItemId), eq(item.tenantId, ctx.tenant.tenantId)));
    if (!svc) throw new NotFoundException('Service item not found');
    if (svc.type !== 'service') throw new BadRequestException(`${svc.code} is not a service item; the plan fee is billed as a service (SAC)`);
    const [dup] = await this.db.select({ id: maasPlan.id }).from(maasPlan).where(and(eq(maasPlan.entityId, entityId), eq(maasPlan.code, input.code)));
    if (dup) throw new ConflictException(`Plan ${input.code} already exists`);
    const [p] = await this.db
      .insert(maasPlan)
      .values({ tenantId: ctx.tenant.tenantId, entityId, code: input.code, name: input.name, includedMinutes: input.includedHours * 60, termMonths: input.termMonths, fee: input.fee, serviceItemId: input.serviceItemId, createdBy: ctx.user.id })
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_plan.create', targetType: 'maas_plan', targetId: p!.id, after: input });
    return p!;
  }

  @Post('plans/:id/deactivate')
  @RequirePermission('services.membership.update')
  async deactivatePlan(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [p] = await this.db.update(maasPlan).set({ isActive: false, updatedAt: new Date() }).where(and(eq(maasPlan.id, id), eq(maasPlan.entityId, entityId))).returning();
    if (!p) throw new NotFoundException('Plan not found');
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_plan.deactivate', targetType: 'maas_plan', targetId: id });
    return { ok: true };
  }

  // ── Memberships ──

  @Get('memberships')
  @RequirePermission('services.membership.read')
  async memberships(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { customerId } = parse(z.object({ customerId: z.uuid().optional() }), query);
    const rows = await this.db
      .select({ m: maasMembership, customerName: party.name, planCode: maasPlan.code, planName: maasPlan.name, invoiceNumber: salesInvoice.number, invoiceStatus: salesInvoice.status })
      .from(maasMembership)
      .innerJoin(party, eq(party.id, maasMembership.customerId))
      .innerJoin(maasPlan, eq(maasPlan.id, maasMembership.planId))
      .leftJoin(salesInvoice, eq(salesInvoice.id, maasMembership.salesInvoiceId))
      .where(and(eq(maasMembership.entityId, entityId), customerId ? eq(maasMembership.customerId, customerId) : undefined))
      .orderBy(desc(maasMembership.startsOn))
      .limit(500);
    const used = await this.usedByMembership(rows.map((r) => r.m.id));
    return rows.map((r) => {
      const usedMinutes = used.get(r.m.id) ?? 0;
      return { ...r.m, customerName: r.customerName, planCode: r.planCode, planName: r.planName, invoiceNumber: r.invoiceNumber, invoiceStatus: r.invoiceStatus, usedMinutes, remainingMinutes: r.m.includedMinutes - usedMinutes };
    });
  }

  @Get('memberships/:id')
  @RequirePermission('services.membership.read')
  async membership(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [r] = await this.db
      .select({ m: maasMembership, customerName: party.name, planCode: maasPlan.code, planName: maasPlan.name, invoiceNumber: salesInvoice.number, invoiceStatus: salesInvoice.status })
      .from(maasMembership)
      .innerJoin(party, eq(party.id, maasMembership.customerId))
      .innerJoin(maasPlan, eq(maasPlan.id, maasMembership.planId))
      .leftJoin(salesInvoice, eq(salesInvoice.id, maasMembership.salesInvoiceId))
      .where(and(eq(maasMembership.id, id), eq(maasMembership.entityId, entityId)));
    if (!r) throw new NotFoundException('Membership not found');
    const draws = await this.db
      .select({ id: maasMembershipDraw.id, bookingId: maasMembershipDraw.bookingId, bookingNumber: maasBooking.number, minutes: maasMembershipDraw.minutes, reversalOf: maasMembershipDraw.reversalOf, reason: maasMembershipDraw.reason, createdAt: maasMembershipDraw.createdAt, createdBy: user.name })
      .from(maasMembershipDraw)
      .innerJoin(maasBooking, eq(maasBooking.id, maasMembershipDraw.bookingId))
      .innerJoin(user, eq(user.id, maasMembershipDraw.createdBy))
      .where(eq(maasMembershipDraw.membershipId, id))
      .orderBy(asc(maasMembershipDraw.createdAt));
    const usedMinutes = draws.reduce((s, d) => s + d.minutes, 0);
    return { ...r.m, customerName: r.customerName, planCode: r.planCode, planName: r.planName, invoiceNumber: r.invoiceNumber, invoiceStatus: r.invoiceStatus, draws, usedMinutes, remainingMinutes: r.m.includedMinutes - usedMinutes };
  }

  /** A membership for one term; its fee becomes a draft invoice in the same transaction (none for a free plan). */
  @Post('memberships')
  @RequirePermission('services.membership.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(membershipInput, body);
    const [plan] = await this.db.select().from(maasPlan).where(and(eq(maasPlan.id, input.planId), eq(maasPlan.entityId, entityId)));
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.isActive) throw new BadRequestException(`Plan ${plan.code} is no longer offered`);
    const [cust] = await this.db.select().from(party).where(and(eq(party.id, input.customerId), eq(party.tenantId, ctx.tenant.tenantId)));
    if (!cust) throw new NotFoundException('Customer not found');
    if (!cust.isCustomer) throw new BadRequestException(`${cust.name} is not a customer`);
    const endsOn = maasTermEnd(input.startsOn, plan.termMonths);
    const free = Number(plan.fee) === 0;
    if (!free && !ctx.tenant.permissions.has('selling.sales_invoice.create')) throw new BadRequestException('Raising the fee invoice needs permission to create sales invoices');
    let created: typeof maasMembership.$inferSelect | null = null;
    const insert = async (tx: Tx, invoiceId: string | null) => {
      // One membership per customer at a time: overlapping terms are refused under a per-customer lock.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`maas-membership:${input.customerId}`}))`);
      const [clash] = await tx
        .select({ number: maasMembership.number, startsOn: maasMembership.startsOn, endsOn: maasMembership.endsOn })
        .from(maasMembership)
        .where(and(eq(maasMembership.entityId, entityId), eq(maasMembership.customerId, input.customerId), eq(maasMembership.status, 'active'), lte(maasMembership.startsOn, endsOn), gte(maasMembership.endsOn, input.startsOn)))
        .limit(1);
      if (clash) throw new ConflictException(`${cust.name} already holds ${clash.number} (${clash.startsOn} to ${clash.endsOn}); start the new term after it ends`);
      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'maas_membership', businessDate());
      const [m] = await tx
        .insert(maasMembership)
        .values({ tenantId: ctx.tenant.tenantId, entityId, number, customerId: input.customerId, planId: plan.id, startsOn: input.startsOn, endsOn, includedMinutes: plan.includedMinutes, fee: plan.fee, salesInvoiceId: invoiceId, createdBy: ctx.user.id })
        .returning();
      created = m!;
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_membership.create', targetType: 'maas_membership', targetId: m!.id, after: { number, plan: plan.code, startsOn: input.startsOn, endsOn, invoiceId } }, tx);
    };
    if (free) await this.db.transaction((tx) => insert(tx, null));
    else
      await this.selling.createDraftInvoice(
        ctx,
        entityId,
        {
          customerId: input.customerId,
          invoiceDate: input.invoiceDate ?? businessDate(),
          remarks: `Studio membership ${plan.code}`,
          lines: [{ itemId: plan.serviceItemId, description: `${plan.name}: ${plan.includedMinutes / 60} machine-hours, ${input.startsOn} to ${endsOn}`, qty: '1', rate: plan.fee }],
        },
        insert,
      );
    return created!;
  }

  /** Cancel a membership that has no hours drawn (net of reversals); its fee invoice is handled in selling. */
  @Post('memberships/:id/cancel')
  @RequirePermission('services.membership.update')
  async cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(reasonInput, body);
    return this.db.transaction(async (tx) => {
      const [m] = await tx.select().from(maasMembership).where(and(eq(maasMembership.id, id), eq(maasMembership.entityId, entityId))).for('update');
      if (!m) throw new NotFoundException('Membership not found');
      if (m.status !== 'active') throw new ConflictException('The membership is already cancelled');
      const used = await membershipDrawn(tx, id);
      if (used > 0) throw new ConflictException(`${used / 60} hours are already drawn; reverse those bookings' billing first`);
      await tx.update(maasMembership).set({ status: 'cancelled', cancelReason: reason, updatedAt: new Date() }).where(eq(maasMembership.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_membership.cancel', targetType: 'maas_membership', targetId: id, after: { reason } }, tx);
      return { ok: true };
    });
  }

  private async usedByMembership(ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await this.db.select({ id: maasMembershipDraw.membershipId, total: sum(maasMembershipDraw.minutes) }).from(maasMembershipDraw).where(inArray(maasMembershipDraw.membershipId, ids)).groupBy(maasMembershipDraw.membershipId);
    return new Map(rows.map((r) => [r.id, Number(r.total ?? 0)]));
  }
}
