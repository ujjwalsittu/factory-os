// Audited support access (decision 050): tenant policy, immutable single-use consent, server-only user security
// epochs and append-only evidence. Identity columns deliberately have no foreign keys: native cleanup must never be
// blocked, and historical references survive deletion (absence refuses access). Source-authority triggers, the
// immutability rules and append-only guards live in the hand-written tail of the `support_access` migration.
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenant } from './platform.js';

const AREAS = sql.raw(`array['inventory','sales-invoices','purchase-invoices','work-orders','accounting']::text[]`);

/** Missing row = disabled, 1800-second cap, all five areas. Revisions only ever increase. */
export const supportAccessPolicy = pgTable(
  'support_access_policy',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    maxDurationSeconds: integer('max_duration_seconds').notNull().default(1800),
    allowedAreas: text('allowed_areas').array().notNull().default(sql`array['inventory','sales-invoices','purchase-invoices','work-orders','accounting']::text[]`),
    /** Bumped by every policy change, including relaxing ones. */
    configRevision: bigint('config_revision', { mode: 'bigint' }).notNull().default(sql`0`),
    /** Bumped in the source transaction by tenant, membership, role, assignment and entity changes. */
    authorityRevision: bigint('authority_revision', { mode: 'bigint' }).notNull().default(sql`0`),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('support_access_policy_duration_ck', sql`${t.maxDurationSeconds} between 300 and 1800`),
    check('support_access_policy_areas_ck', sql`cardinality(${t.allowedAreas}) between 1 and 5 and ${t.allowedAreas} <@ ${AREAS}`),
    check('support_access_policy_revisions_ck', sql`${t.configRevision} >= 0 and ${t.authorityRevision} >= 0`),
  ],
);

/** Global native-user security revision, bumped by password, email, factor and platform-role changes. Server-only. */
export const supportAccessUserEpoch = pgTable(
  'support_access_user_epoch',
  {
    userId: text('user_id').primaryKey(),
    securityEpoch: bigint('security_epoch', { mode: 'bigint' }).notNull().default(sql`0`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('support_access_user_epoch_ck', sql`${t.securityEpoch} >= 0`)],
);

export const supportAccessGrant = pgTable(
  'support_access_grant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    entityId: uuid('entity_id').notNull(),
    operatorUserId: text('operator_user_id').notNull(),
    subjectUserId: text('subject_user_id').notNull(),
    subjectMembershipId: uuid('subject_membership_id').notNull(),
    approverUserId: text('approver_user_id').notNull(),
    areas: text('areas').array().notNull(),
    reason: text('reason').notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    startBy: timestamp('start_by', { withTimezone: true }).notNull(),
    // Captured authority; any later difference ends the consent for good.
    policyConfigRevision: bigint('policy_config_revision', { mode: 'bigint' }).notNull(),
    tenantAuthorityRevision: bigint('tenant_authority_revision', { mode: 'bigint' }).notNull(),
    operatorEpoch: bigint('operator_epoch', { mode: 'bigint' }).notNull(),
    subjectEpoch: bigint('subject_epoch', { mode: 'bigint' }).notNull(),
    approverEpoch: bigint('approver_epoch', { mode: 'bigint' }).notNull(),
    /** Server HMAC of the approver's credential at proof time; private. */
    approverPasswordVersion: text('approver_password_version').notNull(),
    approverSessionId: text('approver_session_id').notNull(),
    // One-way start.
    startedAt: timestamp('started_at', { withTimezone: true }),
    actorSessionId: text('actor_session_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // One-way end. Derived expiry/invalidation is reported without a worker; these record observed transitions.
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endKind: text('end_kind'),
    endReason: text('end_reason'),
    endedBy: text('ended_by'),
  },
  (t) => [
    index('support_access_grant_tenant_idx').on(t.tenantId, t.approvedAt),
    index('support_access_grant_operator_idx').on(t.operatorUserId, t.approvedAt),
    index('support_access_grant_session_idx').on(t.actorSessionId),
    check('support_access_grant_duration_ck', sql`${t.durationSeconds} between 300 and 1800`),
    check('support_access_grant_areas_ck', sql`cardinality(${t.areas}) between 1 and 5 and ${t.areas} <@ ${AREAS}`),
    check('support_access_grant_reason_ck', sql`char_length(${t.reason}) between 3 and 500`),
    check('support_access_grant_people_ck', sql`${t.operatorUserId} <> ${t.approverUserId} and ${t.operatorUserId} <> ${t.subjectUserId}`),
    check('support_access_grant_window_ck', sql`${t.startBy} > ${t.approvedAt} and ${t.startBy} <= ${t.approvedAt} + interval '600 seconds'`),
    check(
      'support_access_grant_start_ck',
      sql`(${t.startedAt} is null and ${t.actorSessionId} is null and ${t.expiresAt} is null) or (${t.startedAt} is not null and ${t.actorSessionId} is not null and ${t.expiresAt} is not null and ${t.startedAt} <= ${t.startBy} and ${t.expiresAt} > ${t.startedAt} and ${t.expiresAt} <= ${t.startedAt} + make_interval(secs => ${t.durationSeconds}))`,
    ),
    check(
      'support_access_grant_end_ck',
      sql`(${t.endedAt} is null and ${t.endKind} is null and ${t.endReason} is null and ${t.endedBy} is null) or (${t.endedAt} is not null and ${t.endKind} in ('stopped','revoked','expired','invalidated') and ${t.endedAt} >= ${t.approvedAt})`,
    ),
  ],
);

/** Append-only. No response bodies, passwords, cookies, challenges or token material. */
export const supportAccessEvent = pgTable(
  'support_access_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    grantId: uuid('grant_id'),
    kind: text('kind').notNull(),
    actorUserId: text('actor_user_id'),
    subjectUserId: text('subject_user_id'),
    operatorUserId: text('operator_user_id'),
    area: text('area'),
    reasonCode: text('reason_code'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    index('support_access_event_tenant_idx').on(t.tenantId, t.occurredAt),
    index('support_access_event_grant_idx').on(t.grantId, t.occurredAt),
    check('support_access_event_kind_ck', sql`${t.kind} in ('approved','started','stopped','revoked','expired','invalidated','read','denied','policy-changed')`),
    check('support_access_event_area_ck', sql`${t.area} is null or ${t.area} = any(${AREAS})`),
    check('support_access_event_reason_ck', sql`${t.reasonCode} is null or ${t.reasonCode} ~ '^[a-z][a-z0-9-]{0,63}$'`),
  ],
);
