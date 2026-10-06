// Tenancy and organisation structure. See docs/15-tenancy-rbac-auth.md §1.

import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);
export const platformAdminLevel = pgEnum('platform_admin_level', ['superadmin', 'support']);

export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: tenantStatus('status').notNull().default('active'),
  plan: text('plan').notNull().default('internal'),
  featureFlags: jsonb('feature_flags').$type<Record<string, boolean>>().notNull().default({}),
  ...timestamps,
});

/** Platform operators. Deliberately separate from tenant roles so a tenant can never grant it. */
export const platformAdmin = pgTable('platform_admin', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  level: platformAdminLevel('level').notNull().default('superadmin'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const legalEntity = pgTable(
  'legal_entity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Subsidiaries point to their parent (EarthNow → Azeonics). */
    parentEntityId: uuid('parent_entity_id').references((): AnyPgColumn => legalEntity.id),
    legalName: text('legal_name').notNull(),
    shortName: text('short_name').notNull(),
    /** Short code used in number series, e.g. "AZ". */
    code: text('code').notNull(),
    pan: text('pan'),
    cin: text('cin'),
    baseCurrency: text('base_currency').notNull().default('INR'),
    /** 4 = April (Indian FY). */
    fyStartMonth: integer('fy_start_month').notNull().default(4),
    address: jsonb('address').$type<Address>(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('legal_entity_tenant_code_uq').on(t.tenantId, t.code), index('legal_entity_tenant_idx').on(t.tenantId)],
);

export const gstRegistrationType = pgEnum('gst_registration_type', [
  'regular',
  'composition',
  'sez_unit',
  'sez_developer',
  'isd',
  'casual',
  'non_resident',
]);

export const gstRegistration = pgTable(
  'gst_registration',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntity.id, { onDelete: 'cascade' }),
    gstin: text('gstin').notNull(),
    stateCode: text('state_code').notNull(),
    type: gstRegistrationType('type').notNull().default('regular'),
    tradeName: text('trade_name'),
    address: jsonb('address').$type<Address>(),
    effectiveFrom: date('effective_from'),
    /** E-invoicing is date-effective (decision 006), not a boolean. */
    einvoiceApplicableFrom: date('einvoice_applicable_from'),
    irpProvider: text('irp_provider').notNull().default('mock'),
    ewbProvider: text('ewb_provider').notNull().default('mock'),
    returnsProvider: text('returns_provider').notNull().default('mock'),
    /** Letter of Undertaking for zero-rated supplies without IGST (decision 031). */
    lutArn: text('lut_arn'),
    lutValidFrom: date('lut_valid_from'),
    lutValidTo: date('lut_valid_to'),
    /** Reference into the secrets store. Credentials are never stored in this table. */
    credentialRef: text('credential_ref'),
    ...timestamps,
  },
  (t) => [uniqueIndex('gst_registration_scope_uq').on(t.id,t.tenantId,t.entityId), uniqueIndex('gst_registration_tenant_gstin_uq').on(t.tenantId, t.gstin), index('gst_registration_entity_idx').on(t.entityId)],
);

export const plant = pgTable(
  'plant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntity.id, { onDelete: 'cascade' }),
    gstRegistrationId: uuid('gst_registration_id').references(() => gstRegistration.id),
    name: text('name').notNull(),
    code: text('code').notNull(),
    address: jsonb('address').$type<Address>(),
    ...timestamps,
  },
  (t) => [uniqueIndex('plant_tenant_code_uq').on(t.tenantId, t.code)],
);

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  district?: string;
  stateCode: string;
  pincode: string;
  country?: string;
}

