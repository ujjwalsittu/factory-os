import { check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth.js';
import { glAccount } from './accounting.js';
import { docStatus } from './inventory.js';
import { party } from './masters.js';
import { legalEntity, tenant } from './platform.js';
const scope = () => ({ tenantId: uuid('tenant_id').notNull().references(() => tenant.id), entityId: uuid('entity_id').notNull().references(() => legalEntity.id) });
const amount = (name: string) => numeric(name, { precision: 24, scale: 6 });
export interface SettlementBillAllocation { billId: string; amount: string }
export interface SettlementDraft {
  direction: 'receipt' | 'payment'; partyId: string; postingDate: string; currency: string;
  exchangeRate: string; accountId: string; amount: string; bankReference: string;
  narration: string; allocations: SettlementBillAllocation[];
}
export interface AllocationDraft { settlementId: string; postingDate: string; reason: string; allocations: SettlementBillAllocation[] }
const lifecycle = () => ({
  number: text('number'), status: docStatus('status').notNull().default('draft'),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }), cancelReason: text('cancel_reason'),
});
export const tradeBill = pgTable('trade_bill', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), partyId: uuid('party_id').notNull().references(() => party.id),
  side: text('side').notNull(), accountId: uuid('account_id').notNull().references(() => glAccount.id),
  reference: text('reference').notNull(), sourceType: text('source_type').notNull(), sourceId: uuid('source_id').notNull(), originKey: text('origin_key').notNull(),
  currency: text('currency').notNull(), recognitionDate: date('recognition_date').notNull(), dueDate: date('due_date'), msmeCategory: text('msme_category'),
}, t => [uniqueIndex('trade_bill_origin_uq').on(t.entityId, t.sourceType, t.sourceId, t.originKey), index('trade_bill_party_idx').on(t.entityId, t.partyId, t.side), check('trade_bill_side_ck', sql`${t.side} in ('receivable','payable')`)]);
export const tradeBillEffect = pgTable('trade_bill_effect', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), billId: uuid('bill_id').notNull().references(() => tradeBill.id),
  sourceType: text('source_type').notNull(), sourceId: uuid('source_id').notNull(), originKey: text('origin_key').notNull(),
  postingDate: date('posting_date').notNull(), amount: amount('amount').notNull(), carryingInr: amount('carrying_inr').notNull(),
  reversalOf: uuid('reversal_of'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('trade_effect_origin_uq').on(t.entityId, t.sourceType, t.sourceId, t.originKey), uniqueIndex('trade_effect_reversal_uq').on(t.reversalOf), index('trade_effect_bill_idx').on(t.entityId, t.billId, t.postingDate)]);
export const partySettlement = pgTable('party_settlement', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), ...lifecycle(), draft: jsonb('draft').$type<SettlementDraft>().notNull(),
  onAccountBillId: uuid('on_account_bill_id').references(() => tradeBill.id), voucherId: uuid('voucher_id'),
}, t => [uniqueIndex('party_settlement_number_uq').on(t.entityId, t.number)]);
export const settlementAllocationDocument = pgTable('settlement_allocation_document', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), ...lifecycle(), settlementId: uuid('settlement_id').notNull().references(() => partySettlement.id),
  draft: jsonb('draft').$type<AllocationDraft>().notNull(), voucherId: uuid('voucher_id'),
}, t => [uniqueIndex('settlement_allocation_number_uq').on(t.entityId, t.number)]);
export const settlementAllocationEffect = pgTable('settlement_allocation_effect', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), settlementId: uuid('settlement_id').notNull().references(() => partySettlement.id),
  allocationDocumentId: uuid('allocation_document_id').references(() => settlementAllocationDocument.id),
  billId: uuid('bill_id').notNull().references(() => tradeBill.id), amount: amount('amount').notNull(), carryingInr: amount('carrying_inr').notNull(),
  sourceCarryingInr: amount('source_carrying_inr').notNull(), postingDate: date('posting_date').notNull(), reversalOf: uuid('reversal_of'),
}, t => [uniqueIndex('settlement_effect_reversal_uq').on(t.reversalOf), index('settlement_effect_bill_idx').on(t.entityId, t.billId), check('settlement_effect_nonzero_ck', sql`${t.amount} <> 0`)]);
export const tradeSubledgerState = pgTable('trade_subledger_state', {
  entityId: uuid('entity_id').primaryKey().references(() => legalEntity.id), tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  version: integer('version').notNull(), initializedAt: timestamp('initialized_at', { withTimezone: true }).notNull().defaultNow(),
});
