import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { legalEntity, tenant } from './platform.js';
import { party } from './masters.js';
import { docStatus } from './inventory.js';
const money = (name: string) => numeric(name, { precision: 24, scale: 6 });
const scope = () => ({ tenantId: uuid('tenant_id').notNull().references(() => tenant.id), entityId: uuid('entity_id').notNull().references(() => legalEntity.id) });
const created = () => ({ createdBy: text('created_by').notNull().references(() => user.id), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() });
const lifecycle = () => ({ ...created(), status: docStatus('status').notNull().default('draft'), submittedBy: text('submitted_by').references(() => user.id), submittedAt: timestamp('submitted_at', { withTimezone: true }), cancelledBy: text('cancelled_by').references(() => user.id), cancelledAt: timestamp('cancelled_at', { withTimezone: true }), cancelReason: text('cancel_reason') });

export const taxConfiguration = pgTable('tax_configuration', {
  ...scope(), active: boolean('active').notNull().default(false), activationDate: date('activation_date'), deductorPan: text('deductor_pan'), tan: text('tan'), revision: integer('revision').notNull().default(1),
  enabledProfiles: jsonb('enabled_profiles').$type<string[]>().notNull().default([]), mappings: jsonb('mappings').$type<Record<string,string>>().notNull().default({}), openingId: uuid('opening_id'),
  activatedBy: text('activated_by').references(() => user.id), activatedAt: timestamp('activated_at', { withTimezone: true }), ...created(),
}, t => [uniqueIndex('tax_configuration_entity_uq').on(t.entityId), foreignKey({name:'tax_configuration_entity_scope_fk',columns:[t.entityId,t.tenantId],foreignColumns:[legalEntity.id,legalEntity.tenantId]}), check('tax_configuration_revision_ck',sql`${t.revision}>0`)]);

/** Revisions are immutable even before enablement; approval selects a revision, never edits it. */
export const taxProfileRevision = pgTable('tax_profile_revision', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), profileKey: text('profile_key').notNull(), revision: integer('revision').notNull(), status: text('status').notNull().default('draft'),
  definition: jsonb('definition').$type<Record<string,unknown>>().notNull(), evidence: jsonb('evidence').$type<Record<string,unknown>>().notNull(), ...created(),
}, t => [uniqueIndex('tax_profile_scope_uq').on(t.id,t.tenantId,t.entityId), uniqueIndex('tax_profile_revision_uq').on(t.entityId,t.profileKey,t.revision), foreignKey({name:'tax_profile_entity_scope_fk',columns:[t.entityId,t.tenantId],foreignColumns:[legalEntity.id,legalEntity.tenantId]}), check('tax_profile_status_ck',sql`${t.status} in ('draft','verified') and ${t.revision}>0`)]);

/** Canonical PAN or reviewed no-PAN identity per deductor. Party masters do not own counters. */
export const taxpayerIdentity = pgTable('taxpayer_identity', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), identityKey: text('identity_key').notNull(), panStatus: text('pan_status').notNull(), evidence: jsonb('evidence').$type<Record<string,unknown>>().notNull(), ...created(),
}, t => [uniqueIndex('taxpayer_identity_scope_uq').on(t.id,t.tenantId,t.entityId), uniqueIndex('taxpayer_identity_key_uq').on(t.entityId,t.identityKey), foreignKey({name:'taxpayer_entity_scope_fk',columns:[t.entityId,t.tenantId],foreignColumns:[legalEntity.id,legalEntity.tenantId]}), check('taxpayer_pan_status_ck',sql`${t.panStatus} in ('valid','missing','inoperative','unknown')`)]);

export const taxPartyEvidence = pgTable('tax_party_evidence', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), partyId: uuid('party_id').notNull(), identityId: uuid('identity_id').notNull(), effectiveDate: date('effective_date').notNull(),
  revision: integer('revision').notNull(), selectors: jsonb('selectors').$type<Record<string,unknown>>().notNull().default({}), evidence: jsonb('evidence').$type<Record<string,unknown>>().notNull(), ...created(),
}, t => [uniqueIndex('tax_party_evidence_revision_uq').on(t.entityId,t.partyId,t.revision), foreignKey({name:'tax_party_identity_scope_fk',columns:[t.identityId,t.tenantId,t.entityId],foreignColumns:[taxpayerIdentity.id,taxpayerIdentity.tenantId,taxpayerIdentity.entityId]}),foreignKey({name:'tax_party_master_scope_fk',columns:[t.partyId,t.tenantId],foreignColumns:[party.id,party.tenantId]}), check('tax_party_revision_ck',sql`${t.revision}>0`)]);

export const taxCertificate = pgTable('tax_certificate', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), identityId: uuid('identity_id').notNull(), profileId: uuid('profile_id').notNull(), reference: text('reference').notNull(), revision: integer('revision').notNull(),
  authority: text('authority').notNull(), act: text('act').notNull(), deductorTan: text('deductor_tan').notNull(), validFrom: date('valid_from').notNull(), validTo: date('valid_to').notNull(),
  ratePercent: money('rate_percent').notNull(), baseLimit: money('base_limit').notNull(), taxLimit: money('tax_limit'), evidence: jsonb('evidence').$type<Record<string,unknown>>().notNull(), ...created(),
}, t => [uniqueIndex('tax_certificate_scope_uq').on(t.id,t.tenantId,t.entityId), uniqueIndex('tax_certificate_revision_uq').on(t.entityId,t.reference,t.revision), foreignKey({name:'tax_certificate_identity_fk',columns:[t.identityId,t.tenantId,t.entityId],foreignColumns:[taxpayerIdentity.id,taxpayerIdentity.tenantId,taxpayerIdentity.entityId]}), foreignKey({name:'tax_certificate_profile_fk',columns:[t.profileId,t.tenantId,t.entityId],foreignColumns:[taxProfileRevision.id,taxProfileRevision.tenantId,taxProfileRevision.entityId]}), check('tax_certificate_values_ck',sql`${t.ratePercent}>=0 and ${t.ratePercent}<=100 and ${t.baseLimit}>=0 and (${t.taxLimit} is null or ${t.taxLimit}>=0) and ${t.validTo}>=${t.validFrom} and ${t.act} in ('1961','2025')`)]);

export const taxOpening = pgTable('tax_opening', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), postingDate: date('posting_date').notNull(), revision: integer('revision').notNull(), lines: jsonb('lines').$type<Record<string,unknown>[]>().notNull().default([]),
  reconciliation: jsonb('reconciliation').$type<Record<string,unknown>>(), reviewedHash: text('reviewed_hash'), reason: text('reason').notNull(), ...lifecycle(),
}, t => [uniqueIndex('tax_opening_scope_uq').on(t.id,t.tenantId,t.entityId),uniqueIndex('tax_opening_revision_uq').on(t.entityId,t.revision),foreignKey({name:'tax_opening_entity_fk',columns:[t.entityId,t.tenantId],foreignColumns:[legalEntity.id,legalEntity.tenantId]}),check('tax_opening_revision_ck',sql`${t.revision}>0`)]);

export const taxSourceHistory = pgTable('tax_source_history', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), openingId: uuid('opening_id').notNull(), sourceType: text('source_type').notNull(), sourceId: uuid('source_id').notNull(),
  revision: integer('revision').notNull(), history: jsonb('history').$type<Record<string,unknown>>().notNull(), ...created(),
}, t => [uniqueIndex('tax_source_history_revision_uq').on(t.entityId,t.sourceType,t.sourceId,t.revision),foreignKey({name:'tax_history_opening_fk',columns:[t.openingId,t.tenantId,t.entityId],foreignColumns:[taxOpening.id,taxOpening.tenantId,taxOpening.entityId]}),check('tax_history_revision_ck',sql`${t.revision}>0`)]);

export const taxAssessment = pgTable('tax_assessment', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), sourceType: text('source_type').notNull(), sourceId: uuid('source_id').notNull(), purpose: text('purpose').notNull(),
  identityId: uuid('identity_id').notNull(), profileId: uuid('profile_id'), postingDate: date('posting_date').notNull(), taxYear: text('tax_year').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string,unknown>>().notNull(), previewHash: text('preview_hash').notNull(), ...lifecycle(),
}, t => [uniqueIndex('tax_assessment_scope_uq').on(t.id,t.tenantId,t.entityId),uniqueIndex('tax_assessment_source_uq').on(t.entityId,t.sourceType,t.sourceId,t.purpose),foreignKey({name:'tax_assessment_identity_fk',columns:[t.identityId,t.tenantId,t.entityId],foreignColumns:[taxpayerIdentity.id,taxpayerIdentity.tenantId,taxpayerIdentity.entityId]}),foreignKey({name:'tax_assessment_profile_fk',columns:[t.profileId,t.tenantId,t.entityId],foreignColumns:[taxProfileRevision.id,taxProfileRevision.tenantId,taxProfileRevision.entityId]})]);

export const taxEvent = pgTable('tax_event', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), assessmentId: uuid('assessment_id').notNull(), identityId: uuid('identity_id').notNull(), category: text('category').notNull(),
  postingDate: date('posting_date').notNull(), taxYear: text('tax_year').notNull(), baseAmount: money('base_amount').notNull(), taxAmount: money('tax_amount').notNull(),
  eventKey: text('event_key').notNull(), voucherId: uuid('voucher_id'), reversalOf: uuid('reversal_of'), ...created(),
}, t => [uniqueIndex('tax_event_scope_uq').on(t.id,t.tenantId,t.entityId),uniqueIndex('tax_event_key_uq').on(t.entityId,t.eventKey),uniqueIndex('tax_event_reversal_uq').on(t.reversalOf),index('tax_event_counter_idx').on(t.entityId,t.identityId,t.taxYear,t.category,t.postingDate),foreignKey({name:'tax_event_assessment_fk',columns:[t.assessmentId,t.tenantId,t.entityId],foreignColumns:[taxAssessment.id,taxAssessment.tenantId,taxAssessment.entityId]}),foreignKey({name:'tax_event_identity_fk',columns:[t.identityId,t.tenantId,t.entityId],foreignColumns:[taxpayerIdentity.id,taxpayerIdentity.tenantId,taxpayerIdentity.entityId]}),check('tax_event_category_ck',sql`${t.category} in ('tds','tcs','customer_tds','supplier_tcs')`)]);

export const taxBaseConsumption = pgTable('tax_base_consumption', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), eventId: uuid('event_id').notNull(), obligationId: uuid('obligation_id').notNull(), recipientAssessmentId: uuid('recipient_assessment_id').notNull(),
  baseAmount: money('base_amount').notNull(), consumptionKey: text('consumption_key').notNull(), reversalOf: uuid('reversal_of'), ...created(),
}, t => [uniqueIndex('tax_consumption_key_uq').on(t.entityId,t.consumptionKey),uniqueIndex('tax_consumption_reversal_uq').on(t.reversalOf),foreignKey({name:'tax_consumption_event_fk',columns:[t.eventId,t.tenantId,t.entityId],foreignColumns:[taxEvent.id,taxEvent.tenantId,taxEvent.entityId]}),foreignKey({name:'tax_consumption_recipient_fk',columns:[t.recipientAssessmentId,t.tenantId,t.entityId],foreignColumns:[taxAssessment.id,taxAssessment.tenantId,taxAssessment.entityId]})]);

export const taxCertificateUse = pgTable('tax_certificate_use', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), certificateId: uuid('certificate_id').notNull(), eventId: uuid('event_id').notNull(), baseAmount: money('base_amount').notNull(),
  taxAmount: money('tax_amount').notNull(), reversalOf: uuid('reversal_of'), ...created(),
}, t => [uniqueIndex('tax_certificate_use_event_uq').on(t.certificateId,t.eventId),uniqueIndex('tax_certificate_use_reversal_uq').on(t.reversalOf),foreignKey({name:'tax_certificate_use_certificate_fk',columns:[t.certificateId,t.tenantId,t.entityId],foreignColumns:[taxCertificate.id,taxCertificate.tenantId,taxCertificate.entityId]}),foreignKey({name:'tax_certificate_use_event_fk',columns:[t.eventId,t.tenantId,t.entityId],foreignColumns:[taxEvent.id,taxEvent.tenantId,taxEvent.entityId]})]);

export const taxAdvice = pgTable('tax_advice', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), partyId: uuid('party_id').notNull(), direction: text('direction').notNull(), postingDate: date('posting_date').notNull(),
  amount: money('amount').notNull(), evidenceKey: text('evidence_key').notNull(), evidence: jsonb('evidence').$type<Record<string,unknown>>().notNull(),
  allocations: jsonb('allocations').$type<{billId:string;amount:string}[]>().notNull(), snapshot: jsonb('snapshot').$type<Record<string,unknown>>(), assessmentId: uuid('assessment_id'), voucherId: uuid('voucher_id'), ...lifecycle(),
}, t => [uniqueIndex('tax_advice_scope_uq').on(t.id,t.tenantId,t.entityId),uniqueIndex('tax_advice_evidence_uq').on(t.entityId,t.partyId,t.evidenceKey),foreignKey({name:'tax_advice_party_fk',columns:[t.partyId,t.tenantId],foreignColumns:[party.id,party.tenantId]}),foreignKey({name:'tax_advice_entity_fk',columns:[t.entityId,t.tenantId],foreignColumns:[legalEntity.id,legalEntity.tenantId]}),foreignKey({name:'tax_advice_assessment_fk',columns:[t.assessmentId,t.tenantId,t.entityId],foreignColumns:[taxAssessment.id,taxAssessment.tenantId,taxAssessment.entityId]}),check('tax_advice_values_ck',sql`${t.amount}>0 and ${t.direction} in ('customer_tds','supplier_tcs')`)]);

export const taxRemittance = pgTable('tax_remittance', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), postingDate: date('posting_date').notNull(), tan: text('tan').notNull(), act: text('act').notNull(),
  taxYear: text('tax_year').notNull(), category: text('category').notNull(), period: text('period').notNull(), referenceKey: text('reference_key').notNull(),
  amount: money('amount').notNull(), bankAccountId: uuid('bank_account_id').notNull(), evidence: jsonb('evidence').$type<Record<string,unknown>>().notNull(),
  snapshot: jsonb('snapshot').$type<Record<string,unknown>>(), voucherId: uuid('voucher_id'), ...lifecycle(),
}, t => [uniqueIndex('tax_remittance_scope_uq').on(t.id,t.tenantId,t.entityId),uniqueIndex('tax_remittance_reference_uq').on(t.entityId,t.tan,t.referenceKey),foreignKey({name:'tax_remittance_entity_fk',columns:[t.entityId,t.tenantId],foreignColumns:[legalEntity.id,legalEntity.tenantId]}),check('tax_remittance_values_ck',sql`${t.amount}>0 and ${t.act} in ('1961','2025') and ${t.category} in ('tds','tcs')`)]);

export const taxRemittanceAllocation = pgTable('tax_remittance_allocation', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), remittanceId: uuid('remittance_id').notNull(), eventId: uuid('event_id').notNull(),
  amount: money('amount').notNull(), reversalOf: uuid('reversal_of'), ...created(),
}, t => [uniqueIndex('tax_remittance_allocation_uq').on(t.remittanceId,t.eventId),uniqueIndex('tax_remittance_allocation_reversal_uq').on(t.reversalOf),foreignKey({name:'tax_remit_allocation_remit_fk',columns:[t.remittanceId,t.tenantId,t.entityId],foreignColumns:[taxRemittance.id,taxRemittance.tenantId,taxRemittance.entityId]}),foreignKey({name:'tax_remit_allocation_event_fk',columns:[t.eventId,t.tenantId,t.entityId],foreignColumns:[taxEvent.id,taxEvent.tenantId,taxEvent.entityId]})]);

export const taxCorrection = pgTable('tax_correction', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), originalEventId: uuid('original_event_id').notNull(), postingDate: date('posting_date').notNull(), reason: text('reason').notNull(),
  evidence: jsonb('evidence').$type<Record<string,unknown>>().notNull(), snapshot: jsonb('snapshot').$type<Record<string,unknown>>(), assessmentId: uuid('assessment_id'), ...lifecycle(),
}, t => [foreignKey({name:'tax_correction_event_fk',columns:[t.originalEventId,t.tenantId,t.entityId],foreignColumns:[taxEvent.id,taxEvent.tenantId,taxEvent.entityId]}),foreignKey({name:'tax_correction_assessment_fk',columns:[t.assessmentId,t.tenantId,t.entityId],foreignColumns:[taxAssessment.id,taxAssessment.tenantId,taxAssessment.entityId]})]);

export const taxExternalReference = pgTable('tax_external_reference', {
  id: uuid('id').primaryKey().defaultRandom(), ...scope(), eventId: uuid('event_id').notNull(), kind: text('kind').notNull(), reference: text('reference').notNull(),
  evidence: jsonb('evidence').$type<Record<string,unknown>>().notNull(), ...created(),
}, t => [uniqueIndex('tax_external_reference_uq').on(t.eventId,t.kind,t.reference),foreignKey({name:'tax_external_event_fk',columns:[t.eventId,t.tenantId,t.entityId],foreignColumns:[taxEvent.id,taxEvent.tenantId,taxEvent.entityId]}),check('tax_external_kind_ck',sql`${t.kind} in ('certificate','reported','correction')`)]);
