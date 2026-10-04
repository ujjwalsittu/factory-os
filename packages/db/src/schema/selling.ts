// Selling: quotations, sales orders, sales invoices (slice 1c). The invoice ships the goods (decision 030).
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { batch, docStatus, stockEntry, warehouse } from './inventory.js';
import { item, party, qty } from './masters.js';
import { type Address, gstRegistration, legalEntity, tenant } from './platform.js';

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
/** Header fields every outward document shares: customer, our GSTIN, tax context, currency, totals. */
const outward = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => legalEntity.id),
  number: text('number'),
  status: docStatus('status').notNull().default('draft'),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => party.id),
  gstRegistrationId: uuid('gst_registration_id').references(() => gstRegistration.id),
  /** regular | sez_with_payment | sez_without_payment | export_with_payment | export_under_lut */
  supplyType: text('supply_type').notNull().default('regular'),
  placeOfSupplyStateCode: text('place_of_supply_state_code'),
  currency: text('currency').notNull().default('INR'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1'),
  remarks: text('remarks'),
  taxableValue: money('taxable_value'),
  igst: money('igst'),
  cgst: money('cgst'),
  sgst: money('sgst'),
  cess: money('cess'),
  totalTax: money('total_tax'),
  grandTotal: money('grand_total'),
});
const outwardLine = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  lineNo: integer('line_no').notNull(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => item.id),
  description: text('description'),
  hsnCode: text('hsn_code'),
  qty: qty('qty').notNull(),
  rate: qty('rate').notNull(),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).notNull(),
  taxableValue: money('taxable_value'),
  igst: money('igst'),
  cgst: money('cgst'),
  sgst: money('sgst'),
  cess: money('cess'),
});

export const quotation = pgTable(
  'quotation',
  {
    ...outward(),
    quotationDate: date('quotation_date').notNull(),
    validTill: date('valid_till'),
    /** Customer's RFQ / enquiry reference. */
    customerRef: text('customer_ref'),
    ...audit,
  },
  (t) => [uniqueIndex('quotation_entity_number_uq').on(t.entityId, t.number), index('quotation_customer_idx').on(t.entityId, t.customerId)],
);

export const quotationLine = pgTable(
  'quotation_line',
  {
    ...outwardLine(),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotation.id, { onDelete: 'cascade' }),
  },
  (t) => [index('quotation_line_q_idx').on(t.quotationId)],
);

export const salesOrder = pgTable(
  'sales_order',
  {
    ...outward(),
    orderDate: date('order_date').notNull(),
    deliveryDate: date('delivery_date'),
    quotationId: uuid('quotation_id').references(() => quotation.id),
    customerPoNo: text('customer_po_no'),
    customerPoDate: date('customer_po_date'),
    paymentTermsDays: integer('payment_terms_days'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Submitted over a credit warning by an approver (decision 032). */
    creditOverride: boolean('credit_override').notNull().default(false),
    ...audit,
  },
  (t) => [uniqueIndex('sales_order_entity_number_uq').on(t.entityId, t.number), index('sales_order_customer_idx').on(t.entityId, t.customerId)],
);

export const salesOrderLine = pgTable(
  'sales_order_line',
  {
    ...outwardLine(),
    soId: uuid('so_id')
      .notNull()
      .references(() => salesOrder.id, { onDelete: 'cascade' }),
    /** Maintained by sales invoices (submitted, net of cancellations). */
    invoicedQty: qty('invoiced_qty').notNull().default('0'),
  },
  (t) => [index('sales_order_line_so_idx').on(t.soId)],
);

export const salesInvoice = pgTable(
  'sales_invoice',
  {
    ...outward(),
    invoiceDate: date('invoice_date').notNull(),
    dueDate: date('due_date'),
    salesOrderId: uuid('sales_order_id').references(() => salesOrder.id),
    customerPoNo: text('customer_po_no'),
    reverseCharge: boolean('reverse_charge').notNull().default(false),
    /** Snapshots: the invoice must print what was true when it was issued. */
    customerName: text('customer_name'),
    customerGstin: text('customer_gstin'),
    billingAddress: jsonb('billing_address').$type<Address & { label?: string; country?: string }>(),
    shippingAddress: jsonb('shipping_address').$type<Address & { label?: string; country?: string }>(),
    /** Exports under LUT (decision 031). */
    lutArn: text('lut_arn'),
    shippingBillNo: text('shipping_bill_no'),
    shippingBillDate: date('shipping_bill_date'),
    portCode: text('port_code'),
    /** The delivery entry that shipped the goods (decision 030). */
    stockEntryId: uuid('stock_entry_id').references(() => stockEntry.id),
    creditOverride: boolean('credit_override').notNull().default(false),
    ...audit,
  },
  (t) => [
    // GST: unique per GSTIN per FY; the FY is part of the number.
    uniqueIndex('sales_invoice_gstin_number_uq').on(t.gstRegistrationId, t.number),
    index('sales_invoice_customer_idx').on(t.entityId, t.customerId),
  ],
);

export const salesInvoiceLine = pgTable(
  'sales_invoice_line',
  {
    ...outwardLine(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => salesInvoice.id, { onDelete: 'cascade' }),
    soLineId: uuid('so_line_id').references(() => salesOrderLine.id),
    /** Stock items: where the goods ship from, and which batch / heat. */
    warehouseId: uuid('warehouse_id').references(() => warehouse.id),
    batchId: uuid('batch_id').references(() => batch.id),
  },
  (t) => [index('sales_invoice_line_inv_idx').on(t.invoiceId)],
);
