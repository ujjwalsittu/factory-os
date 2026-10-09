// Manufacturing slice 2d (decision 048): inspection plans and records, FAI (AS9102), NCR/MRB dispositions,
// calibration register and attachments stored in S3-compatible object storage (Cloudflare R2).
// Results, calibration events and attachments are append-only.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { batch, docStatus, stockEntry, warehouse } from './inventory.js';
import { bomStatus, workOrder, workOrderOperation } from './manufacturing.js';
import { item, qty } from './masters.js';
import { legalEntity, tenant } from './platform.js';

const scope = {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => legalEntity.id),
};
const created = {
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

export const inspectionStage = pgEnum('inspection_stage', ['incoming', 'in_process', 'final']);
export const characteristicKind = pgEnum('characteristic_kind', ['dimension', 'visual', 'functional', 'document']);

/** Revisioned like BOMs: draft → active → obsolete. Records freeze the plan they used. */
export const inspectionPlan = pgTable(
  'inspection_plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    stage: inspectionStage('stage').notNull(),
    /** In-process plans: the routing sequence they check. */
    operationSeq: integer('operation_seq'),
    revision: text('revision').notNull(),
    status: bomStatus('status').notNull().default('draft'),
    remarks: text('remarks'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('inspection_plan_rev_uq').on(t.entityId, t.itemId, t.stage, sql`coalesce(${t.operationSeq}, 0)`, t.revision),
    uniqueIndex('inspection_plan_active_uq').on(t.entityId, t.itemId, t.stage, sql`coalesce(${t.operationSeq}, 0)`).where(sql`${t.status} = 'active'`),
    check('inspection_plan_seq_ck', sql`(${t.stage} = 'in_process') = (${t.operationSeq} is not null)`),
  ],
);

export const inspectionCharacteristic = pgTable(
  'inspection_characteristic',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => inspectionPlan.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    /** Drawing balloon number (AS9102 Form 3). */
    balloon: text('balloon'),
    description: text('description').notNull(),
    kind: characteristicKind('kind').notNull(),
    nominal: qty('nominal'),
    lowerLimit: qty('lower_limit'),
    upperLimit: qty('upper_limit'),
    unit: text('unit'),
    method: text('method'),
    /** Key characteristic (AS9100 8.1.2). */
    isKey: boolean('is_key').notNull().default(false),
    /** Samples per lot; null = every piece. */
    sampleSize: integer('sample_size'),
  },
  (t) => [uniqueIndex('inspection_characteristic_line_uq').on(t.planId, t.lineNo), check('inspection_characteristic_limits_ck', sql`${t.lowerLimit} is null or ${t.upperLimit} is null or ${t.lowerLimit} <= ${t.upperLimit}`)],
);

export const inspectionSource = pgEnum('inspection_source', ['receipt', 'job_work_receipt', 'operation', 'output', 'manual']);
export const inspectionOutcome = pgEnum('inspection_outcome', ['pass', 'fail', 'partial']);

export const inspectionRecord = pgTable(
  'inspection_record',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    number: text('number'),
    stage: inspectionStage('stage').notNull(),
    status: docStatus('status').notNull().default('draft'),
    planId: uuid('plan_id').references(() => inspectionPlan.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    batchId: uuid('batch_id').references(() => batch.id),
    qty: qty('qty').notNull(),
    sourceType: inspectionSource('source_type').notNull(),
    /** Receipt line / job work receipt line / work-order operation / output stock entry line. */
    sourceId: uuid('source_id'),
    workOrderId: uuid('work_order_id').references(() => workOrder.id),
    operationId: uuid('operation_id').references(() => workOrderOperation.id),
    /** Where the stock waits (quarantine) and where accepted stock goes. */
    holdWarehouseId: uuid('hold_warehouse_id').references(() => warehouse.id),
    acceptWarehouseId: uuid('accept_warehouse_id').references(() => warehouse.id),
    outcome: inspectionOutcome('outcome'),
    qtyAccepted: qty('qty_accepted').notNull().default('0'),
    qtyRejected: qty('qty_rejected').notNull().default('0'),
    transferEntryId: uuid('transfer_entry_id').references(() => stockEntry.id),
    remarks: text('remarks'),
    submittedBy: text('submitted_by').references(() => user.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    ...created,
  },
  (t) => [
    uniqueIndex('inspection_record_number_uq').on(t.entityId, t.number),
    index('inspection_record_source_idx').on(t.sourceType, t.sourceId),
    index('inspection_record_item_idx').on(t.entityId, t.itemId, t.stage),
    check('inspection_record_qty_ck', sql`${t.qty} > 0 and ${t.qtyAccepted} + ${t.qtyRejected} <= ${t.qty}`),
  ],
);

/** One row per characteristic per sample. Append-only. */
export const inspectionMeasurement = pgTable(
  'inspection_measurement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => inspectionRecord.id),
    characteristicId: uuid('characteristic_id').references(() => inspectionCharacteristic.id),
    /** Free-text check when there is no plan. */
    description: text('description'),
    sampleNo: integer('sample_no').notNull().default(1),
    measured: qty('measured'),
    pass: boolean('pass').notNull(),
    gaugeId: uuid('gauge_id'),
    /** The gauge's due date when used (evidence that it was in calibration). */
    gaugeDueDate: date('gauge_due_date'),
    note: text('note'),
    ...created,
  },
  (t) => [index('inspection_measurement_record_idx').on(t.recordId), index('inspection_measurement_gauge_idx').on(t.gaugeId)],
);

export const faiReason = pgEnum('fai_reason', ['first_build', 'revision_change', 'process_change', 'lapse']);
export const faiStatus = pgEnum('fai_status', ['draft', 'submitted', 'approved', 'rejected']);

/** First article inspection (AS9102 Forms 1–3). Forms 1–2 are frozen into `forms` on submit. */
export const fai = pgTable(
  'fai',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    number: text('number'),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    itemRevision: text('item_revision'),
    /** The serial or lot of the first article. */
    batchId: uuid('batch_id').references(() => batch.id),
    reason: faiReason('reason').notNull(),
    status: faiStatus('status').notNull().default('draft'),
    /** Form 3 results: the final inspection of the first article. */
    inspectionRecordId: uuid('inspection_record_id').references(() => inspectionRecord.id),
    forms: jsonb('forms').$type<Record<string, unknown>>(),
    remarks: text('remarks'),
    submittedBy: text('submitted_by').references(() => user.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedBy: text('decided_by').references(() => user.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ...created,
  },
  (t) => [uniqueIndex('fai_number_uq').on(t.entityId, t.number), index('fai_item_idx').on(t.entityId, t.itemId, t.status)],
);

export const ncrStatus = pgEnum('ncr_status', ['open', 'dispositioned', 'closed', 'cancelled']);
export const ncrDispositionKind = pgEnum('ncr_disposition_kind', ['use_as_is', 'rework', 'repair', 'scrap', 'return_to_vendor']);
export const ncrDispositionStatus = pgEnum('ncr_disposition_status', ['proposed', 'approved', 'posted', 'cancelled']);

export const ncr = pgTable(
  'ncr',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    number: text('number'),
    status: ncrStatus('status').notNull().default('open'),
    inspectionRecordId: uuid('inspection_record_id').references(() => inspectionRecord.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    batchId: uuid('batch_id').references(() => batch.id),
    qty: qty('qty').notNull(),
    /** Where the stock was, and the MRB hold it moved to. */
    fromWarehouseId: uuid('from_warehouse_id').references(() => warehouse.id),
    mrbWarehouseId: uuid('mrb_warehouse_id').references(() => warehouse.id),
    holdEntryId: uuid('hold_entry_id').references(() => stockEntry.id),
    /** Nonconforming work in progress (in-process NCR) rather than stock. */
    workOrderId: uuid('work_order_id').references(() => workOrder.id),
    description: text('description').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...created,
  },
  (t) => [uniqueIndex('ncr_number_uq').on(t.entityId, t.number), index('ncr_status_idx').on(t.entityId, t.status), check('ncr_qty_ck', sql`${t.qty} > 0`)],
);

export const ncrDisposition = pgTable(
  'ncr_disposition',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ncrId: uuid('ncr_id')
      .notNull()
      .references(() => ncr.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    kind: ncrDispositionKind('kind').notNull(),
    qty: qty('qty').notNull(),
    status: ncrDispositionStatus('status').notNull().default('proposed'),
    /** Use-as-is: customer/engineering concession reference. */
    concessionRef: text('concession_ref'),
    wasteCategory: text('waste_category'),
    note: text('note'),
    proposedBy: text('proposed_by')
      .notNull()
      .references(() => user.id),
    approvedBy: text('approved_by').references(() => user.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    stockEntryId: uuid('stock_entry_id').references(() => stockEntry.id),
    workOrderId: uuid('work_order_id').references(() => workOrder.id),
    returnClaimId: uuid('return_claim_id'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('ncr_disposition_line_uq').on(t.ncrId, t.lineNo), check('ncr_disposition_qty_ck', sql`${t.qty} > 0`)],
);

export const gaugeStatus = pgEnum('gauge_status', ['in_service', 'out_of_service', 'failed']);
export const calibrationResult = pgEnum('calibration_result', ['pass', 'adjusted', 'fail']);

export const gauge = pgTable(
  'gauge',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    code: text('code').notNull(),
    description: text('description').notNull(),
    type: text('type'),
    location: text('location'),
    intervalDays: integer('interval_days').notNull(),
    lastCalibrated: date('last_calibrated'),
    dueDate: date('due_date'),
    status: gaugeStatus('status').notNull().default('in_service'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('gauge_code_uq').on(t.entityId, t.code), check('gauge_interval_ck', sql`${t.intervalDays} > 0`)],
);

/** Append-only calibration history; the gauge row carries the current due date. */
export const calibrationEvent = pgTable(
  'calibration_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    gaugeId: uuid('gauge_id')
      .notNull()
      .references(() => gauge.id),
    calibratedOn: date('calibrated_on').notNull(),
    result: calibrationResult('result').notNull(),
    agency: text('agency'),
    certificateNo: text('certificate_no'),
    nextDue: date('next_due'),
    note: text('note'),
    ...created,
  },
  (t) => [index('calibration_event_gauge_idx').on(t.gaugeId, t.calibratedOn)],
);

export const attachmentKind = pgEnum('attachment_kind', ['mtc', 'coc', 'coa', 'fai', 'cmm', 'photo', 'calibration', 'drawing', 'other']);

/** A file in object storage, owned by a document. Append-only; removal is a withdrawal with a reason. */
export const attachment = pgTable(
  'attachment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    ownerType: text('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    kind: attachmentKind('kind').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    objectKey: text('object_key').notNull(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnBy: text('withdrawn_by').references(() => user.id),
    withdrawReason: text('withdraw_reason'),
    ...created,
  },
  (t) => [index('attachment_owner_idx').on(t.ownerType, t.ownerId), uniqueIndex('attachment_object_uq').on(t.objectKey), check('attachment_size_ck', sql`${t.size} > 0`)],
);
