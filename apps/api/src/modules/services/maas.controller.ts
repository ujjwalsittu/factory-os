// Phase 3a machine-hour MaaS (decision 055): rate cards, bookings, usage and a draft invoice for a completed booking.
// A confirmed booking holds a `booking` machine block, which the scheduler already treats as unavailable time.
import { Dec, maasCharge, maasHours, maasMembershipSplit, maasTermsError } from '@factoryos/core';
import { item, machine, machineBlock, maasBooking, maasMembership, maasMembershipDraw, maasRateCard, maasUsage, party, project, salesInvoice, scheduledOperation, testCampaign, type Database, user, workCentre } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, ne, or, sql, sum } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf, type Tx } from '../accounting/accounting-lock.js';
import { SellingController } from '../selling.controller.js';
import { StockPostingService } from '../stock-posting.service.js';
import { CampaignsController } from './campaigns.controller.js';
import { ProjectsController } from './projects.controller.js';
import type { Billable, BillableLine } from './billables.js';
import { bookingDrawn, membershipDrawn, membershipOn } from './memberships.js';

const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Rupees with up to 2 decimals'));
const rateCardInput = z.object({
  machineId: z.uuid(),
  serviceItemId: z.uuid(),
  standardRate: money,
  memberRate: money.nullable().optional(),
  minimumMinutes: z.number().int().min(0).max(24 * 60).default(0),
  roundingMinutes: z.number().int().default(15),
  validFrom: z.iso.date(),
  validTo: z.iso.date().nullable().optional(),
});
const bookingInput = z.object({
  customerId: z.uuid(),
  machineId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  purpose: z.string().trim().max(500).nullable().optional(),
  /** Decision 057: a chamber booked for a test campaign of the same customer. */
  campaignId: z.uuid().nullable().optional(),
  /** Decision 058: machine time for a project of the same customer, billed through its milestones. */
  projectId: z.uuid().nullable().optional(),
});
const listQuery = z.object({
  status: z.enum(['tentative', 'confirmed', 'in_use', 'completed', 'cancelled']).optional(),
  machineId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
const reason = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });
const usageInput = z.object({ minutes: z.number().int().min(-24 * 60).max(24 * 60).refine((m) => m !== 0, 'Minutes can’t be zero'), note: z.string().trim().min(3, 'Say why').max(500) });
const invoiceInput = z.object({ invoiceDate: z.iso.date().optional(), gstRegistrationId: z.uuid().nullable().optional(), remarks: z.string().trim().max(2000).nullable().optional() });

/** Indian calendar date of an instant: rate cards are dated in the entity's business day. */
const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const MINUTE = 60_000;

@Controller('services')
export class MaasController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
    private readonly selling: SellingController,
  ) {}

  // ── Rate cards ──

  @Get('rate-cards')
  @RequirePermission('services.rate_card.read')
  async rateCards(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    return this.db
      .select({ card: maasRateCard, machineCode: machine.code, machineName: machine.name, itemCode: item.code, itemName: item.name })
      .from(maasRateCard)
      .innerJoin(machine, eq(machine.id, maasRateCard.machineId))
      .innerJoin(item, eq(item.id, maasRateCard.serviceItemId))
      .where(eq(maasRateCard.entityId, entityId))
      .orderBy(asc(machine.code), desc(maasRateCard.validFrom))
      .then((rows) => rows.map((r) => ({ ...r.card, machineCode: r.machineCode, machineName: r.machineName, itemCode: r.itemCode, itemName: r.itemName })));
  }

  @Post('rate-cards')
  @RequirePermission('services.rate_card.update')
  async createRateCard(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(rateCardInput, body);
    const terms = { standardRate: input.standardRate, memberRate: input.memberRate ?? null, minimumMinutes: input.minimumMinutes, roundingMinutes: input.roundingMinutes };
    const err = maasTermsError(terms);
    if (err) throw new BadRequestException(err);
    if (input.validTo && input.validTo < input.validFrom) throw new BadRequestException('The card ends before it starts');
    await this.machineIn(this.db, entityId, input.machineId);
    const [svc] = await this.db.select().from(item).where(and(eq(item.id, input.serviceItemId), eq(item.tenantId, ctx.tenant.tenantId)));
    if (!svc) throw new NotFoundException('Service item not found');
    if (svc.type !== 'service') throw new BadRequestException(`${svc.code} is not a service item; machine time is billed as a service (SAC)`);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`maas-rate:${input.machineId}`}))`);
      const clash = await tx
        .select({ id: maasRateCard.id, validFrom: maasRateCard.validFrom })
        .from(maasRateCard)
        .where(
          and(
            eq(maasRateCard.machineId, input.machineId),
            or(isNull(maasRateCard.validTo), sql`${maasRateCard.validTo} >= ${input.validFrom}`),
            input.validTo ? lte(maasRateCard.validFrom, input.validTo) : sql`true`,
          ),
        )
        .limit(1);
      if (clash.length) throw new ConflictException(`Another rate card from ${clash[0]!.validFrom} covers these dates; end it first`);
      const [card] = await tx
        .insert(maasRateCard)
        .values({ tenantId: ctx.tenant.tenantId, entityId, ...input, memberRate: input.memberRate ?? null, validTo: input.validTo ?? null, createdBy: ctx.user.id })
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_rate_card.create', targetType: 'maas_rate_card', targetId: card!.id, after: input }, tx);
      return card!;
    });
  }

  @Post('rate-cards/:id/end')
  @RequirePermission('services.rate_card.update')
  async endRateCard(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { validTo } = parse(z.object({ validTo: z.iso.date() }), body);
    const [card] = await this.db.select().from(maasRateCard).where(and(eq(maasRateCard.id, id), eq(maasRateCard.entityId, entityId)));
    if (!card) throw new NotFoundException('Rate card not found');
    if (validTo < card.validFrom) throw new BadRequestException(`The card starts on ${card.validFrom}`);
    if (card.validTo && validTo > card.validTo) throw new BadRequestException(`The card already ends on ${card.validTo}`);
    await this.db.update(maasRateCard).set({ validTo, updatedAt: new Date() }).where(eq(maasRateCard.id, id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_rate_card.end', targetType: 'maas_rate_card', targetId: id, before: { validTo: card.validTo }, after: { validTo } });
    return { ok: true };
  }

  // ── Bookings ──

  @Get('bookings')
  @RequirePermission('services.booking.read')
  async bookings(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const q = parse(listQuery, query);
    const rows = await this.db
      .select({ b: maasBooking, customerName: party.name, machineCode: machine.code, machineName: machine.name, invoiceNumber: salesInvoice.number, invoiceStatus: salesInvoice.status })
      .from(maasBooking)
      .innerJoin(party, eq(party.id, maasBooking.customerId))
      .innerJoin(machine, eq(machine.id, maasBooking.machineId))
      .leftJoin(salesInvoice, eq(salesInvoice.id, maasBooking.salesInvoiceId))
      .where(
        and(
          eq(maasBooking.entityId, entityId),
          q.status ? eq(maasBooking.status, q.status) : undefined,
          q.machineId ? eq(maasBooking.machineId, q.machineId) : undefined,
          q.from ? gt(maasBooking.endsAt, new Date(q.from)) : undefined,
          q.to ? lt(maasBooking.startsAt, new Date(q.to)) : undefined,
        ),
      )
      .orderBy(asc(maasBooking.startsAt))
      .limit(500);
    const used = await this.usedMinutes(rows.map((r) => r.b.id));
    return rows.map((r) => ({ ...r.b, customerName: r.customerName, machineCode: r.machineCode, machineName: r.machineName, invoiceNumber: r.invoiceNumber, invoiceStatus: r.invoiceStatus, usedMinutes: used.get(r.b.id) ?? 0 }));
  }

  @Get('bookings/:id')
  @RequirePermission('services.booking.read')
  async booking(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [r] = await this.db
      .select({ b: maasBooking, customerName: party.name, member: party.maasMember, machineCode: machine.code, machineName: machine.name, workCentre: workCentre.name, invoiceNumber: salesInvoice.number, invoiceStatus: salesInvoice.status })
      .from(maasBooking)
      .innerJoin(party, eq(party.id, maasBooking.customerId))
      .innerJoin(machine, eq(machine.id, maasBooking.machineId))
      .innerJoin(workCentre, eq(workCentre.id, machine.workCentreId))
      .leftJoin(salesInvoice, eq(salesInvoice.id, maasBooking.salesInvoiceId))
      .where(and(eq(maasBooking.id, id), eq(maasBooking.entityId, entityId)));
    if (!r) throw new NotFoundException('Booking not found');
    const usage = await this.db
      .select({ id: maasUsage.id, minutes: maasUsage.minutes, source: maasUsage.source, note: maasUsage.note, recordedAt: maasUsage.recordedAt, recordedBy: user.name })
      .from(maasUsage)
      .innerJoin(user, eq(user.id, maasUsage.recordedBy))
      .where(eq(maasUsage.bookingId, id))
      .orderBy(asc(maasUsage.recordedAt));
    const usedMinutes = usage.reduce((s, u) => s + u.minutes, 0);
    const day = istDate(r.b.startsAt);
    const card = await this.cardFor(this.db, r.b.machineId, day);
    // Decision 056: an active membership on the booking's start date makes the customer a member and holds hours.
    const ms = await membershipOn(this.db, entityId, r.b.customerId, day);
    const member = r.member || !!ms;
    const charge = card ? maasCharge(Math.max(0, usedMinutes), card, member) : null;
    const drawnMinutes = await bookingDrawn(this.db, id);
    const [camp] = r.b.campaignId ? await this.db.select({ number: testCampaign.number }).from(testCampaign).where(eq(testCampaign.id, r.b.campaignId)) : [];
    const campaignNumber = camp?.number ?? null;
    const [proj] = r.b.projectId ? await this.db.select({ number: project.number }).from(project).where(eq(project.id, r.b.projectId)) : [];
    const projectNumber = proj?.number ?? null;
    const billed = drawnMinutes > 0 || this.invoiceHolds(r.invoiceStatus);
    const remainingMinutes = ms ? ms.includedMinutes - (await membershipDrawn(this.db, ms.id)) : null;
    const split = charge && !billed ? maasMembershipSplit(charge.billableMinutes, remainingMinutes ?? 0) : null;
    return {
      ...r.b,
      customerName: r.customerName,
      member,
      membership: ms ? { id: ms.id, number: ms.number, endsOn: ms.endsOn, remainingMinutes } : null,
      drawnMinutes,
      split: split && charge ? { ...split, overageHours: maasHours(split.overageMinutes), overageAmount: Dec.of(maasHours(split.overageMinutes)).mul(charge.rate).toFixed(2) } : null,
      machineCode: r.machineCode,
      machineName: r.machineName,
      workCentre: r.workCentre,
      invoiceNumber: r.invoiceNumber,
      invoiceStatus: r.invoiceStatus,
      usage,
      usedMinutes,
      rateCard: card ? { id: card.id, standardRate: card.standardRate, memberRate: card.memberRate, minimumMinutes: card.minimumMinutes, roundingMinutes: card.roundingMinutes, validFrom: card.validFrom, validTo: card.validTo } : null,
      charge,
      billed,
      campaignNumber,
      projectNumber,
      billable: r.b.status === 'completed' && !billed && !!card && !r.b.campaignId && !r.b.projectId,
    };
  }

  @Post('bookings')
  @RequirePermission('services.booking.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = this.span(parse(bookingInput, body));
    await this.customerIn(ctx, input.customerId);
    return this.db.transaction(async (tx) => {
      await this.machineIn(tx, entityId, input.machineId);
      // A campaign's booking belongs to the campaign's project, if any.
      const campaign = input.campaignId ? await CampaignsController.assertBookable(tx, entityId, input.campaignId, input.customerId) : null;
      const projectId = campaign ? campaign.projectId : (input.projectId ?? null);
      if (campaign && input.projectId && input.projectId !== campaign.projectId) throw new BadRequestException(`Campaign ${campaign.number} belongs to ${campaign.projectId ? 'another project' : 'no project'}`);
      if (projectId) await ProjectsController.assertLinkable(tx, entityId, projectId, input.customerId);
      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'maas_booking', businessDate());
      const [b] = await tx
        .insert(maasBooking)
        .values({ tenantId: ctx.tenant.tenantId, entityId, number, customerId: input.customerId, machineId: input.machineId, startsAt: input.start, endsAt: input.end, purpose: input.purpose ?? null, campaignId: input.campaignId ?? null, projectId, createdBy: ctx.user.id })
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_booking.create', targetType: 'maas_booking', targetId: b!.id, after: { number, ...input } }, tx);
      return b!;
    });
  }

  /** Move, resize or change a tentative or confirmed booking; a confirmed one keeps its reservation in step. */
  @Put('bookings/:id')
  @RequirePermission('services.booking.update')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = this.span(parse(bookingInput, body));
    await this.customerIn(ctx, input.customerId);
    return this.db.transaction(async (tx) => {
      await this.lockSchedule(tx, entityId);
      const b = await this.lock(tx, entityId, id);
      if (b.status !== 'tentative' && b.status !== 'confirmed') throw new ConflictException(`A booking that is ${label(b.status)} can’t be changed`);
      if (b.campaignId && input.customerId !== b.customerId) throw new ConflictException('A campaign booking stays with the campaign’s customer');
      if (b.projectId && input.customerId !== b.customerId) throw new ConflictException('A project booking stays with the project’s customer');
      await this.machineIn(tx, entityId, input.machineId);
      if (b.status === 'confirmed') {
        await this.checkClashes(tx, input.machineId, input.start, input.end, b.machineBlockId);
        await tx
          .update(machineBlock)
          .set({ machineId: input.machineId, startsAt: input.start, endsAt: input.end, reason: await this.blockReason(tx, b.number, input.customerId), updatedAt: new Date() })
          .where(eq(machineBlock.id, b.machineBlockId!));
      }
      await tx
        .update(maasBooking)
        .set({ customerId: input.customerId, machineId: input.machineId, startsAt: input.start, endsAt: input.end, purpose: input.purpose ?? null, updatedAt: new Date() })
        .where(eq(maasBooking.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_booking.update', targetType: 'maas_booking', targetId: id, before: { machineId: b.machineId, startsAt: b.startsAt, endsAt: b.endsAt }, after: input }, tx);
      return { ok: true };
    });
  }

  @Post('bookings/:id/confirm')
  @RequirePermission('services.booking.update')
  async confirm(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      await this.lockSchedule(tx, entityId);
      const b = await this.lock(tx, entityId, id);
      if (b.status !== 'tentative') throw new ConflictException(`Only tentative bookings can be confirmed (this one is ${label(b.status)})`);
      if (b.endsAt.getTime() <= Date.now()) throw new BadRequestException('The booking has already ended; move it first');
      await this.checkClashes(tx, b.machineId, b.startsAt, b.endsAt, null);
      const [blk] = await tx
        .insert(machineBlock)
        .values({ tenantId: b.tenantId, entityId, machineId: b.machineId, kind: 'booking', startsAt: b.startsAt, endsAt: b.endsAt, reason: await this.blockReason(tx, b.number, b.customerId), createdBy: ctx.user.id })
        .returning();
      await tx.update(maasBooking).set({ status: 'confirmed', machineBlockId: blk!.id, updatedAt: new Date() }).where(eq(maasBooking.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_booking.confirm', targetType: 'maas_booking', targetId: id, after: { machineBlockId: blk!.id } }, tx);
      return { ok: true };
    });
  }

  @Post('bookings/:id/cancel')
  @RequirePermission('services.booking.update')
  async cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: why } = parse(reason, body);
    return this.db.transaction(async (tx) => {
      await this.lockSchedule(tx, entityId);
      const b = await this.lock(tx, entityId, id);
      if (b.status !== 'tentative' && b.status !== 'confirmed') throw new ConflictException(`A booking that is ${label(b.status)} can’t be cancelled`);
      await tx.update(maasBooking).set({ status: 'cancelled', cancelReason: why, machineBlockId: null, updatedAt: new Date() }).where(eq(maasBooking.id, id));
      if (b.machineBlockId) await tx.delete(machineBlock).where(eq(machineBlock.id, b.machineBlockId));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_booking.cancel', targetType: 'maas_booking', targetId: id, before: { status: b.status }, after: { reason: why } }, tx);
      return { ok: true };
    });
  }

  @Post('bookings/:id/start')
  @RequirePermission('services.usage.create')
  async start(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      const b = await this.lock(tx, entityId, id);
      if (b.status !== 'confirmed') throw new ConflictException(b.status === 'tentative' ? 'Confirm the booking before starting the machine' : `A booking that is ${label(b.status)} can’t be started`);
      const now = new Date();
      await tx.update(maasBooking).set({ status: 'in_use', startedAt: now, updatedAt: now }).where(eq(maasBooking.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_booking.start', targetType: 'maas_booking', targetId: id, after: { startedAt: now } }, tx);
      return { ok: true };
    });
  }

  /** Stop the timer: the elapsed whole minutes are recorded and an early finish frees the rest of the reservation. */
  @Post('bookings/:id/stop')
  @RequirePermission('services.usage.create')
  async stop(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      await this.lockSchedule(tx, entityId);
      const b = await this.lock(tx, entityId, id);
      if (b.status !== 'in_use' || !b.startedAt) throw new ConflictException('The machine timer is not running for this booking');
      const now = new Date();
      const minutes = Math.round((now.getTime() - b.startedAt.getTime()) / MINUTE);
      if (minutes > 0) await tx.insert(maasUsage).values({ tenantId: b.tenantId, bookingId: id, minutes, source: 'timer', note: null, recordedBy: ctx.user.id });
      if (b.machineBlockId) {
        const [blk] = await tx.select().from(machineBlock).where(eq(machineBlock.id, b.machineBlockId));
        if (blk && blk.startsAt >= now) {
          // Stopped before the reserved time began: release all of it.
          await tx.update(maasBooking).set({ machineBlockId: null }).where(eq(maasBooking.id, id));
          await tx.delete(machineBlock).where(eq(machineBlock.id, blk.id));
        } else if (blk && blk.endsAt > now) await tx.update(machineBlock).set({ endsAt: now, updatedAt: now }).where(eq(machineBlock.id, blk.id));
      }
      await tx.update(maasBooking).set({ status: 'completed', stoppedAt: now, updatedAt: now }).where(eq(maasBooking.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_booking.stop', targetType: 'maas_booking', targetId: id, after: { stoppedAt: now, minutes } }, tx);
      return { ok: true, minutes };
    });
  }

  /** Usage recorded by hand (no timer) or a correction; append-only. */
  @Post('bookings/:id/usage')
  @RequirePermission('services.usage.create')
  async recordUsage(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(usageInput, body);
    return this.db.transaction(async (tx) => {
      const b = await this.lock(tx, entityId, id);
      if (b.status !== 'in_use' && b.status !== 'completed') throw new ConflictException('Usage is recorded once the machine has been used');
      if ((await this.invoiceHoldsIn(tx, b.salesInvoiceId)) || (await bookingDrawn(tx, id)) > 0) throw new ConflictException('The booking is billed or invoiced; reverse the billing, or cancel or delete its invoice, to change its usage');
      const [t] = await tx.select({ total: sum(maasUsage.minutes) }).from(maasUsage).where(eq(maasUsage.bookingId, id));
      if (Number(t?.total ?? 0) + input.minutes < 0) throw new BadRequestException(`Only ${Number(t?.total ?? 0)} minutes are recorded`);
      const [u] = await tx.insert(maasUsage).values({ tenantId: b.tenantId, bookingId: id, minutes: input.minutes, source: 'manual', note: input.note, recordedBy: ctx.user.id }).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_usage.record', targetType: 'maas_booking', targetId: id, after: input }, tx);
      return u!;
    });
  }

  /**
   * Bill a completed booking (decision 056): hours come from the customer's membership first; any excess (or all of it,
   * without a membership) becomes a draft tax invoice at the rate card through the sales invoice path. All or nothing.
   */
  @Post('bookings/:id/bill')
  @RequirePermission('services.billing.create')
  async bill(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(invoiceInput, body);
    const b = await this.bookingBillable(ctx, id);
    const { charge: c, coveredMinutes, overageMinutes, hours } = b.detail;
    if (!b.lines.length) {
      await this.db.transaction((tx) => b.settle(tx, null));
      return { invoiceId: null, coveredMinutes, overageMinutes, ...c };
    }
    if (!ctx.tenant.permissions.has('selling.sales_invoice.create')) throw new ForbiddenException('Missing permission: selling.sales_invoice.create');
    const inv = await this.selling.createDraftInvoice(
      ctx,
      entityId,
      { customerId: b.customerId, invoiceDate: input.invoiceDate ?? businessDate(), gstRegistrationId: input.gstRegistrationId ?? null, remarks: input.remarks ?? b.remarks, lines: b.lines },
      b.settle,
    );
    return { invoiceId: inv.id, coveredMinutes, overageMinutes, ...c, hours, amount: b.amount };
  }

  /** What billing a completed booking would carry (decision 060): membership hours first, the excess as one line. */
  async bookingBillable(ctx: TenantRequestContext, id: string): Promise<Billable & { detail: { charge: NonNullable<Awaited<ReturnType<MaasController['booking']>>['charge']>; coveredMinutes: number; overageMinutes: number; hours: string } }> {
    const entityId = entityOf(ctx);
    const d = await this.booking(ctx, id);
    if (d.campaignId) throw new ConflictException(`Billed with test campaign ${d.campaignNumber ?? ''}`.trim());
    if (d.projectId) throw new ConflictException(`Billed through project ${d.projectNumber ?? ''}`.trim());
    if (d.status !== 'completed') throw new ConflictException('Only completed bookings are billed');
    if (d.billed) throw new ConflictException(d.invoiceNumber || d.salesInvoiceId ? `Already invoiced on ${d.invoiceNumber ?? 'a draft invoice'}` : 'Already billed to the membership');
    if (!d.rateCard || !d.charge || !d.split) throw new BadRequestException(`No rate card for ${d.machineCode} on ${istDate(d.startsAt)}`);
    const c = d.charge;
    const { coveredMinutes, overageMinutes } = d.split;
    const membershipId = d.membership?.id ?? null;
    const settle = async (tx: Tx, invoiceId: string | null) => {
      const b = await this.lock(tx, entityId, id);
      if (b.status !== 'completed' || b.projectId || b.campaignId || (await this.invoiceHoldsIn(tx, b.salesInvoiceId)) || (await bookingDrawn(tx, id)) > 0) throw new ConflictException(`Booking ${d.number} changed; reload`);
      const [t] = await tx.select({ total: sum(maasUsage.minutes) }).from(maasUsage).where(eq(maasUsage.bookingId, id));
      if (Number(t?.total ?? 0) !== c.actualMinutes) throw new ConflictException(`Usage of booking ${d.number} changed while billing; reload`);
      if (coveredMinutes > 0 && membershipId) {
        const [m] = await tx.select().from(maasMembership).where(eq(maasMembership.id, membershipId)).for('update');
        if (!m || m.status !== 'active' || m.includedMinutes - (await membershipDrawn(tx, membershipId)) < coveredMinutes) throw new ConflictException(`Membership ${d.membership!.number} changed; reload`);
        await tx.insert(maasMembershipDraw).values({ tenantId: b.tenantId, membershipId, bookingId: id, minutes: coveredMinutes, createdBy: ctx.user.id });
      }
      // No updatedAt bump: billing doesn't change reserved time, so the schedule stays current.
      await tx.update(maasBooking).set({ billedAt: new Date(), ...(invoiceId ? { salesInvoiceId: invoiceId } : {}) }).where(eq(maasBooking.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_booking.bill', targetType: 'maas_booking', targetId: id, after: { invoiceId, membershipId, coveredMinutes, overageMinutes, ...c } }, tx);
    };
    const hours = maasHours(overageMinutes);
    const lines: BillableLine[] = [];
    if (overageMinutes > 0) {
      const [card] = await this.db.select({ serviceItemId: maasRateCard.serviceItemId }).from(maasRateCard).where(eq(maasRateCard.id, d.rateCard.id));
      const description = coveredMinutes
        ? `Machine time on ${d.machineCode} (${d.machineName}), booking ${d.number}: ${c.actualMinutes} min used, ${c.billableMinutes} min billed, ${coveredMinutes} min from membership ${d.membership!.number}, ${overageMinutes} min beyond it at member rate`
        : `Machine time on ${d.machineCode} (${d.machineName}), booking ${d.number}: ${c.actualMinutes} min used, ${c.billableMinutes} min billed${c.memberRate ? ' at member rate' : ''}`;
      lines.push({ itemId: card!.serviceItemId, description, qty: hours, rate: c.rate });
    }
    return {
      kind: 'booking',
      sourceId: id,
      label: d.number,
      customerId: d.customerId,
      customerRef: null,
      remarks: `Machine booking ${d.number}`,
      lines,
      amount: overageMinutes > 0 ? Dec.of(hours).mul(c.rate).toFixed(2) : '0.00',
      settle,
      detail: { charge: c, coveredMinutes, overageMinutes, hours },
    };
  }

  /** Completed bookings not yet billed and billed on their own (not through a campaign or project). */
  async dueBookingIds(entityId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: maasBooking.id, invoiceStatus: salesInvoice.status })
      .from(maasBooking)
      .leftJoin(salesInvoice, eq(salesInvoice.id, maasBooking.salesInvoiceId))
      .where(and(eq(maasBooking.entityId, entityId), eq(maasBooking.status, 'completed'), isNull(maasBooking.campaignId), isNull(maasBooking.projectId), isNull(maasBooking.billedAt)))
      .orderBy(asc(maasBooking.number));
    return rows.filter((r) => !this.invoiceHolds(r.invoiceStatus)).map((r) => r.id);
  }

  /** Decision 055 name for billing, kept for callers that invoice a booking. */
  @Post('bookings/:id/invoice')
  @RequirePermission('services.billing.create')
  async invoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.bill(ctx, id, body);
  }

  /** Undo billing (decision 056): reverse the membership draws once any overage invoice is deleted or cancelled. */
  @Post('bookings/:id/unbill')
  @RequirePermission('services.billing.create')
  async unbill(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: why } = parse(reason, body);
    return this.db.transaction(async (tx) => {
      const b = await this.lock(tx, entityId, id);
      if (await this.invoiceHoldsIn(tx, b.salesInvoiceId)) throw new ConflictException('Delete the draft invoice or cancel the invoice first');
      const draws = await tx
        .select()
        .from(maasMembershipDraw)
        .where(and(eq(maasMembershipDraw.bookingId, id), isNull(maasMembershipDraw.reversalOf), sql`not exists (select 1 from ${maasMembershipDraw} r where r.reversal_of = ${maasMembershipDraw.id})`));
      if (!draws.length) throw new ConflictException('Nothing billed to a membership to reverse');
      for (const dr of draws) await tx.insert(maasMembershipDraw).values({ tenantId: dr.tenantId, membershipId: dr.membershipId, bookingId: id, minutes: -dr.minutes, reversalOf: dr.id, reason: why, createdBy: ctx.user.id });
      await tx.update(maasBooking).set({ billedAt: null }).where(eq(maasBooking.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maas_booking.unbill', targetType: 'maas_booking', targetId: id, after: { reason: why, reversed: draws.map((x) => ({ id: x.id, minutes: x.minutes })) } }, tx);
      return { ok: true };
    });
  }

  // ── helpers ──

  private span(input: z.infer<typeof bookingInput>) {
    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    if (end <= start) throw new BadRequestException('The booking must end after it starts');
    if (end.getTime() - start.getTime() > 31 * 24 * 60 * MINUTE) throw new BadRequestException('Book at most 31 days at a time');
    if (end.getTime() <= Date.now()) throw new BadRequestException('The booking is in the past');
    return { ...input, start, end };
  }

  private async lock(tx: Tx, entityId: string, id: string) {
    const [b] = await tx.select().from(maasBooking).where(and(eq(maasBooking.id, id), eq(maasBooking.entityId, entityId))).for('update');
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  /** The scheduler's per-entity lock, so a booking never races a Reschedule or a move on the Gantt. */
  private async lockSchedule(tx: Tx, entityId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`schedule:${entityId}`}))`);
  }

  private async machineIn(db: Database | Tx, entityId: string, id: string) {
    const [m] = await db.select().from(machine).where(and(eq(machine.id, id), eq(machine.entityId, entityId)));
    if (!m) throw new NotFoundException('Machine not found');
    if (!m.isActive) throw new BadRequestException(`${m.code} is inactive`);
    return m;
  }

  private async customerIn(ctx: TenantRequestContext, id: string) {
    const [p] = await this.db.select().from(party).where(and(eq(party.id, id), eq(party.tenantId, ctx.tenant.tenantId)));
    if (!p) throw new NotFoundException('Customer not found');
    if (!p.isCustomer) throw new BadRequestException(`${p.name} is not a customer`);
    return p;
  }

  private async blockReason(tx: Tx, number: string, customerId: string) {
    const [p] = await tx.select({ name: party.name }).from(party).where(eq(party.id, customerId));
    return `Booking ${number} · ${p?.name ?? 'customer'}`;
  }

  /** A confirmed booking may not overlap other reserved time or pinned/running production on the machine. */
  private async checkClashes(tx: Tx, machineId: string, start: Date, end: Date, ownBlockId: string | null) {
    const [blk] = await tx
      .select({ kind: machineBlock.kind, reason: machineBlock.reason })
      .from(machineBlock)
      .where(and(eq(machineBlock.machineId, machineId), lt(machineBlock.startsAt, end), gt(machineBlock.endsAt, start), ownBlockId ? ne(machineBlock.id, ownBlockId) : undefined))
      .limit(1);
    if (blk) throw new ConflictException(blk.kind === 'booking' ? `Overlaps ${blk.reason}` : `Overlaps ${blk.kind} on this machine: ${blk.reason}`);
    const [op] = await tx
      .select({ pinned: scheduledOperation.pinned, running: scheduledOperation.running })
      .from(scheduledOperation)
      .where(and(eq(scheduledOperation.machineId, machineId), lt(scheduledOperation.startsAt, end), gt(scheduledOperation.endsAt, start), or(eq(scheduledOperation.pinned, true), eq(scheduledOperation.running, true))))
      .limit(1);
    if (op) throw new ConflictException(op.running ? 'Overlaps production running on this machine' : 'Overlaps production pinned on this machine; unpin or move it first');
  }

  private async cardFor(db: Database | Tx, machineId: string, date: string) {
    const [c] = await db
      .select()
      .from(maasRateCard)
      .where(and(eq(maasRateCard.machineId, machineId), lte(maasRateCard.validFrom, date), or(isNull(maasRateCard.validTo), sql`${maasRateCard.validTo} >= ${date}`)))
      .limit(1);
    return c ?? null;
  }

  private invoiceHolds(status: string | null) {
    return status === 'draft' || status === 'submitted';
  }

  private async invoiceHoldsIn(tx: Tx, invoiceId: string | null) {
    if (!invoiceId) return false;
    const [inv] = await tx.select({ status: salesInvoice.status }).from(salesInvoice).where(eq(salesInvoice.id, invoiceId));
    return this.invoiceHolds(inv?.status ?? null);
  }

  private async usedMinutes(ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await this.db.select({ id: maasUsage.bookingId, total: sum(maasUsage.minutes) }).from(maasUsage).where(inArray(maasUsage.bookingId, ids)).groupBy(maasUsage.bookingId);
    return new Map(rows.map((r) => [r.id, Number(r.total ?? 0)]));
  }
}

function label(status: string) {
  return status.replace('_', ' ');
}
