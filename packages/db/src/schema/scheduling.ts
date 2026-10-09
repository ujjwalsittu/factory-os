// Manufacturing slice 2e (decision 049): working calendars, machine blocks and the finite capacity schedule.
// The schedule is a plan, not a ledger: a run replaces its unpinned placements.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { machine, workOrder, workOrderOperation } from './manufacturing.js';
import { legalEntity, tenant } from './platform.js';

const scope = {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => legalEntity.id),
};
const stamps = {
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Weekly shift pattern and holidays. One default per entity; work centres may name another. */
export const workCalendar = pgTable(
  'work_calendar',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    name: text('name').notNull(),
    timeZone: text('time_zone').notNull().default('Asia/Kolkata'),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...stamps,
  },
  (t) => [uniqueIndex('work_calendar_entity_name_uq').on(t.entityId, t.name), uniqueIndex('work_calendar_entity_default_uq').on(t.entityId).where(sql`${t.isDefault}`)],
);

/** A shift starting on `weekday` (1 = Monday … 7 = Sunday); an end at or before the start runs past midnight. */
export const calendarShift = pgTable(
  'calendar_shift',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => workCalendar.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    name: text('name'),
  },
  (t) => [
    index('calendar_shift_calendar_idx').on(t.calendarId),
    check('calendar_shift_weekday_ck', sql`${t.weekday} between 1 and 7`),
    check('calendar_shift_time_ck', sql`${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${t.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  ],
);

export const calendarHoliday = pgTable(
  'calendar_holiday',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => workCalendar.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('calendar_holiday_date_uq').on(t.calendarId, t.date)],
);

/** `booking` is reserved for Phase 3 MaaS bookings. */
export const machineBlockKind = pgEnum('machine_block_kind', ['maintenance', 'breakdown', 'booking']);

/** Time a machine is not available to the scheduler. */
export const machineBlock = pgTable(
  'machine_block',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machine.id),
    kind: machineBlockKind('kind').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    ...stamps,
  },
  (t) => [index('machine_block_machine_idx').on(t.machineId, t.startsAt), check('machine_block_period_ck', sql`${t.endsAt} > ${t.startsAt}`)],
);

/** One "Reschedule" of an entity: who, when, and what could not be placed. */
export const scheduleRun = pgTable(
  'schedule_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    horizonEnd: timestamp('horizon_end', { withTimezone: true }).notNull(),
    placed: integer('placed').notNull(),
    unscheduled: integer('unscheduled').notNull(),
    late: integer('late').notNull(),
    conflicts: integer('conflicts').notNull(),
    /** Unscheduled operations and conflicts with reasons, for the lists on the Gantt. */
    details: jsonb('details').$type<{ unscheduled: { operationId: string; reason: string }[]; conflicts: { operationId: string; reason: string }[] }>().notNull(),
    runBy: text('run_by')
      .notNull()
      .references(() => user.id),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('schedule_run_entity_idx').on(t.entityId, t.runAt)],
);

/** Where and when an operation is planned. Machine is null for outsourced operations. */
export const scheduledOperation = pgTable(
  'scheduled_operation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    runId: uuid('run_id')
      .notNull()
      .references(() => scheduleRun.id),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrder.id),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => workOrderOperation.id, { onDelete: 'cascade' }),
    machineId: uuid('machine_id').references(() => machine.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    pinned: boolean('pinned').notNull().default(false),
    running: boolean('running').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('scheduled_operation_op_uq').on(t.operationId),
    index('scheduled_operation_machine_idx').on(t.entityId, t.machineId, t.startsAt),
    check('scheduled_operation_period_ck', sql`${t.endsAt} >= ${t.startsAt}`),
  ],
);
