// Decision 062: the skill matrix. Named skills are required by machines and work centres and held by people as
// certifications (trainee, qualified, trainer) that expire after the skill's re-certification interval. Certifications
// are append-only (a trigger allows only the one-time revocation); overrides allow one uncertified job card start.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { jobCard, machine, workCentre, workOrderOperation } from './manufacturing.js';
import { legalEntity, tenant } from './platform.js';

const scope = {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => legalEntity.id),
};

export const skillLevel = pgEnum('skill_level', ['trainee', 'qualified', 'trainer']);

export const skill = pgTable(
  'skill',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    recertifyMonths: integer('recertify_months').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('skill_code_uq').on(t.entityId, t.code), check('skill_months_ck', sql`${t.recertifyMonths} between 1 and 60`)],
);

export const machineSkill = pgTable(
  'machine_skill',
  {
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machine.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skill.id),
  },
  (t) => [primaryKey({ columns: [t.machineId, t.skillId] })],
);

export const workCentreSkill = pgTable(
  'work_centre_skill',
  {
    workCentreId: uuid('work_centre_id')
      .notNull()
      .references(() => workCentre.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skill.id),
  },
  (t) => [primaryKey({ columns: [t.workCentreId, t.skillId] })],
);

/** Append-only. A person's current certification for a skill is the latest one not revoked. */
export const skillCertification = pgTable(
  'skill_certification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skill.id),
    level: skillLevel('level').notNull(),
    certifiedOn: date('certified_on').notNull(),
    expiresOn: date('expires_on').notNull(),
    certifiedBy: text('certified_by')
      .notNull()
      .references(() => user.id),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by').references(() => user.id),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    index('skill_certification_user_idx').on(t.entityId, t.userId, t.skillId),
    index('skill_certification_skill_idx').on(t.skillId),
    check('skill_certification_dates_ck', sql`${t.expiresOn} > ${t.certifiedOn}`),
    check('skill_certification_self_ck', sql`${t.certifiedBy} <> ${t.userId}`),
  ],
);

/** A one-time allowance for an uncertified job card start: one person, one operation, one machine (or none). */
export const skillOverride = pgTable(
  'skill_override',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => workOrderOperation.id),
    machineId: uuid('machine_id').references(() => machine.id),
    reason: text('reason').notNull(),
    validOn: date('valid_on').notNull(),
    grantedBy: text('granted_by')
      .notNull()
      .references(() => user.id),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    jobCardId: uuid('job_card_id').references(() => jobCard.id),
  },
  (t) => [
    index('skill_override_operation_idx').on(t.operationId),
    uniqueIndex('skill_override_card_uq').on(t.jobCardId),
    check('skill_override_self_ck', sql`${t.grantedBy} <> ${t.userId}`),
  ],
);
