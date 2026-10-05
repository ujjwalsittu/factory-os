import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { docStatus, fifoLayer, stockEntry, stockLedgerEntry, warehouse } from './inventory.js';
import { legalEntity, tenant, gstRegistration, type Address } from './platform.js';
import { salesInvoice, salesInvoiceLine } from './selling.js';
import { party } from './masters.js';
const amount = (name: string) => numeric(name, { precision: 24, scale: 6 });
const scope = { tenantId: uuid('tenant_id').notNull().references(()=>tenant.id), entityId: uuid('entity_id').notNull().references(()=>legalEntity.id) };
const lifecycle = {
 createdBy: text('created_by').notNull().references(()=>user.id), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(), updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
 submittedBy: text('submitted_by').references(()=>user.id), submittedAt: timestamp('submitted_at',{withTimezone:true}), cancelledBy:text('cancelled_by').references(()=>user.id), cancelledAt:timestamp('cancelled_at',{withTimezone:true}), cancelReason:text('cancel_reason'),
};
export const salesNote = pgTable('sales_note', {
 id:uuid('id').primaryKey().defaultRandom(), ...scope, originalInvoiceId:uuid('original_invoice_id').notNull(), kind:text('kind').notNull(), taxTreatment:text('tax_treatment').notNull(),
 number:text('number'), status:docStatus('status').notNull().default('draft'), customerId:uuid('customer_id').notNull().references(()=>party.id), gstRegistrationId:uuid('gst_registration_id').notNull().references(()=>gstRegistration.id),
 postingDate:date('posting_date').notNull(), dueDate:date('due_date'), reason:text('reason').notNull(), currency:text('currency').notNull(), exchangeRate:amount('exchange_rate').notNull(),
 sellerName:text('seller_name'), sellerGstin:text('seller_gstin'), sellerAddress:jsonb('seller_address').$type<Address>(), supplyType:text('supply_type').notNull(), placeOfSupplyStateCode:text('place_of_supply_state_code'), customerName:text('customer_name'), customerGstin:text('customer_gstin'), billingAddress:jsonb('billing_address').$type<Address>(), shippingAddress:jsonb('shipping_address').$type<Address>(), lutArn:text('lut_arn'),
 taxEligibilityConfirmed:boolean('tax_eligibility_confirmed').notNull().default(false), taxEligibilityActor:text('tax_eligibility_actor').references(()=>user.id),
 taxableValue:amount('taxable_value').notNull().default('0'), cgst:amount('cgst').notNull().default('0'), sgst:amount('sgst').notNull().default('0'), igst:amount('igst').notNull().default('0'), cess:amount('cess').notNull().default('0'), grandTotal:amount('grand_total').notNull().default('0'),
 billId:uuid('bill_id'), voucherId:uuid('voucher_id'), stockEntryId:uuid('stock_entry_id').references(()=>stockEntry.id), ...lifecycle,
}, t=>[
 uniqueIndex('sales_note_gstin_number_uq').on(t.gstRegistrationId,t.number), uniqueIndex('sales_note_identity_scope_uq').on(t.id,t.tenantId,t.entityId,t.originalInvoiceId), index('sales_note_invoice_idx').on(t.entityId,t.originalInvoiceId),
 foreignKey({columns:[t.originalInvoiceId,t.tenantId,t.entityId],foreignColumns:[salesInvoice.id,salesInvoice.tenantId,salesInvoice.entityId]}),
 check('sales_note_kind',sql`${t.kind} in ('credit','debit')`), check('sales_note_tax_treatment',sql`${t.taxTreatment} in ('gst','commercial')`), check('sales_note_rate',sql`${t.exchangeRate}>0`),
]);
export const salesNoteLine = pgTable('sales_note_line', {
 id:uuid('id').primaryKey().defaultRandom(), ...scope, noteId:uuid('note_id').notNull(), originalInvoiceId:uuid('original_invoice_id').notNull(), invoiceLineId:uuid('invoice_line_id').notNull(), lineNo:integer('line_no').notNull(),
 mode:text('mode').notNull(), qty:amount('qty').notNull().default('0'), taxableAmount:amount('taxable_amount').notNull(), returnQty:amount('return_qty').notNull().default('0'), warehouseId:uuid('warehouse_id').references(()=>warehouse.id),
 taxableValue:amount('taxable_value').notNull(), cgst:amount('cgst').notNull(), sgst:amount('sgst').notNull(), igst:amount('igst').notNull(), cess:amount('cess').notNull(), returnValueInr:amount('return_value_inr').notNull().default('0'),
},t=>[
 uniqueIndex('sales_note_line_source_uq').on(t.noteId,t.invoiceLineId), index('sales_note_line_note_idx').on(t.noteId),
 foreignKey({columns:[t.noteId,t.tenantId,t.entityId,t.originalInvoiceId],foreignColumns:[salesNote.id,salesNote.tenantId,salesNote.entityId,salesNote.originalInvoiceId]}).onDelete('cascade'),
 foreignKey({columns:[t.invoiceLineId,t.originalInvoiceId],foreignColumns:[salesInvoiceLine.id,salesInvoiceLine.invoiceId]}),
 check('sales_note_line_mode',sql`${t.mode} in ('quantity','value')`), check('sales_note_line_positive',sql`${t.taxableAmount}>0 and ${t.qty}>=0 and ${t.returnQty}>=0`),
]);
export const salesReturnEffect = pgTable('sales_return_effect', {
 id:uuid('id').primaryKey().defaultRandom(), ...scope, noteId:uuid('note_id').notNull().references(()=>salesNote.id), noteLineId:uuid('note_line_id').notNull().references(()=>salesNoteLine.id), originalLedgerSeq:bigint('original_ledger_seq',{mode:'number'}).notNull().references(()=>stockLedgerEntry.seq),
 originalQty:amount('original_qty').notNull(), originalValue:amount('original_value').notNull(), qty:amount('qty').notNull(), value:amount('value').notNull(), inboundLedgerSeq:bigint('inbound_ledger_seq',{mode:'number'}).notNull().references(()=>stockLedgerEntry.seq), layerId:uuid('layer_id').notNull().references(()=>fifoLayer.id), reversalOf:uuid('reversal_of'), createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('sales_return_effect_reversal_uq').on(t.reversalOf), index('sales_return_effect_source_idx').on(t.entityId,t.originalLedgerSeq),index('sales_return_effect_note_idx').on(t.noteId)]);
