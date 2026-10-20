import { sql } from 'drizzle-orm';
import { check, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { gstRegistration, legalEntity, tenant } from './platform.js';

/**
 * Decision 074: a GSTR-1 or GSTR-3B per GSTIN per month, prepared from submitted documents and moved through
 * maker-checker (Draft → Reviewed → Approved → Filed). The snapshot is what was reviewed; once filed it never
 * changes, and later edits to its documents show as "Changed since filing".
 */
export const gstReturn = pgTable(
  'gst_return',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntity.id),
    gstRegistrationId: uuid('gst_registration_id')
      .notNull()
      .references(() => gstRegistration.id),
    /** YYYY-MM. */
    period: text('period').notNull(),
    /** gstr1 | gstr3b */
    kind: text('kind').notNull(),
    status: text('status').notNull().default('draft'),
    /** Sections, tables, needs attention and checks as prepared. */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    preparedBy: text('prepared_by')
      .notNull()
      .references(() => user.id),
    preparedAt: timestamp('prepared_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: text('reviewed_by').references(() => user.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    approvedBy: text('approved_by').references(() => user.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    filedBy: text('filed_by').references(() => user.id),
    filedAt: timestamp('filed_at', { withTimezone: true }),
    /** From the portal after filing. */
    arn: text('arn'),
    filedOn: date('filed_on'),
  },
  (t) => [
    uniqueIndex('gst_return_period_uq').on(t.gstRegistrationId, t.period, t.kind),
    index('gst_return_entity_idx').on(t.entityId, t.period),
    check('gst_return_kind_ck', sql`${t.kind} in ('gstr1','gstr3b')`),
    check('gst_return_status_ck', sql`${t.status} in ('draft','reviewed','approved','filed')`),
    check('gst_return_period_ck', sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('gst_return_filed_ck', sql`(${t.status} = 'filed') = (${t.arn} is not null and ${t.filedOn} is not null and ${t.filedBy} is not null)`),
    check('gst_return_maker_checker_ck', sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.preparedBy}`),
  ],
);

/** One document's place in a return: the frozen figures it was prepared with. */
export const gstReturnLine = pgTable(
  'gst_return_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => gstReturn.id, { onDelete: 'cascade' }),
    section: text('section').notNull(),
    /** sales_invoice | sales_note | purchase_invoice | supplier_note | bank_charge | landed_cost */
    documentType: text('document_type').notNull(),
    documentId: uuid('document_id').notNull(),
    documentNumber: text('document_number').notNull(),
    documentDate: date('document_date').notNull(),
    /** Dated in an earlier month whose return was already filed. */
    late: text('late_from'),
    figures: jsonb('figures').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index('gst_return_line_return_idx').on(t.returnId), index('gst_return_line_document_idx').on(t.documentId)],
);

/**
 * Decision 074b: a correction to a filed month, proposed in the next GSTR-1 of the GSTIN. A person includes it or
 * drops it with a reason; included ones go into the return's amendment tables and adjust its GSTR-3B. Frozen with
 * the return once filed.
 */
export const gstAmendment = pgTable(
  'gst_amendment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntity.id),
    /** The GSTR-1 that carries the amendment. */
    returnId: uuid('return_id')
      .notNull()
      .references(() => gstReturn.id, { onDelete: 'cascade' }),
    /** The document id, or `b2cs:<month>` for a B2CS revision. */
    key: text('key').notNull(),
    /** b2ba | b2cla | expa | cdnra | cdnura | b2csa */
    amendTable: text('amend_table').notNull(),
    documentType: text('document_type'),
    documentId: uuid('document_id'),
    /** The filed month whose figures are revised. */
    originalPeriod: text('original_period').notNull(),
    reported: jsonb('reported').$type<Record<string, unknown>>().notNull(),
    revised: jsonb('revised').$type<Record<string, unknown>>().notNull(),
    difference: jsonb('difference').$type<Record<string, string>>().notNull(),
    /** proposed | included | dropped */
    status: text('status').notNull().default('proposed'),
    reason: text('reason'),
    decidedBy: text('decided_by').references(() => user.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('gst_amendment_key_uq').on(t.returnId, t.key),
    index('gst_amendment_document_idx').on(t.documentId),
    check('gst_amendment_table_ck', sql`${t.amendTable} in ('b2ba','b2cla','expa','cdnra','cdnura','b2csa')`),
    check('gst_amendment_status_ck', sql`${t.status} in ('proposed','included','dropped')`),
    check('gst_amendment_dropped_reason_ck', sql`${t.status} <> 'dropped' or length(trim(coalesce(${t.reason}, ''))) >= 5`),
    check('gst_amendment_decided_ck', sql`(${t.status} = 'proposed') = (${t.decidedBy} is null)`),
  ],
);
