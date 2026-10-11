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
    /** Decision 057: a chamber booked for a test campaign is billed with the campaign, never by the hour. */
    campaignId: uuid('campaign_id'),
    /** Decision 058: a booking for a project is billed through the project's milestones. */
    projectId: uuid('project_id').references(() => project.id),
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

export const testCampaignStatus = pgEnum('test_campaign_status', ['draft', 'active', 'reported', 'closed', 'cancelled']);

/** Decision 057: a test service order quoted as a lump sum, with the customer's payload held in custody. */
export const testCampaign = pgTable(
  'test_campaign',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    number: text('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => party.id),
    title: text('title').notNull(),
    scope: text('scope'),
    customerRef: text('customer_ref'),
    /** Service item (SAC) of the quoted line. */
    serviceItemId: uuid('service_item_id')
      .notNull()
      .references(() => item.id),
    quotedAmount: money('quoted_amount').notNull(),
    status: testCampaignStatus('status').notNull().default('draft'),
    cancelReason: text('cancel_reason'),
    reportSummary: text('report_summary'),
    reportApprovedBy: text('report_approved_by').references(() => user.id),
    reportApprovedAt: timestamp('report_approved_at', { withTimezone: true }),
    salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoice.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Decision 058: a campaign for a project is billed through the project's milestones. */
    projectId: uuid('project_id').references(() => project.id),
    ...stamps,
  },
  (t) => [
    uniqueIndex('test_campaign_number_uq').on(t.entityId, t.number),
    index('test_campaign_customer_idx').on(t.customerId),
    check('test_campaign_amount_ck', sql`${t.quotedAmount} >= 0`),
  ],
);

export const testStepResult = pgEnum('test_step_result', ['pending', 'pass', 'fail', 'na']);

export const testCampaignStep = pgTable(
  'test_campaign_step',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => testCampaign.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
    requirement: text('requirement'),
    result: testStepResult('result').notNull().default('pending'),
    measured: text('measured'),
    notes: text('notes'),
    recordedBy: text('recorded_by').references(() => user.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('test_campaign_step_seq_uq').on(t.campaignId, t.seq)],
);

export const testCampaignExtra = pgTable(
  'test_campaign_extra',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => testCampaign.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull(),
    rate: money('rate').notNull(),
    serviceItemId: uuid('service_item_id')
      .notNull()
      .references(() => item.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('test_campaign_extra_ck', sql`${t.qty} > 0 and ${t.rate} >= 0`)],
);

/** The customer's goods in our custody for a campaign: not stock, never valued. */
export const custodyItem = pgTable(
  'custody_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => testCampaign.id),
    description: text('description').notNull(),
    serialNo: text('serial_no'),
    qty: integer('qty').notNull().default(1),
    inwardChallanNo: text('inward_challan_no').notNull(),
    receivedCondition: text('received_condition').notNull(),
    receivedBy: text('received_by')
      .notNull()
      .references(() => user.id),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    outwardChallanNo: text('outward_challan_no'),
    returnCondition: text('return_condition'),
    returnedBy: text('returned_by').references(() => user.id),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
  },
  (t) => [index('custody_item_campaign_idx').on(t.campaignId), check('custody_item_qty_ck', sql`${t.qty} > 0`)],
);

// Phase 3d (decision 058): projects billed by milestones (full tax invoices) with retention withheld by the customer;
// actual cost from linked work orders, purchase invoice lines, bookings and approved timesheets.

export const projectStatus = pgEnum('project_status', ['draft', 'active', 'completed', 'closed', 'cancelled']);

export const project = pgTable(
  'project',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    number: text('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => party.id),
    title: text('title').notNull(),
    description: text('description'),
    /** The customer's PO, work order or letter of award. */
    customerRef: text('customer_ref'),
    managerUserId: text('manager_user_id').references(() => user.id),
    /** Service item (SAC) of the milestone invoices. */
    serviceItemId: uuid('service_item_id')
      .notNull()
      .references(() => item.id),
    /** Before GST; the milestones add up to it. */
    contractValue: money('contract_value').notNull(),
    retentionPct: numeric('retention_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    /** Defect liability period: retention falls due this many months after completion. */
    dlpMonths: integer('dlp_months').notNull().default(0),
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: projectStatus('status').notNull().default('draft'),
    cancelReason: text('cancel_reason'),
    completedOn: date('completed_on'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...stamps,
  },
  (t) => [
    uniqueIndex('project_number_uq').on(t.entityId, t.number),
    index('project_customer_idx').on(t.customerId),
    check('project_value_ck', sql`${t.contractValue} > 0`),
    check('project_retention_ck', sql`${t.retentionPct} between 0 and 50`),
    check('project_dlp_ck', sql`${t.dlpMonths} between 0 and 60`),
  ],
);

export const projectCostCategory = pgEnum('project_cost_category', ['material', 'machine', 'labour', 'bought_in', 'other']);

export const projectBudget = pgTable(
  'project_budget',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    category: projectCostCategory('category').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [uniqueIndex('project_budget_uq').on(t.projectId, t.category), check('project_budget_ck', sql`${t.amount} >= 0`)],
);

export const projectMilestone = pgTable(
  'project_milestone',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
    dueDate: date('due_date'),
    /** Before GST. */
    amount: money('amount').notNull(),
    achievedOn: date('achieved_on'),
    acceptanceRef: text('acceptance_ref'),
    achievedBy: text('achieved_by').references(() => user.id),
    /** The milestone counts as invoiced while this invoice is live; a deleted draft frees it. */
    salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoice.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('project_milestone_seq_uq').on(t.projectId, t.seq), check('project_milestone_amount_ck', sql`${t.amount} > 0`)],
);

/** Retention the customer withholds from a milestone invoice; it counts while that invoice is live. */
export const projectRetention = pgTable(
  'project_retention',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    milestoneId: uuid('milestone_id')
      .notNull()
      .references(() => projectMilestone.id),
    salesInvoiceId: uuid('sales_invoice_id').notNull(),
    amount: money('amount').notNull(),
    releasedOn: date('released_on'),
    releaseRef: text('release_ref'),
    releasedBy: text('released_by').references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('project_retention_invoice_uq').on(t.salesInvoiceId), index('project_retention_project_idx').on(t.projectId), check('project_retention_ck', sql`${t.amount} > 0`)],
);

/** Hourly cost of a member's time from a date; append-only (a new rate is a new row). Salary-sensitive. */
export const projectCostRate = pgTable(
  'project_cost_rate',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    hourlyRate: money('hourly_rate').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('project_cost_rate_uq').on(t.entityId, t.userId, t.effectiveFrom), check('project_cost_rate_ck', sql`${t.hourlyRate} >= 0`)],
);

export const timesheetStatus = pgEnum('timesheet_status', ['draft', 'submitted', 'approved']);

export const timesheetEntry = pgTable(
  'timesheet_entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    milestoneId: uuid('milestone_id').references(() => projectMilestone.id, { onDelete: 'set null' }),
    workDate: date('work_date').notNull(),
    /** Quarter hours; negative only on a reversal of an approved entry. */
    hours: numeric('hours', { precision: 6, scale: 2 }).notNull(),
    notes: text('notes'),
    status: timesheetStatus('status').notNull().default('draft'),
    rejectReason: text('reject_reason'),
    approvedBy: text('approved_by').references(() => user.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** Snapshotted at approval from the rate effective on the work date. */
    costRate: money('cost_rate'),
    costAmount: money('cost_amount'),
    reversalOf: uuid('reversal_of'),
    ...stamps,
  },
  (t) => [
    index('timesheet_entry_user_idx').on(t.entityId, t.userId, t.workDate),
    index('timesheet_entry_project_idx').on(t.projectId),
    uniqueIndex('timesheet_entry_reversal_uq').on(t.reversalOf),
    check('timesheet_entry_hours_ck', sql`${t.hours} <> 0 and abs(${t.hours}) <= 24 and mod(${t.hours} * 4, 1) = 0`),
  ],
);

// Phase 3e (decision 059): EarthNow subscriptions. A plan is a prepaid bundle of reports and alerts per period; the fee
// is invoiced in advance, overage on the next invoice, and an upgrade's fee difference is prorated by days.

export const subscriptionPeriod = pgEnum('subscription_period', ['month', 'quarter', 'year']);

export const subscriptionPlan = pgTable(
  'subscription_plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** What is monitored, e.g. crop health. */
    solution: text('solution').notNull(),
    period: subscriptionPeriod('period').notNull(),
    fee: money('fee').notNull(),
    includedReports: integer('included_reports').notNull().default(0),
    includedAlerts: integer('included_alerts').notNull().default(0),
    reportRate: money('report_rate').notNull().default('0'),
    alertRate: money('alert_rate').notNull().default('0'),
    serviceItemId: uuid('service_item_id')
      .notNull()
      .references(() => item.id),
    isActive: boolean('is_active').notNull().default(true),
    ...stamps,
  },
  (t) => [
    uniqueIndex('subscription_plan_code_uq').on(t.entityId, t.code),
    check('subscription_plan_ck', sql`${t.fee} >= 0 and ${t.includedReports} >= 0 and ${t.includedAlerts} >= 0 and ${t.reportRate} >= 0 and ${t.alertRate} >= 0`),
  ],
);

export const subscriptionStatus = pgEnum('subscription_status', ['active', 'cancelled']);

export const subscription = pgTable(
  'subscription',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    number: text('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => party.id),
    customerRef: text('customer_ref'),
    /** The plan in force now; earlier plans are in the change history. */
    planId: uuid('plan_id')
      .notNull()
      .references(() => subscriptionPlan.id),
    aoiName: text('aoi_name').notNull(),
    aoiHectares: numeric('aoi_hectares', { precision: 14, scale: 2 }),
    aoiNotes: text('aoi_notes'),
    /** Anchors the periods. */
    startDate: date('start_date').notNull(),
    /** Last day of the last period, once cancelled. */
    endDate: date('end_date'),
    status: subscriptionStatus('status').notNull().default('active'),
    cancelReason: text('cancel_reason'),
    ...stamps,
  },
  (t) => [uniqueIndex('subscription_number_uq').on(t.entityId, t.number), index('subscription_customer_idx').on(t.customerId), check('subscription_aoi_ck', sql`${t.aoiHectares} is null or ${t.aoiHectares} > 0`)],
);

/** Append-only plan history. An upgrade carries its prorated charge until an invoice takes it. */
export const subscriptionPlanChange = pgTable(
  'subscription_plan_change',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscription.id),
    fromPlanId: uuid('from_plan_id')
      .notNull()
      .references(() => subscriptionPlan.id),
    toPlanId: uuid('to_plan_id')
      .notNull()
      .references(() => subscriptionPlan.id),
    effectiveOn: date('effective_on').notNull(),
    prorationAmount: money('proration_amount').notNull().default('0'),
    /** The invoice that charged the proration; a deleted draft frees it. */
    salesInvoiceId: uuid('sales_invoice_id').references(() => salesInvoice.id, { onDelete: 'set null' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('subscription_plan_change_sub_idx').on(t.subscriptionId, t.effectiveOn), check('subscription_plan_change_ck', sql`${t.prorationAmount} >= 0`)],
);

export const subscriptionDeliveryKind = pgEnum('subscription_delivery_kind', ['report', 'alert']);

/** Reports and alerts delivered, append-only: a wrong entry is cancelled by a reversal row. */
export const subscriptionDelivery = pgTable(
  'subscription_delivery',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscription.id),
    kind: subscriptionDeliveryKind('kind').notNull(),
    deliveredOn: date('delivered_on').notNull(),
    title: text('title').notNull(),
    reference: text('reference'),
    reversalOf: uuid('reversal_of'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('subscription_delivery_sub_idx').on(t.subscriptionId, t.deliveredOn), uniqueIndex('subscription_delivery_reversal_uq').on(t.reversalOf)],
);

/** What each invoice carried: a period's fee, the previous period's overage. Counts while its invoice is live. */
export const subscriptionInvoice = pgTable(
  'subscription_invoice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscription.id),
    salesInvoiceId: uuid('sales_invoice_id').notNull(),
    feePeriodStart: date('fee_period_start'),
    feeAmount: money('fee_amount').notNull().default('0'),
    overagePeriodStart: date('overage_period_start'),
    overageReports: integer('overage_reports').notNull().default(0),
    overageAlerts: integer('overage_alerts').notNull().default(0),
    overageAmount: money('overage_amount').notNull().default('0'),
    prorationAmount: money('proration_amount').notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('subscription_invoice_sub_idx').on(t.subscriptionId), uniqueIndex('subscription_invoice_si_uq').on(t.salesInvoiceId)],
);
