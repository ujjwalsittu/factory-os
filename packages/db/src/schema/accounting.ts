import { sql } from 'drizzle-orm';
import { boolean, check, date, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { docStatus } from './inventory.js';
import { party } from './masters.js';
import { legalEntity, tenant } from './platform.js';
const scope = { tenantId: uuid('tenant_id').notNull().references(() => tenant.id), entityId: uuid('entity_id').notNull().references(() => legalEntity.id) };
const amount = (name: string) => numeric(name, { precision: 24, scale: 6 });
export interface OpeningLine { accountId: string; debit: string; credit: string; partyId?: string; billReference?: string; }
export interface OpeningBill { partyId: string; reference: string; side: 'debit' | 'credit'; amount: string; invoiceId?: string; currency?: string; exchangeRate?: string; originalAmount?: string; }
export interface OpeningReceipt { receiptLineId: string; qty: string; baseCost: string; }
export interface OpeningSettlement { invoiceId: string; amount: string; reason: string; }
export const accountGroup = pgTable('account_group', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope, key: text('key').notNull(), name: text('name').notNull(), parentId: uuid('parent_id'), root: text('root').notNull(),
}, t => [uniqueIndex('account_group_entity_key_uq').on(t.entityId, t.key)]);
export const glAccount = pgTable('gl_account', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope, code: text('code').notNull(), name: text('name').notNull(), groupId: uuid('group_id').notNull().references(() => accountGroup.id), role: text('role'), isActive: boolean('is_active').notNull().default(true),
}, t => [uniqueIndex('account_entity_code_uq').on(t.entityId, t.code), uniqueIndex('account_entity_role_uq').on(t.entityId, t.role)]);
export const accountingSettings = pgTable('accounting_settings', {
  entityId: uuid('entity_id').primaryKey().references(() => legalEntity.id), tenantId: uuid('tenant_id').notNull().references(() => tenant.id), active: boolean('active').notNull().default(false), cutoverDate: date('cutover_date'), activatedAt: timestamp('activated_at', { withTimezone: true }), activatedBy: text('activated_by').references(() => user.id), openingVoucherId: uuid('opening_voucher_id'), mappings: jsonb('mappings').$type<Record<string, string>>().notNull().default({}), controlHistory: jsonb('control_history').$type<Record<string, string[]>>().notNull().default({}),
});
export const openingWorksheet = pgTable('opening_worksheet', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope, lines: jsonb('lines').$type<OpeningLine[]>().notNull().default([]), bills: jsonb('bills').$type<OpeningBill[]>().notNull().default([]), receiptBaselines: jsonb('receipt_baselines').$type<OpeningReceipt[]>().notNull().default([]), settlements: jsonb('settlements').$type<OpeningSettlement[]>().notNull().default([]), reviewedSnapshot: jsonb('reviewed_snapshot'), createdBy: text('created_by').notNull().references(() => user.id), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('opening_worksheet_entity_uq').on(t.entityId)]);
export const journalVoucher = pgTable('journal_voucher', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope, number: text('number'), status: docStatus('status').notNull().default('draft'), postingDate: date('posting_date').notNull(), narration: text('narration').notNull(), sourceType: text('source_type').notNull(), sourceId: uuid('source_id').notNull(), purpose: text('purpose').notNull().default('main'), sourceNumber: text('source_number'), clearingSourceId: uuid('clearing_source_id'), currency: text('currency').notNull().default('INR'), exchangeRate: amount('exchange_rate').notNull().default('1'), draftLines: jsonb('draft_lines').$type<OpeningLine[]>().notNull().default([]), reversalOf: uuid('reversal_of'), createdBy: text('created_by').notNull().references(() => user.id), submittedAt: timestamp('submitted_at', { withTimezone: true }), cancelledAt: timestamp('cancelled_at', { withTimezone: true }), cancelReason: text('cancel_reason'),
}, t => [uniqueIndex('journal_source_purpose_uq').on(t.entityId, t.sourceType, t.sourceId, t.purpose), uniqueIndex('journal_reversal_uq').on(t.reversalOf), uniqueIndex('journal_number_uq').on(t.entityId, t.number), index('journal_entity_date_idx').on(t.entityId, t.postingDate)]);
export const glEntry = pgTable('gl_entry', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope, voucherId: uuid('voucher_id').notNull().references(() => journalVoucher.id), accountId: uuid('account_id').notNull().references(() => glAccount.id), postingDate: date('posting_date').notNull(), debit: amount('debit').notNull(), credit: amount('credit').notNull(), partyId: uuid('party_id').references(() => party.id), billReference: text('bill_reference'), gstRegistrationId: uuid('gst_registration_id'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('gl_entity_account_date_idx').on(t.entityId, t.accountId, t.postingDate), check('gl_one_positive_side', sql`(${t.debit} > 0 and ${t.credit} = 0) or (${t.credit} > 0 and ${t.debit} = 0)`)]);
export const glDisposition = pgTable('gl_disposition', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope, sourceType: text('source_type').notNull(), sourceId: uuid('source_id').notNull(), purpose: text('purpose').notNull(), voucherId: uuid('voucher_id').references(() => journalVoucher.id), reason: text('reason').notNull(),
}, t => [uniqueIndex('gl_disposition_source_uq').on(t.entityId, t.sourceType, t.sourceId, t.purpose)]);
export const receiptInvoiceAllocation = pgTable('receipt_invoice_allocation', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope, invoiceId: uuid('invoice_id').notNull(), receiptLineId: uuid('receipt_line_id').notNull(), qty: amount('qty').notNull(), baseCost: amount('base_cost').notNull(), poRate: amount('po_rate').notNull(), poExchangeRate: amount('po_exchange_rate').notNull(), reversalOf: uuid('reversal_of'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('receipt_allocation_source_idx').on(t.entityId, t.receiptLineId), uniqueIndex('receipt_allocation_reversal_uq').on(t.reversalOf)]);
export const acquisitionCostChange = pgTable('acquisition_cost_change', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope, sourceType: text('source_type').notNull(), sourceId: uuid('source_id').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), layerId: uuid('layer_id').notNull(), oldRate: amount('old_rate').notNull(), newRate: amount('new_rate').notNull(), qtyRemaining: amount('qty_remaining').notNull(), onHand: amount('on_hand').notNull(), consumed: amount('consumed').notNull(), stockLedgerSeq: numeric('stock_ledger_seq', { precision: 30, scale: 0 }), reversedAt: timestamp('reversed_at', { withTimezone: true }),
});
