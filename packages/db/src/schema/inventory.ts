// Inventory: warehouses/locations, batches, number series, stock entries, the append-only stock ledger,
// FIFO cost layers and materialised balances (docs/03 §2–§7, decision 018).
import { bigint, bigserial, boolean, date, index, integer, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { item, party, qty } from './masters.js';
import { legalEntity, plant, tenant } from './platform.js';

export const warehouseType = pgEnum('warehouse_type', [
  'stores',
  'quarantine',
  'mrb',
  'wip',
  'dry_cabinet',
  'cleanroom',
  'finished_goods',
  'scrap',
  'customer_owned',
  'at_job_worker',
  'transit',
]);

/**
 * Warehouses and bins in one tree: a bin is a warehouse with a parent. Stock is held at any node.
 * The type drives rules: availability for issue, ownership (customer-owned stock has no value).
 */
export const warehouse = pgTable(
  'warehouse',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntity.id, { onDelete: 'cascade' }),
    plantId: uuid('plant_id').references(() => plant.id),
    parentId: uuid('parent_id'),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: warehouseType('type').notNull(),
    /** Quarantine/MRB/scrap default to false: stock there can't be issued to production. */
    availableForIssue: boolean('available_for_issue').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('warehouse_entity_code_uq').on(t.entityId, t.code)],
);

/** lot: heat/powder lot/reel; serial: one unit (decision 046); remnant: a cut piece of a parent batch. */
export const batchKind = pgEnum('batch_kind', ['lot', 'serial', 'remnant']);

/** A batch / heat number / powder lot / reel of one item (docs/03 §4). Serials and remnants are batches too (decision 046). */
export const batch = pgTable(
  'batch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    batchNo: text('batch_no').notNull(),
    heatNo: text('heat_no'),
    supplierBatchNo: text('supplier_batch_no'),
    supplierId: uuid('supplier_id').references(() => party.id),
    mfgDate: date('mfg_date'),
    expiryDate: date('expiry_date'),
    /** Remnants and blends point to the batch they came from (Phase 2). */
    parentBatchId: uuid('parent_batch_id'),
    kind: batchKind('kind').notNull().default('lot'),
    /** Remnant pieces: the length of the piece. */
    lengthMm: qty('length_mm'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('batch_item_no_uq').on(t.itemId, t.batchNo), index('batch_tenant_heat_idx').on(t.tenantId, t.heatNo), index('batch_parent_idx').on(t.parentBatchId)],
);

/** Per-entity, per-document-type, per-FY counters. Numbers are allocated at submit, so drafts never burn numbers. */
export const numberSeries = pgTable(
  'number_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntity.id, { onDelete: 'cascade' }),
    docType: text('doc_type').notNull(),
    fy: text('fy').notNull(),
    pattern: text('pattern').notNull(),
    nextValue: integer('next_value').notNull().default(1),
  },
  (t) => [uniqueIndex('number_series_uq').on(t.entityId, t.docType, t.fy)],
);

export const docStatus = pgEnum('doc_status', ['draft', 'submitted', 'cancelled']);
/** return: customer material sent back to its owner. scrap: stock written off into the waste register. */
/** `delivery` = goods shipped to a customer by a sales invoice (decision 030). */
export const stockEntryPurpose = pgEnum('stock_entry_purpose', ['receipt', 'issue', 'transfer', 'adjustment', 'return', 'scrap', 'delivery', 'sales_return', 'purchase_return', 'purchase_return_receipt', 'production_issue', 'production_return', 'production_output', 'cut']);

export const stockEntry = pgTable(
  'stock_entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntity.id),
    /** Assigned on submit. */
    number: text('number'),
    purpose: stockEntryPurpose('purpose').notNull(),
    status: docStatus('status').notNull().default('draft'),
    postingDate: date('posting_date').notNull(),
    partyId: uuid('party_id').references(() => party.id),
    /** Goods receipts against a purchase order (slice 1b). No FK (avoids a schema import cycle); validated by the API. */
    purchaseOrderId: uuid('purchase_order_id'),
    /** Production purposes (decision 044). No FK (avoids a schema import cycle); validated by the API. */
    workOrderId: uuid('work_order_id'),
    /** Set on transfers generated by an incoming inspection. */
    systemGenerated: boolean('system_generated').notNull().default(false),
    reference: text('reference'),
    remarks: text('remarks'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    submittedBy: text('submitted_by').references(() => user.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by').references(() => user.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('stock_entry_entity_number_uq').on(t.entityId, t.number),
    index('stock_entry_entity_date_idx').on(t.entityId, t.postingDate),
    index('stock_entry_work_order_idx').on(t.workOrderId),
  ],
);

export const stockEntryLine = pgTable(
  'stock_entry_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => stockEntry.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    /** In the item's stock UoM. */
    qty: qty('qty').notNull(),
    fromWarehouseId: uuid('from_warehouse_id').references(() => warehouse.id),
    toWarehouseId: uuid('to_warehouse_id').references(() => warehouse.id),
    /** Existing batch (issues/transfers), or created on submit from newBatchNo/heatNo (receipts). */
    batchId: uuid('batch_id').references(() => batch.id),
    newBatchNo: text('new_batch_no'),
    heatNo: text('heat_no'),
    expiryDate: date('expiry_date'),
    /** Owning customer for customer-supplied material; null = owned by the entity (decision 024). */
    ownerPartyId: uuid('owner_party_id').references(() => party.id),
    /** Goods-receipt lines against a PO line. */
    poLineId: uuid('po_line_id'),
    /** Scrap lines: the waste-register category the stock goes into. */
    wasteCategory: text('waste_category'),
    /** Receipt cost per unit; for issues it's computed from FIFO on submit. */
    rate: qty('rate'),
    value: qty('value'),
    remarks: text('remarks'),
  },
  (t) => [index('stock_entry_line_entry_idx').on(t.entryId)],
);

/** Append-only. Corrections are reversals (AGENTS.md §6). */
export const stockLedgerEntry = pgTable(
  'stock_ledger_entry',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    entityId: uuid('entity_id').notNull(),
    itemId: uuid('item_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    batchId: uuid('batch_id'),
    /** null = owned by the entity; otherwise the customer who owns this stock. */
    ownerPartyId: uuid('owner_party_id'),
    /** Signed: + in, − out. */
    qty: qty('qty').notNull(),
    rate: qty('rate').notNull(),
    /** Signed value change. Zero for customer-owned stock. */
    value: qty('value').notNull(),
    postingDate: date('posting_date').notNull(),
    voucherType: text('voucher_type').notNull(),
    voucherId: uuid('voucher_id').notNull(),
    voucherLineId: uuid('voucher_line_id'),
    isReversal: boolean('is_reversal').notNull().default(false),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sle_item_idx').on(t.entityId, t.itemId, t.seq),
    index('sle_voucher_idx').on(t.voucherId),
    index('sle_batch_idx').on(t.batchId),
    index('sle_owner_idx').on(t.entityId, t.ownerPartyId, t.postingDate),
  ],
);

/** FIFO cost layers per entity × item (× batch for batch-tracked items). */
export const fifoLayer = pgTable(
  'fifo_layer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    entityId: uuid('entity_id').notNull(),
    itemId: uuid('item_id').notNull(),
    batchId: uuid('batch_id'),
    qtyIn: qty('qty_in').notNull(),
    qtyRemaining: qty('qty_remaining').notNull(),
    rate: qty('rate').notNull(),
    sourceSeq: bigint('source_seq', { mode: 'number' }).notNull(),
    postingDate: date('posting_date').notNull(),
    voucherId: uuid('voucher_id').notNull(),
  },
  (t) => [index('fifo_layer_open_idx').on(t.entityId, t.itemId, t.batchId, t.postingDate, t.sourceSeq)],
);

/** Which layers an outgoing ledger entry consumed, so a cancel can restore them exactly. */
export const fifoConsumption = pgTable(
  'fifo_consumption',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sleSeq: bigint('sle_seq', { mode: 'number' }).notNull(),
    layerId: uuid('layer_id')
      .notNull()
      .references(() => fifoLayer.id),
    qty: qty('qty').notNull(),
  },
  (t) => [index('fifo_consumption_sle_idx').on(t.sleSeq)],
);

/** Materialised balances, updated in the same transaction as the ledger. */
export const stockBin = pgTable(
  'stock_bin',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    entityId: uuid('entity_id').notNull(),
    itemId: uuid('item_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    batchId: uuid('batch_id'),
    ownerPartyId: uuid('owner_party_id'),
    qty: qty('qty').notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('stock_bin_owner_uq').on(t.entityId, t.itemId, t.warehouseId, t.batchId, t.ownerPartyId).nullsNotDistinct()],
);
