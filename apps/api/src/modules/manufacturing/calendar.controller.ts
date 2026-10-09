// Working calendars and machine downtime for scheduling (decision 049).
import { overlappingShifts } from '@factoryos/core';
import { calendarHoliday, calendarShift, type Database, machine, machineBlock, workCalendar, workCentre } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf, type Tx } from '../accounting/accounting-lock.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const timeZone = z
  .string()
  .trim()
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');
const calendarInput = z.object({
  name: z.string().trim().min(1).max(80),
  timeZone: timeZone.default('Asia/Kolkata'),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  shifts: z
    .array(z.object({ weekday: z.number().int().min(1).max(7), start: time, end: time, name: z.string().trim().max(40).nullable().optional() }))
    .min(1, 'Add at least one shift')
    .max(60),
  holidays: z
    .array(z.object({ date: z.iso.date(), name: z.string().trim().min(1).max(80) }))
    .max(400)
    .default([]),
});
type CalendarInput = z.infer<typeof calendarInput>;
const blockInput = z.object({
  machineId: z.uuid(),
  /** `booking` is reserved for Phase 3 MaaS bookings. */
  kind: z.enum(['maintenance', 'breakdown']),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

@Controller('manufacturing')
export class CalendarController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  @Get('calendars')
  @RequirePermission('manufacturing.calendar.read')
  async calendars(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const cals = await this.db.select().from(workCalendar).where(eq(workCalendar.entityId, entityId)).orderBy(asc(workCalendar.name));
    if (!cals.length) return [];
    const ids = cals.map((c) => c.id);
    const shifts = await this.db.select().from(calendarShift).where(inArray(calendarShift.calendarId, ids)).orderBy(asc(calendarShift.weekday), asc(calendarShift.startTime));
    const holidays = await this.db.select().from(calendarHoliday).where(inArray(calendarHoliday.calendarId, ids)).orderBy(asc(calendarHoliday.date));
    const centres = await this.db.select({ id: workCentre.id, code: workCentre.code, calendarId: workCentre.calendarId }).from(workCentre).where(eq(workCentre.entityId, entityId));
    return cals.map((c) => ({
      ...c,
      shifts: shifts.filter((s) => s.calendarId === c.id).map((s) => ({ weekday: s.weekday, start: s.startTime, end: s.endTime, name: s.name })),
      holidays: holidays.filter((h) => h.calendarId === c.id).map((h) => ({ date: h.date, name: h.name })),
      workCentres: centres.filter((w) => w.calendarId === c.id || (!w.calendarId && c.isDefault)).map((w) => w.code),
    }));
  }

  @Post('calendars')
  @RequirePermission('manufacturing.calendar.update')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = this.check(parse(calendarInput, body));
    return this.db.transaction(async (tx) => {
      const existing = await tx.select({ id: workCalendar.id }).from(workCalendar).where(eq(workCalendar.entityId, entityId)).limit(1);
      // The first calendar of an entity is its default.
      const isDefault = input.isDefault || existing.length === 0;
      if (isDefault) await tx.update(workCalendar).set({ isDefault: false, updatedAt: new Date() }).where(eq(workCalendar.entityId, entityId));
      const [row] = await tx
        .insert(workCalendar)
        .values({ tenantId: ctx.tenant.tenantId, entityId, name: input.name, timeZone: input.timeZone, isDefault, isActive: input.isActive, createdBy: ctx.user.id })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictException(`A calendar named ${input.name} already exists`);
      await this.writeLines(tx, row.id, input);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_calendar.create', targetType: 'work_calendar', targetId: row.id, after: input }, tx);
      return row;
    });
  }

  @Put('calendars/:id')
  @RequirePermission('manufacturing.calendar.update')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = this.check(parse(calendarInput, body));
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(workCalendar).where(and(eq(workCalendar.id, id), eq(workCalendar.entityId, entityId))).for('update');
      if (!before) throw new NotFoundException('Calendar not found');
      if (before.isDefault && !input.isDefault) throw new BadRequestException({ message: 'Make another calendar the default instead', issues: [{ path: 'isDefault', message: 'The entity needs a default calendar' }] });
      if (before.isDefault && !input.isActive) throw new BadRequestException({ message: 'The default calendar stays active', issues: [{ path: 'isActive', message: 'Make another calendar the default first' }] });
      if (!input.isActive) {
        const [used] = await tx.select({ code: workCentre.code }).from(workCentre).where(and(eq(workCentre.calendarId, id), eq(workCentre.isActive, true))).limit(1);
        if (used) throw new ConflictException(`Work centre ${used.code} uses this calendar`);
      }
      if (input.isDefault && !before.isDefault) await tx.update(workCalendar).set({ isDefault: false, updatedAt: new Date() }).where(and(eq(workCalendar.entityId, entityId), ne(workCalendar.id, id)));
      const [clash] = await tx.select({ id: workCalendar.id }).from(workCalendar).where(and(eq(workCalendar.entityId, entityId), eq(workCalendar.name, input.name), ne(workCalendar.id, id)));
      if (clash) throw new ConflictException(`A calendar named ${input.name} already exists`);
      const [row] = await tx.update(workCalendar).set({ name: input.name, timeZone: input.timeZone, isDefault: input.isDefault, isActive: input.isActive, updatedAt: new Date() }).where(eq(workCalendar.id, id)).returning();
      await tx.delete(calendarShift).where(eq(calendarShift.calendarId, id));
      await tx.delete(calendarHoliday).where(eq(calendarHoliday.calendarId, id));
      await this.writeLines(tx, id, input);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_calendar.update', targetType: 'work_calendar', targetId: id, before: { name: before.name, timeZone: before.timeZone, isDefault: before.isDefault }, after: input }, tx);
      return row;
    });
  }

  private check(input: CalendarInput) {
    const clash = overlappingShifts(input.shifts);
    if (clash) {
      const label = (s: { weekday: number; start: string; end: string }) => `${DAYS[s.weekday]} ${s.start}–${s.end}`;
      throw new BadRequestException({ message: `Shifts ${label(clash[0])} and ${label(clash[1])} overlap`, issues: [{ path: 'shifts', message: 'Shifts overlap' }] });
    }
    const dates = input.holidays.map((h) => h.date);
    if (new Set(dates).size !== dates.length) throw new BadRequestException({ message: 'A date is listed twice', issues: [{ path: 'holidays', message: 'Duplicate date' }] });
    return input;
  }

  private async writeLines(tx: Tx, calendarId: string, input: CalendarInput) {
    await tx.insert(calendarShift).values(input.shifts.map((s) => ({ calendarId, weekday: s.weekday, startTime: s.start, endTime: s.end, name: s.name ?? null })));
    if (input.holidays.length) await tx.insert(calendarHoliday).values(input.holidays.map((h) => ({ calendarId, date: h.date, name: h.name })));
  }

  @Get('machine-blocks')
  @RequirePermission('manufacturing.calendar.read')
  async blocks(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const q = parse(z.object({ machineId: z.uuid().optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() }), query);
    const where = [eq(machineBlock.entityId, entityId)];
    if (q.machineId) where.push(eq(machineBlock.machineId, q.machineId));
    if (q.from) where.push(gt(machineBlock.endsAt, new Date(q.from)));
    if (q.to) where.push(lt(machineBlock.startsAt, new Date(q.to)));
    return this.db
      .select({ block: machineBlock, machineCode: machine.code, machineName: machine.name })
      .from(machineBlock)
      .innerJoin(machine, eq(machine.id, machineBlock.machineId))
      .where(and(...where))
      .orderBy(asc(machineBlock.startsAt))
      .then((rows) => rows.map((r) => ({ ...r.block, machineCode: r.machineCode, machineName: r.machineName })));
  }

  @Post('machine-blocks')
  @RequirePermission('manufacturing.calendar.update')
  async createBlock(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(blockInput, body);
    return this.db.transaction(async (tx) => {
      await this.assertBlock(tx, entityId, input);
      const [row] = await tx
        .insert(machineBlock)
        .values({ tenantId: ctx.tenant.tenantId, entityId, machineId: input.machineId, kind: input.kind, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), reason: input.reason, createdBy: ctx.user.id })
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'machine_block.create', targetType: 'machine_block', targetId: row!.id, after: input }, tx);
      return row;
    });
  }

  @Put('machine-blocks/:id')
  @RequirePermission('manufacturing.calendar.update')
  async updateBlock(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(blockInput, body);
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(machineBlock).where(and(eq(machineBlock.id, id), eq(machineBlock.entityId, entityId))).for('update');
      if (!before) throw new NotFoundException('Downtime not found');
      if (before.kind === 'booking') throw new ConflictException('Bookings are changed from the booking');
      await this.assertBlock(tx, entityId, input, id);
      const [row] = await tx
        .update(machineBlock)
        .set({ machineId: input.machineId, kind: input.kind, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), reason: input.reason, updatedAt: new Date() })
        .where(eq(machineBlock.id, id))
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'machine_block.update', targetType: 'machine_block', targetId: id, before, after: input }, tx);
      return row;
    });
  }

  @Delete('machine-blocks/:id')
  @RequirePermission('manufacturing.calendar.update')
  async deleteBlock(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(machineBlock).where(and(eq(machineBlock.id, id), eq(machineBlock.entityId, entityId))).for('update');
      if (!before) throw new NotFoundException('Downtime not found');
      if (before.kind === 'booking') throw new ConflictException('Bookings are changed from the booking');
      await tx.delete(machineBlock).where(eq(machineBlock.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'machine_block.delete', targetType: 'machine_block', targetId: id, before }, tx);
      return { deleted: true };
    });
  }

  private async assertBlock(tx: Tx, entityId: string, input: z.infer<typeof blockInput>, exceptId?: string) {
    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    if (end <= start) throw new BadRequestException({ message: 'The end is before the start', issues: [{ path: 'endsAt', message: 'After the start' }] });
    const [m] = await tx.select({ id: machine.id }).from(machine).where(and(eq(machine.id, input.machineId), eq(machine.entityId, entityId)));
    if (!m) throw new BadRequestException({ message: 'Unknown machine', issues: [{ path: 'machineId', message: 'Not a machine of this entity' }] });
    const where = [eq(machineBlock.machineId, input.machineId), lt(machineBlock.startsAt, end), gt(machineBlock.endsAt, start)];
    if (exceptId) where.push(ne(machineBlock.id, exceptId));
    const [clash] = await tx.select({ reason: machineBlock.reason }).from(machineBlock).where(and(...where)).limit(1);
    if (clash) throw new ConflictException(`Overlaps other downtime on this machine (${clash.reason})`);
  }
}
