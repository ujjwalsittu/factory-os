// Decision 066: machine maintenance. Plans fall due by calendar and/or running hours (from the tap, or job cards on a
// machine without one); orders carry the plan's checklist, labour and spares; breakdowns block the machine on the
// schedule until done; reliability and cost per machine.
import { Dec, planDue, reliability, toEpochMinutes, workingIntervals } from '@factoryos/core';
import {
  type Database,
  iotDevice,
  item,
  jobCard,
  machine,
  machineBlock,
  machineStateEvent,
  maintenanceLabour,
  maintenanceOrder,
  maintenancePlan,
  maintenancePlanItem,
  maintenanceResult,
  maintenanceSpare,
  stockEntry,
  stockEntryLine,
  uom,
  user,
  warehouse,
  workCentre,
} from '@factoryos/db';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { businessDate, lockAccounting, type Tx } from '../accounting/accounting-lock.js';
import { seedChart } from '../accounting/chart.js';
import { GlPostingService } from '../accounting/gl-posting.service.js';
import { SchedulingService } from '../manufacturing/scheduling.service.js';
import { StockPostingService } from '../stock-posting.service.js';
import { extendOpenBreakdowns } from './breakdown-blocks.js';

type Db = Database | Tx;
type Order = typeof maintenanceOrder.$inferSelect;
type Plan = typeof maintenancePlan.$inferSelect;
const DAY = 86400_000;
const OPEN = ['open', 'in_progress'] as const;

export interface PlanInput {
  machineId: string;
  name: string;
  instructions?: string | null;
  everyDays?: number | null;
  everyRunHours?: number | null;
  leadDays: number;
  plannedMinutes: number;
  lastDoneAt?: string | null;
  items: { text: string; unit?: string | null; min?: string | null; max?: string | null; spareItemId?: string | null; spareQty?: string | null }[];
}

/** A numeric column without trailing zeros, for messages (0.0050 → 0.005). */
const trim = (v: string | null) => (v == null ? null : v.includes('.') ? v.replace(/\.?0+$/, '') : v);

@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
    private readonly gl: GlPostingService,
    private readonly scheduling: SchedulingService,
  ) {}

  // ── Running hours ──

  /**
   * Running hours of a machine since `since`: metered `running` time from its tap when it has (or had) one, else the
   * minutes of completed job cards on it. Metered gaps longer than 3 heartbeats count one heartbeat (decision 063).
   */
  async runHours(db: Db, machineId: string, since: Date, until = new Date()): Promise<{ hours: number; source: 'tap' | 'job_cards' }> {
    const [tap] = await db.select({ heartbeatSeconds: iotDevice.heartbeatSeconds }).from(iotDevice).where(eq(iotDevice.machineId, machineId)).orderBy(desc(iotDevice.createdAt)).limit(1);
    if (tap) {
      const hb = tap.heartbeatSeconds;
      const rows = await db.execute<{ seconds: string | null }>(sql`
        select sum(case when gap <= ${3 * hb} then gap else ${hb} end) as seconds from (
          select state, extract(epoch from (coalesce(lead(at) over (order by at, seq), ${until}) - at)) as gap
          from machine_state_event where machine_id = ${machineId} and at >= ${since} and at < ${until}
        ) s where state = 'running'`);
      return { hours: Math.round((Number(rows.rows[0]?.seconds ?? 0) / 3600) * 10) / 10, source: 'tap' };
    }
    const [r] = await db
      .select({ minutes: sql<string>`coalesce(sum(${jobCard.minutes}), 0)` })
      .from(jobCard)
      .where(and(eq(jobCard.machineId, machineId), eq(jobCard.status, 'completed'), gte(jobCard.completedAt, since), lt(jobCard.completedAt, until)));
    return { hours: Math.round((Number(r?.minutes ?? 0) / 60) * 10) / 10, source: 'job_cards' };
  }

  // ── Plans ──

  private assertInterval(i: { everyDays?: number | null; everyRunHours?: number | null }) {
    if (i.everyDays == null && i.everyRunHours == null) throw new BadRequestException({ message: 'Set a calendar interval, a running-hours interval, or both', issues: [{ path: 'everyDays', message: 'Required' }] });
  }

  private async machineOf(db: Db, entityId: string, machineId: string) {
    const [m] = await db.select().from(machine).where(and(eq(machine.id, machineId), eq(machine.entityId, entityId)));
    if (!m) throw new NotFoundException('Machine not found');
    return m;
  }

  private async writeItems(tx: Tx, ctx: TenantRequestContext, planId: string, items: PlanInput['items']) {
    for (const [i, it] of items.entries()) {
      if ((it.min != null || it.max != null) && !it.unit) throw new BadRequestException({ message: `Item ${i + 1}: a reading with limits needs its unit`, issues: [{ path: `items.${i}.unit`, message: 'Required with limits' }] });
      if (it.min != null && it.max != null && Dec.of(it.min).gt(Dec.of(it.max))) throw new BadRequestException({ message: `Item ${i + 1}: the minimum is above the maximum`, issues: [{ path: `items.${i}.min`, message: 'Above the maximum' }] });
      if (it.spareItemId) {
        const [s] = await tx.select({ id: item.id }).from(item).where(and(eq(item.id, it.spareItemId), eq(item.tenantId, ctx.tenant.tenantId)));
        if (!s) throw new BadRequestException(`Item ${i + 1}: unknown spare`);
      }
    }
    if (items.length) await tx.insert(maintenancePlanItem).values(items.map((it, i) => ({ planId, lineNo: i + 1, text: it.text, unit: it.unit ?? null, min: it.min ?? null, max: it.max ?? null, spareItemId: it.spareItemId ?? null, spareQty: it.spareQty ?? null })));
  }

  async createPlan(tx: Tx, ctx: TenantRequestContext, entityId: string, input: PlanInput) {
    this.assertInterval(input);
    await this.machineOf(tx, entityId, input.machineId);
    const [p] = await tx
      .insert(maintenancePlan)
      .values({
        tenantId: ctx.tenant.tenantId,
        entityId,
        machineId: input.machineId,
        name: input.name,
        instructions: input.instructions ?? null,
        everyDays: input.everyDays ?? null,
        everyRunHours: input.everyRunHours ?? null,
        leadDays: input.leadDays,
        plannedMinutes: input.plannedMinutes,
        lastDoneAt: input.lastDoneAt ? new Date(input.lastDoneAt) : new Date(),
        createdBy: ctx.user.id,
      })
      .returning();
    await this.writeItems(tx, ctx, p!.id, input.items);
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maintenance_plan.create', targetType: 'maintenance_plan', targetId: p!.id, after: { name: input.name, everyDays: input.everyDays, everyRunHours: input.everyRunHours } }, tx);
    return this.plan(tx, entityId, p!.id);
  }

  /** The header changes freely; the checklist only until the plan's first order (its results point at the items). */
  async updatePlan(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, input: Omit<PlanInput, 'machineId'> & { isActive?: boolean }) {
    this.assertInterval(input);
    const [p] = await tx.select().from(maintenancePlan).where(and(eq(maintenancePlan.id, id), eq(maintenancePlan.entityId, entityId))).for('update');
    if (!p) throw new NotFoundException('Plan not found');
    const items = await tx.select().from(maintenancePlanItem).where(eq(maintenancePlanItem.planId, id)).orderBy(asc(maintenancePlanItem.lineNo));
    const same = items.length === input.items.length && items.every((it, i) => it.text === input.items[i]!.text && (it.unit ?? null) === (input.items[i]!.unit ?? null) && num(it.min) === num(input.items[i]!.min) && num(it.max) === num(input.items[i]!.max) && (it.spareItemId ?? null) === (input.items[i]!.spareItemId ?? null) && num(it.spareQty) === num(input.items[i]!.spareQty));
    if (!same) {
      const [used] = await tx.select({ id: maintenanceOrder.id }).from(maintenanceOrder).where(eq(maintenanceOrder.planId, id)).limit(1);
      if (used) throw new ConflictException({ message: 'The checklist is fixed once the plan has orders; make a new plan for a different checklist', issues: [{ path: 'items', message: 'Fixed' }] });
      await tx.delete(maintenancePlanItem).where(eq(maintenancePlanItem.planId, id));
      await this.writeItems(tx, ctx, id, input.items);
    }
    await tx
      .update(maintenancePlan)
      .set({ name: input.name, instructions: input.instructions ?? null, everyDays: input.everyDays ?? null, everyRunHours: input.everyRunHours ?? null, leadDays: input.leadDays, plannedMinutes: input.plannedMinutes, isActive: input.isActive ?? p.isActive, ...(input.lastDoneAt ? { lastDoneAt: new Date(input.lastDoneAt) } : {}), updatedAt: new Date() })
      .where(eq(maintenancePlan.id, id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maintenance_plan.update', targetType: 'maintenance_plan', targetId: id, before: { everyDays: p.everyDays, everyRunHours: p.everyRunHours, isActive: p.isActive }, after: { everyDays: input.everyDays, everyRunHours: input.everyRunHours, isActive: input.isActive } }, tx);
    return this.plan(tx, entityId, id);
  }

  /** A plan with its checklist and its due state now. */
  async plan(db: Db, entityId: string, id: string) {
    const [p] = await db.select({ p: maintenancePlan, machineCode: machine.code, machineName: machine.name }).from(maintenancePlan).innerJoin(machine, eq(machine.id, maintenancePlan.machineId)).where(and(eq(maintenancePlan.id, id), eq(maintenancePlan.entityId, entityId)));
    if (!p) throw new NotFoundException('Plan not found');
    const items = await db
      .select({ i: maintenancePlanItem, spareCode: item.code })
      .from(maintenancePlanItem)
      .leftJoin(item, eq(item.id, maintenancePlanItem.spareItemId))
      .where(eq(maintenancePlanItem.planId, id))
      .orderBy(asc(maintenancePlanItem.lineNo));
    return { ...p.p, machineCode: p.machineCode, machineName: p.machineName, items: items.map((x) => ({ ...x.i, spareCode: x.spareCode })), due: await this.dueOf(db, p.p) };
  }

  private async dueOf(db: Db, p: Plan, now = new Date()) {
    const run = await this.runHours(db, p.machineId, p.lastDoneAt, now);
    const due = planDue({ everyDays: p.everyDays, everyRunHours: p.everyRunHours, leadDays: p.leadDays }, { lastDoneAt: p.lastDoneAt, runHoursSince: run.hours }, now);
    const [open] = await db.select({ id: maintenanceOrder.id, number: maintenanceOrder.number }).from(maintenanceOrder).where(and(eq(maintenanceOrder.planId, p.id), inArray(maintenanceOrder.status, [...OPEN])));
    return { ...due, runHoursSince: run.hours, runHoursSource: run.source, openOrder: open ?? null };
  }

  /** Active plans (or all, for the plans page) with their due state, overdue first. */
  async dueList(db: Db, entityId: string, machineId?: string, includeInactive = false) {
    const plans = await db
      .select({ p: maintenancePlan, machineCode: machine.code, machineName: machine.name })
      .from(maintenancePlan)
      .innerJoin(machine, eq(machine.id, maintenancePlan.machineId))
      .where(and(eq(maintenancePlan.entityId, entityId), includeInactive ? undefined : eq(maintenancePlan.isActive, true), machineId ? eq(maintenancePlan.machineId, machineId) : undefined))
      .orderBy(asc(machine.code), asc(maintenancePlan.name));
    const rank = { overdue: 0, due_soon: 1, ok: 2 } as const;
    const out = [];
    for (const r of plans) out.push({ ...r.p, machineCode: r.machineCode, machineName: r.machineName, due: await this.dueOf(db, r.p) });
    return out.sort((a, b) => rank[a.due.status] - rank[b.due.status] || (a.due.dueAt?.getTime() ?? Infinity) - (b.due.dueAt?.getTime() ?? Infinity));
  }

  /** Opens a preventive order for each overdue or due-soon plan that has none open. */
  async generateDue(tx: Tx, ctx: TenantRequestContext, entityId: string) {
    const list = await this.dueList(tx, entityId);
    const made = [];
    for (const p of list) {
      if (p.due.status === 'ok' || p.due.openOrder) continue;
      made.push(await this.openPreventive(tx, ctx, entityId, p.id));
    }
    return made;
  }

  async openPreventive(tx: Tx, ctx: TenantRequestContext, entityId: string, planId: string) {
    const [p] = await tx.select().from(maintenancePlan).where(and(eq(maintenancePlan.id, planId), eq(maintenancePlan.entityId, entityId))).for('update');
    if (!p) throw new NotFoundException('Plan not found');
    if (!p.isActive) throw new ConflictException('The plan is inactive');
    const [open] = await tx.select({ number: maintenanceOrder.number }).from(maintenanceOrder).where(and(eq(maintenanceOrder.planId, planId), inArray(maintenanceOrder.status, [...OPEN])));
    if (open) throw new ConflictException(`${open.number} is already open for this plan`);
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'maintenance_order', businessDate());
    const [o] = await tx.insert(maintenanceOrder).values({ tenantId: ctx.tenant.tenantId, entityId, number, kind: 'preventive', machineId: p.machineId, planId, title: p.name, createdBy: ctx.user.id }).returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maintenance_order.create', targetType: 'maintenance_order', targetId: o!.id, after: { number, kind: 'preventive', plan: p.name } }, tx);
    return o!;
  }

  // ── Breakdowns ──

  /** Any operator: the machine is blocked on the schedule from when it failed until the order is done. */
  async reportBreakdown(tx: Tx, ctx: TenantRequestContext, entityId: string, input: { machineId: string; symptom: string; failedAt?: string | null }) {
    const m = await this.machineOf(tx, entityId, input.machineId);
    const failedAt = input.failedAt ? new Date(input.failedAt) : new Date();
    if (failedAt.getTime() > Date.now() + 60_000) throw new BadRequestException({ message: 'The failure time is in the future', issues: [{ path: 'failedAt', message: 'In the future' }] });
    if (failedAt.getTime() < Date.now() - 7 * DAY) throw new BadRequestException({ message: 'Report breakdowns within a week', issues: [{ path: 'failedAt', message: 'Older than a week' }] });
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`breakdown:${m.id}`}))`);
    const [open] = await tx.select({ number: maintenanceOrder.number }).from(maintenanceOrder).where(and(eq(maintenanceOrder.machineId, m.id), eq(maintenanceOrder.kind, 'breakdown'), inArray(maintenanceOrder.status, [...OPEN])));
    if (open) throw new ConflictException(`${m.code} already has an open breakdown, ${open.number}`);
    const [block] = await tx
      .insert(machineBlock)
      .values({ tenantId: ctx.tenant.tenantId, entityId, machineId: m.id, kind: 'breakdown', startsAt: failedAt, endsAt: new Date(Date.now() + DAY), reason: input.symptom.slice(0, 200), createdBy: ctx.user.id })
      .returning();
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'maintenance_order', businessDate());
    const [o] = await tx
      .insert(maintenanceOrder)
      .values({ tenantId: ctx.tenant.tenantId, entityId, number, kind: 'breakdown', machineId: m.id, title: `Breakdown: ${input.symptom.slice(0, 80)}`, symptom: input.symptom, failedAt, reportedBy: ctx.user.id, blockId: block!.id, createdBy: ctx.user.id })
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maintenance_order.breakdown', targetType: 'maintenance_order', targetId: o!.id, after: { number, machine: m.code, symptom: input.symptom, failedAt } }, tx);
    return o!;
  }

  // ── Orders ──

  async lockOrder(tx: Tx, entityId: string, id: string) {
    const [o] = await tx.select().from(maintenanceOrder).where(and(eq(maintenanceOrder.id, id), eq(maintenanceOrder.entityId, entityId))).for('update');
    if (!o) throw new NotFoundException('Maintenance order not found');
    return o;
  }

  private assertOpen(o: Order) {
    if (!OPEN.includes(o.status as (typeof OPEN)[number])) throw new ConflictException(`${o.number} is ${o.status}`);
  }

  /** Preventive: the scheduler keeps the machine free for the plan's planned minutes from `start`; null clears it. */
  async schedule(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, start: string | null) {
    const o = await this.lockOrder(tx, entityId, id);
    this.assertOpen(o);
    if (o.kind !== 'preventive') throw new ConflictException('A breakdown is already blocking the machine');
    const [p] = await tx.select().from(maintenancePlan).where(eq(maintenancePlan.id, o.planId!));
    if (o.blockId) {
      await tx.update(maintenanceOrder).set({ blockId: null }).where(eq(maintenanceOrder.id, id));
      await tx.delete(machineBlock).where(eq(machineBlock.id, o.blockId));
    }
    let blockId: string | null = null;
    if (start) {
      const s = new Date(start);
      const [b] = await tx
        .insert(machineBlock)
        .values({ tenantId: ctx.tenant.tenantId, entityId, machineId: o.machineId, kind: 'maintenance', startsAt: s, endsAt: new Date(s.getTime() + p!.plannedMinutes * 60_000), reason: `${o.number} ${o.title}`.slice(0, 200), createdBy: ctx.user.id })
        .returning();
      blockId = b!.id;
    }
    await tx.update(maintenanceOrder).set({ scheduledStart: start ? new Date(start) : null, blockId, updatedAt: new Date() }).where(eq(maintenanceOrder.id, id));
    return this.detail(tx, entityId, id);
  }

  async start(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string) {
    const o = await this.lockOrder(tx, entityId, id);
    if (o.status !== 'open') throw new ConflictException(`${o.number} is ${o.status}`);
    await tx.update(maintenanceOrder).set({ status: 'in_progress', startedAt: new Date(), updatedAt: new Date() }).where(eq(maintenanceOrder.id, id));
    return this.detail(tx, entityId, id);
  }

  /** A checklist result. Measured items need a reading; one outside the limits needs a note saying what was done. */
  async result(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, input: { itemId: string; reading?: string | null; note?: string | null }) {
    const o = await this.lockOrder(tx, entityId, id);
    this.assertOpen(o);
    if (!o.planId) throw new ConflictException('A breakdown has no checklist');
    const [it] = await tx.select().from(maintenancePlanItem).where(and(eq(maintenancePlanItem.id, input.itemId), eq(maintenancePlanItem.planId, o.planId)));
    if (!it) throw new NotFoundException('Checklist item not found on this order');
    if (it.unit && input.reading == null) throw new BadRequestException({ message: `${it.text}: enter the reading in ${it.unit}`, issues: [{ path: 'reading', message: 'Required' }] });
    const outside = input.reading != null && ((it.min != null && Dec.of(input.reading).lt(Dec.of(it.min))) || (it.max != null && Dec.of(input.reading).gt(Dec.of(it.max))));
    if (outside && !input.note?.trim()) throw new BadRequestException({ message: `${it.text}: ${input.reading} ${it.unit} is outside ${trim(it.min) ?? '…'}–${trim(it.max) ?? '…'}; add a note on what was done`, issues: [{ path: 'note', message: 'Required outside the limits' }] });
    await tx
      .insert(maintenanceResult)
      .values({ orderId: id, itemId: it.id, reading: input.reading ?? null, note: input.note ?? null, doneBy: ctx.user.id })
      .onConflictDoUpdate({ target: [maintenanceResult.orderId, maintenanceResult.itemId], set: { reading: input.reading ?? null, note: input.note ?? null, doneBy: ctx.user.id, doneAt: new Date() } });
    if (o.status === 'open') await tx.update(maintenanceOrder).set({ status: 'in_progress', startedAt: new Date() }).where(eq(maintenanceOrder.id, id));
    return this.detail(tx, entityId, id);
  }

  async labour(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, input: { minutes: number; technicianId?: string | null; note?: string | null }) {
    const o = await this.lockOrder(tx, entityId, id);
    this.assertOpen(o);
    const [wc] = await tx.select({ rate: workCentre.hourlyRate }).from(machine).innerJoin(workCentre, eq(workCentre.id, machine.workCentreId)).where(eq(machine.id, o.machineId));
    const rate = wc?.rate ?? '0';
    await tx.insert(maintenanceLabour).values({ orderId: id, technicianId: input.technicianId ?? ctx.user.id, minutes: input.minutes, rate, cost: Dec.of(rate).mul(String(input.minutes)).div('60').toFixed(2), note: input.note ?? null, createdBy: ctx.user.id });
    return this.detail(tx, entityId, id);
  }

  /** Spares out of stores to the order: a system stock entry, posted Dr repairs and maintenance, Cr inventory. */
  async issueSpares(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, input: { warehouseId: string; lines: { itemId: string; qty: string; batchId?: string | null }[] }) {
    await lockAccounting(tx, entityId);
    if (await this.gl.active(tx, entityId)) await seedChart(tx, ctx, entityId);
    const o = await this.lockOrder(tx, entityId, id);
    this.assertOpen(o);
    const [w] = await tx.select().from(warehouse).where(and(eq(warehouse.id, input.warehouseId), eq(warehouse.entityId, entityId)));
    if (!w) throw new NotFoundException('Warehouse not found');
    const [e] = await tx
      .insert(stockEntry)
      .values({ tenantId: ctx.tenant.tenantId, entityId, purpose: 'maintenance', postingDate: businessDate(), systemGenerated: true, reference: `mo:${o.id}`, remarks: `${o.number} ${o.title}`.slice(0, 200), createdBy: ctx.user.id })
      .returning();
    await tx.insert(stockEntryLine).values(input.lines.map((l, i) => ({ entryId: e!.id, lineNo: i + 1, itemId: l.itemId, qty: l.qty, batchId: l.batchId ?? null, fromWarehouseId: w.id })));
    await this.posting.submitIn(tx, ctx, entityId, e!.id);
    await tx.insert(maintenanceSpare).values({ orderId: id, stockEntryId: e!.id });
    if (o.status === 'open') await tx.update(maintenanceOrder).set({ status: 'in_progress', startedAt: new Date() }).where(eq(maintenanceOrder.id, id));
    return this.detail(tx, entityId, id);
  }

  async cancelSpares(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, entryId: string, reason: string) {
    const o = await this.lockOrder(tx, entityId, id);
    this.assertOpen(o);
    const [s] = await tx.select().from(maintenanceSpare).where(and(eq(maintenanceSpare.orderId, id), eq(maintenanceSpare.stockEntryId, entryId)));
    if (!s) throw new NotFoundException('That issue is not on this order');
    await this.posting.cancelIn(tx, ctx, entityId, entryId, reason);
    return this.detail(tx, entityId, id);
  }

  /**
   * Done: every checklist item has a result and, for a breakdown, the cause and action are written. The machine block
   * ends now; the plan's baseline moves to now (its next due counts from here).
   */
  async done(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, input: { cause?: string | null; action?: string | null }) {
    const o = await this.lockOrder(tx, entityId, id);
    this.assertOpen(o);
    if (o.kind === 'breakdown' && (!input.cause?.trim() || !input.action?.trim())) throw new BadRequestException({ message: 'Write the cause and the action taken', issues: [{ path: input.cause?.trim() ? 'action' : 'cause', message: 'Required' }] });
    if (o.planId) {
      const items = await tx.select({ id: maintenancePlanItem.id, text: maintenancePlanItem.text }).from(maintenancePlanItem).where(eq(maintenancePlanItem.planId, o.planId));
      const done = await tx.select({ itemId: maintenanceResult.itemId }).from(maintenanceResult).where(eq(maintenanceResult.orderId, id));
      const missing = items.filter((i) => !done.some((d) => d.itemId === i.id));
      if (missing.length) throw new ConflictException({ message: `Checklist not finished: ${missing.map((m) => m.text).join('; ')}`, issues: [{ path: 'checklist', message: `${missing.length} open` }] });
    }
    const now = new Date();
    await tx.update(maintenanceOrder).set({ status: 'done', doneAt: now, doneBy: ctx.user.id, cause: input.cause ?? null, action: input.action ?? null, updatedAt: now }).where(eq(maintenanceOrder.id, id));
    if (o.blockId) {
      const [b] = await tx.select().from(machineBlock).where(eq(machineBlock.id, o.blockId));
      // Done before its slot: the reservation goes; otherwise the block ends now (the real downtime for a breakdown).
      if (b && b.startsAt >= now) {
        await tx.update(maintenanceOrder).set({ blockId: null }).where(eq(maintenanceOrder.id, id));
        await tx.delete(machineBlock).where(eq(machineBlock.id, b.id));
      } else if (b && b.endsAt > now) await tx.update(machineBlock).set({ endsAt: now, updatedAt: now }).where(eq(machineBlock.id, b.id));
    }
    if (o.planId) await tx.update(maintenancePlan).set({ lastDoneAt: now, updatedAt: now }).where(eq(maintenancePlan.id, o.planId));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maintenance_order.done', targetType: 'maintenance_order', targetId: id, after: { number: o.number, cause: input.cause, action: input.action } }, tx);
    return this.detail(tx, entityId, id);
  }

  /** A supervisor other than whoever signed it off; required on critical machines. */
  async verify(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string) {
    const o = await this.lockOrder(tx, entityId, id);
    if (o.status !== 'done') throw new ConflictException(`${o.number} is ${o.status}; only a done order is verified`);
    if (o.doneBy === ctx.user.id) throw new ForbiddenException('Someone other than the technician who signed it off verifies it');
    await tx.update(maintenanceOrder).set({ status: 'verified', verifiedAt: new Date(), verifiedBy: ctx.user.id, updatedAt: new Date() }).where(eq(maintenanceOrder.id, id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maintenance_order.verify', targetType: 'maintenance_order', targetId: id, after: { number: o.number } }, tx);
    return this.detail(tx, entityId, id);
  }

  async cancel(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, reason: string) {
    const o = await this.lockOrder(tx, entityId, id);
    this.assertOpen(o);
    const issued = await tx
      .select({ id: stockEntry.id })
      .from(maintenanceSpare)
      .innerJoin(stockEntry, eq(stockEntry.id, maintenanceSpare.stockEntryId))
      .where(and(eq(maintenanceSpare.orderId, id), eq(stockEntry.status, 'submitted')));
    if (issued.length) throw new ConflictException('Cancel the spares issued to it first');
    if (o.blockId) {
      await tx.update(maintenanceOrder).set({ blockId: null }).where(eq(maintenanceOrder.id, id));
      await tx.delete(machineBlock).where(eq(machineBlock.id, o.blockId));
    }
    await tx.update(maintenanceOrder).set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() }).where(eq(maintenanceOrder.id, id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'maintenance_order.cancel', targetType: 'maintenance_order', targetId: id, after: { number: o.number, reason } }, tx);
    return this.detail(tx, entityId, id);
  }

  async list(db: Db, entityId: string, f: { status?: string; machineId?: string; kind?: string }) {
    await extendOpenBreakdowns(db, entityId);
    const statuses = f.status === 'open' ? [...OPEN] : f.status ? [f.status] : null;
    return db
      .select({ o: maintenanceOrder, machineCode: machine.code, machineName: machine.name, critical: machine.critical })
      .from(maintenanceOrder)
      .innerJoin(machine, eq(machine.id, maintenanceOrder.machineId))
      .where(
        and(
          eq(maintenanceOrder.entityId, entityId),
          statuses ? inArray(maintenanceOrder.status, statuses as Order['status'][]) : undefined,
          f.machineId ? eq(maintenanceOrder.machineId, f.machineId) : undefined,
          f.kind === 'preventive' || f.kind === 'breakdown' ? eq(maintenanceOrder.kind, f.kind) : undefined,
        ),
      )
      .orderBy(desc(maintenanceOrder.createdAt))
      .limit(200)
      .then((rows) => rows.map((r) => ({ ...r.o, machineCode: r.machineCode, machineName: r.machineName, critical: r.critical })));
  }

  /** The order with its checklist and results, labour, spares (value from the stock entries) and cost. */
  async detail(db: Db, entityId: string, id: string) {
    const [r] = await db
      .select({ o: maintenanceOrder, machineCode: machine.code, machineName: machine.name, critical: machine.critical })
      .from(maintenanceOrder)
      .innerJoin(machine, eq(machine.id, maintenanceOrder.machineId))
      .where(and(eq(maintenanceOrder.id, id), eq(maintenanceOrder.entityId, entityId)));
    if (!r) throw new NotFoundException('Maintenance order not found');
    const o = r.o;
    const items = o.planId
      ? await db
          .select({ i: maintenancePlanItem, res: maintenanceResult, by: user.name, spareCode: item.code })
          .from(maintenancePlanItem)
          .leftJoin(maintenanceResult, and(eq(maintenanceResult.itemId, maintenancePlanItem.id), eq(maintenanceResult.orderId, id)))
          .leftJoin(user, eq(user.id, maintenanceResult.doneBy))
          .leftJoin(item, eq(item.id, maintenancePlanItem.spareItemId))
          .where(eq(maintenancePlanItem.planId, o.planId))
          .orderBy(asc(maintenancePlanItem.lineNo))
      : [];
    const labour = await db.select({ l: maintenanceLabour, technician: user.name }).from(maintenanceLabour).innerJoin(user, eq(user.id, maintenanceLabour.technicianId)).where(eq(maintenanceLabour.orderId, id)).orderBy(asc(maintenanceLabour.createdAt));
    const spareEntries = await db.select({ e: stockEntry }).from(maintenanceSpare).innerJoin(stockEntry, eq(stockEntry.id, maintenanceSpare.stockEntryId)).where(eq(maintenanceSpare.orderId, id)).orderBy(asc(maintenanceSpare.createdAt));
    const lines = spareEntries.length
      ? await db
          .select({ entryId: stockEntryLine.entryId, itemCode: item.code, itemName: item.name, qty: stockEntryLine.qty, value: stockEntryLine.value, uom: uom.code })
          .from(stockEntryLine)
          .innerJoin(item, eq(item.id, stockEntryLine.itemId))
          .innerJoin(uom, eq(uom.id, item.stockUomId))
          .where(inArray(stockEntryLine.entryId, spareEntries.map((s) => s.e.id)))
      : [];
    const names = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [o.reportedBy, o.doneBy, o.verifiedBy].filter((x): x is string => !!x).concat(['-'])));
    const nameOf = (u: string | null) => names.find((n) => n.id === u)?.name ?? null;
    const spares = spareEntries.map((s) => ({ id: s.e.id, number: s.e.number, status: s.e.status, postedAt: s.e.submittedAt, lines: lines.filter((l) => l.entryId === s.e.id) }));
    const sparesValue = spares.filter((s) => s.status === 'submitted').flatMap((s) => s.lines).reduce((t, l) => t.add(Dec.of(l.value ?? '0')), Dec.of('0'));
    const labourValue = labour.reduce((t, l) => t.add(Dec.of(l.l.cost)), Dec.of('0'));
    return {
      ...o,
      machineCode: r.machineCode,
      machineName: r.machineName,
      critical: r.critical,
      reportedByName: nameOf(o.reportedBy),
      doneByName: nameOf(o.doneBy),
      verifiedByName: nameOf(o.verifiedBy),
      checklist: items.map((x) => {
        const outside = x.res?.reading != null && ((x.i.min != null && Dec.of(x.res.reading).lt(Dec.of(x.i.min))) || (x.i.max != null && Dec.of(x.res.reading).gt(Dec.of(x.i.max))));
        return { ...x.i, spareCode: x.spareCode, result: x.res ? { reading: x.res.reading, note: x.res.note, doneAt: x.res.doneAt, by: x.by, outside } : null };
      }),
      labour: labour.map((l) => ({ ...l.l, technician: l.technician })),
      spares,
      cost: { spares: sparesValue.toFixed(2), labour: labourValue.toFixed(2), total: sparesValue.add(labourValue).toFixed(2) },
      needsVerification: r.critical && o.status === 'done',
    };
  }

  // ── Machine summary and reports ──

  /** A tap in alarm since when, if it is now (for "Raise a breakdown?"). */
  private async alarmSince(db: Db, machineId: string): Promise<Date | null> {
    const [last] = await db.select({ state: machineStateEvent.state, at: machineStateEvent.at }).from(machineStateEvent).where(eq(machineStateEvent.machineId, machineId)).orderBy(desc(machineStateEvent.at)).limit(1);
    if (last?.state !== 'alarm') return null;
    const [before] = await db.select({ at: machineStateEvent.at }).from(machineStateEvent).where(and(eq(machineStateEvent.machineId, machineId), ne(machineStateEvent.state, 'alarm'))).orderBy(desc(machineStateEvent.at)).limit(1);
    const [first] = await db
      .select({ at: machineStateEvent.at })
      .from(machineStateEvent)
      .where(and(eq(machineStateEvent.machineId, machineId), eq(machineStateEvent.state, 'alarm'), before ? sql`${machineStateEvent.at} > ${before.at}` : undefined))
      .orderBy(asc(machineStateEvent.at))
      .limit(1);
    return first?.at ?? null;
  }

  async machineSummary(db: Db, entityId: string, machineId: string) {
    const m = await this.machineOf(db, entityId, machineId);
    await extendOpenBreakdowns(db, entityId);
    const plans = await this.dueList(db, entityId, m.id);
    const open = await this.list(db, entityId, { status: 'open', machineId: m.id });
    const history = (await this.list(db, entityId, { machineId: m.id })).filter((o) => !OPEN.includes(o.status as (typeof OPEN)[number])).slice(0, 20);
    const to = new Date();
    const from = new Date(to.getTime() - 90 * DAY);
    const [rel] = (await this.report(db, entityId, from, to)).machines.filter((x) => x.machineId === m.id);
    return { machine: { id: m.id, code: m.code, name: m.name, critical: m.critical }, plans, open, history, alarmSince: await this.alarmSince(db, m.id), last90Days: rel ?? null };
  }

  /**
   * Per machine over [from, to): breakdowns, downtime, MTTR, MTBF (running hours per breakdown), availability against
   * its calendar's working time, order counts and cost (spares issued and labour).
   */
  async report(db: Db, entityId: string, from: Date, to: Date) {
    await extendOpenBreakdowns(db, entityId);
    const machines = await db.select({ id: machine.id, code: machine.code, name: machine.name, critical: machine.critical }).from(machine).where(and(eq(machine.entityId, entityId), eq(machine.isActive, true))).orderBy(asc(machine.code));
    const orders = await db.select().from(maintenanceOrder).where(and(eq(maintenanceOrder.entityId, entityId), sql`coalesce(${maintenanceOrder.failedAt}, ${maintenanceOrder.createdAt}) < ${to}`, sql`coalesce(${maintenanceOrder.doneAt}, now()) >= ${from}`, ne(maintenanceOrder.status, 'cancelled')));
    let working: Map<string, number> | null = null;
    try {
      const l = await this.scheduling.load(db, entityId);
      working = new Map(l.machines.map((mm) => [mm.id, workingIntervals(l.calendars.get(mm.calendarId)!, toEpochMinutes(from), toEpochMinutes(to)).reduce((s, i) => s + (i.end - i.start), 0) / 60]));
    } catch {
      working = null; // No calendar yet: availability is left out.
    }
    const ids = orders.map((o) => o.id);
    const labour = ids.length ? await db.select({ orderId: maintenanceLabour.orderId, cost: sql<string>`sum(${maintenanceLabour.cost})` }).from(maintenanceLabour).where(inArray(maintenanceLabour.orderId, ids)).groupBy(maintenanceLabour.orderId) : [];
    const spares = ids.length
      ? await db
          .select({ orderId: maintenanceSpare.orderId, value: sql<string>`coalesce(sum(${stockEntryLine.value}), 0)` })
          .from(maintenanceSpare)
          .innerJoin(stockEntry, and(eq(stockEntry.id, maintenanceSpare.stockEntryId), eq(stockEntry.status, 'submitted')))
          .innerJoin(stockEntryLine, eq(stockEntryLine.entryId, stockEntry.id))
          .where(inArray(maintenanceSpare.orderId, ids))
          .groupBy(maintenanceSpare.orderId)
      : [];
    const out = [];
    for (const m of machines) {
      const mine = orders.filter((o) => o.machineId === m.id);
      if (!mine.length && !working?.get(m.id)) continue;
      const run = await this.runHours(db, m.id, from, to);
      const rel = reliability(
        mine.filter((o) => o.kind === 'breakdown').map((o) => ({ failedAt: o.failedAt!, restoredAt: o.doneAt })),
        from,
        to,
        run.hours,
        working?.get(m.id) ?? 0,
      );
      const cost = (rows: { orderId: string; cost?: string; value?: string }[]) => rows.filter((r) => mine.some((o) => o.id === r.orderId)).reduce((t, r) => t.add(Dec.of(r.cost ?? r.value ?? '0')), Dec.of('0'));
      out.push({
        machineId: m.id,
        machineCode: m.code,
        machineName: m.name,
        critical: m.critical,
        ...rel,
        runHours: run.hours,
        runHoursSource: run.source,
        preventive: mine.filter((o) => o.kind === 'preventive').length,
        sparesCost: cost(spares).toFixed(2),
        labourCost: cost(labour).toFixed(2),
      });
    }
    return { from, to, machines: out };
  }
}

const num = (v: string | null | undefined) => (v == null || v === '' ? null : Dec.of(v).toString());
