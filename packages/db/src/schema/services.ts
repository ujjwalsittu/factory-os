// Phase 3a (decision 055): machine-hour MaaS. Rate cards price a machine per hour; bookings reserve it (a confirmed
// booking holds a `booking` machine block that production is scheduled around); usage is append-only; a completed
// booking is billed through a draft sales invoice.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { machine } from './manufacturing.js';
import { item, party } from './masters.js';
import { legalEntity, tenant } from './platform.js';
import { machineBlock } from './scheduling.js';
import { salesInvoice } from './selling.js';

const scope = {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => legalEntity.id),
};
const stamps = {
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });

/** Hourly price of one machine over a validity period; the API refuses overlapping periods per machine. */
export const maasRateCard = pgTable(
  'maas_rate_card',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machine.id),
    /** Service item (SAC) that becomes the invoice line. */
    serviceItemId: uuid('service_item_id')
      .notNull()
      .references(() => item.id),
    standardRate: money('standard_rate').notNull(),
    memberRate: money('member_rate'),
    minimumMinutes: integer('minimum_minutes').notNull().default(0),
    /** 6, 12, 15, 30 or 60, so billed hours are exact. */
    roundingMinutes: integer('rounding_minutes').notNull().default(15),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    ...stamps,
  },
  (t) => [
    index('maas_rate_card_machine_idx').on(t.machineId, t.validFrom),
    check('maas_rate_card_rounding_ck', sql`${t.roundingMinutes} in (6, 12, 15, 30, 60)`),
    check('maas_rate_card_minimum_ck', sql`${t.minimumMinutes} >= 0 and ${t.minimumMinutes} % ${t.roundingMinutes} = 0`),
    check('maas_rate_card_rates_ck', sql`${t.standardRate} > 0 and (${t.memberRate} is null or ${t.memberRate} > 0)`),
    check('maas_rate_card_validity_ck', sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
  ],
);

export const maasBookingStatus = pgEnum('maas_booking_status', ['tentative', 'confirmed', 'in_use', 'completed', 'cancelled']);

/** A customer's reservation of a machine. */
export const maasBooking = pgTable(
  'maas_booking',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    number: text('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => party.id),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machine.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: maasBookingStatus('status').notNull().default('tentative'),
    purpose: text('purpose'),
    /** The reservation while confirmed or in use. */
    machineBlockId: uuid('machine_block_id').references(() => machineBlock.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    /** The invoice raised for it; a deleted draft frees the booking. */
    salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoice.id, { onDelete: 'set null' }),
    /** Decision 056: set once billed (by membership hours, an invoice, or both); cleared by a reversal. */
    billedAt: timestamp('billed_at', { withTimezone: true }),
    ...stamps,
  },
  (t) => [
    uniqueIndex('maas_booking_number_uq').on(t.entityId, t.number),
    index('maas_booking_machine_idx').on(t.machineId, t.startsAt),
    index('maas_booking_customer_idx').on(t.customerId),
    check('maas_booking_period_ck', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const maasUsageSource = pgEnum('maas_usage_source', ['timer', 'manual']);

/** Recorded machine time, append-only: a correction is a new row (negative minutes allowed with a note). */
export const maasUsage = pgTable(
  'maas_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // No cascade: usage is append-only, so (like other ledgers) it keeps its tenant rather than vanishing with it.
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => maasBooking.id),
    minutes: integer('minutes').notNull(),
    source: maasUsageSource('source').notNull(),
    note: text('note'),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => user.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('maas_usage_booking_idx').on(t.bookingId), check('maas_usage_minutes_ck', sql`${t.minutes} <> 0`)],
);

/** Decision 056: a membership plan — a pool of machine-hours for a term, with a fee invoiced upfront. */
export const maasPlan = pgTable(
  'maas_plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** Whole hours in minutes, so remaining hours stay exact. */
    includedMinutes: integer('included_minutes').notNull(),
    termMonths: integer('term_months').notNull(),
    fee: money('fee').notNull(),
    /** Service item (SAC) that becomes the fee invoice line. */
    serviceItemId: uuid('service_item_id')
      .notNull()
      .references(() => item.id),
    isActive: boolean('is_active').notNull().default(true),
    ...stamps,
  },
  (t) => [
    uniqueIndex('maas_plan_code_uq').on(t.entityId, t.code),
    check('maas_plan_minutes_ck', sql`${t.includedMinutes} > 0 and ${t.includedMinutes} % 60 = 0`),
    check('maas_plan_term_ck', sql`${t.termMonths} between 1 and 60`),
    check('maas_plan_fee_ck', sql`${t.fee} >= 0`),
  ],
);

export const maasMembershipStatus = pgEnum('maas_membership_status', ['active', 'cancelled']);

/** A customer's membership for one term; hours and fee are copied from the plan. */
export const maasMembership = pgTable(
  'maas_membership',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    number: text('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => party.id),
    planId: uuid('plan_id')
      .notNull()
      .references(() => maasPlan.id),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    includedMinutes: integer('included_minutes').notNull(),
    fee: money('fee').notNull(),
    status: maasMembershipStatus('status').notNull().default('active'),
    cancelReason: text('cancel_reason'),
    /** The fee invoice; a deleted draft leaves it empty. */
    salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoice.id, { onDelete: 'set null' }),
    ...stamps,
  },
  (t) => [
    uniqueIndex('maas_membership_number_uq').on(t.entityId, t.number),
    index('maas_membership_customer_idx').on(t.customerId, t.startsOn),
    check('maas_membership_term_ck', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

/** Hours drawn by a booking from a membership; append-only, a reversal is a negative row pointing at the draw. */
export const maasMembershipDraw = pgTable(
  'maas_membership_draw',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // No cascade: append-only, like usage.
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => maasMembership.id),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => maasBooking.id),
    minutes: integer('minutes').notNull(),
    reversalOf: uuid('reversal_of'),
    reason: text('reason'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('maas_membership_draw_membership_idx').on(t.membershipId),
    index('maas_membership_draw_booking_idx').on(t.bookingId),
    uniqueIndex('maas_membership_draw_reversal_uq').on(t.reversalOf),
    check('maas_membership_draw_minutes_ck', sql`(${t.reversalOf} is null and ${t.minutes} > 0) or (${t.reversalOf} is not null and ${t.minutes} < 0)`),
  ],
);
