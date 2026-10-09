// Buying: purchase orders, incoming inspection, purchase invoices (slice 1b).
// Goods receipts are stock entries (purpose 'receipt') linked to a PO, so they post through the one stock engine.
import { bigint, boolean, date, index, integer, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { batch, docStatus, stockEntry, stockEntryLine, warehouse } from './inventory.js';
import { item, party, qty } from './masters.js';
import { gstRegistration, legalEntity, tenant } from './platform.js';

const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const audit = {
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  submittedBy: text('submitted_by').references(() => user.id),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  cancelledBy: text('cancelled_by').references(() => user.id),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
};

export const purchaseOrder = pgTable(
  'purchase_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntity.id),
    number: text('number'),
    status: docStatus('status').notNull().default('draft'),
    /** Closed manually when the rest won't be delivered. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => party.id),
    /** Our GSTIN that is billed and receives the goods (decides intra/inter-state). */
    gstRegistrationId: uuid('gst_registration_id').references(() => gstRegistration.id),
    orderDate: date('order_date').notNull(),
    expectedDate: date('expected_date'),
    supplierQuoteRef: text('supplier_quote_ref'),
    paymentTermsDays: integer('payment_terms_days'),
    remarks: text('remarks'),
    /** ISO 4217. Amounts on the order are in this currency (decision 026). */
    currency: text('currency').notNull().default('INR'),
    /** INR per unit of `currency`; receipts are valued at this rate. */
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1'),
    taxableValue: money('taxable_value'),
    totalTax: money('total_tax'),
    grandTotal: money('grand_total'),
    ...audit,
  },
  (t) => [uniqueIndex('purchase_order_entity_number_uq').on(t.entityId, t.number), index('purchase_order_supplier_idx').on(t.entityId, t.supplierId)],
);

export const purchaseOrderLine = pgTable(
  'purchase_order_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    poId: uuid('po_id')
      .notNull()
      .references(() => purchaseOrder.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    description: text('description'),
    qty: qty('qty').notNull(),
    rate: qty('rate').notNull(),
    gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).notNull(),
    taxableValue: money('taxable_value'),
    /** Maintained by goods receipts and purchase invoices (submitted, net of cancellations). */
    receivedQty: qty('received_qty').notNull().default('0'),
    billedQty: qty('billed_qty').notNull().default('0'),
  },
  (t) => [index('purchase_order_line_po_idx').on(t.poId)],
);

export const inspectionResult = pgEnum('inspection_result', ['accepted', 'rejected', 'partial']);

/**
 * Incoming inspection of a received line in quarantine (docs/03 §5). Submitting it moves accepted quantity
 * to stores and rejected quantity to MRB through a system-generated transfer.
 */
export const qualityInspection = pgTable(
  'quality_inspection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntity.id),
    number: text('number'),
    status: docStatus('status').notNull().default('draft'),
    receiptLineId: uuid('receipt_line_id')
      .notNull()
      .references(() => stockEntryLine.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    batchId: uuid('batch_id').references(() => batch.id),
    ownerPartyId: uuid('owner_party_id').references(() => party.id),
    fromWarehouseId: uuid('from_warehouse_id')
      .notNull()
      .references(() => warehouse.id),
    acceptWarehouseId: uuid('accept_warehouse_id').references(() => warehouse.id),
    rejectWarehouseId: uuid('reject_warehouse_id').references(() => warehouse.id),
    qtyInspected: qty('qty_inspected').notNull(),
    qtyAccepted: qty('qty_accepted').notNull().default('0'),
    qtyRejected: qty('qty_rejected').notNull().default('0'),
    result: inspectionResult('result'),
    /** Characteristics checked, MTC verified, etc. */
    checks: text('checks'),
    remarks: text('remarks'),
    /** The transfer that moved the stock on submit. */
    transferEntryId: uuid('transfer_entry_id').references(() => stockEntry.id),
    /** Characteristic results against an inspection plan (decision 048). */
    inspectionRecordId: uuid('inspection_record_id'),
    inspectionDate: date('inspection_date').notNull(),
    ...audit,
  },
  (t) => [uniqueIndex('quality_inspection_entity_number_uq').on(t.entityId, t.number), index('quality_inspection_receipt_line_idx').on(t.receiptLineId)],
);

export const purchaseInvoice = pgTable(
  'purchase_invoice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntity.id),
    /** Our internal voucher number. */
    number: text('number'),
    status: docStatus('status').notNull().default('draft'),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => party.id),
    gstRegistrationId: uuid('gst_registration_id').references(() => gstRegistration.id),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrder.id),
    supplierInvoiceNo: text('supplier_invoice_no').notNull(),
    supplierInvoiceDate: date('supplier_invoice_date').notNull(),
    postingDate: date('posting_date').notNull(),
    placeOfSupplyStateCode: text('place_of_supply_state_code'),
    supplyType: text('supply_type').notNull().default('regular'),
    reverseCharge: boolean('reverse_charge').notNull().default(false),
    /** Input tax credit eligibility (blocked credits u/s 17(5) are marked ineligible). */
    itcEligible: boolean('itc_eligible').notNull().default(true),
    /** Payment due date; for micro/small suppliers capped at 45 days (Sec 43B(h)). */
    dueDate: date('due_date'),
    msmeCategory: text('msme_category'),
    currency: text('currency').notNull().default('INR'),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1'),
    taxableValue: money('taxable_value'),
    igst: money('igst'),
    cgst: money('cgst'),
    sgst: money('sgst'),
    cess: money('cess'),
    totalTax: money('total_tax'),
    grandTotal: money('grand_total'),
    remarks: text('remarks'),
    ...audit,
  },
  (t) => [uniqueIndex('purchase_invoice_scope_uq').on(t.id,t.tenantId,t.entityId),
    uniqueIndex('purchase_invoice_entity_number_uq').on(t.entityId, t.number),
    index('purchase_invoice_supplier_idx').on(t.entityId, t.supplierId, t.supplierInvoiceNo),
  ],
);

export const purchaseInvoiceLine = pgTable(
  'purchase_invoice_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => purchaseInvoice.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    poLineId: uuid('po_line_id').references(() => purchaseOrderLine.id),
    /** Processing charge for goods received back from job work (decision 047). */
    jobWorkReceiptId: uuid('job_work_receipt_id'),
    hsnCode: text('hsn_code'),
    qty: qty('qty').notNull(),
    rate: qty('rate').notNull(),
    gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).notNull(),
    taxableValue: money('taxable_value'),
    igst: money('igst'),
    cgst: money('cgst'),
    sgst: money('sgst'),
    cess: money('cess'),
  },
  (t) => [uniqueIndex('purchase_invoice_line_identity_uq').on(t.id,t.invoiceId),index('purchase_invoice_line_invoice_idx').on(t.invoiceId)],
);

export const landedChargeType = pgEnum('landed_charge_type', ['bcd', 'sws', 'other_duty', 'freight', 'insurance', 'clearing', 'port', 'other']);
export const allocationBasis = pgEnum('allocation_basis', ['value', 'qty', 'weight']);

/**
 * Landed cost voucher (decisions 027, 028): Bill of Entry details plus charges spread over one or more receipts.
 * Submitting raises the FIFO cost of stock still on hand; the share of material already issued is a variance.
 */
export const landedCostVoucher = pgTable(
  'landed_cost_voucher',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntity.id),
    number: text('number'),
    status: docStatus('status').notNull().default('draft'),
    postingDate: date('posting_date').notNull(),
    boeNo: text('boe_no'),
    boeDate: date('boe_date'),
    portCode: text('port_code'),
    /** Customs (CBIC notified) exchange rate used to assess duty. */
    customsExchangeRate: numeric('customs_exchange_rate', { precision: 18, scale: 6 }),
    assessableValue: money('assessable_value'),
    /** Paid at customs and claimed as input tax credit; never part of cost. */
    importIgst: money('import_igst'),
    importCess: money('import_cess'),
    customsItcEligible: boolean('customs_itc_eligible'),
    remarks: text('remarks'),
    totalCharges: money('total_charges'),
    /** On submit: what went into stock still on hand, and what fell on material already issued. */
    onHandValue: money('on_hand_value'),
    varianceValue: money('variance_value'),
    ...audit,
  },
  (t) => [uniqueIndex('landed_cost_voucher_entity_number_uq').on(t.entityId, t.number)],
);

export const landedCostReceipt = pgTable(
  'landed_cost_receipt',
  {
    voucherId: uuid('voucher_id')
      .notNull()
      .references(() => landedCostVoucher.id, { onDelete: 'cascade' }),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => stockEntry.id),
  },
  (t) => [uniqueIndex('landed_cost_receipt_uq').on(t.voucherId, t.receiptId), index('landed_cost_receipt_receipt_idx').on(t.receiptId)],
);

export const landedCostCharge = pgTable(
  'landed_cost_charge',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    voucherId: uuid('voucher_id')
      .notNull()
      .references(() => landedCostVoucher.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    chargeType: landedChargeType('charge_type').notNull(),
    description: text('description'),
    /** Who billed it: customs, freight forwarder, CHA. */
    partyId: uuid('party_id').references(() => party.id),
    documentNo: text('document_no'),
    amount: money('amount').notNull(),
    basis: allocationBasis('basis').notNull().default('value'),
  },
  (t) => [index('landed_cost_charge_voucher_idx').on(t.voucherId)],
);

/** One row per charge × receipt line, written on submit. Append-only; cancel marks the voucher. */
export const landedCostAllocation = pgTable(
  'landed_cost_allocation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    voucherId: uuid('voucher_id')
      .notNull()
      .references(() => landedCostVoucher.id, { onDelete: 'cascade' }),
    chargeId: uuid('charge_id')
      .notNull()
      .references(() => landedCostCharge.id, { onDelete: 'cascade' }),
    receiptLineId: uuid('receipt_line_id')
      .notNull()
      .references(() => stockEntryLine.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    batchId: uuid('batch_id').references(() => batch.id),
    amount: money('amount').notNull(),
  },
  (t) => [index('landed_cost_allocation_voucher_idx').on(t.voucherId)],
);

/** Per receipt line on submit: how the FIFO layer was revalued, so a cancel can restore it exactly. */
export const landedCostLayerChange = pgTable(
  'landed_cost_layer_change',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    voucherId: uuid('voucher_id')
      .notNull()
      .references(() => landedCostVoucher.id, { onDelete: 'cascade' }),
    receiptLineId: uuid('receipt_line_id')
      .notNull()
      .references(() => stockEntryLine.id),
    layerId: uuid('layer_id').notNull(),
    qtyRemaining: qty('qty_remaining').notNull(),
    oldRate: qty('old_rate').notNull(),
    newRate: qty('new_rate').notNull(),
    amount: money('amount').notNull(),
    onHandValue: qty('on_hand_value').notNull(),
    varianceValue: qty('variance_value').notNull(),
    /** Ledger row that carried the on-hand value (null when nothing was on hand). */
    ledgerSeq: bigint('ledger_seq', { mode: 'number' }),
  },
  (t) => [index('landed_cost_layer_change_layer_idx').on(t.layerId), index('landed_cost_layer_change_voucher_idx').on(t.voucherId)],
);
