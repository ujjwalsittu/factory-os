// Memberships, roles, scoped role assignments, invitations and the audit log.
import { bigserial, boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { tenant } from './platform.js';

export const membershipStatus = pgEnum('membership_status', ['active', 'disabled']);

export const membership = pgTable(
  'membership',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: membershipStatus('status').notNull().default('active'),
    isOwner: boolean('is_owner').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('membership_tenant_user_uq').on(t.tenantId, t.userId), index('membership_user_idx').on(t.userId)],
);

export const role = pgTable(
  'role',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Set for seeded roles (e.g. "owner"); null for custom roles. */
    systemKey: text('system_key'),
    name: text('name').notNull(),
    description: text('description'),
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('role_tenant_name_uq').on(t.tenantId, t.name)],
);

export const roleAssignment = pgTable(
  'role_assignment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => membership.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    /** null = whole tenant; otherwise limited to these legal entities. */
    entityIds: jsonb('entity_ids').$type<string[] | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('role_assignment_membership_idx').on(t.membershipId)],
);

export const invitationStatus = pgEnum('invitation_status', ['pending', 'accepted', 'revoked', 'expired']);

export const invitation = pgTable(
  'invitation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    /** Stored as a SHA-256 hash; the raw token is only in the invite link. */
    tokenHash: text('token_hash').notNull().unique(),
    roles: jsonb('roles').$type<{ roleId: string; entityIds: string[] | null }[]>().notNull(),
    status: invitationStatus('status').notNull().default('pending'),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => user.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('invitation_tenant_idx').on(t.tenantId)],
);

/** Append-only, hash-chained per tenant. Never update or delete rows. */
export const auditEvent = pgTable(
  'audit_event',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** null for platform-level events. */
    tenantId: uuid('tenant_id'),
    entityId: uuid('entity_id'),
    actorUserId: text('actor_user_id'),
    impersonatorUserId: text('impersonator_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
  },
  (t) => [index('audit_event_tenant_idx').on(t.tenantId, t.seq)],
);
