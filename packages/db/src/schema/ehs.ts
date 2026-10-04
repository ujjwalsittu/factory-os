// Waste register (docs/03 §9, decision 025): an append-only record of waste generated and disposed,
// by category and owner. Corrections are made by cancelling a row with a reason, never by editing.
import { boolean, date, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { stockEntry, warehouse } from './inventory.js';
import { item, party, qty, uom } from './masters.js';
import { legalEntity, tenant } from './platform.js';

export const wasteCategory = pgEnum('waste_category', [
  'metal_swarf',
  'metal_offcut',
  'rejected_parts',
  'metal_powder',
  'e_waste',
  'coolant_oil',
  'solvent',
  'packaging',
  'other',
]);
export const wasteMovementKind = pgEnum('waste_movement_kind', ['generated', 'disposed']);
export const wasteDisposalMethod = pgEnum('waste_disposal_method', ['returned_to_customer', 'sold', 'authorised_recycler', 'tsdf', 'other']);

export const wasteMovement = pgTable(
  'waste_movement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntity.id),
    kind: wasteMovementKind('kind').notNull(),
    movementDate: date('movement_date').notNull(),
    category: wasteCategory('category').notNull(),
    /** What it is, e.g. "Ti-6Al-4V swarf" — stock is kept separate per material (never mix alloys). */
    material: text('material').notNull(),
    itemId: uuid('item_id').references(() => item.id),
    qty: qty('qty').notNull(),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uom.id),
    /** null = the entity's own waste; otherwise the customer whose material produced it. */
    ownerPartyId: uuid('owner_party_id').references(() => party.id),
    hazardous: boolean('hazardous').notNull().default(false),
    warehouseId: uuid('warehouse_id').references(() => warehouse.id),
    /** Generated: job / work order / machine reference. */
    sourceRef: text('source_ref'),
    /** Set when the waste came from scrapping stock. */
    stockEntryId: uuid('stock_entry_id').references(() => stockEntry.id),
    disposalMethod: wasteDisposalMethod('disposal_method'),
    /** Disposed: the customer, buyer, recycler or TSDF that received it. */
    counterpartyId: uuid('counterparty_id').references(() => party.id),
    /** Challan, invoice or hazardous-waste manifest (Form 10) number. */
    documentNo: text('document_no'),
    /** Customer's written consent for disposing of their waste other than by return. */
    consentRef: text('consent_ref'),
    remarks: text('remarks'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by').references(() => user.id),
    cancelReason: text('cancel_reason'),
  },
  (t) => [index('waste_entity_idx').on(t.entityId, t.category, t.ownerPartyId), index('waste_stock_entry_idx').on(t.stockEntryId)],
);
