// Phase 3d projects (decision 058): milestones billed as full tax invoices with retention withheld by the customer,
// a budget per cost category, and actual cost from linked work orders, purchase invoice lines, machine bookings and
// approved timesheets. Linked bookings and campaigns are billed only through the milestones.
import { Dec } from '@factoryos/core';
import {
  attachment,
  item,
  machine,
  maasBooking,
  maasUsage,
  membership,
  party,
  project,
  projectBudget,
  projectMilestone,
  projectRetention,
  purchaseInvoice,
  purchaseInvoiceLine,
  salesInvoice,
  testCampaign,
  timesheetEntry,
  type Database,
  user,
  workCentre,
  workOrder,
  workOrderCost,
} from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf, type Tx } from '../accounting/accounting-lock.js';
import { SellingController } from '../selling.controller.js';
import { StockPostingService } from '../stock-posting.service.js';

const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Rupees with up to 2 decimals'));
const pct = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, 'A percentage with up to 2 decimals'))
  .refine((v) => Number(v) <= 50, 'At most 50%');
const projectInput = z.object({
  customerId: z.uuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  customerRef: z.string().trim().max(100).nullable().optional(),
  managerUserId: z.string().min(1).nullable().optional(),
  serviceItemId: z.uuid(),
  contractValue: money.refine((v) => Number(v) > 0, 'Enter the contract value'),
  retentionPct: pct.default('0'),
  dlpMonths: z.number().int().min(0).max(60).default(0),
  startDate: z.iso.date().nullable().optional(),
  endDate: z.iso.date().nullable().optional(),
});
const CATEGORIES = ['material', 'machine', 'labour', 'bought_in', 'other'] as const;
type Category = (typeof CATEGORIES)[number];
const budgetInput = z.object({ lines: z.array(z.object({ category: z.enum(CATEGORIES), amount: money })).max(5) });
const milestoneInput = z.object({
  name: z.string().trim().min(2).max(200),
  dueDate: z.iso.date().nullable().optional(),
  amount: money.refine((v) => Number(v) > 0, 'Enter the amount'),
  seq: z.number().int().min(1).max(9999).optional(),
});
const achieveInput = z.object({ achievedOn: z.iso.date().optional(), acceptanceRef: z.string().trim().min(1, 'The customer’s acceptance reference').max(100) });
const invoiceInput = z.object({ invoiceDate: z.iso.date().optional(), gstRegistrationId: z.uuid().nullable().optional() });
const releaseInput = z.object({ releasedOn: z.iso.date().optional(), releaseRef: z.string().trim().min(1, 'The receipt or reference').max(100) });
const completeInput = z.object({ completedOn: z.iso.date().optional() });
const reasonInput = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });
const LINK_KINDS = ['booking', 'campaign', 'work_order', 'purchase_invoice_line'] as const;
const linkInput = z.object({ kind: z.enum(LINK_KINDS), id: z.uuid() });

const LIVE = (s: string | null | undefined) => s === 'draft' || s === 'submitted';
const OPEN_BOOKING = ['tentative', 'confirmed', 'in_use'] as const;
const OPEN_CAMPAIGN = ['draft', 'active', 'reported'] as const;
type ProjectRow = typeof project.$inferSelect;

/** Retention on an invoice: the project's % of the invoice total including GST, to the paisa. */
export const retentionOf = (grandTotal: string | null, retentionPct: string) => Dec.of(grandTotal ?? '0').mul(retentionPct).div('100').toFixed(2);

@Controller('services')
export class ProjectsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
    private readonly selling: SellingController,
  ) {}

  @Get('projects')
  @RequirePermission('services.project.read')
  async list(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { status } = parse(z.object({ status: z.enum(['draft', 'active', 'completed', 'closed', 'cancelled']).optional() }), query);
    const rows = await this.db
      .select({ p: project, customerName: party.name })
      .from(project)
      .innerJoin(party, eq(party.id, project.customerId))
      .where(and(eq(project.entityId, entityId), status ? eq(project.status, status) : undefined))
      .orderBy(desc(project.createdAt))
      .limit(500);
    const ids = rows.map((r) => r.p.id);
    const billed = ids.length
      ? await this.db
          .select({ projectId: projectMilestone.projectId, taxable: salesInvoice.taxableValue, grandTotal: salesInvoice.grandTotal, invoiceId: salesInvoice.id })
          .from(projectMilestone)
          .innerJoin(salesInvoice, eq(salesInvoice.id, projectMilestone.salesInvoiceId))
          .where(and(inArray(projectMilestone.projectId, ids), inArray(salesInvoice.status, ['draft', 'submitted'])))
      : [];
    const held = ids.length
      ? await this.db
          .select({ projectId: projectRetention.projectId, invoiceId: projectRetention.salesInvoiceId })
          .from(projectRetention)
          .innerJoin(salesInvoice, eq(salesInvoice.id, projectRetention.salesInvoiceId))
          .where(and(inArray(projectRetention.projectId, ids), isNull(projectRetention.releasedOn), inArray(salesInvoice.status, ['draft', 'submitted'])))
      : [];
    return rows.map((r) => {
      const mine = billed.filter((b) => b.projectId === r.p.id);
      const retentionHeld = held
        .filter((h) => h.projectId === r.p.id)
        .reduce((s, h) => s.add(retentionOf(mine.find((b) => b.invoiceId === h.invoiceId)?.grandTotal ?? '0', r.p.retentionPct)), Dec.ZERO);
      return { ...r.p, customerName: r.customerName, invoiced: mine.reduce((s, b) => s.add(b.taxable ?? '0'), Dec.ZERO).toFixed(2), retentionHeld: retentionHeld.toFixed(2) };
    });
  }

  @Get('projects/:id')
  @RequirePermission('services.project.read')
  async get(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const manager = alias(user, 'manager');
    const [r] = await this.db
      .select({ p: project, customerName: party.name, itemCode: item.code, itemName: item.name, managerName: manager.name })
      .from(project)
      .innerJoin(party, eq(party.id, project.customerId))
      .innerJoin(item, eq(item.id, project.serviceItemId))
      .leftJoin(manager, eq(manager.id, project.managerUserId))
      .where(and(eq(project.id, id), eq(project.entityId, entityId)));
    if (!r) throw new NotFoundException('Project not found');
    const p = r.p;
    const achiever = alias(user, 'achiever');
    const milestones = await this.db
      .select({ m: projectMilestone, achievedByName: achiever.name, invoiceNumber: salesInvoice.number, invoiceStatus: salesInvoice.status, invoiceTaxable: salesInvoice.taxableValue, invoiceTotal: salesInvoice.grandTotal, invoiceDate: salesInvoice.invoiceDate })
      .from(projectMilestone)
      .leftJoin(achiever, eq(achiever.id, projectMilestone.achievedBy))
      .leftJoin(salesInvoice, eq(salesInvoice.id, projectMilestone.salesInvoiceId))
      .where(eq(projectMilestone.projectId, id))
      .orderBy(asc(projectMilestone.seq));
    const retention = await this.db
      .select({ r: projectRetention, invoiceNumber: salesInvoice.number, invoiceStatus: salesInvoice.status, invoiceTotal: salesInvoice.grandTotal, milestoneName: projectMilestone.name })
      .from(projectRetention)
      .innerJoin(salesInvoice, eq(salesInvoice.id, projectRetention.salesInvoiceId))
      .innerJoin(projectMilestone, eq(projectMilestone.id, projectRetention.milestoneId))
      .where(and(eq(projectRetention.projectId, id), inArray(salesInvoice.status, ['draft', 'submitted'])))
      .orderBy(asc(projectRetention.createdAt));
    const dueOn = p.completedOn ? addMonths(p.completedOn, p.dlpMonths) : null;
    const retentionRows = retention.map((x) => ({
      ...x.r,
      amount: x.r.releasedOn ? x.r.amount : retentionOf(x.invoiceTotal, p.retentionPct),
      invoiceNumber: x.invoiceNumber,
      invoiceStatus: x.invoiceStatus,
      milestoneName: x.milestoneName,
      dueOn,
    }));
    const budget = await this.db.select().from(projectBudget).where(eq(projectBudget.projectId, id));
    const links = await this.links(entityId, id);
    const actuals = await this.actuals(ctx, entityId, id, links);
    const files = await this.db
      .select({ id: attachment.id, fileName: attachment.fileName, kind: attachment.kind })
      .from(attachment)
      .where(and(eq(attachment.entityId, entityId), eq(attachment.ownerType, 'project'), eq(attachment.ownerId, id), isNull(attachment.withdrawnAt)));
    const live = milestones.filter((m) => LIVE(m.invoiceStatus));
    const revenue = live.reduce((s, m) => s.add(m.invoiceTaxable ?? '0'), Dec.ZERO);
    const actualTotal = CATEGORIES.reduce((s, c) => s.add(actuals.byCategory[c]), Dec.ZERO);
    const milestoneTotal = milestones.reduce((s, m) => s.add(m.m.amount), Dec.ZERO);
    return {
      ...p,
      customerName: r.customerName,
      itemCode: r.itemCode,
      itemName: r.itemName,
      managerName: r.managerName,
      milestones: milestones.map((m) => ({
        ...m.m,
        achievedByName: m.achievedByName,
        invoiceNumber: LIVE(m.invoiceStatus) ? m.invoiceNumber : null,
        invoiceStatus: LIVE(m.invoiceStatus) ? m.invoiceStatus : null,
        salesInvoiceId: LIVE(m.invoiceStatus) ? m.m.salesInvoiceId : null,
        state: LIVE(m.invoiceStatus) ? 'invoiced' : m.m.achievedOn ? 'achieved' : 'pending',
      })),
      milestoneTotal: milestoneTotal.toFixed(2),
      retention: retentionRows,
      retentionHeld: retentionRows.filter((x) => !x.releasedOn).reduce((s, x) => s.add(x.amount), Dec.ZERO).toFixed(2),
      retentionReleased: retentionRows.filter((x) => x.releasedOn).reduce((s, x) => s.add(x.amount), Dec.ZERO).toFixed(2),
      retentionDueOn: dueOn,
      budget: CATEGORIES.map((c) => {
        const b = budget.find((x) => x.category === c)?.amount ?? '0';
        return { category: c, budget: Dec.of(b).toFixed(2), actual: actuals.byCategory[c].toFixed(2), variance: Dec.of(b).sub(actuals.byCategory[c]).toFixed(2) };
      }),
      revenue: revenue.toFixed(2),
      actualCost: actualTotal.toFixed(2),
      margin: revenue.sub(actualTotal).toFixed(2),
      hours: actuals.hours,
      sources: actuals.sources,
      links,
      files,
    };
  }

  @Get('projects-people')
  @RequirePermission('services.project.read')
  async people(@Ctx() ctx: TenantRequestContext) {
    return this.db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(and(eq(membership.tenantId, ctx.tenant.tenantId), eq(membership.status, 'active')))
      .orderBy(asc(user.name));
  }

  @Post('projects')
  @RequirePermission('services.project.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(projectInput, body);
    await this.validate(ctx, input);
    return this.db.transaction(async (tx) => {
      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'project', businessDate());
      const [p] = await tx
        .insert(project)
        .values({ tenantId: ctx.tenant.tenantId, entityId, number, ...this.fields(input), managerUserId: input.managerUserId ?? ctx.user.id, createdBy: ctx.user.id })
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'project.create', targetType: 'project', targetId: p!.id, after: { number, ...input } }, tx);
      return p!;
    });
  }

  @Put('projects/:id')
  @RequirePermission('services.project.update')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(projectInput, body);
    await this.validate(ctx, input);
    await this.transition(ctx, id, 'project.update', async (tx, p) => {
      if (p.status !== 'draft' && p.status !== 'active') throw new ConflictException(`A ${p.status} project can’t be changed`);
      if (p.status === 'active') {
        const fixed = (['customerId', 'serviceItemId', 'contractValue', 'retentionPct', 'dlpMonths'] as const).filter((k) => !same(p[k], input[k]));
        if (fixed.length) throw new ConflictException('The customer and commercial terms are fixed once the project is active');
      }
      if (p.status === 'draft' && !same(p.customerId, input.customerId)) await this.noLinkedWork(tx, p.id, 'Unlink the bookings and campaigns before changing the customer');
      await tx.update(project).set({ ...this.fields(input), managerUserId: input.managerUserId ?? p.managerUserId, updatedAt: new Date() }).where(eq(project.id, id));
    }, input);
    return { ok: true };
  }

  @Put('projects/:id/budget')
  @RequirePermission('services.project.update')
  async setBudget(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { lines } = parse(budgetInput, body);
    if (new Set(lines.map((l) => l.category)).size !== lines.length) throw new BadRequestException('One amount per category');
    await this.transition(ctx, id, 'project.budget', async (tx, p) => {
      this.editable(p);
      await tx.delete(projectBudget).where(eq(projectBudget.projectId, id));
      if (lines.length) await tx.insert(projectBudget).values(lines.map((l) => ({ projectId: id, category: l.category, amount: l.amount })));
    }, { lines });
    return { ok: true };
  }

  // ── Milestones ──

  @Post('projects/:id/milestones')
  @RequirePermission('services.project.update')
  async addMilestone(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(milestoneInput, body);
    let created: unknown;
    await this.transition(ctx, id, 'project.milestone_add', async (tx, p) => {
      this.editable(p);
      const [m] = await tx.select({ max: sql<number>`coalesce(max(${projectMilestone.seq}), 0)::int` }).from(projectMilestone).where(eq(projectMilestone.projectId, id));
      const seq = input.seq ?? (m?.max ?? 0) + 10;
      const [dup] = await tx.select({ id: projectMilestone.id }).from(projectMilestone).where(and(eq(projectMilestone.projectId, id), eq(projectMilestone.seq, seq)));
      if (dup) throw new ConflictException(`Milestone ${seq} already exists`);
      await this.withinContract(tx, p, input.amount);
      [created] = await tx.insert(projectMilestone).values({ projectId: id, seq, name: input.name, dueDate: input.dueDate ?? null, amount: input.amount }).returning();
    }, input);
    return created;
  }

  @Put('milestones/:mid')
  @RequirePermission('services.project.update')
  async editMilestone(@Ctx() ctx: TenantRequestContext, @Param('mid', ParseUUIDPipe) mid: string, @Body() body: unknown) {
    const input = parse(milestoneInput, body);
    const m = await this.milestoneIn(ctx, mid);
    await this.transition(ctx, m.projectId, 'project.milestone_edit', async (tx, p) => {
      this.editable(p);
      const [locked] = await tx.select().from(projectMilestone).where(eq(projectMilestone.id, mid)).for('update');
      if (locked!.achievedOn) throw new ConflictException('An achieved milestone can’t be changed');
      await this.withinContract(tx, p, input.amount, mid);
      await tx.update(projectMilestone).set({ name: input.name, dueDate: input.dueDate ?? null, amount: input.amount }).where(eq(projectMilestone.id, mid));
    }, { mid, ...input });
    return { ok: true };
  }

  @Delete('milestones/:mid')
  @RequirePermission('services.project.update')
  async removeMilestone(@Ctx() ctx: TenantRequestContext, @Param('mid', ParseUUIDPipe) mid: string) {
    const m = await this.milestoneIn(ctx, mid);
    await this.transition(ctx, m.projectId, 'project.milestone_remove', async (tx, p) => {
      this.editable(p);
      const [locked] = await tx.select().from(projectMilestone).where(eq(projectMilestone.id, mid)).for('update');
      if (locked!.achievedOn) throw new ConflictException('An achieved milestone can’t be removed');
      const [t] = await tx.select({ n: sql<number>`count(*)::int` }).from(timesheetEntry).where(eq(timesheetEntry.milestoneId, mid));
      if (t?.n) throw new ConflictException('Hours are booked against this milestone');
      await tx.delete(projectMilestone).where(eq(projectMilestone.id, mid));
    }, { mid, name: m.name });
    return { ok: true };
  }

  @Post('milestones/:mid/achieve')
  @RequirePermission('services.project.update')
  async achieve(@Ctx() ctx: TenantRequestContext, @Param('mid', ParseUUIDPipe) mid: string, @Body() body: unknown) {
    const input = parse(achieveInput, body);
    const m = await this.milestoneIn(ctx, mid);
    await this.transition(ctx, m.projectId, 'project.milestone_achieve', async (tx, p) => {
      if (p.status !== 'active') throw new ConflictException(p.status === 'draft' ? 'Activate the project first' : `A ${p.status} project’s milestones are fixed`);
      const [locked] = await tx.select().from(projectMilestone).where(eq(projectMilestone.id, mid)).for('update');
      if (locked!.achievedOn) throw new ConflictException(`Already achieved on ${locked!.achievedOn}`);
      const achievedOn = input.achievedOn ?? businessDate();
      if (achievedOn > businessDate()) throw new BadRequestException('The achievement date can’t be in the future');
      await tx.update(projectMilestone).set({ achievedOn, acceptanceRef: input.acceptanceRef, achievedBy: ctx.user.id }).where(eq(projectMilestone.id, mid));
    }, { mid, ...input });
    return { ok: true };
  }

  /** A draft tax invoice for an achieved milestone, at its full value; retention is recorded alongside. */
  @Post('milestones/:mid/invoice')
  @RequirePermission('services.billing.create', 'selling.sales_invoice.create')
  async invoice(@Ctx() ctx: TenantRequestContext, @Param('mid', ParseUUIDPipe) mid: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(invoiceInput, body);
    const m = await this.milestoneIn(ctx, mid);
    const d = await this.get(ctx, m.projectId);
    const ms = d.milestones.find((x) => x.id === mid)!;
    if (d.status !== 'active' && d.status !== 'completed') throw new ConflictException(`A ${d.status} project isn’t invoiced`);
    if (!ms.achievedOn) throw new ConflictException('Mark the milestone achieved before invoicing it');
    if (ms.invoiceStatus) throw new ConflictException(`Already invoiced on ${ms.invoiceNumber ?? 'a draft invoice'}`);
    const description = `${ms.name} (project ${d.number}: ${d.title}${d.customerRef ? `, your ref ${d.customerRef}` : ''}; accepted ${ms.acceptanceRef})`;
    const inv = await this.selling.createDraftInvoice(
      ctx,
      entityId,
      {
        customerId: d.customerId,
        invoiceDate: input.invoiceDate ?? businessDate(),
        gstRegistrationId: input.gstRegistrationId ?? null,
        customerPoNo: d.customerRef ?? null,
        remarks: `Project ${d.number} · milestone ${ms.name}${Number(d.retentionPct) > 0 ? ` · retention ${Dec.of(d.retentionPct).toFixed(2)}% withheld by the customer` : ''}`,
        lines: [{ itemId: d.serviceItemId, description, qty: '1', rate: ms.amount }],
      },
      async (tx, invoiceId) => {
        const p = await this.lock(tx, entityId, d.id);
        const [locked] = await tx.select().from(projectMilestone).where(eq(projectMilestone.id, mid)).for('update');
        if ((p.status !== 'active' && p.status !== 'completed') || !locked!.achievedOn || (await this.invoiceLive(tx, locked!.salesInvoiceId))) throw new ConflictException('The project changed; reload');
        await tx.update(projectMilestone).set({ salesInvoiceId: invoiceId }).where(eq(projectMilestone.id, mid));
        if (Number(p.retentionPct) > 0) {
          const [inv] = await tx.select({ grandTotal: salesInvoice.grandTotal }).from(salesInvoice).where(eq(salesInvoice.id, invoiceId));
          await tx.insert(projectRetention).values({ tenantId: p.tenantId, projectId: p.id, milestoneId: mid, salesInvoiceId: invoiceId, amount: retentionOf(inv!.grandTotal, p.retentionPct) });
        }
        await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'project.milestone_invoice', targetType: 'project', targetId: p.id, after: { mid, invoiceId, amount: ms.amount } }, tx);
      },
    );
    return { invoiceId: inv.id };
  }

  /** The customer has paid the retention: record it (the receipt itself is entered in AR). */
  @Post('retention/:rid/release')
  @RequirePermission('services.project.approve')
  async release(@Ctx() ctx: TenantRequestContext, @Param('rid', ParseUUIDPipe) rid: string, @Body() body: unknown) {
    const input = parse(releaseInput, body);
    const [r] = await this.db
      .select({ r: projectRetention })
      .from(projectRetention)
      .innerJoin(project, eq(project.id, projectRetention.projectId))
      .where(and(eq(projectRetention.id, rid), eq(project.entityId, entityOf(ctx))));
    if (!r) throw new NotFoundException('Retention not found');
    await this.transition(ctx, r.r.projectId, 'project.retention_release', async (tx, p) => {
      const [locked] = await tx.select().from(projectRetention).where(eq(projectRetention.id, rid)).for('update');
      if (locked!.releasedOn) throw new ConflictException(`Already released on ${locked!.releasedOn}`);
      const [inv] = await tx.select({ status: salesInvoice.status, grandTotal: salesInvoice.grandTotal }).from(salesInvoice).where(eq(salesInvoice.id, locked!.salesInvoiceId));
      if (inv?.status !== 'submitted') throw new ConflictException(inv?.status === 'draft' ? 'Submit the milestone invoice first' : 'The milestone invoice is no longer live');
      const releasedOn = input.releasedOn ?? businessDate();
      if (releasedOn > businessDate()) throw new BadRequestException('The release date can’t be in the future');
      // Frozen at release: a submitted invoice no longer changes.
      await tx.update(projectRetention).set({ releasedOn, releaseRef: input.releaseRef, releasedBy: ctx.user.id, amount: retentionOf(inv.grandTotal, p.retentionPct) }).where(eq(projectRetention.id, rid));
    }, { rid, ...input });
    return { ok: true };
  }

  // ── Life cycle ──

  @Post('projects/:id/activate')
  @RequirePermission('services.project.approve')
  async activate(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.transition(ctx, id, 'project.activate', async (tx, p) => {
      if (p.status !== 'draft') throw new ConflictException('Only a draft project is activated');
      const [m] = await tx.select({ n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${projectMilestone.amount}), 0)::text` }).from(projectMilestone).where(eq(projectMilestone.projectId, id));
      if (!m?.n) throw new BadRequestException('Add the milestones before activating the project');
      if (!Dec.of(m.total).eq(p.contractValue)) throw new BadRequestException(`The milestones add up to ₹${Dec.of(m.total).toFixed(2)}, not the contract value ₹${Dec.of(p.contractValue).toFixed(2)}`);
      await tx.update(project).set({ status: 'active', updatedAt: new Date() }).where(eq(project.id, id));
    });
    return { ok: true };
  }

  @Post('projects/:id/complete')
  @RequirePermission('services.project.approve')
  async complete(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(completeInput, body ?? {});
    await this.transition(ctx, id, 'project.complete', async (tx, p) => {
      if (p.status !== 'active') throw new ConflictException('Complete an active project');
      const [m] = await tx.select({ n: sql<number>`count(*)::int` }).from(projectMilestone).where(and(eq(projectMilestone.projectId, id), isNull(projectMilestone.achievedOn)));
      if (m?.n) throw new ConflictException(`${m.n} milestone${m.n === 1 ? ' is' : 's are'} not achieved yet`);
      await this.noOpenWork(tx, id);
      const completedOn = input.completedOn ?? businessDate();
      if (completedOn > businessDate()) throw new BadRequestException('The completion date can’t be in the future');
      await tx.update(project).set({ status: 'completed', completedOn, updatedAt: new Date() }).where(eq(project.id, id));
    }, input);
    return { ok: true };
  }

  @Post('projects/:id/close')
  @RequirePermission('services.project.approve')
  async close(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.transition(ctx, id, 'project.close', async (tx, p) => {
      if (p.status !== 'completed') throw new ConflictException(p.status === 'closed' ? 'Already closed' : 'Complete the project before closing it');
      const ms = await tx.select().from(projectMilestone).where(eq(projectMilestone.projectId, id));
      for (const m of ms) if (!(await this.invoiceLive(tx, m.salesInvoiceId))) throw new ConflictException(`Milestone “${m.name}” is not invoiced`);
      const [h] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(projectRetention)
        .innerJoin(salesInvoice, eq(salesInvoice.id, projectRetention.salesInvoiceId))
        .where(and(eq(projectRetention.projectId, id), isNull(projectRetention.releasedOn), inArray(salesInvoice.status, ['draft', 'submitted'])));
      if (h?.n) throw new ConflictException(`Retention on ${h.n} invoice${h.n === 1 ? ' is' : 's is'} still held; record its release first`);
      const [t] = await tx.select({ n: sql<number>`count(*)::int` }).from(timesheetEntry).where(and(eq(timesheetEntry.projectId, id), eq(timesheetEntry.status, 'submitted')));
      if (t?.n) throw new ConflictException(`${t.n} timesheet entr${t.n === 1 ? 'y waits' : 'ies wait'} for approval; approve or send them back first`);
      await tx.update(project).set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() }).where(eq(project.id, id));
    });
    return { ok: true };
  }

  @Post('projects/:id/cancel')
  @RequirePermission('services.project.approve')
  async cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { reason } = parse(reasonInput, body);
    await this.transition(ctx, id, 'project.cancel', async (tx, p) => {
      if (p.status !== 'draft' && p.status !== 'active') throw new ConflictException(`A ${p.status} project can’t be cancelled`);
      const ms = await tx.select().from(projectMilestone).where(eq(projectMilestone.projectId, id));
      for (const m of ms) if (await this.invoiceLive(tx, m.salesInvoiceId)) throw new ConflictException(`Delete or cancel the invoice of milestone “${m.name}” first`);
      await this.noOpenBookings(tx, id);
      await tx.update(project).set({ status: 'cancelled', cancelReason: reason, updatedAt: new Date() }).where(eq(project.id, id));
    }, { reason });
    return { ok: true };
  }

  // ── Links ──

  @Post('projects/:id/links')
  @RequirePermission('services.project.update')
  async link(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(linkInput, body);
    await this.setLink(ctx, id, input.kind, input.id, true);
    return { ok: true };
  }

  /** Documents that could be linked: same customer for bookings and campaigns, unlinked and not billed on their own. */
  @Get('projects/:id/link-candidates')
  @RequirePermission('services.project.read')
  async candidates(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { kind } = parse(z.object({ kind: z.enum(LINK_KINDS) }), query);
    const [p] = await this.db.select().from(project).where(and(eq(project.id, id), eq(project.entityId, entityId)));
    if (!p) throw new NotFoundException('Project not found');
    if (kind === 'booking') {
      const rows = await this.db
        .select({ id: maasBooking.id, number: maasBooking.number, status: maasBooking.status, machineCode: machine.code, startsAt: maasBooking.startsAt })
        .from(maasBooking)
        .innerJoin(machine, eq(machine.id, maasBooking.machineId))
        .leftJoin(salesInvoice, eq(salesInvoice.id, maasBooking.salesInvoiceId))
        .where(and(eq(maasBooking.entityId, entityId), eq(maasBooking.customerId, p.customerId), isNull(maasBooking.projectId), isNull(maasBooking.campaignId), isNull(maasBooking.billedAt), ne(maasBooking.status, 'cancelled'), or(isNull(salesInvoice.id), eq(salesInvoice.status, 'cancelled'))))
        .orderBy(desc(maasBooking.startsAt))
        .limit(200);
      return rows.map((r) => ({ id: r.id, label: `${r.number} · ${r.machineCode} · ${r.status.replace('_', ' ')}` }));
    }
    if (kind === 'campaign') {
      const rows = await this.db
        .select({ id: testCampaign.id, number: testCampaign.number, title: testCampaign.title, status: testCampaign.status })
        .from(testCampaign)
        .leftJoin(salesInvoice, eq(salesInvoice.id, testCampaign.salesInvoiceId))
        .where(and(eq(testCampaign.entityId, entityId), eq(testCampaign.customerId, p.customerId), isNull(testCampaign.projectId), inArray(testCampaign.status, [...OPEN_CAMPAIGN]), or(isNull(salesInvoice.id), eq(salesInvoice.status, 'cancelled'))))
        .orderBy(desc(testCampaign.createdAt))
        .limit(200);
      return rows.map((r) => ({ id: r.id, label: `${r.number} · ${r.title}` }));
    }
    if (kind === 'work_order') {
      const rows = await this.db
        .select({ id: workOrder.id, number: workOrder.number, status: workOrder.status, itemCode: item.code, plannedQty: workOrder.plannedQty })
        .from(workOrder)
        .innerJoin(item, eq(item.id, workOrder.itemId))
        .where(and(eq(workOrder.entityId, entityId), isNull(workOrder.projectId), inArray(workOrder.status, ['draft', 'released'])))
        .orderBy(desc(workOrder.createdAt))
        .limit(200);
      return rows.map((r) => ({ id: r.id, label: `${r.number ?? 'Draft'} · ${r.itemCode} × ${Dec.of(r.plannedQty).toString().replace(/\.?0+$/, '')} · ${r.status}` }));
    }
    const rows = await this.db
      .select({ id: purchaseInvoiceLine.id, lineNo: purchaseInvoiceLine.lineNo, number: purchaseInvoice.number, supplierInvoiceNo: purchaseInvoice.supplierInvoiceNo, supplierName: party.name, itemCode: item.code, taxableValue: purchaseInvoiceLine.taxableValue, currency: purchaseInvoice.currency })
      .from(purchaseInvoiceLine)
      .innerJoin(purchaseInvoice, eq(purchaseInvoice.id, purchaseInvoiceLine.invoiceId))
      .innerJoin(party, eq(party.id, purchaseInvoice.supplierId))
      .innerJoin(item, eq(item.id, purchaseInvoiceLine.itemId))
      .where(and(eq(purchaseInvoice.entityId, entityId), isNull(purchaseInvoiceLine.projectId), ne(purchaseInvoice.status, 'cancelled')))
      .orderBy(desc(purchaseInvoice.postingDate))
      .limit(200);
    return rows.map((r) => ({ id: r.id, label: `${r.number ?? 'Draft'} (${r.supplierName} ${r.supplierInvoiceNo}) · line ${r.lineNo} ${r.itemCode} · ${r.currency} ${Dec.of(r.taxableValue ?? '0').toFixed(2)}` }));
  }

  @Delete('projects/:id/links/:kind/:linkId')
  @RequirePermission('services.project.update')
  async unlink(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Param('linkId', ParseUUIDPipe) linkId: string) {
    const k = parse(z.enum(LINK_KINDS), kind);
    await this.setLink(ctx, id, k, linkId, false);
    return { ok: true };
  }

  private async setLink(ctx: TenantRequestContext, id: string, kind: (typeof LINK_KINDS)[number], linkId: string, on: boolean) {
    const entityId = entityOf(ctx);
    await this.transition(ctx, id, on ? 'project.link' : 'project.unlink', async (tx, p) => {
      if (p.status === 'closed' || p.status === 'cancelled') throw new ConflictException(`A ${p.status} project’s links are fixed`);
      const target = on ? p.id : null;
      // Once milestones are billed, linked machine time and tests may be in them: unlinking would let them be billed twice.
      if (!on && (kind === 'booking' || kind === 'campaign')) {
        const ms = await tx.select({ salesInvoiceId: projectMilestone.salesInvoiceId }).from(projectMilestone).where(and(eq(projectMilestone.projectId, p.id), isNotNull(projectMilestone.salesInvoiceId)));
        for (const m of ms) if (await this.invoiceLive(tx, m.salesInvoiceId)) throw new ConflictException('Milestones are already invoiced, so linked bookings and campaigns stay with the project');
      }
      if (kind === 'booking') {
        const [b] = await tx.select().from(maasBooking).where(and(eq(maasBooking.id, linkId), eq(maasBooking.entityId, entityId))).for('update');
        if (!b) throw new NotFoundException('Booking not found');
        if (on) {
          if (b.projectId === p.id) return;
          if (b.projectId) throw new ConflictException(`Booking ${b.number} belongs to another project`);
          if (b.campaignId) throw new ConflictException(`Booking ${b.number} belongs to a test campaign; link the campaign instead`);
          if (b.customerId !== p.customerId) throw new BadRequestException(`Booking ${b.number} is for another customer`);
          if (b.status === 'cancelled') throw new ConflictException(`Booking ${b.number} is cancelled`);
          if (b.billedAt || (await this.invoiceLive(tx, b.salesInvoiceId))) throw new ConflictException(`Booking ${b.number} is already billed on its own`);
        } else if (b.projectId !== p.id) throw new NotFoundException('That booking is not linked to this project');
        else if (b.campaignId) throw new ConflictException('Unlink the booking’s campaign instead');
        await tx.update(maasBooking).set({ projectId: target, updatedAt: new Date() }).where(eq(maasBooking.id, linkId));
      } else if (kind === 'campaign') {
        const [c] = await tx.select().from(testCampaign).where(and(eq(testCampaign.id, linkId), eq(testCampaign.entityId, entityId))).for('update');
        if (!c) throw new NotFoundException('Campaign not found');
        if (on) {
          if (c.projectId === p.id) return;
          if (c.projectId) throw new ConflictException(`Campaign ${c.number} belongs to another project`);
          if (c.customerId !== p.customerId) throw new BadRequestException(`Campaign ${c.number} is for another customer`);
          if (!(OPEN_CAMPAIGN as readonly string[]).includes(c.status)) throw new ConflictException(`Campaign ${c.number} is ${c.status}`);
          if (await this.invoiceLive(tx, c.salesInvoiceId)) throw new ConflictException(`Campaign ${c.number} is already invoiced on its own`);
          const [billed] = await tx.select({ number: maasBooking.number }).from(maasBooking).where(and(eq(maasBooking.campaignId, c.id), or(isNotNull(maasBooking.projectId), isNotNull(maasBooking.billedAt)))).limit(1);
          if (billed) throw new ConflictException(`Booking ${billed.number} of the campaign is billed or linked elsewhere`);
        } else if (c.projectId !== p.id) throw new NotFoundException('That campaign is not linked to this project');
        else if (c.status === 'closed') throw new ConflictException('A closed campaign stays with its project');
        await tx.update(testCampaign).set({ projectId: target, updatedAt: new Date() }).where(eq(testCampaign.id, linkId));
        // The campaign's bookings follow it.
        await tx.update(maasBooking).set({ projectId: target, updatedAt: new Date() }).where(eq(maasBooking.campaignId, linkId));
      } else if (kind === 'work_order') {
        const [w] = await tx.select().from(workOrder).where(and(eq(workOrder.id, linkId), eq(workOrder.entityId, entityId))).for('update');
        if (!w) throw new NotFoundException('Work order not found');
        if (on) {
          if (w.projectId === p.id) return;
          if (w.projectId) throw new ConflictException(`Work order ${w.number ?? '(draft)'} belongs to another project`);
          if (w.status !== 'draft' && w.status !== 'released') throw new ConflictException(`A ${w.status} work order can’t be linked`);
        } else if (w.projectId !== p.id) throw new NotFoundException('That work order is not linked to this project');
        await tx.update(workOrder).set({ projectId: target, updatedAt: new Date() }).where(eq(workOrder.id, linkId));
      } else {
        const [l] = await tx
          .select({ l: purchaseInvoiceLine, status: purchaseInvoice.status, number: purchaseInvoice.number })
          .from(purchaseInvoiceLine)
          .innerJoin(purchaseInvoice, eq(purchaseInvoice.id, purchaseInvoiceLine.invoiceId))
          .where(and(eq(purchaseInvoiceLine.id, linkId), eq(purchaseInvoice.entityId, entityId)))
          .for('update', { of: purchaseInvoiceLine });
        if (!l) throw new NotFoundException('Purchase invoice line not found');
        if (on) {
          if (l.l.projectId === p.id) return;
          if (l.l.projectId) throw new ConflictException('That purchase line is a cost of another project');
          if (l.status === 'cancelled') throw new ConflictException('The purchase invoice is cancelled');
        } else if (l.l.projectId !== p.id) throw new NotFoundException('That purchase line is not linked to this project');
        // A project tag only: the purchase invoice itself is unchanged.
        await tx.update(purchaseInvoiceLine).set({ projectId: target }).where(eq(purchaseInvoiceLine.id, linkId));
      }
    }, { kind, id: linkId });
  }

  // ── Read model ──

  private async links(entityId: string, id: string) {
    const bookings = await this.db
      .select({ id: maasBooking.id, number: maasBooking.number, status: maasBooking.status, startsAt: maasBooking.startsAt, endsAt: maasBooking.endsAt, machineCode: machine.code, campaignId: maasBooking.campaignId })
      .from(maasBooking)
      .innerJoin(machine, eq(machine.id, maasBooking.machineId))
      .where(and(eq(maasBooking.projectId, id), eq(maasBooking.entityId, entityId)))
      .orderBy(asc(maasBooking.startsAt));
    const campaigns = await this.db
      .select({ id: testCampaign.id, number: testCampaign.number, title: testCampaign.title, status: testCampaign.status })
      .from(testCampaign)
      .where(and(eq(testCampaign.projectId, id), eq(testCampaign.entityId, entityId)))
      .orderBy(asc(testCampaign.createdAt));
    const workOrders = await this.db
      .select({ id: workOrder.id, number: workOrder.number, status: workOrder.status, itemCode: item.code, itemName: item.name, plannedQty: workOrder.plannedQty })
      .from(workOrder)
      .innerJoin(item, eq(item.id, workOrder.itemId))
      .where(and(eq(workOrder.projectId, id), eq(workOrder.entityId, entityId)))
      .orderBy(asc(workOrder.createdAt));
    const purchaseLines = await this.db
      .select({
        id: purchaseInvoiceLine.id,
        invoiceId: purchaseInvoice.id,
        number: purchaseInvoice.number,
        status: purchaseInvoice.status,
        supplierInvoiceNo: purchaseInvoice.supplierInvoiceNo,
        supplierName: party.name,
        itemCode: item.code,
        itemName: item.name,
        taxableValue: purchaseInvoiceLine.taxableValue,
        currency: purchaseInvoice.currency,
      })
      .from(purchaseInvoiceLine)
      .innerJoin(purchaseInvoice, eq(purchaseInvoice.id, purchaseInvoiceLine.invoiceId))
      .innerJoin(party, eq(party.id, purchaseInvoice.supplierId))
      .innerJoin(item, eq(item.id, purchaseInvoiceLine.itemId))
      .where(and(eq(purchaseInvoiceLine.projectId, id), eq(purchaseInvoice.entityId, entityId)))
      .orderBy(asc(purchaseInvoice.postingDate));
    return { bookings, campaigns, workOrders, purchaseLines };
  }

  /** Actual cost by category, with its sources; labour per person only with the cost-rate permission. */
  private async actuals(ctx: TenantRequestContext, entityId: string, id: string, links: Awaited<ReturnType<ProjectsController['links']>>) {
    const byCategory: Record<Category, Dec> = { material: Dec.ZERO, machine: Dec.ZERO, labour: Dec.ZERO, bought_in: Dec.ZERO, other: Dec.ZERO };
    const sources: { category: Category; kind: string; id: string; reference: string; amount: string }[] = [];
    const woIds = links.workOrders.map((w) => w.id);
    if (woIds.length) {
      const costs = await this.db
        .select({ workOrderId: workOrderCost.workOrderId, kind: workOrderCost.kind, amount: sql<string>`sum(${workOrderCost.amount})::text` })
        .from(workOrderCost)
        .where(and(inArray(workOrderCost.workOrderId, woIds), inArray(workOrderCost.kind, ['issue', 'return', 'absorption', 'job_work'])))
        .groupBy(workOrderCost.workOrderId, workOrderCost.kind);
      for (const c of costs) {
        const category: Category = c.kind === 'absorption' ? 'machine' : c.kind === 'job_work' ? 'bought_in' : 'material';
        byCategory[category] = byCategory[category].add(c.amount);
        const wo = links.workOrders.find((w) => w.id === c.workOrderId)!;
        sources.push({ category, kind: 'work_order', id: wo.id, reference: `${wo.number ?? 'Draft work order'} · ${c.kind.replace('_', ' ')}`, amount: Dec.of(c.amount).toFixed(2) });
      }
    }
    const bookingIds = links.bookings.map((b) => b.id);
    if (bookingIds.length) {
      const used = await this.db
        .select({ bookingId: maasUsage.bookingId, minutes: sql<number>`sum(${maasUsage.minutes})::int`, rate: workCentre.hourlyRate })
        .from(maasUsage)
        .innerJoin(maasBooking, eq(maasBooking.id, maasUsage.bookingId))
        .innerJoin(machine, eq(machine.id, maasBooking.machineId))
        .innerJoin(workCentre, eq(workCentre.id, machine.workCentreId))
        .where(inArray(maasUsage.bookingId, bookingIds))
        .groupBy(maasUsage.bookingId, workCentre.hourlyRate);
      for (const u of used) {
        const amount = Dec.of(u.minutes).mul(u.rate).div('60');
        byCategory.machine = byCategory.machine.add(amount);
        const b = links.bookings.find((x) => x.id === u.bookingId)!;
        sources.push({ category: 'machine', kind: 'booking', id: b.id, reference: `${b.number} · ${b.machineCode} · ${u.minutes} min`, amount: amount.toFixed(2) });
      }
    }
    const pi = await this.db
      .select({ l: purchaseInvoiceLine, number: purchaseInvoice.number, rate: purchaseInvoice.exchangeRate, itcEligible: purchaseInvoice.itcEligible, invoiceId: purchaseInvoice.id })
      .from(purchaseInvoiceLine)
      .innerJoin(purchaseInvoice, eq(purchaseInvoice.id, purchaseInvoiceLine.invoiceId))
      .where(and(eq(purchaseInvoiceLine.projectId, id), eq(purchaseInvoice.entityId, entityId), eq(purchaseInvoice.status, 'submitted')));
    for (const x of pi) {
      let amount = Dec.of(x.l.taxableValue ?? '0');
      if (!x.itcEligible) for (const t of [x.l.igst, x.l.cgst, x.l.sgst, x.l.cess]) amount = amount.add(t ?? '0');
      amount = amount.mul(x.rate);
      byCategory.bought_in = byCategory.bought_in.add(amount);
      sources.push({ category: 'bought_in', kind: 'purchase_invoice', id: x.invoiceId, reference: `${x.number ?? 'Purchase invoice'} · line ${x.l.lineNo}`, amount: amount.toFixed(2) });
    }
    const person = alias(user, 'person');
    const hours = await this.db
      .select({
        userId: timesheetEntry.userId,
        name: person.name,
        approved: sql<string>`coalesce(sum(${timesheetEntry.hours}) filter (where ${timesheetEntry.status} = 'approved'), 0)::text`,
        pending: sql<string>`coalesce(sum(${timesheetEntry.hours}) filter (where ${timesheetEntry.status} <> 'approved'), 0)::text`,
        cost: sql<string>`coalesce(sum(${timesheetEntry.costAmount}) filter (where ${timesheetEntry.status} = 'approved'), 0)::text`,
      })
      .from(timesheetEntry)
      .innerJoin(person, eq(person.id, timesheetEntry.userId))
      .where(and(eq(timesheetEntry.projectId, id), eq(timesheetEntry.entityId, entityId)))
      .groupBy(timesheetEntry.userId, person.name)
      .orderBy(asc(person.name));
    const seeRates = ctx.tenant.permissions.has('services.cost_rate.read');
    for (const h of hours) byCategory.labour = byCategory.labour.add(h.cost);
    if (hours.length) sources.push({ category: 'labour', kind: 'timesheets', id, reference: 'Approved timesheets', amount: byCategory.labour.toFixed(2) });
    return {
      byCategory,
      sources,
      hours: hours.map((h) => ({ userId: h.userId, name: h.name, approvedHours: Dec.of(h.approved).toFixed(2), pendingHours: Dec.of(h.pending).toFixed(2), cost: seeRates ? Dec.of(h.cost).toFixed(2) : null })),
    };
  }

  // ── helpers ──

  private fields(input: z.infer<typeof projectInput>) {
    return {
      customerId: input.customerId,
      title: input.title,
      description: input.description ?? null,
      customerRef: input.customerRef ?? null,
      serviceItemId: input.serviceItemId,
      contractValue: input.contractValue,
      retentionPct: input.retentionPct,
      dlpMonths: input.dlpMonths,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
    };
  }

  private async validate(ctx: TenantRequestContext, input: z.infer<typeof projectInput>) {
    const [c] = await this.db.select().from(party).where(and(eq(party.id, input.customerId), eq(party.tenantId, ctx.tenant.tenantId)));
    if (!c) throw new NotFoundException('Customer not found');
    if (!c.isCustomer) throw new BadRequestException(`${c.name} is not a customer`);
    const [s] = await this.db.select().from(item).where(and(eq(item.id, input.serviceItemId), eq(item.tenantId, ctx.tenant.tenantId)));
    if (!s) throw new NotFoundException('Service item not found');
    if (s.type !== 'service') throw new BadRequestException(`${s.code} is not a service item; milestones are billed as a service (SAC)`);
    if (input.startDate && input.endDate && input.endDate < input.startDate) throw new BadRequestException('The end date is before the start date');
    if (input.managerUserId) {
      const [m] = await this.db.select({ id: membership.id }).from(membership).where(and(eq(membership.tenantId, ctx.tenant.tenantId), eq(membership.userId, input.managerUserId), eq(membership.status, 'active')));
      if (!m) throw new BadRequestException('The project manager must be an active member');
    }
  }

  /** Lock the project, run `fn`, and audit, in one transaction. */
  private async transition(ctx: TenantRequestContext, id: string, action: string, fn: (tx: Tx, p: ProjectRow) => Promise<void>, after?: unknown) {
    const entityId = entityOf(ctx);
    await this.db.transaction(async (tx) => {
      const p = await this.lock(tx, entityId, id);
      await fn(tx, p);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action, targetType: 'project', targetId: id, after }, tx);
    });
  }

  private editable(p: ProjectRow) {
    if (p.status !== 'draft' && p.status !== 'active') throw new ConflictException(`A ${p.status} project’s plan is fixed`);
  }

  /** The milestones never add up to more than the contract value. */
  private async withinContract(tx: Tx, p: ProjectRow, amount: string, except?: string) {
    const [m] = await tx
      .select({ total: sql<string>`coalesce(sum(${projectMilestone.amount}), 0)::text` })
      .from(projectMilestone)
      .where(and(eq(projectMilestone.projectId, p.id), except ? ne(projectMilestone.id, except) : undefined));
    const total = Dec.of(m?.total ?? '0').add(amount);
    if (total.gt(p.contractValue)) throw new BadRequestException(`The milestones would add up to ₹${total.toFixed(2)}, more than the contract value ₹${Dec.of(p.contractValue).toFixed(2)}`);
  }

  private async noOpenBookings(tx: Tx, id: string) {
    const [b] = await tx.select({ number: maasBooking.number, status: maasBooking.status }).from(maasBooking).where(and(eq(maasBooking.projectId, id), inArray(maasBooking.status, [...OPEN_BOOKING]))).limit(1);
    if (b) throw new ConflictException(`Booking ${b.number} is still ${b.status.replace('_', ' ')}; complete or cancel it first`);
  }

  private async noOpenWork(tx: Tx, id: string) {
    await this.noOpenBookings(tx, id);
    const [c] = await tx.select({ number: testCampaign.number, status: testCampaign.status }).from(testCampaign).where(and(eq(testCampaign.projectId, id), inArray(testCampaign.status, [...OPEN_CAMPAIGN]))).limit(1);
    if (c) throw new ConflictException(`Test campaign ${c.number} is still ${c.status}; close or cancel it first`);
  }

  private async noLinkedWork(tx: Tx, id: string, message: string) {
    const [b] = await tx.select({ id: maasBooking.id }).from(maasBooking).where(eq(maasBooking.projectId, id)).limit(1);
    const [c] = await tx.select({ id: testCampaign.id }).from(testCampaign).where(eq(testCampaign.projectId, id)).limit(1);
    if (b || c) throw new ConflictException(message);
  }

  private async lock(tx: Tx, entityId: string, id: string) {
    const [p] = await tx.select().from(project).where(and(eq(project.id, id), eq(project.entityId, entityId))).for('update');
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private async milestoneIn(ctx: TenantRequestContext, mid: string) {
    const [m] = await this.db
      .select({ id: projectMilestone.id, projectId: projectMilestone.projectId, name: projectMilestone.name })
      .from(projectMilestone)
      .innerJoin(project, eq(project.id, projectMilestone.projectId))
      .where(and(eq(projectMilestone.id, mid), eq(project.entityId, entityOf(ctx))));
    if (!m) throw new NotFoundException('Milestone not found');
    return m;
  }

  private async invoiceLive(tx: Tx, invoiceId: string | null) {
    if (!invoiceId) return false;
    const [inv] = await tx.select({ status: salesInvoice.status }).from(salesInvoice).where(eq(salesInvoice.id, invoiceId));
    return LIVE(inv?.status);
  }

  /** Bookings and campaigns join only a draft or active project of the same customer. */
  static async assertLinkable(tx: Database | Tx, entityId: string, projectId: string, customerId: string) {
    const [p] = await tx.select().from(project).where(and(eq(project.id, projectId), eq(project.entityId, entityId)));
    if (!p) throw new NotFoundException('Project not found');
    if (p.status !== 'draft' && p.status !== 'active') throw new ConflictException(`Project ${p.number} is ${p.status}`);
    if (p.customerId !== customerId) throw new BadRequestException(`Project ${p.number} is for another customer`);
    return p;
  }
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (a != null && b != null && /^-?\d+(\.\d+)?$/.test(String(a)) && Dec.of(String(a)).eq(String(b)));

/** ISO date plus whole months, clamped to the month's last day. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
