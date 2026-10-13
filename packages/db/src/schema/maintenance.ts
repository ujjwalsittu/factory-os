// Decision 066: machine maintenance. Preventive plans (calendar and/or running hours) with checklists; maintenance
// orders (preventive or breakdown) with results, labour and spares issued from stock; breakdowns block the machine
// on the schedule through a machine block.
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { stockEntry } from './inventory.js';
import { machine } from './manufacturing.js';
import { item, qty } from './masters.js';
import { legalEntity, tenant } from './platform.js';
import { machineBlock } from './scheduling.js';

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

export const maintenancePlan = pgTable(
  'maintenance_plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machine.id),
    name: text('name').notNull(),
    instructions: text('instructions'),
    everyDays: integer('every_days'),
    everyRunHours: integer('every_run_hours'),
    leadDays: integer('lead_days').notNull().default(7),
    /** How long the machine is blocked on the schedule when an order of this plan is scheduled. */
    plannedMinutes: integer('planned_minutes').notNull().default(60),
    /** The baseline the next due date and hours count from: the last completed order, or as entered. */
    lastDoneAt: timestamp('last_done_at', { withTimezone: true }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...stamps,
  },
  (t) => [
    index('maintenance_plan_machine_idx').on(t.machineId),
    check('maintenance_plan_interval_ck', sql`${t.everyDays} is not null or ${t.everyRunHours} is not null`),
    check('maintenance_plan_values_ck', sql`coalesce(${t.everyDays}, 1) > 0 and coalesce(${t.everyRunHours}, 1) > 0 and ${t.leadDays} >= 0 and ${t.plannedMinutes} > 0`),
  ],
);

/** A checklist line: text, and for a measured item its unit and limits (a reading is then required). */
export const maintenancePlanItem = pgTable(
  'maintenance_plan_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => maintenancePlan.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    text: text('text').notNull(),
    unit: text('unit'),
    min: numeric('min', { precision: 18, scale: 4 }),
    max: numeric('max', { precision: 18, scale: 4 }),
    /** A spare the task usually needs (shown on the order with its stock). */
    spareItemId: uuid('spare_item_id').references(() => item.id),
    spareQty: qty('spare_qty'),
  },
  (t) => [uniqueIndex('maintenance_plan_item_line_uq').on(t.planId, t.lineNo)],
);

export const maintenanceOrderKind = pgEnum('maintenance_order_kind', ['preventive', 'breakdown']);
export const maintenanceOrderStatus = pgEnum('maintenance_order_status', ['open', 'in_progress', 'done', 'verified', 'cancelled']);

export const maintenanceOrder = pgTable(
  'maintenance_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    number: text('number').notNull(),
    kind: maintenanceOrderKind('kind').notNull(),
    status: maintenanceOrderStatus('status').notNull().default('open'),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machine.id),
    planId: uuid('plan_id').references(() => maintenancePlan.id),
    title: text('title').notNull(),
    /** Preventive: when it is planned; its machine block covers the plan's planned minutes. */
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
    /** Breakdown: what the operator saw and when the machine stopped. */
    symptom: text('symptom'),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    reportedBy: text('reported_by').references(() => user.id),
    /** The schedule block this order holds (maintenance or breakdown). */
    blockId: uuid('block_id').references(() => machineBlock.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    cause: text('cause'),
    action: text('action'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneBy: text('done_by').references(() => user.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by').references(() => user.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...stamps,
  },
  (t) => [
    uniqueIndex('maintenance_order_number_uq').on(t.entityId, t.number),
    index('maintenance_order_machine_idx').on(t.machineId, t.createdAt),
    // One open preventive order per plan at a time.
    uniqueIndex('maintenance_order_plan_open_uq').on(t.planId).where(sql`${t.status} in ('open', 'in_progress')`),
    check('maintenance_order_breakdown_ck', sql`${t.kind} <> 'breakdown' or (${t.failedAt} is not null and ${t.symptom} is not null)`),
  ],
);

/** Checklist results, one per plan item; a reading where the item is measured. */
export const maintenanceResult = pgTable(
  'maintenance_result',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => maintenanceOrder.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => maintenancePlanItem.id),
    reading: numeric('reading', { precision: 18, scale: 4 }),
    note: text('note'),
    doneBy: text('done_by')
      .notNull()
      .references(() => user.id),
    doneAt: timestamp('done_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('maintenance_result_item_uq').on(t.orderId, t.itemId)],
);

/** Technician time, costed at the machine's work centre rate when recorded. */
export const maintenanceLabour = pgTable(
  'maintenance_labour',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => maintenanceOrder.id),
    technicianId: text('technician_id')
      .notNull()
      .references(() => user.id),
    minutes: integer('minutes').notNull(),
    rate: numeric('rate', { precision: 18, scale: 2 }).notNull(),
    cost: numeric('cost', { precision: 18, scale: 2 }).notNull(),
    note: text('note'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('maintenance_labour_order_idx').on(t.orderId), check('maintenance_labour_minutes_ck', sql`${t.minutes} > 0`)],
);

/** Spares issued to an order: a system stock entry with purpose `maintenance` (cancelled through the order). */
export const maintenanceSpare = pgTable(
  'maintenance_spare',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => maintenanceOrder.id),
    stockEntryId: uuid('stock_entry_id')
      .notNull()
      .references(() => stockEntry.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('maintenance_spare_entry_uq').on(t.stockEntryId), index('maintenance_spare_order_idx').on(t.orderId)],
);
