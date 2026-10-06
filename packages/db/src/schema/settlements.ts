// AR/AP settlements (decision 036): bill-wise subledger, customer receipts / supplier payments, later allocation.
// Bills and their effects are append-only evidence; balances are always derived, never stored on invoices.
import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { glAccount } from './accounting.js';
import { supplierNote } from './supplier-returns.js';
import { salesNote } from './sales-notes.js';
import { user } from './auth.js';
import { docStatus } from './inventory.js';
import { party } from './masters.js';
import { legalEntity, tenant } from './platform.js';

const scope = {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenant.id),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => legalEntity.id),
};
const amount = (name: string) => numeric(name, { precision: 24, scale: 6 });
const lifecycle = {
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

export interface SettlementAllocationDraft {
  billId: string;
  amount: string;
}

/**
 * One receivable or payable item: an invoice, an opening bill, a journal-origin item, or money held on account.
 * `kind`: bill (owed to / by us) · advance (unapplied receipt/payment) · journal_credit (credit from a journal).
 * Identity is the source, never the display reference.
 */
export const tradeBill = pgTable(
  'trade_bill',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    side: text('side').notNull(),
    kind: text('kind').notNull().default('bill'),
    partyId: uuid('party_id')
      .notNull()
      .references(() => party.id),
    /** The trade control the balance sits on; settlement clears this account even after remapping. */
    accountId: uuid('account_id')
      .notNull()
      .references(() => glAccount.id),
    reference: text('reference').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    originKey: text('origin_key').notNull(),
    currency: text('currency').notNull().default('INR'),
    originalAmount: amount('original_amount').notNull(),
    recognitionDate: date('recognition_date').notNull(),
    dueDate: date('due_date'),
    msmeCategory: text('msme_category'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('trade_bill_origin_uq').on(t.entityId, t.originKey),
    index('trade_bill_party_idx').on(t.entityId, t.side, t.partyId),
    check('trade_bill_side', sql`${t.side} in ('receivable', 'payable')`),
    check('trade_bill_kind', sql`${t.kind} in ('bill', 'advance', 'journal_credit')`),
  ],
);

/**
 * Signed change to a bill's balance in side terms (+ increases what is owed, − settles it), in document currency
 * and INR carrying value. Append-only; a reversal is a new row pointing at what it reverses.
 */
export const tradeBillEffect = pgTable(
  'trade_bill_effect',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    billId: uuid('bill_id')
      .notNull()
      .references(() => tradeBill.id),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    originKey: text('origin_key').notNull(),
    glEntryId: uuid('gl_entry_id'),
    postingDate: date('posting_date').notNull(),
    amount: amount('amount').notNull(),
    carryingInr: amount('carrying_inr').notNull(),
    reversalOf: uuid('reversal_of'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('trade_bill_effect_origin_uq').on(t.entityId, t.originKey),
    uniqueIndex('trade_bill_effect_reversal_uq').on(t.reversalOf),
    index('trade_bill_effect_bill_idx').on(t.billId, t.postingDate),
    index('trade_bill_effect_source_idx').on(t.entityId, t.sourceType, t.sourceId),
  ],
);

/** Customer receipt or supplier payment: one party, one currency, one cash/bank account. */
export const partySettlement = pgTable(
  'party_settlement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    number: text('number'),
    status: docStatus('status').notNull().default('draft'),
    direction: text('direction').notNull(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => party.id),
    postingDate: date('posting_date').notNull(),
    currency: text('currency').notNull().default('INR'),
    exchangeRate: amount('exchange_rate').notNull().default('1'),
    /** Cash or bank account the money moved through. */
    accountId: uuid('account_id')
      .notNull()
      .references(() => glAccount.id),
    amount: amount('amount').notNull(),
    newTax: amount('new_tax').notNull().default('0'),
    bankCharge: amount('bank_charge').notNull().default('0'),
    componentSnapshot: jsonb('component_snapshot').$type<Record<string,unknown>>(),
    bankReference: text('bank_reference'),
    narration: text('narration'),
    allocations: jsonb('allocations').$type<SettlementAllocationDraft[]>().notNull().default([]),
    /** Bill holding the unapplied amount, created on submit when money is left over. */
    advanceBillId: uuid('advance_bill_id'),
    voucherId: uuid('voucher_id'),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex('party_settlement_number_uq').on(t.entityId, t.number),
    index('party_settlement_party_idx').on(t.entityId, t.partyId),
    check('party_settlement_direction', sql`${t.direction} in ('receipt', 'payment')`),
    check('party_settlement_amount', sql`${t.amount} > 0`),
    check('party_settlement_components_ck', sql`${t.newTax}>=0 and ${t.bankCharge}>=0 and (${t.currency}='INR' or (${t.newTax}=0 and ${t.bankCharge}=0))`),
  ],
);

/** Later application of money held on account against open bills; the cash is not moved again. */
export const settlementAllocationDocument = pgTable(
  'settlement_allocation_document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    number: text('number'),
    status: docStatus('status').notNull().default('draft'),
    settlementId: uuid('settlement_id').references(() => partySettlement.id),
    supplierNoteId: uuid('supplier_note_id').references(() => supplierNote.id),
    creditNoteId: uuid('credit_note_id').references(() => salesNote.id),
    postingDate: date('posting_date').notNull(),
    reason: text('reason').notNull(),
    allocations: jsonb('allocations').$type<SettlementAllocationDraft[]>().notNull().default([]),
    voucherId: uuid('voucher_id'),
    ...lifecycle,
  },
  (t) => [uniqueIndex('settlement_allocation_number_uq').on(t.entityId, t.number), index('settlement_allocation_source_idx').on(t.settlementId), check('settlement_allocation_source', sql`num_nonnulls(${t.settlementId},${t.creditNoteId},${t.supplierNoteId})=1`)],
);

/** Marks when an entity's subledger was first built from its posted GL (upgrade initialisation). */
export const tradeSubledgerState = pgTable('trade_subledger_state', {
  entityId: uuid('entity_id')
    .primaryKey()
    .references(() => legalEntity.id),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenant.id),
  version: integer('version').notNull().default(1),
  initializedAt: timestamp('initialized_at', { withTimezone: true }).notNull().defaultNow(),
});
