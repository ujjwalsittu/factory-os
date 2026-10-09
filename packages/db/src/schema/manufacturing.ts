// Manufacturing slice 2a (decision 044): work centres, BOMs with operations, work orders, job cards and
// the append-only WIP cost ledger. Stock moves through stock entries with production purposes.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { batch, stockEntry, warehouse } from './inventory.js';
import { item, party, qty } from './masters.js';
import { legalEntity, tenant } from './platform.js';
import { salesOrder } from './selling.js';

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

/** Machine group. The hourly rate (INR, machine + labour) is what job cards absorb into WIP. */
export const workCentre = pgTable(
  'work_centre',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    code: text('code').notNull(),
    name: text('name').notNull(),
    hourlyRate: qty('hourly_rate').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...stamps,
  },
  (t) => [uniqueIndex('work_centre_entity_code_uq').on(t.entityId, t.code), check('work_centre_rate_ck', sql`${t.hourlyRate} >= 0`)],
);

export const machine = pgTable(
  'machine',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    workCentreId: uuid('work_centre_id')
      .notNull()
      .references(() => workCentre.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...stamps,
  },
  (t) => [uniqueIndex('machine_entity_code_uq').on(t.entityId, t.code), index('machine_centre_idx').on(t.workCentreId)],
);

export const bomStatus = pgEnum('bom_status', ['draft', 'active', 'obsolete']);

/** Bill of materials with its operations (routing) for one item revision. Active BOMs are frozen. */
export const bom = pgTable(
  'bom',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    revision: text('revision').notNull(),
    /** Quantity of the item this BOM makes; materials are per this quantity. */
    quantity: qty('quantity').notNull().default('1'),
    status: bomStatus('status').notNull().default('draft'),
    isDefault: boolean('is_default').notNull().default(false),
    remarks: text('remarks'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    activatedBy: text('activated_by').references(() => user.id),
    ...stamps,
  },
  (t) => [
    uniqueIndex('bom_item_revision_uq').on(t.entityId, t.itemId, t.revision),
    uniqueIndex('bom_item_default_uq').on(t.entityId, t.itemId).where(sql`${t.isDefault}`),
    check('bom_quantity_ck', sql`${t.quantity} > 0`),
  ],
);

export const bomMaterial = pgTable(
  'bom_material',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bomId: uuid('bom_id')
      .notNull()
      .references(() => bom.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    qty: qty('qty').notNull(),
    /** Issued automatically on output (fasteners, consumables). Never batch-tracked items. */
    backflush: boolean('backflush').notNull().default(false),
    remarks: text('remarks'),
  },
  (t) => [index('bom_material_bom_idx').on(t.bomId), check('bom_material_qty_ck', sql`${t.qty} > 0`)],
);

export const bomOperation = pgTable(
  'bom_operation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bomId: uuid('bom_id')
      .notNull()
      .references(() => bom.id, { onDelete: 'cascade' }),
    /** 10, 20, 30… */
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
    /** Null only for an outsourced operation (decision 047). */
    workCentreId: uuid('work_centre_id').references(() => workCentre.id),
    /** Done by a job worker: no work centre, no job cards (decision 047). */
    outsourced: boolean('outsourced').notNull().default(false),
    supplierId: uuid('supplier_id').references(() => party.id),
    setupMinutes: qty('setup_minutes').notNull().default('0'),
    runMinutesPerUnit: qty('run_minutes_per_unit').notNull().default('0'),
    instructions: text('instructions'),
  },
  (t) => [uniqueIndex('bom_operation_seq_uq').on(t.bomId, t.seq), check('bom_operation_centre_ck', sql`${t.outsourced} or ${t.workCentreId} is not null`)],
);

export const workOrderStatus = pgEnum('work_order_status', ['draft', 'released', 'completed', 'cancelled']);

export const workOrder = pgTable(
  'work_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    /** Assigned on release. */
    number: text('number'),
    status: workOrderStatus('status').notNull().default('draft'),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    bomId: uuid('bom_id')
      .notNull()
      .references(() => bom.id),
    plannedQty: qty('planned_qty').notNull(),
    producedQty: qty('produced_qty').notNull().default('0'),
    /** Default for issues and backflush. */
    sourceWarehouseId: uuid('source_warehouse_id')
      .notNull()
      .references(() => warehouse.id),
    /** Where output goes. */
    targetWarehouseId: uuid('target_warehouse_id')
      .notNull()
      .references(() => warehouse.id),
    salesOrderId: uuid('sales_order_id').references(() => salesOrder.id),
    /** Rework/repair order for an NCR disposition (decision 048). */
    reworkOfNcrId: uuid('rework_of_ncr_id'),
    plannedStart: date('planned_start'),
    plannedEnd: date('planned_end'),
    remarks: text('remarks'),
    releasedBy: text('released_by').references(() => user.id),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    completedBy: text('completed_by').references(() => user.id),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedOn: date('completed_on'),
    cancelledBy: text('cancelled_by').references(() => user.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...stamps,
  },
  (t) => [
    uniqueIndex('work_order_entity_number_uq').on(t.entityId, t.number),
    index('work_order_entity_status_idx').on(t.entityId, t.status),
    check('work_order_qty_ck', sql`${t.plannedQty} > 0`),
  ],
);

/** Frozen copy of the BOM materials at release, scaled to the planned quantity. */
export const workOrderMaterial = pgTable(
  'work_order_material',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrder.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    /** Per unit of output, kept for backflush. */
    qtyPerUnit: qty('qty_per_unit').notNull(),
    requiredQty: qty('required_qty').notNull(),
    backflush: boolean('backflush').notNull().default(false),
  },
  (t) => [uniqueIndex('work_order_material_item_uq').on(t.workOrderId, t.itemId)],
);

export const workOrderOperation = pgTable(
  'work_order_operation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrder.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
    workCentreId: uuid('work_centre_id').references(() => workCentre.id),
    outsourced: boolean('outsourced').notNull().default(false),
    supplierId: uuid('supplier_id').references(() => party.id),
    plannedMinutes: qty('planned_minutes').notNull(),
    instructions: text('instructions'),
  },
  (t) => [uniqueIndex('work_order_operation_seq_uq').on(t.workOrderId, t.seq), check('work_order_operation_centre_ck', sql`${t.outsourced} or ${t.workCentreId} is not null`)],
);

export const jobCardStatus = pgEnum('job_card_status', ['running', 'paused', 'completed', 'cancelled']);

export const jobCard = pgTable(
  'job_card',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrder.id),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => workOrderOperation.id),
    machineId: uuid('machine_id').references(() => machine.id),
    operatorId: text('operator_id')
      .notNull()
      .references(() => user.id),
    status: jobCardStatus('status').notNull().default('running'),
    goodQty: qty('good_qty'),
    reworkQty: qty('rework_qty'),
    scrapQty: qty('scrap_qty'),
    minutes: qty('minutes'),
    /** Work centre rate when the card was completed. */
    hourlyRate: qty('hourly_rate'),
    value: qty('value'),
    postingDate: date('posting_date'),
    remarks: text('remarks'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by').references(() => user.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('job_card_work_order_idx').on(t.workOrderId),
    // One running or paused card per operator at a time.
    uniqueIndex('job_card_operator_open_uq').on(t.operatorId).where(sql`${t.status} in ('running', 'paused')`),
  ],
);

export const jobCardEventKind = pgEnum('job_card_event_kind', ['start', 'pause', 'resume', 'stop']);

/** Append-only. */
export const jobCardEvent = pgTable(
  'job_card_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobCardId: uuid('job_card_id')
      .notNull()
      .references(() => jobCard.id),
    kind: jobCardEventKind('kind').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    reason: text('reason'),
    by: text('by')
      .notNull()
      .references(() => user.id),
  },
  (t) => [index('job_card_event_card_idx').on(t.jobCardId, t.at)],
);

export const workOrderCostKind = pgEnum('work_order_cost_kind', ['issue', 'return', 'absorption', 'output', 'variance', 'job_work']);

/** Append-only WIP ledger per work order: positive into WIP, negative out. A reversal negates its row. */
export const workOrderCost = pgTable(
  'work_order_cost',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrder.id),
    kind: workOrderCostKind('kind').notNull(),
    postingDate: date('posting_date').notNull(),
    amount: qty('amount').notNull(),
    /** Output rows: quantity produced (negative on reversal). */
    qty: qty('qty'),
    stockEntryId: uuid('stock_entry_id').references(() => stockEntry.id),
    jobCardId: uuid('job_card_id').references(() => jobCard.id),
    /** job_work rows: the purchase invoice line that charged the processing (decision 047). */
    purchaseInvoiceLineId: uuid('purchase_invoice_line_id'),
    reversalOf: uuid('reversal_of'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('work_order_cost_wo_idx').on(t.workOrderId, t.createdAt), uniqueIndex('work_order_cost_reversal_uq').on(t.reversalOf)],
);

/** Gapless running number per serial-tracked item per tenant; never resets (decision 046). */
export const serialCounter = pgTable(
  'serial_counter',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    nextValue: integer('next_value').notNull().default(1),
  },
  (t) => [uniqueIndex('serial_counter_item_uq').on(t.tenantId, t.itemId)],
);

/** As-built: which component serial went into which assembly serial. Append-only; a reversal row frees it. */
export const serialComponent = pgTable(
  'serial_component',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    assemblyBatchId: uuid('assembly_batch_id')
      .notNull()
      .references(() => batch.id),
    componentBatchId: uuid('component_batch_id')
      .notNull()
      .references(() => batch.id),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrder.id),
    stockEntryId: uuid('stock_entry_id')
      .notNull()
      .references(() => stockEntry.id),
    reversalOf: uuid('reversal_of'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('serial_component_assembly_idx').on(t.assemblyBatchId),
    index('serial_component_component_idx').on(t.componentBatchId),
    uniqueIndex('serial_component_reversal_uq').on(t.reversalOf),
  ],
);
