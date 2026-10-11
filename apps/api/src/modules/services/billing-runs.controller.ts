// Phase 3f billing runs (decision 060): everything due across the service sources, raised as one draft invoice per
// customer and customer reference, then reviewed and submitted through the normal invoice submit.
import { Dec } from '@factoryos/core';
import { billingRun, billingRunInvoice, party, salesInvoice, type Database, user } from '@factoryos/db';
import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf } from '../accounting/accounting-lock.js';
import { SellingController } from '../selling.controller.js';
import { StockPostingService } from '../stock-posting.service.js';
import { type Billable, type BillableKind, BILLABLE_ORDER } from './billables.js';
import { CampaignsController } from './campaigns.controller.js';
import { MaasController } from './maas.controller.js';
import { ProjectsController } from './projects.controller.js';
import { SubscriptionsController } from './subscriptions.controller.js';

const KINDS = ['subscription', 'booking', 'milestone', 'campaign'] as const;
const scopeInput = z.object({
  kinds: z.array(z.enum(KINDS)).min(1).default([...KINDS]),
  customerIds: z.array(z.uuid()).max(500).optional(),
});
const runInput = scopeInput.extend({ asOf: z.iso.date().optional() });
const previewQuery = z.object({ kinds: z.string().optional(), customerIds: z.string().optional() });

type Group = { customerId: string; customerName: string; customerRef: string | null; items: Billable[]; amount: string };
const LIVE = (s: string | null | undefined) => s === 'draft' || s === 'submitted';

/** The message of a refusal, whether an HTTP exception (with a validation body) or a plain error. */
function messageOf(e: unknown): string {
  if (e instanceof HttpException) {
    const r = e.getResponse() as string | { message?: string | string[] };
    if (typeof r === 'string') return r;
    return Array.isArray(r.message) ? r.message.join('; ') : (r.message ?? e.message);
  }
  return e instanceof Error ? e.message : String(e);
}

@Controller('services')
export class BillingRunsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
    private readonly selling: SellingController,
    private readonly maas: MaasController,
    private readonly campaigns: CampaignsController,
    private readonly projects: ProjectsController,
    private readonly subscriptions: SubscriptionsController,
  ) {}

  /** Everything due now, grouped as a run would invoice it; nothing is written. */
  @Get('billing-runs/preview')
  @RequirePermission('services.billing_run.read')
  async preview(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const q = parse(previewQuery, query);
    const scope = parse(scopeInput, { kinds: q.kinds ? q.kinds.split(',') : undefined, customerIds: q.customerIds ? q.customerIds.split(',') : undefined });
    const { groups, skipped } = await this.collect(ctx, scope);
    return {
      groups: groups.map((g) => ({ customerId: g.customerId, customerName: g.customerName, customerRef: g.customerRef, amount: g.amount, items: g.items.map(item) })),
      skipped,
      total: groups.reduce((t, g) => t.add(g.amount), Dec.ZERO).toFixed(2),
    };
  }

  @Post('billing-runs')
  @RequirePermission('services.billing_run.create', 'services.billing.create', 'selling.sales_invoice.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(runInput, body ?? {});
    const asOf = input.asOf ?? businessDate();
    if (asOf > businessDate()) throw new BadRequestException({ message: 'A tax invoice cannot be dated in the future', issues: [{ path: 'asOf', message: 'Use today or earlier' }] });
    const { groups, skipped } = await this.collect(ctx, input);
    if (!groups.length) throw new BadRequestException(skipped.length ? `Nothing can be billed: ${skipped.map((s) => `${s.label}: ${s.message}`).join('; ')}` : 'Nothing is due');
    const run = await this.db.transaction(async (tx) => {
      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'billing_run', asOf);
      const [r] = await tx.insert(billingRun).values({ tenantId: ctx.tenant.tenantId, entityId, number, asOf, kinds: input.kinds, createdBy: ctx.user.id }).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'billing_run.create', targetType: 'billing_run', targetId: r!.id, after: { number, asOf, kinds: input.kinds, groups: groups.length } }, tx);
      return r!;
    });
    const failures: (typeof billingRun.$inferSelect)['failures'] = [];
    let invoices = 0;
    for (const g of groups) {
      // Lock sources in one order across runs, so concurrent runs can't deadlock.
      const items = [...g.items].sort((a, b) => BILLABLE_ORDER[a.kind] - BILLABLE_ORDER[b.kind] || a.sourceId.localeCompare(b.sourceId));
      const lines = items.flatMap((b) => b.lines);
      const record = async (tx: Parameters<Billable['settle']>[0], invoiceId: string | null) => {
        for (const b of items) await b.settle(tx, b.lines.length ? invoiceId : null);
        await tx.insert(billingRunInvoice).values({ runId: run.id, salesInvoiceId: invoiceId, customerId: g.customerId, customerRef: g.customerRef, items: items.map(item), amount: g.amount });
      };
      try {
        if (!lines.length) await this.db.transaction((tx) => record(tx, null));
        else {
          await this.selling.createDraftInvoice(ctx, entityId, { customerId: g.customerId, invoiceDate: asOf, customerPoNo: g.customerRef, remarks: `Billing run ${run.number}`, lines }, record);
          invoices++;
        }
      } catch (e) {
        failures.push({ customerId: g.customerId, customerName: g.customerName, customerRef: g.customerRef, items: items.map((b) => b.label), message: messageOf(e) });
      }
    }
    for (const s of skipped) failures.push({ customerId: s.customerId ?? '', customerName: s.customerName ?? '', customerRef: null, items: [s.label], message: s.message });
    if (failures.length) await this.db.update(billingRun).set({ failures }).where(eq(billingRun.id, run.id));
    return { id: run.id, number: run.number, invoices, failures: failures.length };
  }

  @Get('billing-runs')
  @RequirePermission('services.billing_run.read')
  async list(@Ctx() ctx: TenantRequestContext) {
    const runs = await this.db
      .select({ r: billingRun, createdByName: user.name })
      .from(billingRun)
      .innerJoin(user, eq(user.id, billingRun.createdBy))
      .where(eq(billingRun.entityId, entityOf(ctx)))
      .orderBy(desc(billingRun.createdAt))
      .limit(200);
    const ids = runs.map((r) => r.r.id);
    const rows = ids.length
      ? await this.db
          .select({ runId: billingRunInvoice.runId, amount: billingRunInvoice.amount, status: salesInvoice.status, grandTotal: salesInvoice.grandTotal, salesInvoiceId: billingRunInvoice.salesInvoiceId })
          .from(billingRunInvoice)
          .leftJoin(salesInvoice, eq(salesInvoice.id, billingRunInvoice.salesInvoiceId))
          .where(inArray(billingRunInvoice.runId, ids))
      : [];
    return runs.map((r) => {
      const mine = rows.filter((x) => x.runId === r.r.id && x.salesInvoiceId);
      return {
        ...r.r,
        createdByName: r.createdByName,
        invoices: mine.filter((x) => LIVE(x.status)).length,
        drafts: mine.filter((x) => x.status === 'draft').length,
        total: mine.filter((x) => LIVE(x.status)).reduce((t, x) => t.add(x.grandTotal ?? '0'), Dec.ZERO).toFixed(2),
      };
    });
  }

  @Get('billing-runs/:id')
  @RequirePermission('services.billing_run.read')
  async get(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const [r] = await this.db
      .select({ r: billingRun, createdByName: user.name })
      .from(billingRun)
      .innerJoin(user, eq(user.id, billingRun.createdBy))
      .where(and(eq(billingRun.id, id), eq(billingRun.entityId, entityOf(ctx))));
    if (!r) throw new NotFoundException('Billing run not found');
    const invoices = await this.db
      .select({ i: billingRunInvoice, customerName: party.name, invoiceNumber: salesInvoice.number, invoiceStatus: salesInvoice.status, grandTotal: salesInvoice.grandTotal })
      .from(billingRunInvoice)
      .innerJoin(party, eq(party.id, billingRunInvoice.customerId))
      .leftJoin(salesInvoice, eq(salesInvoice.id, billingRunInvoice.salesInvoiceId))
      .where(eq(billingRunInvoice.runId, id))
      .orderBy(asc(party.name));
    return {
      ...r.r,
      createdByName: r.createdByName,
      invoices: invoices.map((x) => ({ ...x.i, customerName: x.customerName, invoiceNumber: x.invoiceNumber, invoiceStatus: x.i.salesInvoiceId ? (x.invoiceStatus ?? 'deleted') : null, grandTotal: x.grandTotal })),
    };
  }

  /** Submit each draft of the run through the normal submit (credit limit, LUT, dates); refusals stay drafts. */
  @Post('billing-runs/:id/submit')
  @RequirePermission('services.billing_run.read', 'selling.sales_invoice.submit')
  async submitAll(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const run = await this.get(ctx, id);
    let submitted = 0;
    let refused = 0;
    for (const inv of run.invoices) {
      if (!inv.salesInvoiceId || inv.invoiceStatus !== 'draft') continue;
      try {
        await this.selling.submitInvoice(ctx, inv.salesInvoiceId, {});
        await this.db.update(billingRunInvoice).set({ submitError: null }).where(eq(billingRunInvoice.id, inv.id));
        submitted++;
      } catch (e) {
        if (e instanceof ForbiddenException) throw e;
        await this.db.update(billingRunInvoice).set({ submitError: messageOf(e) }).where(eq(billingRunInvoice.id, inv.id));
        refused++;
      }
    }
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId: entityOf(ctx), action: 'billing_run.submit', targetType: 'billing_run', targetId: id, after: { submitted, refused } });
    return { submitted, refused };
  }

  // ── helpers ──

  /** Billables of every due source in scope, grouped by customer and reference; sources that can't bill are skipped. */
  private async collect(ctx: TenantRequestContext, scope: z.infer<typeof scopeInput>) {
    const entityId = entityOf(ctx);
    const sources: Record<BillableKind, { ids: () => Promise<string[]>; billable: (id: string) => Promise<Billable> }> = {
      subscription: { ids: () => this.subscriptions.dueSubscriptionIds(entityId), billable: (id) => this.subscriptions.subscriptionBillable(ctx, id) },
      booking: { ids: () => this.maas.dueBookingIds(entityId), billable: (id) => this.maas.bookingBillable(ctx, id) },
      milestone: { ids: () => this.projects.dueMilestoneIds(entityId), billable: (id) => this.projects.milestoneBillable(ctx, id) },
      campaign: { ids: () => this.campaigns.dueCampaignIds(entityId), billable: (id) => this.campaigns.campaignBillable(ctx, id) },
    };
    const billables: Billable[] = [];
    const skipped: { kind: BillableKind; sourceId: string; label: string; customerId?: string; customerName?: string; message: string }[] = [];
    for (const kind of KINDS) {
      if (!scope.kinds.includes(kind)) continue;
      for (const id of await sources[kind].ids()) {
        try {
          const b = await sources[kind].billable(id);
          if (!scope.customerIds || scope.customerIds.includes(b.customerId)) billables.push(b);
        } catch (e) {
          skipped.push({ kind, sourceId: id, label: `${kind} ${id.slice(0, 8)}`, message: messageOf(e) });
        }
      }
    }
    const names = billables.length ? new Map((await this.db.select({ id: party.id, name: party.name }).from(party).where(inArray(party.id, [...new Set(billables.map((b) => b.customerId))]))).map((p) => [p.id, p.name])) : new Map<string, string>();
    const groups = new Map<string, Group>();
    for (const b of billables) {
      const key = `${b.customerId}|${b.customerRef ?? ''}`;
      const g = groups.get(key) ?? { customerId: b.customerId, customerName: names.get(b.customerId) ?? '', customerRef: b.customerRef, items: [], amount: '0.00' };
      g.items.push(b);
      g.amount = Dec.of(g.amount).add(b.amount).toFixed(2);
      groups.set(key, g);
    }
    return { groups: [...groups.values()].sort((a, b) => a.customerName.localeCompare(b.customerName) || (a.customerRef ?? '').localeCompare(b.customerRef ?? '')), skipped };
  }
}

const item = (b: Billable) => ({ kind: b.kind, sourceId: b.sourceId, label: b.label, amount: b.amount });
