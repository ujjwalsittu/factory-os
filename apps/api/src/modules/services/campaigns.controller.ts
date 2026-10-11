// Phase 3c test campaigns (decision 057): a test service order quoted as a lump sum plus extras, with the customer's
// payload in a custody register (not stock), test steps with results, a quality sign-off, and one invoice at the end.
import { Dec } from '@factoryos/core';
import { attachment, custodyItem, item, machine, maasBooking, party, project, salesInvoice, testCampaign, testCampaignExtra, testCampaignStep, type Database, user } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf, type Tx } from '../accounting/accounting-lock.js';
import { SellingController } from '../selling.controller.js';
import { ProjectsController } from './projects.controller.js';
import { StockPostingService } from '../stock-posting.service.js';

const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Rupees with up to 2 decimals'));
const campaignInput = z.object({
  customerId: z.uuid(),
  title: z.string().trim().min(3).max(200),
  scope: z.string().trim().max(4000).nullable().optional(),
  customerRef: z.string().trim().max(100).nullable().optional(),
  serviceItemId: z.uuid(),
  quotedAmount: money,
  /** Decision 058: a campaign for a project of the same customer is billed through its milestones. */
  projectId: z.uuid().nullable().optional(),
});
const stepInput = z.object({ name: z.string().trim().min(2).max(200), requirement: z.string().trim().max(1000).nullable().optional(), seq: z.number().int().min(1).max(9999).optional() });
const resultInput = z.object({ result: z.enum(['pending', 'pass', 'fail', 'na']), measured: z.string().trim().max(200).nullable().optional(), notes: z.string().trim().max(2000).nullable().optional() });
const custodyInput = z.object({
  description: z.string().trim().min(2).max(300),
  serialNo: z.string().trim().max(100).nullable().optional(),
  qty: z.number().int().min(1).max(100000).default(1),
  inwardChallanNo: z.string().trim().min(1, 'The customer’s challan number').max(60),
  receivedCondition: z.string().trim().min(2, 'Note the condition on receipt').max(1000),
});
const returnInput = z.object({ returnCondition: z.string().trim().min(2, 'Note the condition on return').max(1000) });
const extraInput = z.object({
  description: z.string().trim().min(2).max(500),
  qty: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(/^\d+(\.\d{1,3})?$/, 'Up to 3 decimals')),
  rate: money,
  serviceItemId: z.uuid().optional(),
});
const approveInput = z.object({ summary: z.string().trim().min(5, 'Summarise the outcome').max(4000) });
const reasonInput = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });
const invoiceInput = z.object({ invoiceDate: z.iso.date().optional(), gstRegistrationId: z.uuid().nullable().optional() });

const LIVE = (s: string | null) => s === 'draft' || s === 'submitted';

@Controller('services')
export class CampaignsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
    private readonly selling: SellingController,
  ) {}

  @Get('campaigns')
  @RequirePermission('services.campaign.read')
  async list(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { status } = parse(z.object({ status: z.enum(['draft', 'active', 'reported', 'closed', 'cancelled']).optional() }), query);
    const rows = await this.db
      .select({ c: testCampaign, customerName: party.name, invoiceNumber: salesInvoice.number, invoiceStatus: salesInvoice.status })
      .from(testCampaign)
      .innerJoin(party, eq(party.id, testCampaign.customerId))
      .leftJoin(salesInvoice, eq(salesInvoice.id, testCampaign.salesInvoiceId))
      .where(and(eq(testCampaign.entityId, entityId), status ? eq(testCampaign.status, status) : undefined))
      .orderBy(desc(testCampaign.createdAt))
      .limit(500);
    const ids = rows.map((r) => r.c.id);
    const held = ids.length
      ? await this.db
          .select({ id: custodyItem.campaignId, n: sql<number>`count(*)::int` })
          .from(custodyItem)
          .where(and(inArray(custodyItem.campaignId, ids), isNull(custodyItem.returnedAt)))
          .groupBy(custodyItem.campaignId)
      : [];
    return rows.map((r) => ({ ...r.c, customerName: r.customerName, invoiceNumber: r.invoiceNumber, invoiceStatus: r.invoiceStatus, inCustody: held.find((h) => h.id === r.c.id)?.n ?? 0 }));
  }

  @Get('campaigns/:id')
  @RequirePermission('services.campaign.read')
  async get(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const approver = alias(user, 'approver');
    const [r] = await this.db
      .select({ c: testCampaign, customerName: party.name, itemCode: item.code, itemName: item.name, approvedByName: approver.name, invoiceNumber: salesInvoice.number, invoiceStatus: salesInvoice.status, projectNumber: project.number })
      .from(testCampaign)
      .innerJoin(party, eq(party.id, testCampaign.customerId))
      .innerJoin(item, eq(item.id, testCampaign.serviceItemId))
      .leftJoin(project, eq(project.id, testCampaign.projectId))
      .leftJoin(approver, eq(approver.id, testCampaign.reportApprovedBy))
      .leftJoin(salesInvoice, eq(salesInvoice.id, testCampaign.salesInvoiceId))
      .where(and(eq(testCampaign.id, id), eq(testCampaign.entityId, entityId)));
    if (!r) throw new NotFoundException('Campaign not found');
    const recorder = alias(user, 'recorder');
    const steps = await this.db
      .select({ s: testCampaignStep, recordedByName: recorder.name })
      .from(testCampaignStep)
      .leftJoin(recorder, eq(recorder.id, testCampaignStep.recordedBy))
      .where(eq(testCampaignStep.campaignId, id))
      .orderBy(asc(testCampaignStep.seq));
    const receiver = alias(user, 'receiver');
    const returner = alias(user, 'returner');
    const custody = await this.db
      .select({ i: custodyItem, receivedByName: receiver.name, returnedByName: returner.name })
      .from(custodyItem)
      .innerJoin(receiver, eq(receiver.id, custodyItem.receivedBy))
      .leftJoin(returner, eq(returner.id, custodyItem.returnedBy))
      .where(eq(custodyItem.campaignId, id))
      .orderBy(asc(custodyItem.receivedAt));
    const extras = await this.db.select().from(testCampaignExtra).where(eq(testCampaignExtra.campaignId, id)).orderBy(asc(testCampaignExtra.createdAt));
    const bookings = await this.db
      .select({ id: maasBooking.id, number: maasBooking.number, status: maasBooking.status, startsAt: maasBooking.startsAt, endsAt: maasBooking.endsAt, machineCode: machine.code })
      .from(maasBooking)
      .innerJoin(machine, eq(machine.id, maasBooking.machineId))
      .where(and(eq(maasBooking.campaignId, id), eq(maasBooking.entityId, entityId)))
      .orderBy(asc(maasBooking.startsAt));
    const files = await this.db
      .select({ id: attachment.id, fileName: attachment.fileName, kind: attachment.kind })
      .from(attachment)
      .where(and(eq(attachment.entityId, entityId), eq(attachment.ownerType, 'test_campaign'), eq(attachment.ownerId, id), isNull(attachment.withdrawnAt)));
    const total = extras.reduce((s, e) => s.add(Dec.of(e.qty).mul(e.rate).toFixed(2)), Dec.of(r.c.quotedAmount));
    return {
      ...r.c,
      customerName: r.customerName,
      itemCode: r.itemCode,
      itemName: r.itemName,
      approvedByName: r.approvedByName,
      projectNumber: r.projectNumber,
      invoiceNumber: r.invoiceNumber,
      invoiceStatus: r.invoiceStatus,
      steps: steps.map((s) => ({ ...s.s, recordedByName: s.recordedByName })),
      custody: custody.map((c) => ({ ...c.i, receivedByName: c.receivedByName, returnedByName: c.returnedByName })),
      extras: extras.map((e) => ({ ...e, amount: Dec.of(e.qty).mul(e.rate).toFixed(2) })),
      bookings,
      files,
      totalAmount: total.toFixed(2),
      inCustody: custody.filter((c) => !c.i.returnedAt).length,
      pendingSteps: steps.filter((s) => s.s.result === 'pending').length,
    };
  }

  @Post('campaigns')
  @RequirePermission('services.campaign.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(campaignInput, body);
    await this.customerIn(ctx, input.customerId);
    await this.serviceItemIn(ctx, input.serviceItemId);
    return this.db.transaction(async (tx) => {
      if (input.projectId) await ProjectsController.assertLinkable(tx, entityId, input.projectId, input.customerId);
      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'test_campaign', businessDate());
      const [c] = await tx
        .insert(testCampaign)
        .values({ tenantId: ctx.tenant.tenantId, entityId, number, customerId: input.customerId, title: input.title, scope: input.scope ?? null, customerRef: input.customerRef ?? null, serviceItemId: input.serviceItemId, quotedAmount: input.quotedAmount, projectId: input.projectId ?? null, createdBy: ctx.user.id })
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'test_campaign.create', targetType: 'test_campaign', targetId: c!.id, after: { number, ...input } }, tx);
      return c!;
    });
  }

  @Put('campaigns/:id')
  @RequirePermission('services.campaign.update')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(campaignInput, body);
    await this.customerIn(ctx, input.customerId);
    await this.serviceItemIn(ctx, input.serviceItemId);
    return this.db.transaction(async (tx) => {
      const c = await this.lock(tx, entityId, id);
      if (c.status !== 'draft' && c.status !== 'active') throw new ConflictException(`A ${c.status} campaign can’t be changed`);
      if (c.status === 'active' && input.customerId !== c.customerId) throw new ConflictException('The customer is fixed once the campaign is accepted');
      if (c.projectId && input.customerId !== c.customerId) throw new ConflictException('A project campaign stays with the project’s customer');
      await tx
        .update(testCampaign)
        .set({ customerId: input.customerId, title: input.title, scope: input.scope ?? null, customerRef: input.customerRef ?? null, serviceItemId: input.serviceItemId, quotedAmount: input.quotedAmount, updatedAt: new Date() })
        .where(eq(testCampaign.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'test_campaign.update', targetType: 'test_campaign', targetId: id, before: { title: c.title, quotedAmount: c.quotedAmount }, after: input }, tx);
      return { ok: true };
    });
  }

  @Post('campaigns/:id/accept')
  @RequirePermission('services.campaign.update')
  async accept(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.transition(ctx, id, 'test_campaign.accept', async (tx, c) => {
      if (c.status !== 'draft') throw new ConflictException('Only a draft campaign is accepted');
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(testCampaignStep).where(eq(testCampaignStep.campaignId, id));
      if (!n?.n) throw new BadRequestException('Add the test steps before accepting the campaign');
      await tx.update(testCampaign).set({ status: 'active', updatedAt: new Date() }).where(eq(testCampaign.id, id));
    });
    return { ok: true };
  }

  // ── Steps and results ──

  @Post('campaigns/:id/steps')
  @RequirePermission('services.campaign.update')
  async addStep(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(stepInput, body);
    let created: unknown;
    await this.transition(ctx, id, 'test_campaign.step_add', async (tx, c) => {
      this.editable(c);
      const [m] = await tx.select({ max: sql<number>`coalesce(max(${testCampaignStep.seq}), 0)::int` }).from(testCampaignStep).where(eq(testCampaignStep.campaignId, id));
      const seq = input.seq ?? (m?.max ?? 0) + 10;
      const [dup] = await tx.select({ id: testCampaignStep.id }).from(testCampaignStep).where(and(eq(testCampaignStep.campaignId, id), eq(testCampaignStep.seq, seq)));
      if (dup) throw new ConflictException(`Step ${seq} already exists`);
      [created] = await tx.insert(testCampaignStep).values({ campaignId: id, seq, name: input.name, requirement: input.requirement ?? null }).returning();
    });
    return created;
  }

  @Put('steps/:stepId')
  @RequirePermission('services.campaign.update')
  async editStep(@Ctx() ctx: TenantRequestContext, @Param('stepId', ParseUUIDPipe) stepId: string, @Body() body: unknown) {
    const input = parse(stepInput, body);
    const step = await this.stepIn(ctx, stepId);
    await this.transition(ctx, step.campaignId, 'test_campaign.step_edit', async (tx, c) => {
      this.editable(c);
      await tx.update(testCampaignStep).set({ name: input.name, requirement: input.requirement ?? null }).where(eq(testCampaignStep.id, stepId));
    });
    return { ok: true };
  }

  @Post('steps/:stepId/result')
  @RequirePermission('services.campaign.update')
  async result(@Ctx() ctx: TenantRequestContext, @Param('stepId', ParseUUIDPipe) stepId: string, @Body() body: unknown) {
    const input = parse(resultInput, body);
    const step = await this.stepIn(ctx, stepId);
    await this.transition(ctx, step.campaignId, 'test_campaign.result', async (tx, c) => {
      if (c.status !== 'active') throw new ConflictException(c.status === 'draft' ? 'Accept the campaign before recording results' : 'Results are frozen once the report is approved');
      await tx
        .update(testCampaignStep)
        .set({ result: input.result, measured: input.measured ?? null, notes: input.notes ?? null, recordedBy: input.result === 'pending' ? null : ctx.user.id, recordedAt: input.result === 'pending' ? null : new Date() })
        .where(eq(testCampaignStep.id, stepId));
    }, { stepId, ...input });
    return { ok: true };
  }

  // ── Custody ──

  @Post('campaigns/:id/custody')
  @RequirePermission('services.campaign.update')
  async receive(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(custodyInput, body);
    let created: unknown;
    await this.transition(ctx, id, 'custody.receive', async (tx, c) => {
      if (c.status !== 'active') throw new ConflictException(c.status === 'draft' ? 'Accept the campaign before receiving the payload' : `A ${c.status} campaign doesn’t take in goods`);
      [created] = await tx.insert(custodyItem).values({ tenantId: c.tenantId, campaignId: id, description: input.description, serialNo: input.serialNo ?? null, qty: input.qty, inwardChallanNo: input.inwardChallanNo, receivedCondition: input.receivedCondition, receivedBy: ctx.user.id }).returning();
    }, input);
    return created;
  }

  @Post('custody/:itemId/return')
  @RequirePermission('services.campaign.update')
  async giveBack(@Ctx() ctx: TenantRequestContext, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(returnInput, body);
    const [ci] = await this.db.select().from(custodyItem).where(eq(custodyItem.id, itemId));
    if (!ci) throw new NotFoundException('Custody item not found');
    let challan = '';
    await this.transition(ctx, ci.campaignId, 'custody.return', async (tx) => {
      const [locked] = await tx.select().from(custodyItem).where(eq(custodyItem.id, itemId)).for('update');
      if (locked!.returnedAt) throw new ConflictException(`Already returned on ${locked!.outwardChallanNo}`);
      challan = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'custody_return', businessDate());
      await tx.update(custodyItem).set({ returnedAt: new Date(), returnedBy: ctx.user.id, returnCondition: input.returnCondition, outwardChallanNo: challan }).where(eq(custodyItem.id, itemId));
    }, { itemId, ...input });
    return { ok: true, outwardChallanNo: challan };
  }

  // ── Extras ──

  @Post('campaigns/:id/extras')
  @RequirePermission('services.campaign.update')
  async addExtra(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(extraInput, body);
    if (input.serviceItemId) await this.serviceItemIn(ctx, input.serviceItemId);
    let created: unknown;
    await this.transition(ctx, id, 'test_campaign.extra_add', async (tx, c) => {
      if (c.status === 'closed' || c.status === 'cancelled') throw new ConflictException(`A ${c.status} campaign can’t take extras`);
      if (await this.invoiceLive(tx, c.salesInvoiceId)) throw new ConflictException('The campaign is invoiced; delete or cancel the invoice to add extras');
      [created] = await tx.insert(testCampaignExtra).values({ campaignId: id, description: input.description, qty: input.qty, rate: input.rate, serviceItemId: input.serviceItemId ?? c.serviceItemId, createdBy: ctx.user.id }).returning();
    }, input);
    return created;
  }

  @Delete('extras/:extraId')
  @RequirePermission('services.campaign.update')
  async removeExtra(@Ctx() ctx: TenantRequestContext, @Param('extraId', ParseUUIDPipe) extraId: string) {
    const [e] = await this.db.select().from(testCampaignExtra).where(eq(testCampaignExtra.id, extraId));
    if (!e) throw new NotFoundException('Extra not found');
    await this.transition(ctx, e.campaignId, 'test_campaign.extra_remove', async (tx, c) => {
      if (c.status === 'closed' || c.status === 'cancelled' || (await this.invoiceLive(tx, c.salesInvoiceId))) throw new ConflictException('Extras are fixed once the campaign is invoiced or closed');
      await tx.delete(testCampaignExtra).where(eq(testCampaignExtra.id, extraId));
    }, { extraId, description: e.description });
    return { ok: true };
  }

  // ── Report, invoice, close, cancel ──

  /** Quality sign-off: every step has a result; results freeze. */
  @Post('campaigns/:id/approve')
  @RequirePermission('services.campaign.approve')
  async approve(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { summary } = parse(approveInput, body);
    await this.transition(ctx, id, 'test_campaign.approve', async (tx, c) => {
      if (c.status !== 'active') throw new ConflictException(c.status === 'draft' ? 'Accept the campaign and record results first' : 'The report is already approved');
      const [p] = await tx.select({ n: sql<number>`count(*)::int` }).from(testCampaignStep).where(and(eq(testCampaignStep.campaignId, id), eq(testCampaignStep.result, 'pending')));
      if (p?.n) throw new BadRequestException(`${p.n} step${p.n === 1 ? ' has' : 's have'} no result yet`);
      await tx.update(testCampaign).set({ status: 'reported', reportSummary: summary, reportApprovedBy: ctx.user.id, reportApprovedAt: new Date(), updatedAt: new Date() }).where(eq(testCampaign.id, id));
    }, { summary });
    return { ok: true };
  }

  /** One draft tax invoice for the quoted amount and the extras, after the report is approved. */
  @Post('campaigns/:id/invoice')
  @RequirePermission('services.billing.create', 'selling.sales_invoice.create')
  async invoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(invoiceInput, body);
    const d = await this.get(ctx, id);
    if (d.projectId) throw new ConflictException(`Billed through project ${d.projectNumber ?? ''}`.trim());
    if (d.status !== 'reported' && d.status !== 'closed') throw new ConflictException('Invoice the campaign once its report is approved');
    if (LIVE(d.invoiceStatus)) throw new ConflictException(`Already invoiced on ${d.invoiceNumber ?? 'a draft invoice'}`);
    const lines = [
      { itemId: d.serviceItemId, description: `${d.title} (campaign ${d.number}${d.customerRef ? `, your ref ${d.customerRef}` : ''})`, qty: '1', rate: d.quotedAmount },
      ...d.extras.map((e) => ({ itemId: e.serviceItemId, description: `${e.description} (campaign ${d.number})`, qty: e.qty, rate: e.rate })),
    ].filter((l) => Number(l.rate) > 0);
    if (!lines.length) throw new BadRequestException('Nothing to invoice: the quoted amount and extras are zero');
    const inv = await this.selling.createDraftInvoice(
      ctx,
      entityId,
      { customerId: d.customerId, invoiceDate: input.invoiceDate ?? businessDate(), gstRegistrationId: input.gstRegistrationId ?? null, customerPoNo: d.customerRef ?? null, remarks: `Test campaign ${d.number}`, lines },
      async (tx, invoiceId) => {
        const c = await this.lock(tx, entityId, id);
        if ((c.status !== 'reported' && c.status !== 'closed') || c.projectId || (await this.invoiceLive(tx, c.salesInvoiceId))) throw new ConflictException('The campaign changed; reload');
        await tx.update(testCampaign).set({ salesInvoiceId: invoiceId, updatedAt: new Date() }).where(eq(testCampaign.id, id));
        await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'test_campaign.invoice', targetType: 'test_campaign', targetId: id, after: { invoiceId, total: d.totalAmount } }, tx);
      },
    );
    return { invoiceId: inv.id, total: d.totalAmount };
  }

  @Post('campaigns/:id/close')
  @RequirePermission('services.campaign.update')
  async close(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.transition(ctx, id, 'test_campaign.close', async (tx, c) => {
      if (c.status !== 'reported') throw new ConflictException(c.status === 'closed' ? 'Already closed' : 'Close a campaign once its report is approved');
      // A project campaign is billed through the project's milestones, so it closes without its own invoice.
      if (!c.projectId && !(await this.invoiceLive(tx, c.salesInvoiceId))) throw new ConflictException('Invoice the campaign before closing it');
      const [h] = await tx.select({ n: sql<number>`count(*)::int` }).from(custodyItem).where(and(eq(custodyItem.campaignId, id), isNull(custodyItem.returnedAt)));
      if (h?.n) throw new ConflictException(`${h.n} item${h.n === 1 ? ' is' : 's are'} still in custody; return the payload first`);
      await this.noOpenBookings(tx, id);
      await tx.update(testCampaign).set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() }).where(eq(testCampaign.id, id));
    });
    return { ok: true };
  }

  @Post('campaigns/:id/cancel')
  @RequirePermission('services.campaign.update')
  async cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { reason } = parse(reasonInput, body);
    await this.transition(ctx, id, 'test_campaign.cancel', async (tx, c) => {
      if (c.status !== 'draft' && c.status !== 'active') throw new ConflictException(`A ${c.status} campaign can’t be cancelled`);
      const [h] = await tx.select({ n: sql<number>`count(*)::int` }).from(custodyItem).where(and(eq(custodyItem.campaignId, id), isNull(custodyItem.returnedAt)));
      if (h?.n) throw new ConflictException('Return the payload in custody before cancelling');
      await this.noOpenBookings(tx, id);
      if (await this.invoiceLive(tx, c.salesInvoiceId)) throw new ConflictException('Delete or cancel the campaign’s invoice first');
      await tx.update(testCampaign).set({ status: 'cancelled', cancelReason: reason, updatedAt: new Date() }).where(eq(testCampaign.id, id));
    }, { reason });
    return { ok: true };
  }

  // ── helpers ──

  /** Lock the campaign, run `fn`, and audit, in one transaction. */
  private async transition(ctx: TenantRequestContext, id: string, action: string, fn: (tx: Tx, c: typeof testCampaign.$inferSelect) => Promise<void>, after?: unknown) {
    const entityId = entityOf(ctx);
    await this.db.transaction(async (tx) => {
      const c = await this.lock(tx, entityId, id);
      await fn(tx, c);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action, targetType: 'test_campaign', targetId: id, after }, tx);
    });
  }

  /** A campaign can't end while one of its chamber bookings is still open (it would keep the chamber reserved). */
  private async noOpenBookings(tx: Tx, id: string) {
    const [b] = await tx
      .select({ number: maasBooking.number, status: maasBooking.status })
      .from(maasBooking)
      .where(and(eq(maasBooking.campaignId, id), inArray(maasBooking.status, ['tentative', 'confirmed', 'in_use'])))
      .limit(1);
    if (b) throw new ConflictException(`Chamber booking ${b.number} is still ${b.status.replace('_', ' ')}; complete or cancel it first`);
  }

  private editable(c: typeof testCampaign.$inferSelect) {
    if (c.status !== 'draft' && c.status !== 'active') throw new ConflictException('Steps are frozen once the report is approved');
  }

  private async lock(tx: Tx, entityId: string, id: string) {
    const [c] = await tx.select().from(testCampaign).where(and(eq(testCampaign.id, id), eq(testCampaign.entityId, entityId))).for('update');
    if (!c) throw new NotFoundException('Campaign not found');
    return c;
  }

  private async stepIn(ctx: TenantRequestContext, stepId: string) {
    const [s] = await this.db
      .select({ id: testCampaignStep.id, campaignId: testCampaignStep.campaignId })
      .from(testCampaignStep)
      .innerJoin(testCampaign, eq(testCampaign.id, testCampaignStep.campaignId))
      .where(and(eq(testCampaignStep.id, stepId), eq(testCampaign.entityId, entityOf(ctx))));
    if (!s) throw new NotFoundException('Step not found');
    return s;
  }

  private async customerIn(ctx: TenantRequestContext, id: string) {
    const [p] = await this.db.select().from(party).where(and(eq(party.id, id), eq(party.tenantId, ctx.tenant.tenantId)));
    if (!p) throw new NotFoundException('Customer not found');
    if (!p.isCustomer) throw new BadRequestException(`${p.name} is not a customer`);
  }

  private async serviceItemIn(ctx: TenantRequestContext, id: string) {
    const [s] = await this.db.select().from(item).where(and(eq(item.id, id), eq(item.tenantId, ctx.tenant.tenantId)));
    if (!s) throw new NotFoundException('Service item not found');
    if (s.type !== 'service') throw new BadRequestException(`${s.code} is not a service item; tests are billed as a service (SAC)`);
  }

  private async invoiceLive(tx: Tx, invoiceId: string | null) {
    if (!invoiceId) return false;
    const [inv] = await tx.select({ status: salesInvoice.status }).from(salesInvoice).where(eq(salesInvoice.id, invoiceId));
    return LIVE(inv?.status ?? null);
  }

  /** Bookings may only be linked to an active campaign of the same customer. */
  static async assertBookable(tx: Database | Tx, entityId: string, campaignId: string, customerId: string) {
    const [c] = await tx.select().from(testCampaign).where(and(eq(testCampaign.id, campaignId), eq(testCampaign.entityId, entityId)));
    if (!c) throw new NotFoundException('Campaign not found');
    if (c.status !== 'draft' && c.status !== 'active') throw new ConflictException(`Campaign ${c.number} is ${c.status}`);
    if (c.customerId !== customerId) throw new BadRequestException(`Campaign ${c.number} is for another customer`);
    return c;
  }
}
