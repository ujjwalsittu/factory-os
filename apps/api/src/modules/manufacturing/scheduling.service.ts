// Finite capacity scheduling (decision 049): loads calendars, blocks and released work, runs the core engine and
// stores the placements. Moves are checked against the same free time the engine uses.
import {
  allocate,
  type CalendarSpec,
  Dec,
  fromEpochMinutes,
  type Interval,
  normalize,
  schedule,
  type SchedOrder,
  subtract,
  toEpochMinutes,
  workingIntervals,
  zonedEpochMinutes,
} from '@factoryos/core';
import {
  calendarHoliday,
  calendarShift,
  type Database,
  item,
  jobCard,
  machine,
  machineBlock,
  salesOrder,
  scheduledOperation,
  scheduleRun,
  stockEntry,
  workCalendar,
  workCentre,
  workOrder,
  workOrderOperation,
} from '@factoryos/db';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import type { Tx } from '../accounting/accounting-lock.js';
import { JobWorkService } from './job-work.service.js';

export const HORIZON_DAYS = 28;

interface Loaded {
  calendars: Map<string, CalendarSpec>;
  defaultCalendarId: string;
  machines: { id: string; code: string; name: string; workCentreId: string; workCentre: string; calendarId: string }[];
}

@Injectable()
export class SchedulingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly jobWork: JobWorkService,
  ) {}

  /** Calendars and active machines of active work centres; refuses when no calendar is set up. */
  async load(db: Database | Tx, entityId: string): Promise<Loaded> {
    const cals = await db.select().from(workCalendar).where(and(eq(workCalendar.entityId, entityId), eq(workCalendar.isActive, true)));
    const def = cals.find((c) => c.isDefault);
    if (!def) throw new BadRequestException('Set up a working calendar first (Manufacturing → Calendars)');
    const ids = cals.map((c) => c.id);
    const shifts = await db.select().from(calendarShift).where(inArray(calendarShift.calendarId, ids));
    const holidays = await db.select().from(calendarHoliday).where(inArray(calendarHoliday.calendarId, ids));
    const calendars = new Map(
      cals.map((c) => [
        c.id,
        {
          timeZone: c.timeZone,
          shifts: shifts.filter((s) => s.calendarId === c.id).map((s) => ({ weekday: s.weekday, start: s.startTime, end: s.endTime })),
          holidays: holidays.filter((h) => h.calendarId === c.id).map((h) => h.date),
        },
      ]),
    );
    const rows = await db
      .select({ id: machine.id, code: machine.code, name: machine.name, workCentreId: workCentre.id, workCentre: workCentre.name, calendarId: workCentre.calendarId })
      .from(machine)
      .innerJoin(workCentre, eq(workCentre.id, machine.workCentreId))
      .where(and(eq(machine.entityId, entityId), eq(machine.isActive, true), eq(workCentre.isActive, true)))
      .orderBy(asc(workCentre.code), asc(machine.code));
    return { calendars, defaultCalendarId: def.id, machines: rows.map((m) => ({ ...m, calendarId: m.calendarId && calendars.has(m.calendarId) ? m.calendarId : def.id })) };
  }

  /** Working time minus downtime, per machine, over [from, to). */
  async freeTime(db: Database | Tx, entityId: string, l: Loaded, from: number, to: number) {
    const blocks = await db
      .select()
      .from(machineBlock)
      .where(and(eq(machineBlock.entityId, entityId), lt(machineBlock.startsAt, fromEpochMinutes(to)), gt(machineBlock.endsAt, fromEpochMinutes(from))));
    return new Map(
      l.machines.map((m) => [
        m.id,
        subtract(
          workingIntervals(l.calendars.get(m.calendarId)!, from, to),
          blocks.filter((b) => b.machineId === m.id).map((b) => ({ start: toEpochMinutes(b.startsAt), end: Math.ceil(b.endsAt.getTime() / 60000) })),
        ),
      ]),
    );
  }

  /** One "Reschedule": places every released work order, replacing the unpinned placements. */
  async runIn(tx: Tx, ctx: TenantRequestContext, entityId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`schedule:${entityId}`}))`);
    const l = await this.load(tx, entityId);
    const now = toEpochMinutes(new Date());
    const horizon = now + HORIZON_DAYS * 1440;
    const free = await this.freeTime(tx, entityId, l, now, horizon);
    const tz = l.calendars.get(l.defaultCalendarId)!.timeZone;

    const orders = await tx
      .select({ wo: workOrder, delivery: salesOrder.deliveryDate })
      .from(workOrder)
      .leftJoin(salesOrder, eq(salesOrder.id, workOrder.salesOrderId))
      .where(and(eq(workOrder.entityId, entityId), eq(workOrder.status, 'released')));
    const woIds = orders.map((o) => o.wo.id);
    const ops = woIds.length ? await tx.select().from(workOrderOperation).where(inArray(workOrderOperation.workOrderId, woIds)) : [];
    const cards = woIds.length ? await tx.select().from(jobCard).where(inArray(jobCard.workOrderId, woIds)) : [];
    const kept = woIds.length ? await tx.select().from(scheduledOperation).where(and(eq(scheduledOperation.entityId, entityId), eq(scheduledOperation.pinned, true))) : [];
    const machineIds = new Set(l.machines.map((m) => m.id));

    const input: SchedOrder[] = [];
    for (const { wo, delivery } of orders) {
      const returns = await this.jobWork.outsourcedReturns(tx, wo.id);
      const due = delivery ?? wo.plannedEnd;
      const sched: SchedOrder = {
        id: wo.id,
        priority: wo.priority,
        dueAt: due ? zonedEpochMinutes(due, '23:59', tz) + 1 : null,
        // Milliseconds: orders released in the same minute keep their release order.
        releasedAt: (wo.releasedAt ?? wo.createdAt).getTime(),
        earliestStart: wo.plannedStart ? zonedEpochMinutes(wo.plannedStart, '00:00', tz) : null,
        ops: [],
      };
      for (const op of ops.filter((o) => o.workOrderId === wo.id)) {
        if (op.outsourced) {
          const back = returns.find((r) => r.operationId === op.id);
          if (back && !Dec.of(back.good).lt(wo.plannedQty)) continue;
          sched.ops.push({ id: op.id, seq: op.seq, workCentreId: null, outsourced: true, minutes: 0, leadDays: op.leadDays ?? 7 });
          continue;
        }
        const opCards = cards.filter((c) => c.operationId === op.id);
        const good = opCards.filter((c) => c.status === 'completed').reduce((s, c) => s.add(c.goodQty ?? '0'), Dec.ZERO);
        // Planned minutes scale with the quantity still to make (setup included proportionally).
        const left = Dec.of(wo.plannedQty).sub(good);
        const minutes = left.gt('0') ? Number(Dec.of(op.plannedMinutes).mul(left).div(wo.plannedQty).toString()) : 0;
        const open = opCards.find((c) => (c.status === 'running' || c.status === 'paused') && c.machineId && machineIds.has(c.machineId));
        const pin = kept.find((k) => k.operationId === op.id && k.machineId && machineIds.has(k.machineId));
        if (!open && !pin && minutes <= 0) continue;
        sched.ops.push({
          id: op.id,
          seq: op.seq,
          workCentreId: op.workCentreId,
          outsourced: false,
          minutes,
          running: open ? { machineId: open.machineId!, start: toEpochMinutes(open.createdAt) } : null,
          pinned: !open && pin ? { machineId: pin.machineId!, start: toEpochMinutes(pin.startsAt), end: toEpochMinutes(pin.endsAt) } : null,
        });
      }
      input.push(sched);
    }

    const r = schedule({ now, orders: input, machines: l.machines.map((m) => ({ id: m.id, workCentreId: m.workCentreId, free: free.get(m.id) ?? [] })) });
    const [run] = await tx
      .insert(scheduleRun)
      .values({
        tenantId: ctx.tenant.tenantId,
        entityId,
        horizonEnd: fromEpochMinutes(horizon),
        placed: r.placements.length,
        unscheduled: r.unscheduled.length,
        late: r.orders.filter((o) => o.late).length,
        conflicts: r.conflicts.length,
        details: { unscheduled: r.unscheduled.map((u) => ({ operationId: u.opId, reason: u.reason })), conflicts: r.conflicts.map((c) => ({ operationId: c.opId, reason: c.reason })) },
        runBy: ctx.user.id,
      })
      .returning();
    await tx.delete(scheduledOperation).where(eq(scheduledOperation.entityId, entityId));
    if (r.placements.length)
      await tx.insert(scheduledOperation).values(
        r.placements.map((p) => ({
          tenantId: ctx.tenant.tenantId,
          entityId,
          runId: run!.id,
          workOrderId: p.orderId,
          operationId: p.opId,
          machineId: p.machineId,
          startsAt: fromEpochMinutes(p.start),
          endsAt: fromEpochMinutes(p.end),
          pinned: p.pinned,
          running: p.running,
        })),
      );
    for (const o of r.orders) await tx.update(workOrder).set({ scheduledFinish: o.finish === null ? null : fromEpochMinutes(o.finish) }).where(eq(workOrder.id, o.orderId));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'schedule.run', targetType: 'schedule_run', targetId: run!.id, after: { placed: run!.placed, unscheduled: run!.unscheduled, late: run!.late, conflicts: run!.conflicts } }, tx);
    return run!;
  }

  /** The latest run, its bars in [from, to), downtime, working time and the late and unscheduled lists. */
  async view(entityId: string, fromIso?: string, toIso?: string) {
    const [run] = await this.db.select().from(scheduleRun).where(eq(scheduleRun.entityId, entityId)).orderBy(desc(scheduleRun.runAt)).limit(1);
    let l: Loaded | null = null;
    try {
      l = await this.load(this.db, entityId);
    } catch {
      l = null;
    }
    const from = fromIso ? toEpochMinutes(fromIso) : toEpochMinutes(new Date()) - 60;
    const to = toIso ? toEpochMinutes(toIso) : from + 14 * 1440;
    const bars = await this.db
      .select({
        s: scheduledOperation,
        seq: workOrderOperation.seq,
        name: workOrderOperation.name,
        number: workOrder.number,
        status: workOrder.status,
        priority: workOrder.priority,
        plannedQty: workOrder.plannedQty,
        plannedEnd: workOrder.plannedEnd,
        delivery: salesOrder.deliveryDate,
        scheduledFinish: workOrder.scheduledFinish,
        itemCode: item.code,
        itemName: item.name,
        issued: sql<boolean>`exists (select 1 from ${stockEntry} se where se.work_order_id = ${workOrder.id} and se.purpose = 'production_issue' and se.status = 'submitted')`,
      })
      .from(scheduledOperation)
      .innerJoin(workOrderOperation, eq(workOrderOperation.id, scheduledOperation.operationId))
      .innerJoin(workOrder, eq(workOrder.id, scheduledOperation.workOrderId))
      .innerJoin(item, eq(item.id, workOrder.itemId))
      .leftJoin(salesOrder, eq(salesOrder.id, workOrder.salesOrderId))
      .where(and(eq(scheduledOperation.entityId, entityId), lt(scheduledOperation.startsAt, fromEpochMinutes(to)), gt(scheduledOperation.endsAt, fromEpochMinutes(from))))
      .orderBy(asc(scheduledOperation.startsAt));
    const tz = l ? l.calendars.get(l.defaultCalendarId)!.timeZone : 'Asia/Kolkata';
    const dueAt = (b: { delivery: string | null; plannedEnd: string | null }) => {
      const d = b.delivery ?? b.plannedEnd;
      return d ? fromEpochMinutes(zonedEpochMinutes(d, '23:59', tz) + 1) : null;
    };
    const blocks = l
      ? await this.db
          .select()
          .from(machineBlock)
          .where(and(eq(machineBlock.entityId, entityId), lt(machineBlock.startsAt, fromEpochMinutes(to)), gt(machineBlock.endsAt, fromEpochMinutes(from))))
      : [];
    const unscheduledIds = run ? run.details.unscheduled.map((u) => u.operationId) : [];
    const conflictIds = run ? run.details.conflicts.map((c) => c.operationId) : [];
    const named = unscheduledIds.length || conflictIds.length
      ? await this.db
          .select({ id: workOrderOperation.id, seq: workOrderOperation.seq, name: workOrderOperation.name, workOrderId: workOrder.id, number: workOrder.number })
          .from(workOrderOperation)
          .innerJoin(workOrder, eq(workOrder.id, workOrderOperation.workOrderId))
          .where(inArray(workOrderOperation.id, [...unscheduledIds, ...conflictIds]))
      : [];
    const late = await this.db
      .select({ id: workOrder.id, number: workOrder.number, itemCode: item.code, scheduledFinish: workOrder.scheduledFinish, plannedEnd: workOrder.plannedEnd, delivery: salesOrder.deliveryDate, priority: workOrder.priority })
      .from(workOrder)
      .innerJoin(item, eq(item.id, workOrder.itemId))
      .leftJoin(salesOrder, eq(salesOrder.id, workOrder.salesOrderId))
      .where(and(eq(workOrder.entityId, entityId), eq(workOrder.status, 'released')));
    // Out of date when released work has changed since the run.
    const stale =
      !run ||
      (
        await this.db
          .select({ id: workOrder.id })
          .from(workOrder)
          .where(and(eq(workOrder.entityId, entityId), gt(workOrder.updatedAt, run.runAt)))
          .limit(1)
      ).length > 0;
    return {
      run: run ?? null,
      stale,
      calendarMissing: !l,
      timeZone: tz,
      machines: l ? l.machines : [],
      working: l ? Object.fromEntries([...l.calendars.entries()].map(([id, c]) => [id, workingIntervals(c, from, to).map((i) => ({ start: fromEpochMinutes(i.start), end: fromEpochMinutes(i.end) }))])) : {},
      blocks: blocks.map((b) => ({ id: b.id, machineId: b.machineId, kind: b.kind, startsAt: b.startsAt, endsAt: b.endsAt, reason: b.reason })),
      bars: bars.map((b) => {
        const due = dueAt(b);
        return {
          operationId: b.s.operationId,
          workOrderId: b.s.workOrderId,
          number: b.number,
          itemCode: b.itemCode,
          itemName: b.itemName,
          seq: b.seq,
          name: b.name,
          qty: b.plannedQty,
          priority: b.priority,
          machineId: b.s.machineId,
          startsAt: b.s.startsAt,
          endsAt: b.s.endsAt,
          pinned: b.s.pinned,
          running: b.s.running,
          dueAt: due,
          late: !!(due && b.scheduledFinish && b.scheduledFinish > due),
          noMaterial: !b.issued,
          conflict: conflictIds.includes(b.s.operationId),
        };
      }),
      unscheduled: run ? run.details.unscheduled.map((u) => ({ ...u, ...named.find((n) => n.id === u.operationId) })) : [],
      conflicts: run ? run.details.conflicts.map((c) => ({ ...c, ...named.find((n) => n.id === c.operationId) })) : [],
      late: late
        .map((w) => ({ ...w, dueAt: dueAt(w) }))
        .filter((w) => w.dueAt && w.scheduledFinish && w.scheduledFinish > w.dueAt)
        .map(({ delivery: _d, ...w }) => w),
    };
  }

  /**
   * A planner moves an operation to `start` on `machineId` (same work centre). The work fills that machine's free
   * time from `start`; refused when it would overlap another bar or downtime, break routing order or start in the
   * past, or when the schedule changed since `runId`. The moved bar is pinned.
   */
  async moveIn(tx: Tx, ctx: TenantRequestContext, entityId: string, input: { operationId: string; machineId: string; start: string; runId: string }) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`schedule:${entityId}`}))`);
    const [latest] = await tx.select({ id: scheduleRun.id }).from(scheduleRun).where(eq(scheduleRun.entityId, entityId)).orderBy(desc(scheduleRun.runAt)).limit(1);
    if (!latest || latest.id !== input.runId) throw new ConflictException('The schedule changed; reload');
    const [bar] = await tx.select().from(scheduledOperation).where(and(eq(scheduledOperation.operationId, input.operationId), eq(scheduledOperation.entityId, entityId))).for('update');
    if (!bar) throw new NotFoundException('This operation is not on the schedule');
    if (bar.running) throw new ConflictException('A running operation stays where it is');
    if (!bar.machineId) throw new BadRequestException('Outsourced operations are not on a machine');
    const [op] = await tx.select().from(workOrderOperation).where(eq(workOrderOperation.id, bar.operationId));
    const l = await this.load(tx, entityId);
    const target = l.machines.find((m) => m.id === input.machineId);
    if (!target || target.workCentreId !== op!.workCentreId) throw new BadRequestException({ message: 'Choose a machine in the operation’s work centre', issues: [{ path: 'machineId', message: 'Wrong work centre' }] });
    const now = toEpochMinutes(new Date());
    const start = toEpochMinutes(input.start);
    if (start < now) throw new BadRequestException('Can’t schedule in the past');
    const [down] = await tx
      .select({ reason: machineBlock.reason })
      .from(machineBlock)
      .where(and(eq(machineBlock.machineId, target.id), lt(machineBlock.startsAt, fromEpochMinutes(start + 1)), gt(machineBlock.endsAt, fromEpochMinutes(start))))
      .limit(1);
    if (down) throw new ConflictException(`Overlaps downtime on that machine (${down.reason})`);
    const minutes = Math.max(0, Math.round((bar.endsAt.getTime() - bar.startsAt.getTime()) / 60000));
    const length = this.workMinutes((await this.freeTime(tx, entityId, l, toEpochMinutes(bar.startsAt), toEpochMinutes(bar.endsAt) + 1)).get(bar.machineId) ?? [], bar) || minutes;
    const horizonEnd = Math.max(start, now) + HORIZON_DAYS * 1440 * 2;
    const working = (await this.freeTime(tx, entityId, l, start, horizonEnd)).get(target.id) ?? [];
    const a = allocate(working, start, length);
    if (!a) throw new BadRequestException('Not enough working time on that machine');
    const others = await tx
      .select()
      .from(scheduledOperation)
      .where(and(eq(scheduledOperation.entityId, entityId), eq(scheduledOperation.machineId, target.id), lt(scheduledOperation.startsAt, fromEpochMinutes(a.end)), gt(scheduledOperation.endsAt, fromEpochMinutes(a.start))));
    const clash = others.find((o) => o.operationId !== bar.operationId);
    if (clash) throw new ConflictException('Overlaps another operation on that machine');
    const [blocked] = await tx
      .select({ reason: machineBlock.reason })
      .from(machineBlock)
      .where(and(eq(machineBlock.machineId, target.id), lt(machineBlock.startsAt, fromEpochMinutes(a.end)), gt(machineBlock.endsAt, fromEpochMinutes(a.start))))
      .limit(1);
    if (blocked) throw new ConflictException(`Overlaps downtime on that machine (${blocked.reason})`);
    const siblings = await tx
      .select({ seq: workOrderOperation.seq, machineId: scheduledOperation.machineId, startsAt: scheduledOperation.startsAt, endsAt: scheduledOperation.endsAt })
      .from(scheduledOperation)
      .innerJoin(workOrderOperation, eq(workOrderOperation.id, scheduledOperation.operationId))
      .where(eq(scheduledOperation.workOrderId, bar.workOrderId));
    const before = siblings.filter((s) => s.seq < op!.seq).sort((x, y) => y.seq - x.seq)[0];
    // Outsourced operations are not on a machine and can't be moved; they follow on the next run.
    const after = siblings.filter((s) => s.seq > op!.seq && s.machineId).sort((x, y) => x.seq - y.seq)[0];
    if (before && toEpochMinutes(before.endsAt) > a.start) throw new ConflictException(`Operation ${before.seq} finishes after this start`);
    if (after && toEpochMinutes(after.startsAt) < a.end) throw new ConflictException(`Operation ${after.seq} starts before this finishes; move it first`);
    const [row] = await tx
      .update(scheduledOperation)
      .set({ machineId: target.id, startsAt: fromEpochMinutes(a.start), endsAt: fromEpochMinutes(a.end), pinned: true, updatedAt: new Date() })
      .where(eq(scheduledOperation.id, bar.id))
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'schedule.move', targetType: 'work_order_operation', targetId: bar.operationId, before: { machineId: bar.machineId, startsAt: bar.startsAt, endsAt: bar.endsAt }, after: { machineId: row!.machineId, startsAt: row!.startsAt, endsAt: row!.endsAt } }, tx);
    return row!;
  }

  /** Working minutes a bar occupies: its span minus the non-working time inside it. */
  private workMinutes(free: Interval[], bar: { startsAt: Date; endsAt: Date }) {
    const s = toEpochMinutes(bar.startsAt);
    const e = toEpochMinutes(bar.endsAt);
    return normalize(free)
      .map((f) => Math.max(0, Math.min(f.end, e) - Math.max(f.start, s)))
      .reduce((x, y) => x + y, 0);
  }

  async unpinIn(tx: Tx, ctx: TenantRequestContext, entityId: string, operationId: string) {
    const [row] = await tx
      .update(scheduledOperation)
      .set({ pinned: false, updatedAt: new Date() })
      .where(and(eq(scheduledOperation.operationId, operationId), eq(scheduledOperation.entityId, entityId)))
      .returning();
    if (!row) throw new NotFoundException('This operation is not on the schedule');
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'schedule.unpin', targetType: 'work_order_operation', targetId: operationId }, tx);
    return row;
  }

  /** The machine queues in schedule order, for the shop floor's dispatch list. */
  async dispatch(db: Database | Tx, entityId: string) {
    return db
      .select({ operationId: scheduledOperation.operationId, machineId: scheduledOperation.machineId, startsAt: scheduledOperation.startsAt })
      .from(scheduledOperation)
      .innerJoin(workOrder, eq(workOrder.id, scheduledOperation.workOrderId))
      .where(and(eq(scheduledOperation.entityId, entityId), eq(workOrder.status, 'released')))
      .orderBy(asc(scheduledOperation.startsAt));
  }
}
