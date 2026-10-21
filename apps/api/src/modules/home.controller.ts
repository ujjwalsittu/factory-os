import { Dec } from '@factoryos/core';
import {
  capa,
  capaAction,
  type Database,
  gauge,
  iotDevice,
  item,
  jobCard,
  machine,
  maintenanceOrder,
  ncr,
  party,
  project,
  purchaseInvoice,
  purchaseOrder,
  quotation,
  salesInvoice,
  salesOrder,
  stockEntry,
  timesheetEntry,
  user,
  workOrder,
} from '@factoryos/db';
import { Controller, Get, Inject } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, lt, lte, ne, not, or, sql } from 'drizzle-orm';
import { Ctx, TenantScoped, type TenantRequestContext } from '../common/access.js';
import { DB } from '../common/tokens.js';
import { BillService } from './accounting/bill.service.js';
import { businessDate, lockAccounting } from './accounting/accounting-lock.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { itc04Deadlines } from './manufacturing/itc04.controller.js';

/** One line of a tile: what it is, a short detail, and the page that opens it. */
export interface TileRow {
  label: string;
  detail: string;
  href: string;
  /** The next step for this row (decision 068 hand-offs), shown only with the permission to take it. */
  action?: { label: string; href: string; permission: string };
}

export interface Tile {
  id: string;
  group: 'needs_me' | 'sell' | 'buy' | 'stock' | 'make' | 'quality' | 'machines';
  title: string;
  /** Everything counted, not only the rows shown. */
  count: number;
  /** For money tiles: the total in INR, two decimals. */
  amountInr?: string;
  rows: TileRow[];
  /** The page that lists all of it. */
  href: string;
  /** True when this tile could not be computed; the others are unaffected. */
  error?: boolean;
}

interface Env {
  entityId: string;
  tenantId: string;
  userId: string;
  today: string;
}

type Result = { count: number; rows: TileRow[]; amountInr?: string };

interface Def {
  id: string;
  group: Tile['group'];
  title: string;
  href: string;
  /** Every permission the person needs; a tile they cannot read is not returned at all. */
  needs: string[];
  /** Alternatively, at least one of these. */
  needsAny?: string[];
  run: (e: Env) => Promise<Result>;
}

const ROWS = 5;
const TILE_TIMEOUT_MS = 8000;
const num = (n: unknown) => Number(n ?? 0);
/** A quantity without its trailing zeros (40.000000 → 40). */
const qtyText = (v: string) => String(Number(v));
const short = (s: string | null | undefined, n = 60) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? ''));
/** YYYY-MM-DD plus whole days. */
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Documents a person left in draft: each with its read permission, list page and how drafts are labelled. */
const DRAFT_DOCS = [
  { kind: 'Sales invoice', perm: 'selling.sales_invoice.read', base: '/app/selling/invoices', table: salesInvoice },
  { kind: 'Sales order', perm: 'selling.sales_order.read', base: '/app/selling/orders', table: salesOrder },
  { kind: 'Quotation', perm: 'selling.quotation.read', base: '/app/selling/quotations', table: quotation },
  { kind: 'Purchase order', perm: 'buying.purchase_order.read', base: '/app/buying/orders', table: purchaseOrder },
  { kind: 'Purchase invoice', perm: 'buying.purchase_invoice.read', base: '/app/buying/invoices', table: purchaseInvoice },
  { kind: 'Stock entry', perm: 'inventory.stock_entry.read', base: '/app/inventory/entries', table: stockEntry },
] as const;

/**
 * "My work" (decision 068, slice 2): what needs the signed-in person in the active entity, as counts and the top rows,
 * each with a link. A tile is returned only when the person can read what it counts. Each tile is computed on its own,
 * so one failing or slow tile reports `error` and never blocks the rest.
 */
@Controller()
export class HomeController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bills: BillService,
    private readonly maintenance: MaintenanceService,
  ) {}

  @Get('home')
  @TenantScoped()
  async home(@Ctx() ctx: TenantRequestContext): Promise<{ needsEntity: boolean; asOf: string; tiles: Tile[] }> {
    const asOf = businessDate();
    const entityId = ctx.tenant.activeEntityId;
    if (!entityId) return { needsEntity: true, asOf, tiles: [] };
    const env: Env = { entityId, tenantId: ctx.tenant.tenantId, userId: ctx.user.id, today: asOf };
    const mine = this.defs(ctx).filter((d) => d.needs.every((p) => ctx.tenant.permissions.has(p)) && (!d.needsAny || d.needsAny.some((p) => ctx.tenant.permissions.has(p))));
    const settled = await Promise.allSettled(
      mine.map((d) => {
        let timer: NodeJS.Timeout | undefined;
        const limit = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), TILE_TIMEOUT_MS);
        });
        return Promise.race([d.run(env), limit]).finally(() => clearTimeout(timer));
      }),
    );
    const tiles = mine.map((d, i): Tile => {
      const r = settled[i]!;
      const base = { id: d.id, group: d.group, title: d.title, href: d.href };
      if (r.status !== 'fulfilled') return { ...base, count: 0, rows: [], error: true };
      const rows = r.value.rows.map(({ action, ...row }) => (action && ctx.tenant.permissions.has(action.permission) ? { ...row, action } : row));
      return { ...base, ...r.value, rows };
    });
    return { needsEntity: false, asOf, tiles };
  }

  private defs(ctx: TenantRequestContext): Def[] {
    const db = this.db;
    const perms = ctx.tenant.permissions;
    return [
      // ── Needs me ──
      {
        id: 'timesheets-approve',
        group: 'needs_me',
        title: 'Timesheets waiting for my approval',
        href: '/app/approvals?kind=timesheet',
        needs: ['services.timesheet.read', 'services.timesheet.approve'],
        run: async (e) => {
          const where = and(eq(timesheetEntry.entityId, e.entityId), eq(timesheetEntry.status, 'submitted'), ne(timesheetEntry.userId, e.userId));
          const [c] = await db.select({ n: count() }).from(timesheetEntry).where(where);
          const rows = await db
            .select({ name: user.name, workDate: timesheetEntry.workDate, hours: timesheetEntry.hours, project: project.number })
            .from(timesheetEntry)
            .innerJoin(user, eq(user.id, timesheetEntry.userId))
            .innerJoin(project, eq(project.id, timesheetEntry.projectId))
            .where(where)
            .orderBy(asc(timesheetEntry.workDate))
            .limit(ROWS);
          return { count: num(c?.n), rows: rows.map((r) => ({ label: r.name, detail: `${r.project} · ${Number(r.hours)} h on ${r.workDate}`, href: '/app/services/timesheets' })) };
        },
      },
      {
        id: 'ncr-dispositions',
        group: 'needs_me',
        title: 'NCR dispositions waiting for approval',
        href: '/app/approvals?kind=ncr',
        needs: ['quality.ncr.read', 'quality.ncr.approve'],
        run: async (e) => {
          const where = and(eq(ncr.entityId, e.entityId), eq(ncr.status, 'open'), sql`exists (select 1 from ncr_disposition d where d.ncr_id = ${ncr.id} and d.status = 'proposed')`);
          const [c] = await db.select({ n: count() }).from(ncr).where(where);
          const rows = await db.select({ id: ncr.id, number: ncr.number, description: ncr.description }).from(ncr).where(where).orderBy(asc(ncr.createdAt)).limit(ROWS);
          return { count: num(c?.n), rows: rows.map((r) => ({ label: r.number ?? 'NCR', detail: short(r.description), href: `/app/quality/ncrs/${r.id}` })) };
        },
      },
      {
        id: 'maintenance-verify',
        group: 'needs_me',
        title: 'Maintenance orders waiting for my verification',
        href: '/app/approvals?kind=maintenance',
        needs: ['maintenance.order.read', 'maintenance.order.approve'],
        run: async (e) => {
          // Critical machines only; the person who signed the work off cannot verify it.
          const where = and(eq(maintenanceOrder.entityId, e.entityId), eq(maintenanceOrder.status, 'done'), eq(machine.critical, true), sql`${maintenanceOrder.doneBy} is distinct from ${e.userId}`);
          const [c] = await db.select({ n: count() }).from(maintenanceOrder).innerJoin(machine, eq(machine.id, maintenanceOrder.machineId)).where(where);
          const rows = await db
            .select({ id: maintenanceOrder.id, number: maintenanceOrder.number, title: maintenanceOrder.title, machine: machine.code })
            .from(maintenanceOrder)
            .innerJoin(machine, eq(machine.id, maintenanceOrder.machineId))
            .where(where)
            .orderBy(asc(maintenanceOrder.doneAt))
            .limit(ROWS);
          return { count: num(c?.n), rows: rows.map((r) => ({ label: r.number, detail: `${r.machine} · ${short(r.title)}`, href: `/app/maintenance/orders/${r.id}` })) };
        },
      },
      {
        id: 'my-drafts',
        group: 'needs_me',
        title: 'My drafts older than a day',
        href: '/app',
        needs: [],
        needsAny: DRAFT_DOCS.map((d) => d.perm),
        run: async (e) => {
          const cutoff = new Date(Date.now() - 86_400_000);
          const docs = DRAFT_DOCS.filter((d) => perms.has(d.perm));
          const parts = await Promise.all(
            docs.map(async (d) => {
              // The six document tables share these columns; one typed view of them keeps the query in one place.
              const t = d.table as unknown as typeof salesInvoice;
              const where = and(eq(t.entityId, e.entityId), eq(t.status, 'draft'), eq(t.createdBy, e.userId), lt(t.createdAt, cutoff));
              const [c] = await db.select({ n: count() }).from(t).where(where);
              const rows = await db.select({ id: t.id, number: t.number, createdAt: t.createdAt }).from(t).where(where).orderBy(asc(t.createdAt)).limit(ROWS);
              return { d, n: num(c?.n), rows };
            }),
          );
          const rows = parts
            .flatMap((p) => p.rows.map((r) => ({ createdAt: r.createdAt, label: r.number ?? `Draft ${p.d.kind.toLowerCase()}`, detail: `${p.d.kind} · started ${r.createdAt.toISOString().slice(0, 10)}`, href: `${p.d.base}/${r.id}` })))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .slice(0, ROWS)
            .map(({ label, detail, href }) => ({ label, detail, href }));
          return { count: parts.reduce((s, p) => s + p.n, 0), rows };
        },
      },
      // ── Sell & cash ──
      {
        id: 'overdue-receivables',
        group: 'sell',
        title: 'Overdue customer bills',
        href: '/app/accounts/outstanding',
        needs: ['accounts.report.read'],
        run: async (e) => {
          const open = await this.openBills(ctx, e, 'receivable');
          const late = open.filter((b) => b.dueDate && b.dueDate < e.today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
          const names = await this.partyNames(late.slice(0, ROWS).map((b) => b.partyId));
          return {
            count: late.length,
            amountInr: late.reduce((s, b) => s.add(b.carryingInr), Dec.ZERO).toFixed(2),
            rows: late.slice(0, ROWS).map((b) => ({
              label: names.get(b.partyId) ?? b.reference,
              detail: `${b.reference} · INR ${Dec.of(b.carryingInr).toFixed(2)} · due ${b.dueDate}`,
              href: '/app/accounts/outstanding',
              action: { label: 'Record receipt', href: `/app/accounts/settlements/new?direction=receipt&party=${b.partyId}`, permission: 'accounts.settlement.create' },
            })),
          };
        },
      },
      {
        id: 'quotations-expiring',
        group: 'sell',
        title: 'Quotations expiring within 7 days',
        href: '/app/selling/quotations',
        needs: ['selling.quotation.read'],
        run: async (e) => {
          const where = and(
            eq(quotation.entityId, e.entityId),
            eq(quotation.status, 'submitted'),
            sql`${quotation.validTill} between ${e.today}::date and ${addDays(e.today, 7)}::date`,
            sql`not exists (select 1 from sales_order o where o.quotation_id = ${quotation.id} and o.status <> 'cancelled')`,
          );
          const [c] = await db.select({ n: count() }).from(quotation).where(where);
          const rows = await db
            .select({ id: quotation.id, number: quotation.number, customer: party.name, validTill: quotation.validTill })
            .from(quotation)
            .innerJoin(party, eq(party.id, quotation.customerId))
            .where(where)
            .orderBy(asc(quotation.validTill))
            .limit(ROWS);
          return { count: num(c?.n), rows: rows.map((r) => ({ label: r.number ?? 'Quotation', detail: `${r.customer} · valid till ${r.validTill}`, href: `/app/selling/quotations/${r.id}` })) };
        },
      },
      // ── Buy & pay ──
      {
        id: 'late-purchase-orders',
        group: 'buy',
        title: 'Purchase orders past their expected date',
        href: '/app/buying/orders',
        needs: ['buying.purchase_order.read'],
        run: async (e) => {
          const where = and(
            eq(purchaseOrder.entityId, e.entityId),
            eq(purchaseOrder.status, 'submitted'),
            isNull(purchaseOrder.closedAt),
            lt(purchaseOrder.expectedDate, e.today),
            sql`exists (select 1 from purchase_order_line l where l.po_id = ${purchaseOrder.id} and l.received_qty < l.qty)`,
          );
          const [c] = await db.select({ n: count() }).from(purchaseOrder).where(where);
          const rows = await db
            .select({ id: purchaseOrder.id, number: purchaseOrder.number, supplier: party.name, expected: purchaseOrder.expectedDate })
            .from(purchaseOrder)
            .innerJoin(party, eq(party.id, purchaseOrder.supplierId))
            .where(where)
            .orderBy(asc(purchaseOrder.expectedDate))
            .limit(ROWS);
          return { count: num(c?.n), rows: rows.map((r) => ({ label: r.number ?? 'Purchase order', detail: `${r.supplier} · expected ${r.expected}`, href: `/app/buying/orders/${r.id}` })) };
        },
      },
      {
        id: 'payables-due',
        group: 'buy',
        title: 'Supplier bills due within 7 days or overdue',
        href: '/app/accounts/outstanding',
        needs: ['accounts.report.read'],
        run: async (e) => {
          const open = await this.openBills(ctx, e, 'payable');
          const soon = open.filter((b) => b.dueDate && b.dueDate <= addDays(e.today, 7)).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
          const names = await this.partyNames(soon.slice(0, ROWS).map((b) => b.partyId));
          return {
            count: soon.length,
            amountInr: soon.reduce((s, b) => s.add(b.carryingInr), Dec.ZERO).toFixed(2),
            rows: soon.slice(0, ROWS).map((b) => ({
              label: names.get(b.partyId) ?? b.reference,
              detail: `${b.reference} · INR ${Dec.of(b.carryingInr).toFixed(2)} · due ${b.dueDate}`,
              href: '/app/accounts/outstanding?side=payable',
              action: { label: 'Record payment', href: `/app/accounts/settlements/new?direction=payment&party=${b.partyId}`, permission: 'accounts.settlement.create' },
            })),
          };
        },
      },
      // ── Stock ──
      {
        id: 'below-reorder',
        group: 'stock',
        title: 'Items below their reorder level',
        href: '/app/inventory/balance',
        needs: ['masters.item.read', 'inventory.report.read'],
        run: async (e) => {
          // Own stock only (customer-owned material is not ours to reorder); an item with no stock at all counts as zero.
          const res = await db.execute<{ id: string; code: string; name: string; reorder: string; on_hand: string }>(sql`
            select i.id, i.code, i.name, i.reorder_level as reorder, coalesce(sum(b.qty), 0) as on_hand
            from ${item} i
            left join stock_bin b on b.item_id = i.id and b.entity_id = ${e.entityId} and b.owner_party_id is null
            where i.tenant_id = ${e.tenantId} and i.is_active and i.is_stock_item and i.reorder_level is not null
            group by i.id
            having coalesce(sum(b.qty), 0) < i.reorder_level
            order by (i.reorder_level - coalesce(sum(b.qty), 0)) desc, i.code`);
          const all = res.rows;
          return { count: all.length, rows: all.slice(0, ROWS).map((r) => ({
              label: `${r.code} ${r.name}`,
              detail: `${qtyText(r.on_hand)} on hand, reorder at ${qtyText(r.reorder)}`,
              href: '/app/inventory/balance',
              // Prefilled with the shortfall up to the reorder level.
              action: { label: 'Create purchase order', href: `/app/buying/orders/new?item=${r.id}&qty=${qtyText(Dec.of(r.reorder).sub(r.on_hand).toString())}`, permission: 'buying.purchase_order.create' },
            })) };
        },
      },
      {
        id: 'job-work-due',
        group: 'stock',
        title: 'Job work goods due back or overdue',
        href: '/app/compliance/itc04',
        needs: ['compliance.job_work_return.read'],
        run: async (e) => {
          const r = await itc04Deadlines(db, e.entityId);
          const lines = r.lines.filter((l) => l.state === 'due_soon' || l.state === 'overdue');
          return { count: r.soon, rows: lines.slice(0, ROWS).map((l) => ({ label: `${l.challanNo ?? 'Challan'} · ${l.itemCode}`, detail: `${l.jobWorker} · ${l.state === 'overdue' ? 'overdue since' : 'due by'} ${l.due}`, href: `/app/manufacturing/job-work/${l.orderId}` })) };
        },
      },
      // ── Make ──
      {
        id: 'late-work-orders',
        group: 'make',
        title: 'Work orders past their planned end',
        href: '/app/manufacturing',
        needs: ['manufacturing.work_order.read'],
        run: async (e) => {
          const where = and(eq(workOrder.entityId, e.entityId), eq(workOrder.status, 'released'), lt(workOrder.plannedEnd, e.today));
          const [c] = await db.select({ n: count() }).from(workOrder).where(where);
          const rows = await db
            .select({ id: workOrder.id, number: workOrder.number, code: item.code, plannedEnd: workOrder.plannedEnd })
            .from(workOrder)
            .innerJoin(item, eq(item.id, workOrder.itemId))
            .where(where)
            .orderBy(asc(workOrder.plannedEnd))
            .limit(ROWS);
          return { count: num(c?.n), rows: rows.map((r) => ({ label: r.number ?? 'Work order', detail: `${r.code} · planned end ${r.plannedEnd}`, href: `/app/manufacturing/work-orders/${r.id}` })) };
        },
      },
      {
        id: 'my-job-cards',
        group: 'make',
        title: 'My job cards left running or paused',
        href: '/app/manufacturing/shop-floor',
        needs: ['manufacturing.job_card.read'],
        run: async (e) => {
          const where = and(eq(jobCard.entityId, e.entityId), eq(jobCard.operatorId, e.userId), inArray(jobCard.status, ['running', 'paused']));
          const [c] = await db.select({ n: count() }).from(jobCard).where(where);
          const rows = await db
            .select({ status: jobCard.status, createdAt: jobCard.createdAt, wo: workOrder.number })
            .from(jobCard)
            .innerJoin(workOrder, eq(workOrder.id, jobCard.workOrderId))
            .where(where)
            .orderBy(asc(jobCard.createdAt))
            .limit(ROWS);
          return { count: num(c?.n), rows: rows.map((r) => ({ label: r.wo ?? 'Work order', detail: `${r.status} since ${r.createdAt.toISOString().slice(0, 10)}`, href: '/app/manufacturing/shop-floor' })) };
        },
      },
      // ── Quality ──
      {
        id: 'open-ncrs',
        group: 'quality',
        title: 'Open NCRs',
        href: '/app/quality/ncrs',
        needs: ['quality.ncr.read'],
        run: async (e) => {
          const where = and(eq(ncr.entityId, e.entityId), eq(ncr.status, 'open'));
          const [c] = await db.select({ n: count() }).from(ncr).where(where);
          const rows = await db.select({ id: ncr.id, number: ncr.number, description: ncr.description }).from(ncr).where(where).orderBy(asc(ncr.createdAt)).limit(ROWS);
          return {
            count: num(c?.n),
            rows: rows.map((r) => ({
              label: r.number ?? 'NCR',
              detail: short(r.description),
              href: `/app/quality/ncrs/${r.id}`,
              action: { label: 'Raise CAPA', href: `/app/quality/ncrs/${r.id}?capa=1`, permission: 'quality.capa.create' },
            })),
          };
        },
      },
      {
        id: 'capa-overdue',
        group: 'quality',
        title: 'CAPA actions past their due date',
        href: '/app/quality/capas',
        needs: ['quality.capa.read'],
        run: async (e) => {
          const where = and(eq(capa.entityId, e.entityId), eq(capaAction.status, 'open'), lt(capaAction.dueOn, e.today), not(inArray(capa.status, ['closed', 'cancelled'])));
          const [c] = await db.select({ n: count() }).from(capaAction).innerJoin(capa, eq(capa.id, capaAction.capaId)).where(where);
          const rows = await db
            .select({ capaId: capa.id, number: capa.number, description: capaAction.description, dueOn: capaAction.dueOn })
            .from(capaAction)
            .innerJoin(capa, eq(capa.id, capaAction.capaId))
            .where(where)
            .orderBy(asc(capaAction.dueOn))
            .limit(ROWS);
          return { count: num(c?.n), rows: rows.map((r) => ({ label: r.number, detail: `${short(r.description, 50)} · due ${r.dueOn}`, href: `/app/quality/capas/${r.capaId}` })) };
        },
      },
      {
        id: 'gauges-due',
        group: 'quality',
        title: 'Gauges due for calibration within 30 days',
        href: '/app/quality/gauges',
        needs: ['quality.gauge.read'],
        run: async (e) => {
          const where = and(eq(gauge.entityId, e.entityId), eq(gauge.status, 'in_service'), lte(gauge.dueDate, addDays(e.today, 30)));
          const [c] = await db.select({ n: count() }).from(gauge).where(where);
          const rows = await db.select({ code: gauge.code, description: gauge.description, dueDate: gauge.dueDate }).from(gauge).where(where).orderBy(asc(gauge.dueDate)).limit(ROWS);
          return { count: num(c?.n), rows: rows.map((r) => ({ label: r.code, detail: `${short(r.description, 40)} · ${r.dueDate && r.dueDate < e.today ? 'overdue since' : 'due'} ${r.dueDate}`, href: '/app/quality/gauges' })) };
        },
      },
      // ── Machines ──
      {
        id: 'machines-down',
        group: 'machines',
        title: 'Machines in alarm or maintenance',
        href: '/app/machines',
        needs: ['plant.machine_state.read'],
        run: async (e) => {
          // Only taps that are reporting (heard from within three heartbeats); a silent tap says nothing about its machine.
          const where = and(
            eq(iotDevice.entityId, e.entityId),
            eq(iotDevice.status, 'active'),
            inArray(iotDevice.lastState, ['alarm', 'maintenance']),
            sql`${iotDevice.lastSeenAt} > now() - (${iotDevice.heartbeatSeconds} * 3) * interval '1 second'`,
          );
          const [c] = await db.select({ n: count() }).from(iotDevice).where(where);
          const rows = await db
            .select({ machineId: machine.id, code: machine.code, name: machine.name, state: iotDevice.lastState })
            .from(iotDevice)
            .innerJoin(machine, eq(machine.id, iotDevice.machineId))
            .where(where)
            .orderBy(asc(machine.code))
            .limit(ROWS);
          return { count: num(c?.n), rows: rows.map((r) => ({ label: `${r.code} ${r.name}`, detail: r.state === 'alarm' ? 'In alarm' : 'In maintenance', href: `/app/machines/${r.machineId}` })) };
        },
      },
      {
        id: 'maintenance-due',
        group: 'machines',
        title: 'Maintenance due or overdue',
        href: '/app/maintenance',
        needs: ['maintenance.plan.read'],
        run: async (e) => {
          // Plans with no open order yet: the same calculation as the Maintenance page.
          const plans = (await this.maintenance.dueList(db, e.entityId)).filter((p) => p.due.status !== 'ok' && !p.due.openOrder);
          return { count: plans.length, rows: plans.slice(0, ROWS).map((p) => ({ label: `${p.machineCode} ${p.machineName}`, detail: `${p.name} · ${p.due.status === 'overdue' ? 'overdue' : 'due soon'}`, href: '/app/maintenance' })) };
        },
      },
      {
        id: 'taps-silent',
        group: 'machines',
        title: 'Taps not reporting',
        href: '/app/plant/devices',
        needs: ['plant.device.read'],
        run: async (e) => {
          const where = and(
            eq(iotDevice.entityId, e.entityId),
            eq(iotDevice.status, 'active'),
            or(isNull(iotDevice.lastSeenAt), sql`${iotDevice.lastSeenAt} <= now() - (${iotDevice.heartbeatSeconds} * 3) * interval '1 second'`),
          );
          const [c] = await db.select({ n: count() }).from(iotDevice).where(where);
          const rows = await db.select({ code: iotDevice.code, name: iotDevice.name, lastSeenAt: iotDevice.lastSeenAt }).from(iotDevice).where(where).orderBy(asc(iotDevice.code)).limit(ROWS);
          return { count: num(c?.n), rows: rows.map((r) => ({ label: `${r.code} ${r.name}`, detail: r.lastSeenAt ? `last heard ${r.lastSeenAt.toISOString().slice(0, 10)}` : 'never heard from', href: '/app/plant/devices' })) };
        },
      },
    ];
  }

  /** Open bills of one side, as the Outstanding page sees them (bills are brought up to date first, under the same lock). */
  private async openBills(ctx: TenantRequestContext, e: Env, side: 'receivable' | 'payable') {
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, e.entityId);
      await this.bills.syncIn(tx, ctx, e.entityId);
      const all = await this.bills.list(tx, e.entityId, { side, asOf: e.today, openOnly: true });
      return all.filter((b) => b.kind === 'bill' && Dec.of(b.carryingInr).gt('0'));
    });
  }

  private async partyNames(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.db.select({ id: party.id, name: party.name }).from(party).where(inArray(party.id, unique));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
