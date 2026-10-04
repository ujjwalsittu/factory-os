// Tenant-level master data shared by all legal entities (docs/02 tenancy model, docs/03 §1).
import { boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenant } from './platform.js';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};
/** Quantities, rates and values: 6 decimal places, read as strings (see @factoryos/core Dec). */
export const qty = (name: string) => numeric(name, { precision: 24, scale: 6 });

export const uom = pgTable(
  'uom',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** Allowed decimal places for quantities in this unit (Nos = 0, kg = 3). */
    decimals: integer('decimals').notNull().default(3),
    ...timestamps,
  },
  (t) => [uniqueIndex('uom_tenant_code_uq').on(t.tenantId, t.code)],
);

export const hsnKind = pgEnum('hsn_kind', ['hsn', 'sac']);

/** HSN (goods) / SAC (services) with effective-dated GST rates (docs/05 §1). */
export const hsnCode = pgTable(
  'hsn_code',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    kind: hsnKind('kind').notNull(),
    description: text('description').notNull(),
    gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).notNull(),
    cessRate: numeric('cess_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    effectiveFrom: date('effective_from').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('hsn_tenant_code_from_uq').on(t.tenantId, t.code, t.effectiveFrom)],
);

export const itemType = pgEnum('item_type', [
  'raw_material',
  'powder',
  'component',
  'consumable',
  'sub_assembly',
  'finished_good',
  'kit',
  'tool',
  'gauge',
  'service',
  'scrap',
]);
export const itemTracking = pgEnum('item_tracking', ['none', 'batch', 'serial']);

export const item = pgTable(
  'item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    type: itemType('type').notNull(),
    /** batch: heat number / powder lot / reel; serial: one unit per serial (Phase 2). */
    tracking: itemTracking('tracking').notNull().default('none'),
    isStockItem: boolean('is_stock_item').notNull().default(true),
    stockUomId: uuid('stock_uom_id')
      .notNull()
      .references(() => uom.id),
    hsnCode: text('hsn_code'),
    /** Drawing revision (A, B, C…). AS9100 configuration control (docs/03 §1). */
    revision: text('revision'),
    drawingNo: text('drawing_no'),
    shelfLifeDays: integer('shelf_life_days'),
    /** Moisture sensitivity level for SMT parts (1, 2, 2a, 3, 4, 5, 5a, 6). */
    mslLevel: text('msl_level'),
    requiresIncomingInspection: boolean('requires_incoming_inspection').notNull().default(false),
    /** Export-controlled (SCOMET etc.); restricts visibility later (open question B5). */
    exportControlled: boolean('export_controlled').notNull().default(false),
    reorderLevel: qty('reorder_level'),
    attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('item_tenant_code_uq').on(t.tenantId, t.code), index('item_tenant_type_idx').on(t.tenantId, t.type)],
);

export const gstTreatment = pgEnum('gst_treatment', ['registered', 'unregistered', 'composition', 'sez', 'overseas', 'deemed_export']);

export const party = pgTable(
  'party',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isCustomer: boolean('is_customer').notNull().default(false),
    isSupplier: boolean('is_supplier').notNull().default(false),
    gstTreatment: gstTreatment('gst_treatment').notNull().default('registered'),
    gstin: text('gstin'),
    pan: text('pan'),
    /** Place-of-supply state for unregistered parties; derived from GSTIN when registered. */
    stateCode: text('state_code'),
    /** MSME (Sec 43B(h)): Udyam number and category drive 45-day payment tracking (docs/05 §6). */
    msmeUdyam: text('msme_udyam'),
    msmeCategory: text('msme_category'),
    creditDays: integer('credit_days'),
    /** Rupees; null = no credit check (decision 032). */
    creditLimit: numeric('credit_limit', { precision: 18, scale: 2 }),
    email: text('email'),
    phone: text('phone'),
    addresses: jsonb('addresses')
      .$type<{ label: string; line1: string; line2?: string; city: string; stateCode: string; pincode: string; country?: string }[]>()
      .notNull()
      .default([]),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('party_tenant_code_uq').on(t.tenantId, t.code), index('party_tenant_gstin_idx').on(t.tenantId, t.gstin)],
);
