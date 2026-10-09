// Quality (decision 048): inspection plans, calibration register, inspection records with the final and incoming
// gates, and NCR/MRB. Stock moves through system stock entries; the NCR controller orchestrates rework orders.
import { addDays, Dec, gaugeBlock, inspectionOutcome, withinLimits } from '@factoryos/core';
import {
  calibrationEvent,
  type Database,
  gauge,
  inspectionCharacteristic,
  inspectionMeasurement,
  inspectionPlan,
  inspectionRecord,
  item,
  ncr,
  ncrDisposition,
  purchaseInvoice,
  purchaseInvoiceLine,
  receiptInvoiceAllocation,
  stockEntry,
  stockEntryLine,
  warehouse,
} from '@factoryos/db';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { businessDate, lockAccounting, type Tx } from '../accounting/accounting-lock.js';
import { StockPostingService } from '../stock-posting.service.js';
import { SupplierReturnClaimService } from '../supplier-returns/claim.service.js';

type Stage = 'incoming' | 'in_process' | 'final';
export interface CharacteristicInput {
  balloon?: string | null;
  description: string;
  kind: 'dimension' | 'visual' | 'functional' | 'document';
  nominal?: string | null;
  lowerLimit?: string | null;
  upperLimit?: string | null;
  unit?: string | null;
  method?: string | null;
  isKey?: boolean;
  sampleSize?: number | null;
}
export interface PlanInput {
  itemId: string;
  stage: Stage;
  operationSeq?: number | null;
  revision: string;
  remarks?: string | null;
  characteristics: CharacteristicInput[];
}
export interface MeasurementInput {
  characteristicId?: string | null;
  description?: string | null;
  sampleNo?: number;
  measured?: string | null;
  pass?: boolean | null;
  gaugeId?: string | null;
  note?: string | null;
}
export interface DispositionInput {
  kind: 'use_as_is' | 'rework' | 'repair' | 'scrap' | 'return_to_vendor';
  qty: string;
  concessionRef?: string | null;
  wasteCategory?: string | null;
  note?: string | null;
}

@Injectable()
export class QualityService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
    private readonly claims: SupplierReturnClaimService,
  ) {}

  run<T>(entityId: string, f: (tx: Tx) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      return f(tx);
    });
  }

  // Plans ------------------------------------------------------------------------------------------------

  async savePlanIn(tx: Tx, ctx: TenantRequestContext, entityId: string, input: PlanInput, id?: string) {
    const [it] = await tx.select().from(item).where(and(eq(item.id, input.itemId), eq(item.tenantId, ctx.tenant.tenantId)));
    if (!it) throw new BadRequestException({ message: 'Unknown item', issues: [{ path: 'itemId', message: 'Unknown item' }] });
    if ((input.stage === 'in_process') !== (input.operationSeq !== null && input.operationSeq !== undefined))
      throw new BadRequestException({ message: 'An in-process plan names its routing operation; other plans do not', issues: [{ path: 'operationSeq', message: 'Check the operation' }] });
    if (!input.characteristics.length) throw new BadRequestException({ message: 'Add at least one characteristic', issues: [{ path: 'characteristics', message: 'Required' }] });
    input.characteristics.forEach((c, i) => {
      if (c.lowerLimit && c.upperLimit && Dec.of(c.lowerLimit).gt(c.upperLimit)) throw new BadRequestException({ message: `Characteristic ${i + 1}: the lower limit is above the upper limit`, issues: [{ path: `characteristics.${i}.lowerLimit`, message: 'Above the upper limit' }] });
    });
    let planId = id;
    if (id) {
      const p = await this.lockPlan(tx, entityId, id);
      if (p.status !== 'draft') throw new ConflictException('Only draft plans can be edited; copy it to a new revision');
      await tx.update(inspectionPlan).set({ itemId: it.id, stage: input.stage, operationSeq: input.operationSeq ?? null, revision: input.revision, remarks: input.remarks ?? null, updatedAt: new Date() }).where(eq(inspectionPlan.id, id));
      await tx.delete(inspectionCharacteristic).where(eq(inspectionCharacteristic.planId, id));
    } else {
      const [dup] = await tx
        .select({ id: inspectionPlan.id })
        .from(inspectionPlan)
        .where(and(eq(inspectionPlan.entityId, entityId), eq(inspectionPlan.itemId, it.id), eq(inspectionPlan.stage, input.stage), sql`coalesce(${inspectionPlan.operationSeq}, 0) = ${input.operationSeq ?? 0}`, eq(inspectionPlan.revision, input.revision)));
      if (dup) throw new ConflictException(`Revision ${input.revision} of this plan already exists`);
      const [p] = await tx
        .insert(inspectionPlan)
        .values({ tenantId: ctx.tenant.tenantId, entityId, itemId: it.id, stage: input.stage, operationSeq: input.operationSeq ?? null, revision: input.revision, remarks: input.remarks ?? null, createdBy: ctx.user.id })
        .returning();
      planId = p!.id;
    }
    await tx.insert(inspectionCharacteristic).values(
      input.characteristics.map((c, i) => ({
        planId: planId!,
        lineNo: i + 1,
        balloon: c.balloon ?? null,
        description: c.description,
        kind: c.kind,
        nominal: c.nominal ?? null,
        lowerLimit: c.lowerLimit ?? null,
        upperLimit: c.upperLimit ?? null,
        unit: c.unit ?? null,
        method: c.method ?? null,
        isKey: c.isKey ?? false,
        sampleSize: c.sampleSize ?? null,
      })),
    );
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: id ? 'inspection_plan.update' : 'inspection_plan.create', targetType: 'inspection_plan', targetId: planId!, after: { item: it.code, stage: input.stage, revision: input.revision } }, tx);
    return planId!;
  }

  /** Activating obsoletes the previously active revision of the same item, stage and operation. */
  async activatePlanIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string) {
    const p = await this.lockPlan(tx, entityId, id);
    if (p.status !== 'draft') throw new ConflictException(`Only drafts can be activated (this one is ${p.status})`);
    await tx
      .update(inspectionPlan)
      .set({ status: 'obsolete', updatedAt: new Date() })
      .where(and(eq(inspectionPlan.entityId, entityId), eq(inspectionPlan.itemId, p.itemId), eq(inspectionPlan.stage, p.stage), sql`coalesce(${inspectionPlan.operationSeq}, 0) = ${p.operationSeq ?? 0}`, eq(inspectionPlan.status, 'active')));
    await tx.update(inspectionPlan).set({ status: 'active', updatedAt: new Date() }).where(eq(inspectionPlan.id, id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'inspection_plan.activate', targetType: 'inspection_plan', targetId: id }, tx);
  }

  async activePlan(db: Database | Tx, entityId: string, itemId: string, stage: Stage, operationSeq: number | null = null) {
    const [p] = await db
      .select()
      .from(inspectionPlan)
      .where(and(eq(inspectionPlan.entityId, entityId), eq(inspectionPlan.itemId, itemId), eq(inspectionPlan.stage, stage), sql`coalesce(${inspectionPlan.operationSeq}, 0) = ${operationSeq ?? 0}`, eq(inspectionPlan.status, 'active')));
    return p ?? null;
  }

  private async lockPlan(tx: Tx, entityId: string, id: string) {
    const [p] = await tx.select().from(inspectionPlan).where(and(eq(inspectionPlan.id, id), eq(inspectionPlan.entityId, entityId))).for('update');
    if (!p) throw new NotFoundException('Inspection plan not found');
    return p;
  }

  // Gauges -----------------------------------------------------------------------------------------------

  async createGaugeIn(tx: Tx, ctx: TenantRequestContext, entityId: string, input: { code: string; description: string; type?: string | null; location?: string | null; intervalDays: number; lastCalibrated?: string | null }) {
    const [dup] = await tx.select({ id: gauge.id }).from(gauge).where(and(eq(gauge.entityId, entityId), eq(gauge.code, input.code)));
    if (dup) throw new ConflictException({ message: `Gauge ${input.code} already exists`, issues: [{ path: 'code', message: 'Already used' }] });
    const [g] = await tx
      .insert(gauge)
      .values({ tenantId: ctx.tenant.tenantId, entityId, code: input.code, description: input.description, type: input.type ?? null, location: input.location ?? null, intervalDays: input.intervalDays, lastCalibrated: input.lastCalibrated ?? null, dueDate: input.lastCalibrated ? addDays(input.lastCalibrated, input.intervalDays) : null, createdBy: ctx.user.id })
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'gauge.create', targetType: 'gauge', targetId: g!.id, after: input }, tx);
    return g!;
  }

  async updateGaugeIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, input: { description?: string; type?: string | null; location?: string | null; intervalDays?: number; inService?: boolean }) {
    const g = await this.lockGauge(tx, entityId, id);
    if (input.inService !== undefined && g.status === 'failed') throw new ConflictException('A failed gauge returns to service with a passing calibration');
    const [after] = await tx
      .update(gauge)
      .set({
        description: input.description ?? g.description,
        type: input.type === undefined ? g.type : input.type,
        location: input.location === undefined ? g.location : input.location,
        intervalDays: input.intervalDays ?? g.intervalDays,
        status: input.inService === undefined ? g.status : input.inService ? 'in_service' : 'out_of_service',
        updatedAt: new Date(),
      })
      .where(eq(gauge.id, id))
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'gauge.update', targetType: 'gauge', targetId: id, before: g, after: input }, tx);
    return after!;
  }

  /**
   * Pass or adjusted: due again after the interval. Fail: the gauge is blocked and the inspection results that
   * used it since its last good calibration are returned for review.
   */
  async calibrateIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, input: { calibratedOn: string; result: 'pass' | 'adjusted' | 'fail'; agency?: string | null; certificateNo?: string | null; note?: string | null }) {
    const g = await this.lockGauge(tx, entityId, id);
    if (input.calibratedOn > businessDate()) throw new BadRequestException({ message: 'The calibration date is in the future', issues: [{ path: 'calibratedOn', message: 'In the future' }] });
    const nextDue = input.result === 'fail' ? null : addDays(input.calibratedOn, g.intervalDays);
    const [ev] = await tx
      .insert(calibrationEvent)
      .values({ tenantId: ctx.tenant.tenantId, entityId, gaugeId: id, calibratedOn: input.calibratedOn, result: input.result, agency: input.agency ?? null, certificateNo: input.certificateNo ?? null, nextDue, note: input.note ?? null, createdBy: ctx.user.id })
      .returning();
    const since = g.lastCalibrated;
    await tx
      .update(gauge)
      .set(input.result === 'fail' ? { status: 'failed', updatedAt: new Date() } : { status: 'in_service', lastCalibrated: input.calibratedOn, dueDate: nextDue, updatedAt: new Date() })
      .where(eq(gauge.id, id));
    const suspect =
      input.result === 'fail'
        ? await tx
            .selectDistinct({ id: inspectionRecord.id, number: inspectionRecord.number, itemId: inspectionRecord.itemId, batchId: inspectionRecord.batchId })
            .from(inspectionMeasurement)
            .innerJoin(inspectionRecord, eq(inspectionRecord.id, inspectionMeasurement.recordId))
            .where(and(eq(inspectionMeasurement.gaugeId, id), since ? sql`${inspectionMeasurement.createdAt}::date >= ${since}` : sql`true`))
        : [];
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'gauge.calibrate', targetType: 'gauge', targetId: id, after: { ...input, nextDue, suspect: suspect.length } }, tx);
    return { event: ev!, suspect };
  }

  private async lockGauge(tx: Tx, entityId: string, id: string) {
    const [g] = await tx.select().from(gauge).where(and(eq(gauge.id, id), eq(gauge.entityId, entityId))).for('update');
    if (!g) throw new NotFoundException('Gauge not found');
    return g;
  }

  // Inspection records -----------------------------------------------------------------------------------

  /** A record for stock waiting in a hold warehouse (final output, job work return) or for WIP / manual checks. */
  async openRecordIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    input: { stage: Stage; itemId: string; batchId?: string | null; qty: string; sourceType: 'receipt' | 'job_work_receipt' | 'operation' | 'output' | 'manual'; sourceId?: string | null; workOrderId?: string | null; operationId?: string | null; operationSeq?: number | null; holdWarehouseId?: string | null; acceptWarehouseId?: string | null; remarks?: string | null },
  ) {
    const plan = await this.activePlan(tx, entityId, input.itemId, input.stage, input.stage === 'in_process' ? (input.operationSeq ?? null) : null);
    const [r] = await tx
      .insert(inspectionRecord)
      .values({
        tenantId: ctx.tenant.tenantId,
        entityId,
        stage: input.stage,
        planId: plan?.id ?? null,
        itemId: input.itemId,
        batchId: input.batchId ?? null,
        qty: input.qty,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        workOrderId: input.workOrderId ?? null,
        operationId: input.operationId ?? null,
        holdWarehouseId: input.holdWarehouseId ?? null,
        acceptWarehouseId: input.acceptWarehouseId ?? null,
        remarks: input.remarks ?? null,
        createdBy: ctx.user.id,
      })
      .returning();
    return r!;
  }

  /** Appends measurements. Gauges must be in calibration today; limits decide pass/fail for measured values. */
  async measureIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, rows: MeasurementInput[]) {
    const r = await this.lockRecord(tx, entityId, id);
    if (r.status !== 'draft') throw new ConflictException('This inspection is already submitted');
    const chars = r.planId ? await tx.select().from(inspectionCharacteristic).where(eq(inspectionCharacteristic.planId, r.planId)) : [];
    const gaugeIds = [...new Set(rows.map((x) => x.gaugeId).filter((x): x is string => !!x))];
    const gauges = new Map((gaugeIds.length ? await tx.select().from(gauge).where(and(inArray(gauge.id, gaugeIds), eq(gauge.entityId, entityId))) : []).map((g) => [g.id, g]));
    const today = businessDate();
    const values = rows.map((m, i) => {
      const issue = (message: string, path = `results.${i}`) => new BadRequestException({ message: `Result ${i + 1}: ${message}`, issues: [{ path, message }] });
      const c = m.characteristicId ? chars.find((x) => x.id === m.characteristicId) : undefined;
      if (m.characteristicId && !c) throw issue('not a characteristic of this inspection plan');
      if (!c && !m.description?.trim()) throw issue('describe the check', `results.${i}.description`);
      let g: (typeof gauge.$inferSelect) | undefined;
      if (m.gaugeId) {
        g = gauges.get(m.gaugeId);
        if (!g) throw issue('unknown gauge', `results.${i}.gaugeId`);
        const block = gaugeBlock(g, today);
        if (block) throw issue(block, `results.${i}.gaugeId`);
      }
      const measured = m.measured?.trim() || null;
      let pass = m.pass ?? null;
      if (measured !== null) {
        if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(measured)) throw issue('enter a number', `results.${i}.measured`);
        if (c && (c.lowerLimit !== null || c.upperLimit !== null)) pass = withinLimits(measured, c.lowerLimit, c.upperLimit);
      }
      if (pass === null) throw issue('record pass or fail', `results.${i}.pass`);
      if (c && sampleLimit(c.sampleSize, r.qty) < (m.sampleNo ?? 1)) throw issue(`only ${sampleLimit(c.sampleSize, r.qty)} samples are planned`, `results.${i}.sampleNo`);
      return { recordId: r.id, characteristicId: c?.id ?? null, description: c ? null : m.description!.trim(), sampleNo: m.sampleNo ?? 1, measured, pass, gaugeId: g?.id ?? null, gaugeDueDate: g?.dueDate ?? null, note: m.note ?? null, createdBy: ctx.user.id };
    });
    if (values.length) await tx.insert(inspectionMeasurement).values(values);
    return values.map((v) => ({ characteristicId: v.characteristicId, sampleNo: v.sampleNo, pass: v.pass }));
  }

  /**
   * Submit: every planned characteristic has its samples measured. Accepted stock moves from the hold warehouse
   * to its destination; rejected stock (or WIP) is raised as an NCR.
   */
  async submitRecordIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, input: { qtyAccepted: string; qtyRejected: string; ncrDescription?: string | null; remarks?: string | null }) {
    const r = await this.lockRecord(tx, entityId, id);
    if (r.status !== 'draft') throw new ConflictException('This inspection is already submitted');
    let outcome: 'pass' | 'fail' | 'partial';
    try {
      outcome = inspectionOutcome(r.qty, input.qtyAccepted, input.qtyRejected);
    } catch (e) {
      throw new BadRequestException({ message: (e as Error).message, issues: [{ path: 'qtyAccepted', message: (e as Error).message }] });
    }
    const latest = await this.latestResults(tx, r.id);
    if (!latest.length) throw new BadRequestException('Record at least one result');
    if (r.planId) {
      const chars = await tx.select().from(inspectionCharacteristic).where(eq(inspectionCharacteristic.planId, r.planId)).orderBy(asc(inspectionCharacteristic.lineNo));
      for (const c of chars) {
        const needed = sampleLimit(c.sampleSize, r.qty);
        const done = latest.filter((x) => x.characteristicId === c.id).length;
        if (done < needed) throw new BadRequestException(`Characteristic ${c.balloon ?? c.lineNo} (${c.description}): ${done} of ${needed} samples recorded`);
      }
    }
    if (outcome === 'pass' && latest.some((x) => !x.pass)) throw new BadRequestException('A characteristic failed; reject the nonconforming quantity');
    if (Dec.of(input.qtyRejected).gt('0') && !input.ncrDescription?.trim()) throw new BadRequestException({ message: 'Describe the nonconformance for the NCR', issues: [{ path: 'ncrDescription', message: 'Required' }] });
    let transferEntryId: string | null = null;
    if (r.holdWarehouseId && r.acceptWarehouseId && Dec.of(input.qtyAccepted).gt('0')) {
      transferEntryId = await this.transferIn(tx, ctx, entityId, { itemId: r.itemId, batchId: r.batchId, qty: input.qtyAccepted, from: r.holdWarehouseId, to: r.acceptWarehouseId, reference: `inspection:${r.id}` });
    }
    const date = businessDate();
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'inspection_record', date);
    const [after] = await tx
      .update(inspectionRecord)
      .set({ status: 'submitted', number, outcome, qtyAccepted: input.qtyAccepted, qtyRejected: input.qtyRejected, transferEntryId, remarks: input.remarks ?? r.remarks, submittedBy: ctx.user.id, submittedAt: new Date() })
      .where(eq(inspectionRecord.id, r.id))
      .returning();
    let raised = null;
    if (Dec.of(input.qtyRejected).gt('0'))
      raised = await this.raiseNcrIn(tx, ctx, entityId, { itemId: r.itemId, batchId: r.batchId, qty: input.qtyRejected, fromWarehouseId: r.holdWarehouseId, workOrderId: r.holdWarehouseId ? null : r.workOrderId, inspectionRecordId: r.id, description: input.ncrDescription!.trim() });
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'inspection.submit', targetType: 'inspection_record', targetId: r.id, after: { number, outcome, accepted: input.qtyAccepted, rejected: input.qtyRejected, ncr: raised?.number ?? null } }, tx);
    return { ...after!, ncr: raised };
  }

  async cancelRecordIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, reason: string) {
    const r = await this.lockRecord(tx, entityId, id);
    if (r.status !== 'draft') throw new ConflictException('A submitted inspection stands; raise an NCR to correct it');
    if (r.holdWarehouseId) throw new ConflictException('This inspection holds stock in quarantine; cancel the document that put it there');
    await tx.update(inspectionRecord).set({ status: 'cancelled', remarks: reason }).where(eq(inspectionRecord.id, r.id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'inspection.cancel', targetType: 'inspection_record', targetId: r.id, reason }, tx);
  }

  /** Called when the document that put stock on hold is cancelled: drafts are withdrawn, submitted ones block it. */
  async releaseHoldIn(tx: Tx, sourceType: 'output' | 'job_work_receipt', sourceIds: string[]) {
    if (!sourceIds.length) return;
    const rows = await tx.select().from(inspectionRecord).where(and(eq(inspectionRecord.sourceType, sourceType), inArray(inspectionRecord.sourceId, sourceIds), ne(inspectionRecord.status, 'cancelled'))).for('update');
    const done = rows.find((x) => x.status === 'submitted');
    if (done) throw new ConflictException(`Inspection ${done.number} has been recorded for this stock; it can't be cancelled`);
    if (rows.length) await tx.update(inspectionRecord).set({ status: 'cancelled', remarks: 'Source cancelled' }).where(inArray(inspectionRecord.id, rows.map((x) => x.id)));
  }

  /** Latest result per characteristic (or free-text check) and sample: re-measuring appends. */
  async latestResults(db: Database | Tx, recordId: string) {
    const rows = await db.select().from(inspectionMeasurement).where(eq(inspectionMeasurement.recordId, recordId)).orderBy(asc(inspectionMeasurement.createdAt), asc(inspectionMeasurement.id));
    const by = new Map<string, (typeof rows)[number]>();
    for (const x of rows) by.set(`${x.characteristicId ?? `d:${x.description}`}:${x.sampleNo}`, x);
    return [...by.values()].sort((a, b) => (a.characteristicId ?? '').localeCompare(b.characteristicId ?? '') || a.sampleNo - b.sampleNo);
  }

  private async lockRecord(tx: Tx, entityId: string, id: string) {
    const [r] = await tx.select().from(inspectionRecord).where(and(eq(inspectionRecord.id, id), eq(inspectionRecord.entityId, entityId))).for('update');
    if (!r) throw new NotFoundException('Inspection not found');
    return r;
  }

  // NCR / MRB --------------------------------------------------------------------------------------------

  /** Stock goes on hold in the MRB warehouse; WIP nonconformance (no warehouse) is recorded against the work order. */
  async raiseNcrIn(tx: Tx, ctx: TenantRequestContext, entityId: string, input: { itemId: string; batchId?: string | null; qty: string; fromWarehouseId?: string | null; workOrderId?: string | null; inspectionRecordId?: string | null; description: string }) {
    if (!Dec.of(input.qty).gt('0')) throw new BadRequestException({ message: 'Quantity must be positive', issues: [{ path: 'qty', message: 'Must be positive' }] });
    let mrbId: string | null = null;
    let holdEntryId: string | null = null;
    if (input.fromWarehouseId) {
      const mrb = await this.holdWarehouse(tx, ctx, entityId, 'mrb');
      if (mrb.id === input.fromWarehouseId) throw new BadRequestException('The stock is already in MRB');
      mrbId = mrb.id;
      holdEntryId = await this.transferIn(tx, ctx, entityId, { itemId: input.itemId, batchId: input.batchId ?? null, qty: input.qty, from: input.fromWarehouseId, to: mrb.id, reference: 'ncr:hold' });
    } else if (!input.workOrderId) throw new BadRequestException({ message: 'Choose where the nonconforming stock is', issues: [{ path: 'fromWarehouseId', message: 'Required' }] });
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'ncr', businessDate());
    const [n] = await tx
      .insert(ncr)
      .values({ tenantId: ctx.tenant.tenantId, entityId, number, inspectionRecordId: input.inspectionRecordId ?? null, itemId: input.itemId, batchId: input.batchId ?? null, qty: input.qty, fromWarehouseId: input.fromWarehouseId ?? null, mrbWarehouseId: mrbId, holdEntryId, workOrderId: input.workOrderId ?? null, description: input.description, createdBy: ctx.user.id })
      .returning();
    if (holdEntryId) await tx.update(stockEntry).set({ reference: `ncr:${n!.id}` }).where(eq(stockEntry.id, holdEntryId));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'ncr.raise', targetType: 'ncr', targetId: n!.id, after: { number, qty: input.qty, description: input.description } }, tx);
    return n!;
  }

  async lockNcr(tx: Tx, entityId: string, id: string) {
    const [n] = await tx.select().from(ncr).where(and(eq(ncr.id, id), eq(ncr.entityId, entityId))).for('update');
    if (!n) throw new NotFoundException('NCR not found');
    return n;
  }

  /** Proposed dispositions replace earlier proposals; together they cover the NCR quantity exactly. */
  async proposeIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, lines: DispositionInput[]) {
    const n = await this.lockNcr(tx, entityId, id);
    if (n.status !== 'open') throw new ConflictException(`This NCR is ${n.status}`);
    const total = lines.reduce((s, l) => s.add(l.qty), Dec.ZERO);
    if (!total.eq(n.qty)) throw new BadRequestException({ message: `Dispositions must cover the NCR quantity exactly (${Dec.of(n.qty).toString().replace(/\.?0+$/, '')})`, issues: [{ path: 'lines', message: 'Check the quantities' }] });
    lines.forEach((l, i) => {
      if (l.kind === 'scrap' && n.fromWarehouseId && !l.wasteCategory) throw new BadRequestException({ message: `Line ${i + 1}: choose a waste category`, issues: [{ path: `lines.${i}.wasteCategory`, message: 'Required' }] });
      if (l.kind === 'use_as_is' && !l.concessionRef?.trim()) throw new BadRequestException({ message: `Line ${i + 1}: use-as-is needs a concession reference`, issues: [{ path: `lines.${i}.concessionRef`, message: 'Required' }] });
    });
    await tx.delete(ncrDisposition).where(and(eq(ncrDisposition.ncrId, n.id), eq(ncrDisposition.status, 'proposed')));
    await tx.insert(ncrDisposition).values(lines.map((l, i) => ({ ncrId: n.id, lineNo: i + 1, kind: l.kind, qty: l.qty, concessionRef: l.concessionRef ?? null, wasteCategory: l.wasteCategory ?? null, note: l.note ?? null, proposedBy: ctx.user.id })));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'ncr.propose', targetType: 'ncr', targetId: n.id, after: { lines } }, tx);
  }

  /**
   * MRB approval posts every line except rework/repair, which the controller turns into rework orders:
   * use-as-is releases the stock, scrap posts a scrap entry (waste register, GL), return to vendor opens a
   * draft supplier return claim on the purchase invoice that billed the lot. WIP NCR lines are recorded only.
   */
  async postDispositionIn(tx: Tx, ctx: TenantRequestContext, entityId: string, n: typeof ncr.$inferSelect, d: typeof ncrDisposition.$inferSelect) {
    const date = businessDate();
    const set: Partial<typeof ncrDisposition.$inferInsert> = { status: 'posted', approvedBy: ctx.user.id, approvedAt: new Date(), postedAt: new Date() };
    if (n.mrbWarehouseId) {
      if (d.kind === 'use_as_is') {
        const [rec] = n.inspectionRecordId ? await tx.select().from(inspectionRecord).where(eq(inspectionRecord.id, n.inspectionRecordId)) : [];
        const to = rec?.acceptWarehouseId ?? n.fromWarehouseId!;
        set.stockEntryId = await this.transferIn(tx, ctx, entityId, { itemId: n.itemId, batchId: n.batchId, qty: d.qty, from: n.mrbWarehouseId, to, reference: `ncr:${n.id}` });
      } else if (d.kind === 'scrap') {
        const [e] = await tx
          .insert(stockEntry)
          .values({ tenantId: ctx.tenant.tenantId, entityId, purpose: 'scrap', postingDate: date, systemGenerated: true, reference: `ncr:${n.id}`, remarks: `NCR ${n.number}`, createdBy: ctx.user.id })
          .returning();
        await tx.insert(stockEntryLine).values({ entryId: e!.id, lineNo: 1, itemId: n.itemId, batchId: n.batchId, qty: d.qty, fromWarehouseId: n.mrbWarehouseId, wasteCategory: d.wasteCategory });
        await this.posting.submitIn(tx, ctx, entityId, e!.id);
        set.stockEntryId = e!.id;
      } else if (d.kind === 'return_to_vendor') {
        set.returnClaimId = await this.returnClaimIn(tx, ctx, entityId, n, d.qty);
      }
    }
    await tx.update(ncrDisposition).set(set).where(eq(ncrDisposition.id, d.id));
  }

  /** Draft supplier return claim against the purchase invoice line that billed this lot's receipt. */
  private async returnClaimIn(tx: Tx, ctx: TenantRequestContext, entityId: string, n: typeof ncr.$inferSelect, qty: string) {
    if (!n.batchId) throw new BadRequestException('Return to vendor needs the lot or heat of the nonconforming stock');
    const [src] = await tx
      .select({ invoiceId: purchaseInvoiceLine.invoiceId, invoiceLineId: purchaseInvoiceLine.id, rate: purchaseInvoiceLine.rate })
      .from(receiptInvoiceAllocation)
      .innerJoin(stockEntryLine, eq(stockEntryLine.id, receiptInvoiceAllocation.receiptLineId))
      .innerJoin(purchaseInvoiceLine, and(eq(purchaseInvoiceLine.invoiceId, receiptInvoiceAllocation.invoiceId), eq(purchaseInvoiceLine.itemId, stockEntryLine.itemId), sql`${purchaseInvoiceLine.poLineId} is not distinct from ${stockEntryLine.poLineId}`))
      .innerJoin(purchaseInvoice, eq(purchaseInvoice.id, purchaseInvoiceLine.invoiceId))
      .where(and(eq(receiptInvoiceAllocation.entityId, entityId), eq(stockEntryLine.batchId, n.batchId), isNull(receiptInvoiceAllocation.reversalOf), eq(purchaseInvoice.status, 'submitted')))
      .orderBy(desc(purchaseInvoice.postingDate))
      .limit(1);
    if (!src) throw new BadRequestException('Return to vendor needs the purchase invoice of this lot; none is booked yet');
    const claim = await this.claims.saveIn(tx, ctx, entityId, {
      invoiceId: src.invoiceId,
      postingDate: businessDate(),
      reason: `NCR ${n.number}: ${n.description}`.slice(0, 500),
      lines: [{ invoiceLineId: src.invoiceLineId, qty, taxableAmount: Dec.of(qty).mul(src.rate).toFixed(2) }],
    });
    return (claim as { id: string }).id;
  }

  // Helpers ----------------------------------------------------------------------------------------------

  /** Quarantine and MRB warehouses: the entity's first active one of that type, created if it has none. */
  async holdWarehouse(tx: Tx, ctx: TenantRequestContext, entityId: string, type: 'quarantine' | 'mrb') {
    const [w] = await tx.select().from(warehouse).where(and(eq(warehouse.entityId, entityId), eq(warehouse.type, type), eq(warehouse.isActive, true))).orderBy(asc(warehouse.createdAt)).limit(1);
    if (w) return w;
    const code = type === 'mrb' ? 'MRB' : 'QUA';
    const [clash] = await tx.select({ id: warehouse.id }).from(warehouse).where(and(eq(warehouse.entityId, entityId), eq(warehouse.code, code)));
    if (clash) throw new ConflictException(`Create a ${type === 'mrb' ? 'MRB' : 'Quarantine'} warehouse; code ${code} is taken by another type`);
    const [created] = await tx.insert(warehouse).values({ tenantId: ctx.tenant.tenantId, entityId, code, name: type === 'mrb' ? 'MRB (nonconforming)' : 'Quarantine', type, availableForIssue: false }).returning();
    return created!;
  }

  async transferIn(tx: Tx, ctx: TenantRequestContext, entityId: string, t: { itemId: string; batchId: string | null; qty: string; from: string; to: string; reference: string }) {
    const [e] = await tx
      .insert(stockEntry)
      .values({ tenantId: ctx.tenant.tenantId, entityId, purpose: 'transfer', postingDate: businessDate(), systemGenerated: true, reference: t.reference, remarks: 'Quality', createdBy: ctx.user.id })
      .returning();
    await tx.insert(stockEntryLine).values({ entryId: e!.id, lineNo: 1, itemId: t.itemId, batchId: t.batchId, qty: t.qty, fromWarehouseId: t.from, toWarehouseId: t.to });
    await this.posting.submitIn(tx, ctx, entityId, e!.id);
    return e!.id;
  }
}

/** Samples planned for a characteristic: its sample size capped at the lot, or every piece (whole units). */
export function sampleLimit(sampleSize: number | null, lotQty: string): number {
  const lot = Math.max(1, Math.ceil(Number(lotQty)));
  return sampleSize === null ? lot : Math.min(sampleSize, lot);
}
