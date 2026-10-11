// Phase 3d (decision 058): members record their own hours on projects; an approver (never for their own hours)
// values them at the member's cost rate effective on the work date. Approved hours are frozen; a correction is a
// negative reversal. Cost rates are salary-sensitive and need their own permission.
import { Dec } from '@factoryos/core';
import { membership, project, projectCostRate, projectMilestone, timesheetEntry, type Database, user } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf, type Tx } from '../accounting/accounting-lock.js';

const hours = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, 'Hours, e.g. 7.5'))
  .refine((v) => Number(v) > 0 && Number(v) <= 24 && Dec.of(v).mul('4').toFixed(6).endsWith('.000000'), 'Quarter hours from 0.25 to 24');
const entryInput = z.object({
  projectId: z.uuid(),
  milestoneId: z.uuid().nullable().optional(),
  workDate: z.iso.date(),
  hours,
  notes: z.string().trim().max(1000).nullable().optional(),
});
const listQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(['draft', 'submitted', 'approved']).optional(),
  projectId: z.uuid().optional(),
});
const submitInput = z.object({ from: z.iso.date(), to: z.iso.date() });
const reasonInput = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });
const rateInput = z.object({
  userId: z.string().min(1),
  hourlyRate: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Rupees with up to 2 decimals')),
  effectiveFrom: z.iso.date(),
});

type Entry = typeof timesheetEntry.$inferSelect;

@Controller('services')
export class TimesheetsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  @Get('timesheets')
  @RequirePermission('services.timesheet.read')
  async list(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const q = parse(listQuery, query);
    if (q.scope === 'all' && !ctx.tenant.permissions.has('services.timesheet.approve')) throw new ForbiddenException('Only approvers see everyone’s hours');
    const person = alias(user, 'person');
    const approver = alias(user, 'approver');
    const rows = await this.db
      .select({ e: timesheetEntry, personName: person.name, approvedByName: approver.name, projectNumber: project.number, projectTitle: project.title, milestoneName: projectMilestone.name })
      .from(timesheetEntry)
      .innerJoin(person, eq(person.id, timesheetEntry.userId))
      .innerJoin(project, eq(project.id, timesheetEntry.projectId))
      .leftJoin(approver, eq(approver.id, timesheetEntry.approvedBy))
      .leftJoin(projectMilestone, eq(projectMilestone.id, timesheetEntry.milestoneId))
      .where(
        and(
          eq(timesheetEntry.entityId, entityId),
          q.scope === 'mine' ? eq(timesheetEntry.userId, ctx.user.id) : undefined,
          q.from ? gte(timesheetEntry.workDate, q.from) : undefined,
          q.to ? lte(timesheetEntry.workDate, q.to) : undefined,
          q.status ? eq(timesheetEntry.status, q.status) : undefined,
          q.projectId ? eq(timesheetEntry.projectId, q.projectId) : undefined,
        ),
      )
      .orderBy(desc(timesheetEntry.workDate), asc(person.name), asc(timesheetEntry.createdAt))
      .limit(2000);
    const seeRates = ctx.tenant.permissions.has('services.cost_rate.read');
    return rows.map((r) => ({
      ...r.e,
      costRate: seeRates ? r.e.costRate : null,
      costAmount: seeRates ? r.e.costAmount : null,
      personName: r.personName,
      approvedByName: r.approvedByName,
      projectNumber: r.projectNumber,
      projectTitle: r.projectTitle,
      milestoneName: r.milestoneName,
      mine: r.e.userId === ctx.user.id,
    }));
  }

  /** Active projects anyone recording hours can pick from. */
  @Get('timesheets/projects')
  @RequirePermission('services.timesheet.read')
  async projects(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const rows = await this.db.select({ id: project.id, number: project.number, title: project.title }).from(project).where(and(eq(project.entityId, entityId), eq(project.status, 'active'))).orderBy(asc(project.number));
    const ms = rows.length
      ? await this.db
          .select({ id: projectMilestone.id, projectId: projectMilestone.projectId, name: projectMilestone.name, seq: projectMilestone.seq })
          .from(projectMilestone)
          .where(inArray(projectMilestone.projectId, rows.map((r) => r.id)))
          .orderBy(asc(projectMilestone.seq))
      : [];
    return rows.map((r) => ({ ...r, milestones: ms.filter((m) => m.projectId === r.id).map(({ id, name }) => ({ id, name })) }));
  }

  @Post('timesheets')
  @RequirePermission('services.timesheet.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(entryInput, body);
    return this.db.transaction(async (tx) => {
      await this.checkEntry(tx, ctx, entityId, input);
      const [e] = await tx
        .insert(timesheetEntry)
        .values({ tenantId: ctx.tenant.tenantId, entityId, userId: ctx.user.id, projectId: input.projectId, milestoneId: input.milestoneId ?? null, workDate: input.workDate, hours: input.hours, notes: input.notes ?? null, createdBy: ctx.user.id })
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'timesheet.create', targetType: 'timesheet_entry', targetId: e!.id, after: input }, tx);
      return e!;
    });
  }

  @Put('timesheets/:id')
  @RequirePermission('services.timesheet.create')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(entryInput, body);
    await this.db.transaction(async (tx) => {
      const e = await this.ownDraft(tx, ctx, entityId, id);
      await this.checkEntry(tx, ctx, entityId, input, e.id);
      await tx.update(timesheetEntry).set({ projectId: input.projectId, milestoneId: input.milestoneId ?? null, workDate: input.workDate, hours: input.hours, notes: input.notes ?? null, rejectReason: null, updatedAt: new Date() }).where(eq(timesheetEntry.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'timesheet.update', targetType: 'timesheet_entry', targetId: id, before: { hours: e.hours, workDate: e.workDate }, after: input }, tx);
    });
    return { ok: true };
  }

  @Delete('timesheets/:id')
  @RequirePermission('services.timesheet.create')
  async remove(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    await this.db.transaction(async (tx) => {
      const e = await this.ownDraft(tx, ctx, entityId, id);
      await tx.delete(timesheetEntry).where(eq(timesheetEntry.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'timesheet.delete', targetType: 'timesheet_entry', targetId: id, before: { hours: e.hours, workDate: e.workDate } }, tx);
    });
    return { ok: true };
  }

  /** Submit one's own drafts in a date range (usually a week). */
  @Post('timesheets/submit')
  @RequirePermission('services.timesheet.create')
  async submit(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { from, to } = parse(submitInput, body);
    if (to < from) throw new BadRequestException('The range ends before it starts');
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(timesheetEntry)
        .set({ status: 'submitted', rejectReason: null, updatedAt: new Date() })
        .where(and(eq(timesheetEntry.entityId, entityId), eq(timesheetEntry.userId, ctx.user.id), eq(timesheetEntry.status, 'draft'), gte(timesheetEntry.workDate, from), lte(timesheetEntry.workDate, to)))
        .returning({ id: timesheetEntry.id });
      if (!rows.length) throw new BadRequestException('No draft hours in that range');
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'timesheet.submit', targetType: 'timesheet_entry', targetId: rows[0]!.id, after: { from, to, entries: rows.length } }, tx);
      return { submitted: rows.length };
    });
  }

  @Post('timesheets/:id/approve')
  @RequirePermission('services.timesheet.approve')
  async approve(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    await this.db.transaction(async (tx) => {
      const e = await this.lock(tx, entityId, id);
      if (e.userId === ctx.user.id) throw new ForbiddenException('Someone else approves your hours');
      if (e.status !== 'submitted') throw new ConflictException(e.status === 'approved' ? 'Already approved' : 'Only submitted hours are approved');
      const rate = await this.rateOn(tx, entityId, e.userId, e.workDate);
      const cost = Dec.of(e.hours).mul(rate).toFixed(2);
      await tx.update(timesheetEntry).set({ status: 'approved', approvedBy: ctx.user.id, approvedAt: new Date(), costRate: rate, costAmount: cost, updatedAt: new Date() }).where(eq(timesheetEntry.id, id));
      // Rates and cost are salary-sensitive: the audit trail keeps the hours only.
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'timesheet.approve', targetType: 'timesheet_entry', targetId: id, after: { hours: e.hours, workDate: e.workDate } }, tx);
    });
    return { ok: true };
  }

  @Post('timesheets/:id/reject')
  @RequirePermission('services.timesheet.approve')
  async reject(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(reasonInput, body);
    await this.db.transaction(async (tx) => {
      const e = await this.lock(tx, entityId, id);
      if (e.userId === ctx.user.id) throw new ForbiddenException('Someone else reviews your hours');
      if (e.status !== 'submitted') throw new ConflictException('Only submitted hours are sent back');
      await tx.update(timesheetEntry).set({ status: 'draft', rejectReason: reason, updatedAt: new Date() }).where(eq(timesheetEntry.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'timesheet.reject', targetType: 'timesheet_entry', targetId: id, after: { reason } }, tx);
    });
    return { ok: true };
  }

  /** Approved hours never change; a correction is a negative entry at the same rate. */
  @Post('timesheets/:id/reverse')
  @RequirePermission('services.timesheet.approve')
  async reverse(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(reasonInput, body);
    return this.db.transaction(async (tx) => {
      const e = await this.lock(tx, entityId, id);
      if (e.userId === ctx.user.id) throw new ForbiddenException('Someone else corrects your approved hours');
      if (e.status !== 'approved' || e.reversalOf) throw new ConflictException('Only approved hours are reversed');
      const [done] = await tx.select({ id: timesheetEntry.id }).from(timesheetEntry).where(eq(timesheetEntry.reversalOf, id));
      if (done) throw new ConflictException('Already reversed');
      const [p] = await tx.select({ status: project.status }).from(project).where(eq(project.id, e.projectId));
      if (p?.status === 'closed') throw new ConflictException('The project is closed');
      const [r] = await tx
        .insert(timesheetEntry)
        .values({
          tenantId: e.tenantId,
          entityId,
          userId: e.userId,
          projectId: e.projectId,
          milestoneId: e.milestoneId,
          workDate: e.workDate,
          hours: Dec.of(e.hours).neg().toFixed(2),
          notes: `Reversal: ${reason}`,
          status: 'approved',
          approvedBy: ctx.user.id,
          approvedAt: new Date(),
          costRate: e.costRate,
          costAmount: Dec.of(e.costAmount ?? '0').neg().toFixed(2),
          reversalOf: id,
          createdBy: ctx.user.id,
        })
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'timesheet.reverse', targetType: 'timesheet_entry', targetId: id, after: { reason, reversal: r!.id } }, tx);
      return { id: r!.id };
    });
  }

  // ── Cost rates ──

  @Get('cost-rates')
  @RequirePermission('services.cost_rate.read')
  async rates(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const setter = alias(user, 'setter');
    const people = await this.db
      .select({ userId: user.id, name: user.name, email: user.email })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(and(eq(membership.tenantId, ctx.tenant.tenantId), eq(membership.status, 'active')))
      .orderBy(asc(user.name));
    const rates = await this.db
      .select({ r: projectCostRate, setByName: setter.name })
      .from(projectCostRate)
      .innerJoin(setter, eq(setter.id, projectCostRate.createdBy))
      .where(eq(projectCostRate.entityId, entityId))
      .orderBy(desc(projectCostRate.effectiveFrom));
    const today = businessDate();
    return people.map((p) => {
      const mine = rates.filter((r) => r.r.userId === p.userId);
      return { ...p, current: mine.find((r) => r.r.effectiveFrom <= today)?.r.hourlyRate ?? null, history: mine.map((r) => ({ ...r.r, setByName: r.setByName })) };
    });
  }

  @Post('cost-rates')
  @RequirePermission('services.cost_rate.update')
  async setRate(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(rateInput, body);
    const [m] = await this.db.select({ id: membership.id }).from(membership).where(and(eq(membership.tenantId, ctx.tenant.tenantId), eq(membership.userId, input.userId)));
    if (!m) throw new NotFoundException('Member not found');
    return this.db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: projectCostRate.id }).from(projectCostRate).where(and(eq(projectCostRate.entityId, entityId), eq(projectCostRate.userId, input.userId), eq(projectCostRate.effectiveFrom, input.effectiveFrom)));
      if (dup) throw new ConflictException('A rate from that date already exists; add one from another date');
      const [r] = await tx.insert(projectCostRate).values({ tenantId: ctx.tenant.tenantId, entityId, userId: input.userId, hourlyRate: input.hourlyRate, effectiveFrom: input.effectiveFrom, createdBy: ctx.user.id }).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'project_cost_rate.create', targetType: 'project_cost_rate', targetId: r!.id, after: { userId: input.userId, effectiveFrom: input.effectiveFrom } }, tx);
      return { id: r!.id };
    });
  }

  // ── helpers ──

  private async checkEntry(tx: Tx, ctx: TenantRequestContext, entityId: string, input: z.infer<typeof entryInput>, except?: string) {
    if (input.workDate > businessDate()) throw new BadRequestException('Hours can’t be recorded for a future date');
    const [p] = await tx.select({ status: project.status, number: project.number }).from(project).where(and(eq(project.id, input.projectId), eq(project.entityId, entityId)));
    if (!p) throw new NotFoundException('Project not found');
    if (p.status !== 'active') throw new ConflictException(`Project ${p.number} is ${p.status}; hours go on active projects`);
    if (input.milestoneId) {
      const [m] = await tx.select({ id: projectMilestone.id }).from(projectMilestone).where(and(eq(projectMilestone.id, input.milestoneId), eq(projectMilestone.projectId, input.projectId)));
      if (!m) throw new BadRequestException('That milestone is not on this project');
    }
    // One person can't log more than 24 hours a day, across projects; serialised per person and day.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`timesheet:${entityId}:${ctx.user.id}:${input.workDate}`}))`);
    const [d] = await tx
      .select({ total: sql<string>`coalesce(sum(${timesheetEntry.hours}), 0)::text` })
      .from(timesheetEntry)
      .where(and(eq(timesheetEntry.entityId, entityId), eq(timesheetEntry.userId, ctx.user.id), eq(timesheetEntry.workDate, input.workDate), except ? ne(timesheetEntry.id, except) : undefined));
    const total = Dec.of(d?.total ?? '0').add(input.hours);
    if (total.gt('24')) throw new BadRequestException(`That makes ${total.toFixed(2)} hours on ${input.workDate}; a day has 24`);
  }

  private async ownDraft(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string) {
    const e = await this.lock(tx, entityId, id);
    if (e.userId !== ctx.user.id) throw new ForbiddenException('You can change only your own hours');
    if (e.status !== 'draft') throw new ConflictException(e.status === 'approved' ? 'Approved hours are frozen' : 'Submitted hours wait for approval');
    return e;
  }

  private async lock(tx: Tx, entityId: string, id: string): Promise<Entry> {
    const [e] = await tx.select().from(timesheetEntry).where(and(eq(timesheetEntry.id, id), eq(timesheetEntry.entityId, entityId))).for('update');
    if (!e) throw new NotFoundException('Timesheet entry not found');
    return e;
  }

  private async rateOn(tx: Tx, entityId: string, userId: string, date: string) {
    const [r] = await tx
      .select({ rate: projectCostRate.hourlyRate })
      .from(projectCostRate)
      .where(and(eq(projectCostRate.entityId, entityId), eq(projectCostRate.userId, userId), lte(projectCostRate.effectiveFrom, date)))
      .orderBy(desc(projectCostRate.effectiveFrom))
      .limit(1);
    if (!r) {
      const [u] = await tx.select({ name: user.name }).from(user).where(eq(user.id, userId));
      throw new ConflictException(`Set a cost rate for ${u?.name ?? 'this person'} from ${date} or earlier first`);
    }
    return r.rate;
  }
}
