// Phase 3e EarthNow subscriptions (decision 059): a plan is a prepaid bundle of reports and alerts per period. The
// period fee is invoiced in advance; reports and alerts beyond the bundle are overage on the next invoice; an upgrade
// applies at once with its fee difference prorated by days, a downgrade from the next period.
import { Dec, subscriptionOverage, type SubscriptionPeriod, subscriptionPeriodEnd, subscriptionPeriodIndex, subscriptionPeriodStart, subscriptionProration } from '@factoryos/core';
import { item, party, salesInvoice, subscription, subscriptionDelivery, subscriptionInvoice, subscriptionPlan, subscriptionPlanChange, type Database, user } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf, type Tx } from '../accounting/accounting-lock.js';
import { SellingController } from '../selling.controller.js';
import { StockPostingService } from '../stock-posting.service.js';
import type { Billable } from './billables.js';

const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Rupees with up to 2 decimals'));
const planInput = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(120),
  solution: z.string().trim().min(2).max(120),
  period: z.enum(['month', 'quarter', 'year']),
  fee: money,
  includedReports: z.number().int().min(0).max(10000),
  includedAlerts: z.number().int().min(0).max(100000),
  reportRate: money.default('0'),
  alertRate: money.default('0'),
  serviceItemId: z.uuid(),
});
const subscribeInput = z.object({
  customerId: z.uuid(),
  planId: z.uuid(),
  customerRef: z.string().trim().max(100).nullable().optional(),
  aoiName: z.string().trim().min(2).max(200),
  aoiHectares: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Hectares with up to 2 decimals'))
    .refine((v) => Number(v) > 0, 'More than zero')
    .nullable()
    .optional(),
  aoiNotes: z.string().trim().max(2000).nullable().optional(),
  startDate: z.iso.date(),
});
const changeInput = z.object({ planId: z.uuid() });
const deliveryInput = z.object({ kind: z.enum(['report', 'alert']), deliveredOn: z.iso.date().optional(), title: z.string().trim().min(2).max(300), reference: z.string().trim().max(200).nullable().optional() });
const reasonInput = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });
const invoiceInput = z.object({ invoiceDate: z.iso.date().optional(), gstRegistrationId: z.uuid().nullable().optional() });

/** A period's fee can be invoiced up to this many days before it starts. */
const ADVANCE_DAYS = 7;
const LIVE = (s: string | null | undefined) => s === 'draft' || s === 'submitted';
type Plan = typeof subscriptionPlan.$inferSelect;
type Sub = typeof subscription.$inferSelect;

/** A PostgreSQL unique violation (23505) on `constraint`, as raised directly or wrapped by the query builder. */
const uniqueViolation = (e: unknown, constraint: string): boolean => {
  const err = e as { code?: string; constraint?: string; constraint_name?: string; cause?: unknown } | null;
  if (!err || typeof err !== 'object') return false;
  if (err.code === '23505' && (err.constraint ?? err.constraint_name) === constraint) return true;
  return err.cause ? uniqueViolation(err.cause, constraint) : false;
};

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

@Controller('services')
export class SubscriptionsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
    private readonly selling: SellingController,
  ) {}

  // ── Plans ──

  @Get('subscription-plans')
  @RequirePermission('services.subscription.read')
  async plans(@Ctx() ctx: TenantRequestContext) {
    return this.db
      .select({ p: subscriptionPlan, itemCode: item.code })
      .from(subscriptionPlan)
      .innerJoin(item, eq(item.id, subscriptionPlan.serviceItemId))
      .where(eq(subscriptionPlan.entityId, entityOf(ctx)))
      .orderBy(desc(subscriptionPlan.isActive), asc(subscriptionPlan.code))
      .then((rows) => rows.map((r) => ({ ...r.p, itemCode: r.itemCode })));
  }

  @Post('subscription-plans')
  @RequirePermission('services.subscription.create')
  async createPlan(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(planInput, body);
    const [svc] = await this.db.select().from(item).where(and(eq(item.id, input.serviceItemId), eq(item.tenantId, ctx.tenant.tenantId)));
    if (!svc) throw new NotFoundException('Service item not found');
    if (svc.type !== 'service') throw new BadRequestException(`${svc.code} is not a service item; subscriptions are billed as a service (SAC)`);
    const [dup] = await this.db.select({ id: subscriptionPlan.id }).from(subscriptionPlan).where(and(eq(subscriptionPlan.entityId, entityId), eq(subscriptionPlan.code, input.code)));
    if (dup) throw new ConflictException(`Plan ${input.code} already exists`);
    const [p] = await this.db.insert(subscriptionPlan).values({ tenantId: ctx.tenant.tenantId, entityId, ...input, createdBy: ctx.user.id }).returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'subscription_plan.create', targetType: 'subscription_plan', targetId: p!.id, after: input });
    return p!;
  }

  @Post('subscription-plans/:id/stop')
  @RequirePermission('services.subscription.update')
  async stopPlan(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [p] = await this.db.update(subscriptionPlan).set({ isActive: false, updatedAt: new Date() }).where(and(eq(subscriptionPlan.id, id), eq(subscriptionPlan.entityId, entityId))).returning();
    if (!p) throw new NotFoundException('Plan not found');
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'subscription_plan.stop', targetType: 'subscription_plan', targetId: id });
    return { ok: true };
  }

  // ── Subscriptions ──

  @Get('subscriptions')
  @RequirePermission('services.subscription.read')
  async list(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const rows = await this.db
      .select({ s: subscription, customerName: party.name })
      .from(subscription)
      .innerJoin(party, eq(party.id, subscription.customerId))
      .where(eq(subscription.entityId, entityId))
      .orderBy(desc(subscription.createdAt))
      .limit(500);
    const out = [];
    for (const r of rows) {
      const st = await this.state(this.db, r.s);
      out.push({ ...r.s, customerName: r.customerName, planName: st.planNow.name, planCode: st.planNow.code, solution: st.planNow.solution, next: st.next });
    }
    return out;
  }

  @Get('subscriptions/:id')
  @RequirePermission('services.subscription.read')
  async get(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const s = await this.find(this.db, entityOf(ctx), id);
    const [c] = await this.db.select({ name: party.name }).from(party).where(eq(party.id, s.customerId));
    const st = await this.state(this.db, s);
    const recorder = alias(user, 'recorder');
    const deliveries = await this.db
      .select({ d: subscriptionDelivery, recordedBy: recorder.name })
      .from(subscriptionDelivery)
      .innerJoin(recorder, eq(recorder.id, subscriptionDelivery.createdBy))
      .where(eq(subscriptionDelivery.subscriptionId, id))
      .orderBy(desc(subscriptionDelivery.deliveredOn), desc(subscriptionDelivery.createdAt));
    const reversed = new Set(deliveries.map((d) => d.d.reversalOf).filter(Boolean));
    return {
      ...s,
      customerName: c?.name ?? '',
      plan: st.planNow,
      pendingChange: st.pending,
      today: st.today,
      periods: st.periods,
      next: st.next,
      changes: st.changes.map((ch) => ({
        ...ch,
        fromPlan: st.planById.get(ch.fromPlanId)?.name ?? '',
        toPlan: st.planById.get(ch.toPlanId)?.name ?? '',
        prorationInvoiced: !!ch.salesInvoiceId && st.liveInvoices.has(ch.salesInvoiceId),
      })),
      deliveries: deliveries.map((d) => ({ ...d.d, recordedBy: d.recordedBy, reversed: reversed.has(d.d.id) })),
      invoices: st.invoiceRows,
    };
  }

  @Post('subscriptions')
  @RequirePermission('services.subscription.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(subscribeInput, body);
    const [c] = await this.db.select().from(party).where(and(eq(party.id, input.customerId), eq(party.tenantId, ctx.tenant.tenantId)));
    if (!c) throw new NotFoundException('Customer not found');
    if (!c.isCustomer) throw new BadRequestException(`${c.name} is not a customer`);
    // Back-dating covers a subscription agreed before it is entered; each past period then falls due in turn.
    if (input.startDate < addDays(businessDate(), -366)) throw new BadRequestException('A subscription starts at most a year back');
    const duplicate = () => new ConflictException(`${c.name} already subscribes for ${input.aoiName}`);
    return this.db.transaction(async (tx) => {
      const plan = await this.planIn(tx, entityId, input.planId);
      if (!plan.isActive) throw new ConflictException(`Plan ${plan.code} is no longer offered`);
      const same = await tx
        .select({ number: subscription.number })
        .from(subscription)
        .where(and(eq(subscription.entityId, entityId), eq(subscription.customerId, input.customerId), eq(subscription.aoiName, input.aoiName), eq(subscription.status, 'active')))
        .for('update');
      if (same.length) throw new ConflictException(`${c.name} already subscribes for ${input.aoiName} (${same[0]!.number})`);
      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'subscription', businessDate());
      const [s] = await tx
        .insert(subscription)
        .values({ tenantId: ctx.tenant.tenantId, entityId, number, customerId: input.customerId, customerRef: input.customerRef ?? null, planId: plan.id, aoiName: input.aoiName, aoiHectares: input.aoiHectares ?? null, aoiNotes: input.aoiNotes ?? null, startDate: input.startDate, createdBy: ctx.user.id })
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'subscription.create', targetType: 'subscription', targetId: s!.id, after: { number, ...input } }, tx);
      return s!;
    }).catch((e: unknown) => {
      // A concurrent request for the same customer and AOI won the unique index.
      if (uniqueViolation(e, 'subscription_active_aoi_uq')) throw duplicate();
      throw e;
    });
  }

  /** Upgrade at once (fee difference prorated on the next invoice); downgrade or same fee from the next period. */
  @Post('subscriptions/:id/change-plan')
  @RequirePermission('services.subscription.update')
  async changePlan(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { planId } = parse(changeInput, body);
    let result: { effectiveOn: string; prorationAmount: string } = { effectiveOn: '', prorationAmount: '0.00' };
    await this.transition(ctx, id, 'subscription.change_plan', async (tx, s) => {
      if (s.status !== 'active') throw new ConflictException('A cancelled subscription keeps its plan');
      const st = await this.state(tx, s);
      if (st.pending) throw new ConflictException(`A change to ${st.pending.toPlan} from ${st.pending.effectiveOn} is already pending`);
      const to = await this.planIn(tx, entityId, planId);
      if (!to.isActive) throw new ConflictException(`Plan ${to.code} is no longer offered`);
      const from = st.planNow;
      if (to.id === from.id) throw new ConflictException('That is the current plan');
      if (to.period !== from.period) throw new BadRequestException('Change to a plan with the same billing period');
      const today = st.today;
      const k = subscriptionPeriodIndex(s.startDate, from.period, today);
      let effectiveOn: string;
      let prorationAmount = '0.00';
      if (k < 0) effectiveOn = s.startDate;
      else if (Dec.of(to.fee).gt(from.fee)) {
        effectiveOn = today;
        const start = subscriptionPeriodStart(s.startDate, from.period, k);
        const feeInvoiced = st.periods.find((p) => p.index === k)?.feeInvoice;
        // On the first day of a period not yet invoiced, the new fee is simply invoiced for the whole period.
        if (feeInvoiced || effectiveOn > start) prorationAmount = subscriptionProration(from.fee, to.fee, start, subscriptionPeriodEnd(s.startDate, from.period, k), effectiveOn);
      } else effectiveOn = subscriptionPeriodStart(s.startDate, from.period, k + 1);
      await tx.insert(subscriptionPlanChange).values({ subscriptionId: id, fromPlanId: from.id, toPlanId: to.id, effectiveOn, prorationAmount, createdBy: ctx.user.id });
      await tx.update(subscription).set({ planId: to.id, updatedAt: new Date() }).where(eq(subscription.id, id));
      result = { effectiveOn, prorationAmount };
    }, { planId });
    return result;
  }

  @Post('subscriptions/:id/deliveries')
  @RequirePermission('services.subscription.update')
  async deliver(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(deliveryInput, body);
    let created: unknown;
    await this.transition(ctx, id, 'subscription.delivery', async (tx, s) => {
      const st = await this.state(tx, s);
      const on = input.deliveredOn ?? st.today;
      if (on > st.today) throw new BadRequestException('A delivery can’t be dated in the future');
      this.deliverable(s, st, on);
      [created] = await tx.insert(subscriptionDelivery).values({ tenantId: s.tenantId, subscriptionId: id, kind: input.kind, deliveredOn: on, title: input.title, reference: input.reference ?? null, createdBy: ctx.user.id }).returning();
    }, input);
    return created;
  }

  @Post('subscription-deliveries/:did/reverse')
  @RequirePermission('services.subscription.update')
  async reverse(@Ctx() ctx: TenantRequestContext, @Param('did', ParseUUIDPipe) did: string, @Body() body: unknown) {
    const { reason } = parse(reasonInput, body);
    const [d] = await this.db
      .select({ d: subscriptionDelivery })
      .from(subscriptionDelivery)
      .innerJoin(subscription, eq(subscription.id, subscriptionDelivery.subscriptionId))
      .where(and(eq(subscriptionDelivery.id, did), eq(subscription.entityId, entityOf(ctx))));
    if (!d) throw new NotFoundException('Delivery not found');
    await this.transition(ctx, d.d.subscriptionId, 'subscription.delivery_reverse', async (tx, s) => {
      if (d.d.reversalOf) throw new ConflictException('A reversal is not reversed');
      const [done] = await tx.select({ id: subscriptionDelivery.id }).from(subscriptionDelivery).where(eq(subscriptionDelivery.reversalOf, did));
      if (done) throw new ConflictException('Already reversed');
      const st = await this.state(tx, s);
      this.overageOpen(s, st, d.d.deliveredOn);
      await tx.insert(subscriptionDelivery).values({ tenantId: s.tenantId, subscriptionId: s.id, kind: d.d.kind, deliveredOn: d.d.deliveredOn, title: `Reversal: ${reason}`, reference: d.d.reference, reversalOf: did, createdBy: ctx.user.id });
    }, { did, reason });
    return { ok: true };
  }

  /** One draft invoice: the next period's fee (when due), overage of ended periods, and upgrade prorations. */
  @Post('subscriptions/:id/invoice')
  @RequirePermission('services.billing.create', 'selling.sales_invoice.create')
  async invoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(invoiceInput, body);
    const b = await this.subscriptionBillable(ctx, id);
    const inv = await this.selling.createDraftInvoice(
      ctx,
      entityId,
      { customerId: b.customerId, invoiceDate: input.invoiceDate ?? businessDate(), gstRegistrationId: input.gstRegistrationId ?? null, customerPoNo: b.customerRef, remarks: b.remarks, lines: b.lines },
      b.settle,
    );
    return { invoiceId: inv.id, lines: b.lines.length };
  }

  /** What the next invoice of a subscription would carry (decision 060); refused when nothing is due. */
  async subscriptionBillable(ctx: TenantRequestContext, id: string): Promise<Billable> {
    const entityId = entityOf(ctx);
    const s = await this.find(this.db, entityId, id);
    const bill = this.bill(await this.state(this.db, s), s);
    if (!bill.lines.length) throw new ConflictException(bill.nothing);
    return {
      kind: 'subscription',
      sourceId: id,
      label: s.number,
      customerId: s.customerId,
      customerRef: s.customerRef ?? null,
      remarks: `Subscription ${s.number} · ${s.aoiName}`,
      lines: bill.lines.map((l) => l.line),
      amount: bill.lines.reduce((t, l) => t.add(l.amount), Dec.ZERO).toFixed(2),
      settle: async (tx, invoiceId) => {
        if (!invoiceId) throw new ConflictException(`Subscription ${s.number} needs an invoice`);
        const locked = await this.lock(tx, entityId, id);
        // Recompute under the lock: the same lines, or someone else invoiced or recorded meanwhile.
        const again = this.bill(await this.state(tx, locked), locked);
        if (JSON.stringify(again.lines.map((l) => l.line)) !== JSON.stringify(bill.lines.map((l) => l.line))) throw new ConflictException(`Subscription ${s.number} changed; reload`);
        for (const l of bill.lines) {
          if (l.kind === 'fee') await tx.insert(subscriptionInvoice).values({ subscriptionId: id, salesInvoiceId: invoiceId, feePeriodStart: l.periodStart, feeAmount: l.amount });
          else if (l.kind === 'overage') await tx.insert(subscriptionInvoice).values({ subscriptionId: id, salesInvoiceId: invoiceId, overagePeriodStart: l.periodStart, overageReports: l.reports, overageAlerts: l.alerts, overageAmount: l.amount });
          else {
            await tx.update(subscriptionPlanChange).set({ salesInvoiceId: invoiceId }).where(eq(subscriptionPlanChange.id, l.changeId));
            await tx.insert(subscriptionInvoice).values({ subscriptionId: id, salesInvoiceId: invoiceId, prorationAmount: l.amount });
          }
        }
        await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'subscription.invoice', targetType: 'subscription', targetId: id, after: { invoiceId, lines: bill.lines.map((l) => ({ kind: l.kind, amount: l.amount })) } }, tx);
      },
    };
  }

  /** Subscriptions with something to invoice today: a fee due, ended periods' overage or an upgrade proration. */
  async dueSubscriptionIds(entityId: string): Promise<string[]> {
    const rows = await this.db.select().from(subscription).where(eq(subscription.entityId, entityId)).orderBy(asc(subscription.number));
    const due: string[] = [];
    for (const s of rows) if (this.bill(await this.state(this.db, s), s).lines.length) due.push(s.id);
    return due;
  }

  /** Cancel at the end of the current (or last invoiced) period; before the start with nothing invoiced, at once. */
  @Post('subscriptions/:id/cancel')
  @RequirePermission('services.subscription.update')
  async cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { reason } = parse(reasonInput, body);
    let endDate = '';
    await this.transition(ctx, id, 'subscription.cancel', async (tx, s) => {
      if (s.status !== 'active') throw new ConflictException('Already cancelled');
      const st = await this.state(tx, s);
      const period = st.planNow.period;
      const lastInvoiced = Math.max(-1, ...st.periods.filter((p) => p.feeInvoice).map((p) => p.index));
      const k = Math.max(subscriptionPeriodIndex(s.startDate, period, st.today), lastInvoiced);
      endDate = k < 0 ? addDays(s.startDate, -1) : subscriptionPeriodEnd(s.startDate, period, k);
      await tx.update(subscription).set({ status: 'cancelled', endDate, cancelReason: reason, updatedAt: new Date() }).where(eq(subscription.id, id));
    }, { reason });
    return { ok: true, endDate };
  }

  // ── Read model ──

  /** Periods from the start to the next one due, with the plan, bundle, deliveries, overage and invoices of each. */
  private async state(db: Database | Tx, s: Sub) {
    const today = businessDate();
    const changes = await db.select().from(subscriptionPlanChange).where(eq(subscriptionPlanChange.subscriptionId, s.id)).orderBy(asc(subscriptionPlanChange.effectiveOn), asc(subscriptionPlanChange.createdAt));
    const planIds = [...new Set([s.planId, ...changes.flatMap((c) => [c.fromPlanId, c.toPlanId])])];
    const plans = await db.select().from(subscriptionPlan).where(inArray(subscriptionPlan.id, planIds));
    const planById = new Map(plans.map((p) => [p.id, p]));
    const original = planById.get(changes[0]?.fromPlanId ?? s.planId)!;
    /** Plan in force on a date; `forFee` skips a same-day upgrade that carries its own proration. */
    const planOn = (date: string, forFee = false) => {
      let p = original;
      for (const c of changes) if (c.effectiveOn < date || (c.effectiveOn === date && !(forFee && Dec.of(c.prorationAmount).gt('0')))) p = planById.get(c.toPlanId)!;
      return p;
    };
    const planNow = planOn(today);
    const pendingRow = changes.find((c) => c.effectiveOn > today);
    const pending = pendingRow ? { effectiveOn: pendingRow.effectiveOn, toPlan: planById.get(pendingRow.toPlanId)!.name } : null;
    const rows = await db
      .select({ r: subscriptionInvoice, number: salesInvoice.number, status: salesInvoice.status })
      .from(subscriptionInvoice)
      .leftJoin(salesInvoice, eq(salesInvoice.id, subscriptionInvoice.salesInvoiceId))
      .where(eq(subscriptionInvoice.subscriptionId, s.id));
    const live = rows.filter((r) => LIVE(r.status));
    const liveInvoices = new Set(live.map((r) => r.r.salesInvoiceId));
    const deliveries = await db.select().from(subscriptionDelivery).where(eq(subscriptionDelivery.subscriptionId, s.id));
    const period = original.period as SubscriptionPeriod;
    const feeRow = (start: string) => live.find((r) => r.r.feePeriodStart === start);
    const overageRow = (start: string) => live.find((r) => r.r.overagePeriodStart === start);
    const withinEnd = (start: string) => !s.endDate || start <= s.endDate;
    // Next period whose fee is not invoiced, within the subscription's end. A period of a free plan has no fee line
    // and counts as invoiced once it may be.
    const horizon = addDays(today, ADVANCE_DAYS);
    let n = 0;
    for (;;) {
      const start = subscriptionPeriodStart(s.startDate, period, n);
      if (!withinEnd(start)) break;
      if (feeRow(start) || (start <= horizon && Dec.of(planOn(start, true).fee).isZero())) n++;
      else break;
    }
    const nextStart = subscriptionPeriodStart(s.startDate, period, n);
    const last = Math.max(n, subscriptionPeriodIndex(s.startDate, period, s.endDate && s.endDate < today ? s.endDate : today));
    const periods = [];
    for (let k = 0; k <= last; k++) {
      const start = subscriptionPeriodStart(s.startDate, period, k);
      if (!withinEnd(start)) break;
      const end = subscriptionPeriodEnd(s.startDate, period, k);
      const bundle = planOn(end <= today ? end : today);
      const count = (kind: 'report' | 'alert') => deliveries.filter((d) => d.kind === kind && d.deliveredOn >= start && d.deliveredOn <= end).reduce((t, d) => t + (d.reversalOf ? -1 : 1), 0);
      const reports = count('report');
      const alerts = count('alert');
      const r = subscriptionOverage(reports, bundle.includedReports, bundle.reportRate);
      const a = subscriptionOverage(alerts, bundle.includedAlerts, bundle.alertRate);
      const fee = feeRow(start);
      const ov = overageRow(start);
      periods.push({
        index: k,
        start,
        end,
        feePlan: planOn(start, true).name,
        fee: planOn(start, true).fee,
        planId: bundle.id,
        planName: bundle.name,
        includedReports: bundle.includedReports,
        includedAlerts: bundle.includedAlerts,
        reportRate: bundle.reportRate,
        alertRate: bundle.alertRate,
        reports,
        alerts,
        overageReports: r.extra,
        overageAlerts: a.extra,
        overageAmount: Dec.of(r.amount).add(a.amount).toFixed(2),
        ended: end < today,
        feeInvoice: fee ? { id: fee.r.salesInvoiceId, number: fee.number, status: fee.status } : null,
        overageInvoice: ov ? { id: ov.r.salesInvoiceId, number: ov.number, status: ov.status } : null,
      });
    }
    const due = withinEnd(nextStart) && nextStart <= addDays(today, ADVANCE_DAYS);
    return {
      today,
      planById,
      planNow,
      pending,
      changes,
      periods,
      liveInvoices,
      planFeeOn: (date: string) => planOn(date, true),
      next: withinEnd(nextStart) ? { start: nextStart, end: subscriptionPeriodEnd(s.startDate, period, n), due } : null,
      invoiceRows: live.map((r) => ({ ...r.r, invoiceNumber: r.number, invoiceStatus: r.status })),
    };
  }

  /** What the next invoice would carry. */
  private bill(st: Awaited<ReturnType<SubscriptionsController['state']>>, s: Sub) {
    type Line = { itemId: string; description: string; qty: string; rate: string };
    const lines: ({ kind: 'fee'; periodStart: string; amount: string; line: Line } | { kind: 'overage'; periodStart: string; reports: number; alerts: number; amount: string; line: Line } | { kind: 'proration'; changeId: string; amount: string; line: Line })[] = [];
    if (st.next?.due) {
      const plan = st.planFeeOn(st.next.start);
      if (Dec.of(plan.fee).gt('0'))
        lines.push({ kind: 'fee', periodStart: st.next.start, amount: Dec.of(plan.fee).toFixed(2), line: { itemId: plan.serviceItemId, description: `${plan.name} (${plan.solution}) · ${s.aoiName} · ${st.next.start} to ${st.next.end}`, qty: '1', rate: plan.fee } });
    }
    for (const p of st.periods) {
      if (!p.ended || p.overageInvoice || !Dec.of(p.overageAmount).gt('0')) continue;
      const plan = st.planById.get(p.planId)!;
      const parts = [p.overageReports ? `${p.overageReports} report${p.overageReports === 1 ? '' : 's'}` : '', p.overageAlerts ? `${p.overageAlerts} alert${p.overageAlerts === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
      lines.push({
        kind: 'overage',
        periodStart: p.start,
        reports: p.overageReports,
        alerts: p.overageAlerts,
        amount: p.overageAmount,
        line: { itemId: plan.serviceItemId, description: `Beyond the bundle, ${p.start} to ${p.end}: ${parts} (${s.aoiName})`, qty: '1', rate: p.overageAmount },
      });
    }
    for (const c of st.changes) {
      if (!Dec.of(c.prorationAmount).gt('0') || (c.salesInvoiceId && st.liveInvoices.has(c.salesInvoiceId))) continue;
      const to = st.planById.get(c.toPlanId)!;
      lines.push({ kind: 'proration', changeId: c.id, amount: c.prorationAmount, line: { itemId: to.serviceItemId, description: `Upgrade from ${st.planById.get(c.fromPlanId)!.name} to ${to.name} from ${c.effectiveOn}, rest of that period (${s.aoiName})`, qty: '1', rate: c.prorationAmount } });
    }
    const nothing = st.next ? `Nothing to invoice yet: the period from ${st.next.start} can be invoiced from ${addDays(st.next.start, -ADVANCE_DAYS)}` : 'Nothing left to invoice';
    return { lines, nothing };
  }

  // ── helpers ──

  /** Deliveries fall inside the subscription and in a period whose overage isn't billed yet. */
  private deliverable(s: Sub, st: Awaited<ReturnType<SubscriptionsController['state']>>, on: string) {
    if (on < s.startDate) throw new BadRequestException(`The subscription starts on ${s.startDate}`);
    if (s.endDate && on > s.endDate) throw new ConflictException(`The subscription ended on ${s.endDate}`);
    this.overageOpen(s, st, on);
  }

  private overageOpen(s: Sub, st: Awaited<ReturnType<SubscriptionsController['state']>>, on: string) {
    const p = st.periods.find((x) => x.start <= on && on <= x.end);
    if (p?.overageInvoice) throw new ConflictException(`The overage for ${p.start} to ${p.end} is already invoiced on ${p.overageInvoice.number ?? 'a draft invoice'}`);
  }

  private async transition(ctx: TenantRequestContext, id: string, action: string, fn: (tx: Tx, s: Sub) => Promise<void>, after?: unknown) {
    const entityId = entityOf(ctx);
    await this.db.transaction(async (tx) => {
      const s = await this.lock(tx, entityId, id);
      await fn(tx, s);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action, targetType: 'subscription', targetId: id, after }, tx);
    });
  }

  private async lock(tx: Tx, entityId: string, id: string) {
    const [s] = await tx.select().from(subscription).where(and(eq(subscription.id, id), eq(subscription.entityId, entityId))).for('update');
    if (!s) throw new NotFoundException('Subscription not found');
    return s;
  }

  private async find(db: Database | Tx, entityId: string, id: string) {
    const [s] = await db.select().from(subscription).where(and(eq(subscription.id, id), eq(subscription.entityId, entityId)));
    if (!s) throw new NotFoundException('Subscription not found');
    return s;
  }

  private async planIn(db: Database | Tx, entityId: string, id: string): Promise<Plan> {
    const [p] = await db.select().from(subscriptionPlan).where(and(eq(subscriptionPlan.id, id), eq(subscriptionPlan.entityId, entityId)));
    if (!p) throw new NotFoundException('Plan not found');
    return p;
  }
}
