// Manufacturing slice 2c (decision 047): job work outward under Sec 143 and ITC-04.
// Conversion orders move our stock through an "At vendor" warehouse; operation orders send work-order pieces
// (WIP, not stock) for an outsourced routing step. Receipts and consumption rows are append-only.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { batch, docStatus, stockEntry, stockEntryLine, warehouse } from './inventory.js';
import { workOrder, workOrderOperation } from './manufacturing.js';
import { item, party, qty } from './masters.js';
import { gstRegistration, legalEntity, tenant } from './platform.js';

const scope = {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => legalEntity.id),
};
const created = {
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

export const jobWorkKind = pgEnum('job_work_kind', ['operation', 'conversion']);
export const jobWorkStatus = pgEnum('job_work_status', ['draft', 'open', 'closed', 'cancelled']);
/** Sec 143: inputs have one year, capital goods three. */
export const jobWorkGoodsType = pgEnum('job_work_goods_type', ['input', 'capital_good']);
export const itc04Frequency = pgEnum('itc04_frequency', ['half_yearly', 'annual']);

export const jobWorkOrder = pgTable(
  'job_work_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    number: text('number'),
    kind: jobWorkKind('kind').notNull(),
    status: jobWorkStatus('status').notNull().default('draft'),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => party.id),
    /** Operation orders: the work order and its outsourced operation. */
    workOrderId: uuid('work_order_id').references(() => workOrder.id),
    workOrderOperationId: uuid('work_order_operation_id').references(() => workOrderOperation.id),
    /** Conversion orders: what comes back. */
    targetItemId: uuid('target_item_id').references(() => item.id),
    targetQty: qty('target_qty'),
    /** Where returned conversion goods are received by default. */
    targetWarehouseId: uuid('target_warehouse_id').references(() => warehouse.id),
    natureOfWork: text('nature_of_work'),
    expectedReturnDate: date('expected_return_date'),
    remarks: text('remarks'),
    closeReason: text('close_reason'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('job_work_order_number_uq').on(t.entityId, t.number),
    index('job_work_order_supplier_idx').on(t.entityId, t.supplierId),
    index('job_work_order_wo_idx').on(t.workOrderId),
    check(
      'job_work_order_kind_ck',
      sql`(${t.kind} = 'operation' and ${t.workOrderId} is not null and ${t.workOrderOperationId} is not null) or (${t.kind} = 'conversion' and ${t.targetItemId} is not null and ${t.targetQty} > 0)`,
    ),
  ],
);

/** Conversion orders: planned materials to send. */
export const jobWorkOrderLine = pgTable(
  'job_work_order_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => jobWorkOrder.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    qty: qty('qty').notNull(),
  },
  (t) => [uniqueIndex('job_work_order_line_uq').on(t.orderId, t.lineNo), check('job_work_order_line_qty_ck', sql`${t.qty} > 0`)],
);

/** Delivery challan (rule 55) for goods sent to the job worker. Numbered per GSTIN × FY, ≤ 16 characters. */
export const jobWorkChallan = pgTable(
  'job_work_challan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    orderId: uuid('order_id')
      .notNull()
      .references(() => jobWorkOrder.id),
    number: text('number'),
    status: docStatus('status').notNull().default('draft'),
    postingDate: date('posting_date').notNull(),
    gstRegistrationId: uuid('gst_registration_id').references(() => gstRegistration.id),
    fromWarehouseId: uuid('from_warehouse_id').references(() => warehouse.id),
    /** Conversion challans move stock into the "At vendor" warehouse. */
    stockEntryId: uuid('stock_entry_id').references(() => stockEntry.id),
    interstate: boolean('interstate').notNull().default(false),
    placeOfSupplyStateCode: text('place_of_supply_state_code'),
    ewayBillNo: text('eway_bill_no'),
    vehicleNo: text('vehicle_no'),
    remarks: text('remarks'),
    cancelReason: text('cancel_reason'),
    ...created,
  },
  (t) => [
    uniqueIndex('job_work_challan_number_uq').on(t.entityId, t.gstRegistrationId, t.number),
    index('job_work_challan_order_idx').on(t.orderId),
    index('job_work_challan_date_idx').on(t.entityId, t.postingDate),
    check('job_work_challan_number_len_ck', sql`${t.number} is null or length(${t.number}) <= 16`),
  ],
);

export const jobWorkChallanLine = pgTable(
  'job_work_challan_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    challanId: uuid('challan_id')
      .notNull()
      .references(() => jobWorkChallan.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    batchId: uuid('batch_id').references(() => batch.id),
    qty: qty('qty').notNull(),
    /** Taxable value for the challan and ITC-04 (FIFO cost for stock, WIP share for work-order pieces). */
    value: qty('value').notNull(),
    goodsType: jobWorkGoodsType('goods_type').notNull(),
    hsnCode: text('hsn_code'),
    /** Sec 143(1): null when no limit applies (capital-goods tools). */
    dueBy: date('due_by'),
    /** Commissioner's extension (second proviso): order reference and new date. */
    extendedDueBy: date('extended_due_by'),
    extensionRef: text('extension_ref'),
    /** Sec 143(3)/(4): Accounts records the invoice raised for a deemed supply. */
    deemedSupplyInvoiceNo: text('deemed_supply_invoice_no'),
    deemedSupplyMarkedBy: text('deemed_supply_marked_by').references(() => user.id),
    deemedSupplyMarkedAt: timestamp('deemed_supply_marked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('job_work_challan_line_uq').on(t.challanId, t.lineNo),
    check('job_work_challan_line_qty_ck', sql`${t.qty} > 0 and ${t.value} >= 0`),
  ],
);

/** Goods received back from the job worker. */
export const jobWorkReceipt = pgTable(
  'job_work_receipt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    orderId: uuid('order_id')
      .notNull()
      .references(() => jobWorkOrder.id),
    number: text('number'),
    status: docStatus('status').notNull().default('submitted'),
    postingDate: date('posting_date').notNull(),
    /** The job worker's own challan or invoice for the return (ITC-04 table 5). */
    jobWorkerChallanNo: text('job_worker_challan_no'),
    jobWorkerChallanDate: date('job_worker_challan_date'),
    /** Conversion receipts post a job_work_in stock entry. */
    stockEntryId: uuid('stock_entry_id').references(() => stockEntry.id),
    remarks: text('remarks'),
    cancelReason: text('cancel_reason'),
    ...created,
  },
  (t) => [uniqueIndex('job_work_receipt_number_uq').on(t.entityId, t.number), index('job_work_receipt_order_idx').on(t.orderId), index('job_work_receipt_date_idx').on(t.entityId, t.postingDate)],
);

export const jobWorkReceiptLine = pgTable(
  'job_work_receipt_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => jobWorkReceipt.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    batchId: uuid('batch_id').references(() => batch.id),
    /** Good quantity back. */
    qty: qty('qty').notNull(),
    /** Operation orders: pieces rejected at the job worker. */
    rejectedQty: qty('rejected_qty').notNull().default('0'),
    value: qty('value').notNull().default('0'),
    warehouseId: uuid('warehouse_id').references(() => warehouse.id),
    stockEntryLineId: uuid('stock_entry_line_id').references(() => stockEntryLine.id),
  },
  (t) => [uniqueIndex('job_work_receipt_line_uq').on(t.receiptId, t.lineNo), check('job_work_receipt_line_qty_ck', sql`${t.qty} >= 0 and ${t.rejectedQty} >= 0 and ${t.qty} + ${t.rejectedQty} > 0`)],
);

/**
 * Which challan lines a receipt discharges (ITC-04 table 5 needs the original challan). Append-only;
 * cancelling a receipt writes negated rows with reversal_of.
 */
export const jobWorkConsumption = pgTable(
  'job_work_consumption',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => jobWorkReceipt.id),
    challanLineId: uuid('challan_line_id')
      .notNull()
      .references(() => jobWorkChallanLine.id),
    /** Quantity of the challan line discharged, in its own unit; loss and scrap are part of it. */
    qty: qty('qty').notNull(),
    lossQty: qty('loss_qty').notNull().default('0'),
    scrapQty: qty('scrap_qty').notNull().default('0'),
    reversalOf: uuid('reversal_of'),
    ...created,
  },
  (t) => [
    index('job_work_consumption_challan_idx').on(t.challanLineId),
    index('job_work_consumption_receipt_idx').on(t.receiptId),
    uniqueIndex('job_work_consumption_reversal_uq').on(t.reversalOf),
  ],
);

/** Rule 45(3) specified period per entity and FY: half-yearly when the previous FY's turnover exceeded ₹5 crore. */
export const itc04Setting = pgTable(
  'itc04_setting',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    /** "2026-27" */
    fy: text('fy').notNull(),
    frequency: itc04Frequency('frequency').notNull(),
    ...created,
  },
  (t) => [uniqueIndex('itc04_setting_uq').on(t.entityId, t.fy)],
);
