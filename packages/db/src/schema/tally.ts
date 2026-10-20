import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { legalEntity, tenant } from './platform.js';

/** Decision 072: Tally XML imports, staged objects, and the Tally GUID links that keep re-imports duplicate-free. */
const identity = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  entityId: uuid('entity_id').notNull().references(() => legalEntity.id),
});

export type TallyImportFile = { name: string; sha256: string; bytes: number };

export const tallyImport = pgTable(
  'tally_import',
  {
    ...identity(),
    status: text('status').notNull().default('read'),
    files: jsonb('files').$type<TallyImportFile[]>().notNull(),
    company: text('company'),
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
    createdBy: text('created_by').notNull().references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    committedBy: text('committed_by').references(() => user.id),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tally_import_scope_uq').on(t.id, t.tenantId, t.entityId),
    foreignKey({ name: 'tally_import_entity_fk', columns: [t.entityId, t.tenantId], foreignColumns: [legalEntity.id, legalEntity.tenantId] }),
    check('tally_import_status_ck', sql`${t.status} in ('read','committed','discarded')`),
    check('tally_import_commit_ck', sql`(${t.status} = 'committed') = (${t.committedAt} is not null and ${t.committedBy} is not null)`),
  ],
);

/** One Tally object in one import, with the proposed and the chosen action. Kept after commit as the audit trail. */
export const tallyStaged = pgTable(
  'tally_staged',
  {
    ...identity(),
    importId: uuid('import_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    kind: text('kind').notNull(),
    guid: text('guid'),
    alterId: integer('alter_id'),
    name: text('name').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    proposed: text('proposed').notNull(),
    action: text('action').notNull(),
    targetId: uuid('target_id'),
    candidates: jsonb('candidates').$type<{ id: string; label: string; reason: string }[]>().notNull().default([]),
    notes: jsonb('notes').$type<string[]>().notNull().default([]),
    resultId: uuid('result_id'),
  },
  (t) => [
    uniqueIndex('tally_staged_ordinal_uq').on(t.importId, t.ordinal),
    index('tally_staged_import_kind_idx').on(t.importId, t.kind),
    foreignKey({ name: 'tally_staged_import_fk', columns: [t.importId, t.tenantId, t.entityId], foreignColumns: [tallyImport.id, tallyImport.tenantId, tallyImport.entityId] }).onDelete('cascade'),
    check('tally_staged_kind_ck', sql`${t.kind} in ('group','ledger','party','stockgroup','unit','godown','stockitem','opening','stock','voucher')`),
    check('tally_staged_action_ck', sql`${t.proposed} in ('new','link','update','unchanged','conflict','skip') and ${t.action} in ('new','link','update','unchanged','conflict','skip')`),
  ],
);

/** Tally GUID → FactoryOS record, per entity. The import's identity for every later re-sync. */
export const tallyLink = pgTable(
  'tally_link',
  {
    ...identity(),
    kind: text('kind').notNull(),
    guid: text('guid').notNull(),
    targetId: uuid('target_id').notNull(),
    alterId: integer('alter_id'),
    name: text('name').notNull(),
    importId: uuid('import_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tally_link_guid_uq').on(t.entityId, t.kind, t.guid),
    // One Tally object per FactoryOS record, except parties: Tally often keeps two ledgers for one GSTIN (a customer and
    // a supplier ledger, or a duplicate), and FactoryOS keeps one party per GSTIN.
    uniqueIndex('tally_link_target_uq').on(t.entityId, t.kind, t.targetId).where(sql`${t.kind} <> 'party'`),
    index('tally_link_target_idx').on(t.entityId, t.kind, t.targetId),
    foreignKey({ name: 'tally_link_import_fk', columns: [t.importId, t.tenantId, t.entityId], foreignColumns: [tallyImport.id, tallyImport.tenantId, tallyImport.entityId] }),
  ],
);

export type TallyVoucherBillRow = { name: string; type: string | null; side: 'debit' | 'credit'; amount: string };
export type TallyVoucherItemRow = {
  item: string;
  qty: string | null;
  unit: string | null;
  rate: string | null;
  amount: string | null;
  direction: 'in' | 'out' | null;
  batches: { godown: string | null; batch: string | null; qty: string | null }[];
};

/**
 * Tally history (decision 072): vouchers from Day Book exports, kept apart from the general ledger. They are never
 * posted, never sent to GST or e-invoicing, and a newer ALTERID replaces a voucher's lines.
 */
export const tallyVoucher = pgTable(
  'tally_voucher',
  {
    ...identity(),
    guid: text('guid').notNull(),
    alterId: integer('alter_id'),
    voucherType: text('voucher_type').notNull(),
    number: text('number'),
    date: date('date').notNull(),
    narration: text('narration'),
    partyName: text('party_name'),
    partyId: uuid('party_id'),
    cancelled: boolean('cancelled').notNull().default(false),
    optional: boolean('optional').notNull().default(false),
    /** Total of the debit side, for lists. */
    amount: numeric('amount', { precision: 24, scale: 6 }).notNull(),
    items: jsonb('items').$type<TallyVoucherItemRow[]>().notNull().default([]),
    importId: uuid('import_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tally_voucher_guid_uq').on(t.entityId, t.guid),
    uniqueIndex('tally_voucher_scope_uq').on(t.id, t.tenantId, t.entityId),
    index('tally_voucher_entity_date_idx').on(t.entityId, t.date),
    index('tally_voucher_party_idx').on(t.entityId, t.partyId),
    foreignKey({ name: 'tally_voucher_import_fk', columns: [t.importId, t.tenantId, t.entityId], foreignColumns: [tallyImport.id, tallyImport.tenantId, tallyImport.entityId] }),
  ],
);

/** One ledger amount of a Tally voucher, with the FactoryOS ledger or party it is linked to when known. */
export const tallyVoucherLine = pgTable(
  'tally_voucher_line',
  {
    ...identity(),
    voucherId: uuid('voucher_id').notNull(),
    lineNo: integer('line_no').notNull(),
    ledgerName: text('ledger_name').notNull(),
    accountId: uuid('account_id'),
    partyId: uuid('party_id'),
    side: text('side').notNull(),
    amount: numeric('amount', { precision: 24, scale: 6 }).notNull(),
    bills: jsonb('bills').$type<TallyVoucherBillRow[]>().notNull().default([]),
  },
  (t) => [
    uniqueIndex('tally_voucher_line_no_uq').on(t.voucherId, t.lineNo),
    index('tally_voucher_line_account_idx').on(t.entityId, t.accountId),
    index('tally_voucher_line_party_idx').on(t.entityId, t.partyId),
    check('tally_voucher_line_side_ck', sql`${t.side} in ('debit','credit')`),
    check('tally_voucher_line_amount_ck', sql`${t.amount} > 0`),
    foreignKey({ name: 'tally_voucher_line_voucher_fk', columns: [t.voucherId, t.tenantId, t.entityId], foreignColumns: [tallyVoucher.id, tallyVoucher.tenantId, tallyVoucher.entityId] }).onDelete('cascade'),
  ],
);

