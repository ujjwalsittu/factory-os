// Decision 065: SMT board traceability. Reels and paste jars are tracked containers of a component lot; their events
// drive the MSL and paste clocks; feeder loads per work order say which reels a placed panel saw; panels carry the
// board serials reserved at label printing. Labels go to plant printers through the edge agent.
import { sql } from 'drizzle-orm';
import { check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { batch, warehouse } from './inventory.js';
import { iotEdge } from './iot.js';
import { machine, workOrder } from './manufacturing.js';
import { item, qty } from './masters.js';
import { legalEntity, tenant } from './platform.js';

const scope = {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => legalEntity.id),
};

// ── Printers and print jobs ──

export const labelPrinterStatus = pgEnum('label_printer_status', ['active', 'retired']);

/** A Zebra-compatible label printer on a plant network, reached through that plant's edge agent. */
export const labelPrinter = pgTable(
  'label_printer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    edgeId: uuid('edge_id')
      .notNull()
      .references(() => iotEdge.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    host: text('host').notNull(),
    port: integer('port').notNull().default(9100),
    dpi: integer('dpi').notNull().default(203),
    widthMm: integer('width_mm').notNull(),
    heightMm: integer('height_mm').notNull(),
    status: labelPrinterStatus('status').notNull().default('active'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('label_printer_code_uq').on(t.entityId, t.code),
    check('label_printer_port_ck', sql`${t.port} between 1 and 65535`),
    check('label_printer_dpi_ck', sql`${t.dpi} in (203, 300, 600)`),
    check('label_printer_size_ck', sql`${t.widthMm} between 10 and 200 and ${t.heightMm} between 5 and 300`),
  ],
);

export const printJobStatus = pgEnum('print_job_status', ['queued', 'sent', 'printed', 'failed']);
export const printJobKind = pgEnum('print_job_kind', ['panel', 'board', 'container', 'test']);

export const printJob = pgTable(
  'print_job',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    printerId: uuid('printer_id')
      .notNull()
      .references(() => labelPrinter.id),
    kind: printJobKind('kind').notNull(),
    /** The panel, board or container the label is for (null for a test label). */
    sourceId: uuid('source_id'),
    label: text('label').notNull(),
    zpl: text('zpl').notNull(),
    status: printJobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    /** While sent, the edge holds the job until then; a crashed agent's job returns to the queue. */
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    error: text('error'),
    printedAt: timestamp('printed_at', { withTimezone: true }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('print_job_printer_status_idx').on(t.printerId, t.status, t.createdAt), index('print_job_source_idx').on(t.sourceId)],
);

// ── Reels and paste jars ──

export const smtContainerKind = pgEnum('smt_container_kind', ['reel', 'paste']);

export const smtContainer = pgTable(
  'smt_container',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    kind: smtContainerKind('kind').notNull(),
    /** Its label: printed by us or the supplier's reel ID, scanned. */
    code: text('code').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    /** The component lot; stock and FIFO stay at lot level. */
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batch.id),
    warehouseId: uuid('warehouse_id').references(() => warehouse.id),
    qty: qty('qty').notNull(),
    /** MSL 6: the floor life on the part's label, in hours. */
    labelHours: integer('label_hours'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('smt_container_code_uq').on(t.entityId, t.code), index('smt_container_batch_idx').on(t.batchId), check('smt_container_qty_ck', sql`${t.qty} > 0`)],
);

/** Append-only (trigger): opened, dry cabinet in/out, baked, resealed, empty; paste out of fridge, opened, back in, empty. */
export const smtContainerEvent = pgTable(
  'smt_container_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    containerId: uuid('container_id')
      .notNull()
      .references(() => smtContainer.id),
    kind: text('kind').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
  },
  (t) => [
    index('smt_container_event_container_idx').on(t.containerId, t.at),
    check('smt_container_event_kind_ck', sql`${t.kind} in ('opened', 'cabinet_in', 'cabinet_out', 'baked', 'resealed', 'empty', 'out_of_fridge', 'back_in_fridge')`),
  ],
);

// ── Feeder setup ──

export const smtFeederLoad = pgTable(
  'smt_feeder_load',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrder.id),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machine.id),
    slot: text('slot').notNull(),
    containerId: uuid('container_id')
      .notNull()
      .references(() => smtContainer.id),
    loadedAt: timestamp('loaded_at', { withTimezone: true }).notNull().defaultNow(),
    loadedBy: text('loaded_by')
      .notNull()
      .references(() => user.id),
    unloadedAt: timestamp('unloaded_at', { withTimezone: true }),
    unloadedBy: text('unloaded_by').references(() => user.id),
  },
  (t) => [
    uniqueIndex('smt_feeder_slot_uq').on(t.workOrderId, t.machineId, t.slot).where(sql`${t.unloadedAt} is null`),
    uniqueIndex('smt_feeder_container_uq').on(t.containerId).where(sql`${t.unloadedAt} is null`),
    index('smt_feeder_wo_idx').on(t.workOrderId, t.loadedAt),
    index('smt_feeder_container_idx').on(t.containerId),
  ],
);

// ── Panels and boards ──

export const smtPanel = pgTable(
  'smt_panel',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrder.id),
    seq: integer('seq').notNull(),
    code: text('code').notNull(),
    placedAt: timestamp('placed_at', { withTimezone: true }),
    placedBy: text('placed_by').references(() => user.id),
    /** The placement machine the panel was scanned into (its feeder setup). */
    machineId: uuid('machine_id').references(() => machine.id),
    depaneledAt: timestamp('depaneled_at', { withTimezone: true }),
    depaneledBy: text('depaneled_by').references(() => user.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('smt_panel_code_uq').on(t.entityId, t.code), uniqueIndex('smt_panel_wo_seq_uq').on(t.workOrderId, t.seq)],
);

export const smtBoard = pgTable(
  'smt_board',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    panelId: uuid('panel_id')
      .notNull()
      .references(() => smtPanel.id),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrder.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    position: integer('position').notNull(),
    /** Reserved from the item's serial counter when the panel label was printed (decision 046). */
    serialNo: text('serial_no').notNull(),
    /** The serial batch made by production output. */
    batchId: uuid('batch_id').references(() => batch.id),
    scrappedAt: timestamp('scrapped_at', { withTimezone: true }),
    scrappedBy: text('scrapped_by').references(() => user.id),
    scrapReason: text('scrap_reason'),
  },
  (t) => [
    uniqueIndex('smt_board_serial_uq').on(t.itemId, t.serialNo),
    uniqueIndex('smt_board_panel_pos_uq').on(t.panelId, t.position),
    uniqueIndex('smt_board_batch_uq').on(t.batchId),
    index('smt_board_wo_idx').on(t.workOrderId),
    check('smt_board_scrap_ck', sql`${t.scrappedAt} is null or ${t.batchId} is null`),
  ],
);
