// Quality (decision 048): inspection plans, gauges and calibration, inspection records, NCR/MRB.
import { Dec, gaugeBlock } from '@factoryos/core';
import {
  batch,
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
  uom,
  warehouse,
  workOrder,
  workOrderOperation,
} from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { AuditService } from '../../common/audit.service.js';
import { businessDate, entityOf } from '../accounting/accounting-lock.js';
import { WorkOrderService } from '../manufacturing/work-order.service.js';
import { QualityService, sampleLimit } from './quality.service.js';

const decimal = z.string().trim().regex(/^-?\d{1,12}(\.\d{1,6})?$/, 'Enter a number');
const quantity = z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/, 'Enter a quantity');
const positive = quantity.refine((v) => Number(v) > 0, 'Must be more than zero');
const isoDate = z.iso.date();
const reasonInput = z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(1000) });
const stage = z.enum(['incoming', 'in_process', 'final']);
const planInput = z.object({
  itemId: z.uuid(),
  stage,
  operationSeq: z.number().int().min(1).max(9999).nullable().optional(),
  revision: z.string().trim().toUpperCase().min(1).max(10),
  remarks: z.string().trim().max(2000).nullable().optional(),
  characteristics: z
    .array(
      z.object({
        balloon: z.string().trim().max(20).nullable().optional(),
        description: z.string().trim().min(1).max(300),
        kind: z.enum(['dimension', 'visual', 'functional', 'document']),
        nominal: decimal.nullable().optional(),
        lowerLimit: decimal.nullable().optional(),
        upperLimit: decimal.nullable().optional(),
        unit: z.string().trim().max(20).nullable().optional(),
        method: z.string().trim().max(200).nullable().optional(),
        isKey: z.boolean().optional(),
        sampleSize: z.number().int().min(1).max(10000).nullable().optional(),
      }),
    )
    .max(300),
});
const gaugeInput = z.object({
  code: z.string().trim().toUpperCase().min(1).max(30),
  description: z.string().trim().min(1).max(200),
  type: z.string().trim().max(60).nullable().optional(),
  location: z.string().trim().max(100).nullable().optional(),
  intervalDays: z.number().int().min(1).max(3650),
  lastCalibrated: isoDate.nullable().optional(),
});
const recordInput = z.object({
  stage,
  itemId: z.uuid(),
  batchId: z.uuid().nullable().optional(),
  qty: positive,
  sourceType: z.enum(['receipt', 'operation', 'manual']),
  sourceId: z.uuid().nullable().optional(),
  workOrderId: z.uuid().nullable().optional(),
  operationId: z.uuid().nullable().optional(),
  remarks: z.string().trim().max(1000).nullable().optional(),
});
const measureInput = z.object({
  results: z
    .array(
      z.object({
        characteristicId: z.uuid().nullable().optional(),
        description: z.string().trim().max(300).nullable().optional(),
        sampleNo: z.number().int().min(1).max(10000).optional(),
        measured: z.string().trim().max(30).nullable().optional(),
        pass: z.boolean().nullable().optional(),
        gaugeId: z.uuid().nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1)
    .max(2000),
});
const submitInput = z.object({ qtyAccepted: quantity, qtyRejected: quantity, ncrDescription: z.string().trim().max(2000).nullable().optional(), remarks: z.string().trim().max(1000).nullable().optional() });
const ncrInput = z.object({ itemId: z.uuid(), batchId: z.uuid().nullable().optional(), qty: positive, fromWarehouseId: z.uuid().nullable().optional(), workOrderId: z.uuid().nullable().optional(), description: z.string().trim().min(5).max(2000) });
const dispositionsInput = z.object({
  lines: z
    .array(
      z.object({
        kind: z.enum(['use_as_is', 'rework', 'repair', 'scrap', 'return_to_vendor']),
        qty: positive,
        concessionRef: z.string().trim().max(100).nullable().optional(),
        wasteCategory: z.enum(['metal_swarf', 'metal_offcut', 'rejected_parts', 'metal_powder', 'coolant_oil', 'solvent', 'e_waste', 'packaging', 'other']).nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
});
const approveInput = z.object({ reworkWorkCentreId: z.uuid().nullable().optional(), reworkTargetWarehouseId: z.uuid().nullable().optional() });

@Controller('quality')
export class QualityController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly quality: QualityService,
    private readonly orders: WorkOrderService,
    private readonly audit: AuditService,
  ) {}

  // Plans -----------------------------------------------------------------------------------------------

  @Get('plans')
  @RequirePermission('quality.plan.read')
  plans(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const q = parse(z.object({ itemId: z.uuid().optional(), stage: stage.optional(), status: z.enum(['draft', 'active', 'obsolete']).optional() }), query);
    const where: SQL[] = [eq(inspectionPlan.entityId, entityId)];
    if (q.itemId) where.push(eq(inspectionPlan.itemId, q.itemId));
    if (q.stage) where.push(eq(inspectionPlan.stage, q.stage));
    if (q.status) where.push(eq(inspectionPlan.status, q.status));
    return this.db
      .select({ plan: inspectionPlan, itemCode: item.code, itemName: item.name })
      .from(inspectionPlan)
      .innerJoin(item, eq(item.id, inspectionPlan.itemId))
      .where(and(...where))
      .orderBy(asc(item.code), asc(inspectionPlan.stage), desc(inspectionPlan.createdAt))
      .then((rows) => rows.map((r) => ({ ...r.plan, itemCode: r.itemCode, itemName: r.itemName })));
  }

  @Get('plans/:id')
  @RequirePermission('quality.plan.read')
  async plan(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const [p] = await this.db
      .select({ plan: inspectionPlan, itemCode: item.code, itemName: item.name, itemRevision: item.revision })
      .from(inspectionPlan)
      .innerJoin(item, eq(item.id, inspectionPlan.itemId))
      .where(and(eq(inspectionPlan.id, id), eq(inspectionPlan.entityId, entityOf(ctx))));
    if (!p) throw new NotFoundException('Inspection plan not found');
    const characteristics = await this.db.select().from(inspectionCharacteristic).where(eq(inspectionCharacteristic.planId, id)).orderBy(asc(inspectionCharacteristic.lineNo));
    return { ...p.plan, itemCode: p.itemCode, itemName: p.itemName, itemRevision: p.itemRevision, characteristics };
  }

  @Post('plans')
  @RequirePermission('quality.plan.create')
  async createPlan(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(planInput, body);
    const id = await this.quality.run(entityId, (tx) => this.quality.savePlanIn(tx, ctx, entityId, input));
    return this.plan(ctx, id);
  }

  @Put('plans/:id')
  @RequirePermission('quality.plan.update')
  async updatePlan(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(planInput, body);
    await this.quality.run(entityId, (tx) => this.quality.savePlanIn(tx, ctx, entityId, input, id));
    return this.plan(ctx, id);
  }

  @Post('plans/:id/activate')
  @RequirePermission('quality.plan.submit')
  async activatePlan(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    await this.quality.run(entityId, (tx) => this.quality.activatePlanIn(tx, ctx, entityId, id));
    return this.plan(ctx, id);
  }

  // Gauges ----------------------------------------------------------------------------------------------

  @Get('gauges')
  @RequirePermission('quality.gauge.read')
  async gauges(@Ctx() ctx: TenantRequestContext) {
    const today = businessDate();
    const rows = await this.db.select().from(gauge).where(eq(gauge.entityId, entityOf(ctx))).orderBy(asc(gauge.code));
    return rows.map((g) => ({ ...g, usable: gaugeBlock(g, today) === null, block: gaugeBlock(g, today) }));
  }

  @Get('gauges/:id')
  @RequirePermission('quality.gauge.read')
  async gauge(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const [g] = await this.db.select().from(gauge).where(and(eq(gauge.id, id), eq(gauge.entityId, entityOf(ctx))));
    if (!g) throw new NotFoundException('Gauge not found');
    const events = await this.db.select().from(calibrationEvent).where(eq(calibrationEvent.gaugeId, id)).orderBy(desc(calibrationEvent.calibratedOn), desc(calibrationEvent.createdAt));
    return { ...g, block: gaugeBlock(g, businessDate()), events };
  }

  @Post('gauges')
  @RequirePermission('quality.gauge.create')
  createGauge(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(gaugeInput, body);
    return this.quality.run(entityId, (tx) => this.quality.createGaugeIn(tx, ctx, entityId, input));
  }

  @Put('gauges/:id')
  @RequirePermission('quality.gauge.update')
  updateGauge(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(gaugeInput.omit({ code: true, lastCalibrated: true }).partial().extend({ inService: z.boolean().optional() }), body);
    return this.quality.run(entityId, (tx) => this.quality.updateGaugeIn(tx, ctx, entityId, id, input));
  }

  @Post('gauges/:id/calibrations')
  @RequirePermission('quality.gauge.update')
  calibrate(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(z.object({ calibratedOn: isoDate, result: z.enum(['pass', 'adjusted', 'fail']), agency: z.string().trim().max(120).nullable().optional(), certificateNo: z.string().trim().max(60).nullable().optional(), note: z.string().trim().max(500).nullable().optional() }), body);
    return this.quality.run(entityId, (tx) => this.quality.calibrateIn(tx, ctx, entityId, id, input));
  }

  // Inspections -----------------------------------------------------------------------------------------

  @Get('inspections')
  @RequirePermission('quality.inspection.read')
  inspections(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const q = parse(z.object({ status: z.enum(['draft', 'submitted', 'cancelled']).optional(), stage: stage.optional(), itemId: z.uuid().optional(), workOrderId: z.uuid().optional() }), query);
    const where: SQL[] = [eq(inspectionRecord.entityId, entityOf(ctx))];
    if (q.status) where.push(eq(inspectionRecord.status, q.status));
    if (q.stage) where.push(eq(inspectionRecord.stage, q.stage));
    if (q.itemId) where.push(eq(inspectionRecord.itemId, q.itemId));
    if (q.workOrderId) where.push(eq(inspectionRecord.workOrderId, q.workOrderId));
    return this.db
      .select({ r: inspectionRecord, itemCode: item.code, itemName: item.name, batchNo: batch.batchNo, workOrder: workOrder.number })
      .from(inspectionRecord)
      .innerJoin(item, eq(item.id, inspectionRecord.itemId))
      .leftJoin(batch, eq(batch.id, inspectionRecord.batchId))
      .leftJoin(workOrder, eq(workOrder.id, inspectionRecord.workOrderId))
      .where(and(...where))
      .orderBy(desc(inspectionRecord.createdAt))
      .limit(500)
      .then((rows) => rows.map((x) => ({ ...x.r, itemCode: x.itemCode, itemName: x.itemName, batchNo: x.batchNo, workOrder: x.workOrder })));
  }

  @Get('inspections/:id')
  @RequirePermission('quality.inspection.read')
  async inspection(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const [x] = await this.db
      .select({ r: inspectionRecord, itemCode: item.code, itemName: item.name, itemRevision: item.revision, uom: uom.code, batchNo: batch.batchNo, workOrder: workOrder.number, plan: inspectionPlan })
      .from(inspectionRecord)
      .innerJoin(item, eq(item.id, inspectionRecord.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .leftJoin(batch, eq(batch.id, inspectionRecord.batchId))
      .leftJoin(workOrder, eq(workOrder.id, inspectionRecord.workOrderId))
      .leftJoin(inspectionPlan, eq(inspectionPlan.id, inspectionRecord.planId))
      .where(and(eq(inspectionRecord.id, id), eq(inspectionRecord.entityId, entityOf(ctx))));
    if (!x) throw new NotFoundException('Inspection not found');
    const characteristics = x.plan ? await this.db.select().from(inspectionCharacteristic).where(eq(inspectionCharacteristic.planId, x.plan.id)).orderBy(asc(inspectionCharacteristic.lineNo)) : [];
    const latest = await this.quality.latestResults(this.db, id);
    const history = await this.db.select().from(inspectionMeasurement).where(eq(inspectionMeasurement.recordId, id)).orderBy(asc(inspectionMeasurement.createdAt));
    const [raised] = await this.db.select({ id: ncr.id, number: ncr.number }).from(ncr).where(eq(ncr.inspectionRecordId, id));
    const wh = [x.r.holdWarehouseId, x.r.acceptWarehouseId].filter((w): w is string => !!w);
    const whs = wh.length ? await this.db.select({ id: warehouse.id, name: warehouse.name }).from(warehouse).where(inArray(warehouse.id, wh)) : [];
    return {
      ...x.r,
      itemCode: x.itemCode,
      itemName: x.itemName,
      itemRevision: x.itemRevision,
      uom: x.uom,
      batchNo: x.batchNo,
      workOrder: x.workOrder,
      plan: x.plan ? { id: x.plan.id, revision: x.plan.revision } : null,
      holdWarehouse: whs.find((w) => w.id === x.r.holdWarehouseId)?.name ?? null,
      acceptWarehouse: whs.find((w) => w.id === x.r.acceptWarehouseId)?.name ?? null,
      characteristics: characteristics.map((c) => ({ ...c, samples: sampleLimit(c.sampleSize, x.r.qty) })),
      results: latest,
      history,
      ncr: raised ?? null,
    };
  }

  @Post('inspections')
  @RequirePermission('quality.inspection.create')
  async createInspection(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(recordInput, body);
    if (input.stage === 'final') throw new BadRequestException('Final inspections open automatically when output goes to Quarantine');
    const r = await this.quality.run(entityId, async (tx) => {
      let operationSeq: number | null = null;
      if (input.stage === 'in_process') {
        if (!input.workOrderId || !input.operationId) throw new BadRequestException('An in-process inspection names its work order operation');
        const [wo] = await tx.select().from(workOrder).where(and(eq(workOrder.id, input.workOrderId), eq(workOrder.entityId, entityId)));
        if (!wo || wo.itemId !== input.itemId) throw new BadRequestException('The work order does not make this item');
        const [op] = await tx.select().from(workOrderOperation).where(eq(workOrderOperation.id, input.operationId));
        if (!op || op.workOrderId !== wo.id) throw new BadRequestException('Operation not found on this work order');
        operationSeq = op.seq;
      }
      return this.quality.openRecordIn(tx, ctx, entityId, { ...input, sourceType: input.stage === 'in_process' ? 'operation' : input.sourceType, sourceId: input.stage === 'in_process' ? input.operationId : input.sourceId, operationSeq });
    });
    return this.inspection(ctx, r.id);
  }

  @Post('inspections/:id/results')
  @RequirePermission('quality.inspection.create')
  async measure(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { results } = parse(measureInput, body);
    await this.quality.run(entityId, (tx) => this.quality.measureIn(tx, ctx, entityId, id, results));
    return this.inspection(ctx, id);
  }

  @Post('inspections/:id/submit')
  @RequirePermission('quality.inspection.submit')
  async submitInspection(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(submitInput, body);
    await this.quality.run(entityId, (tx) => this.quality.submitRecordIn(tx, ctx, entityId, id, input));
    return this.inspection(ctx, id);
  }

  @Post('inspections/:id/cancel')
  @RequirePermission('quality.inspection.cancel')
  async cancelInspection(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(reasonInput, body);
    await this.quality.run(entityId, (tx) => this.quality.cancelRecordIn(tx, ctx, entityId, id, reason));
    return this.inspection(ctx, id);
  }

  // NCR / MRB -------------------------------------------------------------------------------------------

  @Get('ncrs')
  @RequirePermission('quality.ncr.read')
  ncrs(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const q = parse(z.object({ status: z.enum(['open', 'dispositioned', 'closed', 'cancelled']).optional() }), query);
    const where: SQL[] = [eq(ncr.entityId, entityOf(ctx))];
    if (q.status) where.push(eq(ncr.status, q.status));
    return this.db
      .select({ n: ncr, itemCode: item.code, itemName: item.name, batchNo: batch.batchNo })
      .from(ncr)
      .innerJoin(item, eq(item.id, ncr.itemId))
      .leftJoin(batch, eq(batch.id, ncr.batchId))
      .where(and(...where))
      .orderBy(desc(ncr.createdAt))
      .limit(500)
      .then((rows) => rows.map((x) => ({ ...x.n, itemCode: x.itemCode, itemName: x.itemName, batchNo: x.batchNo })));
  }

  @Get('ncrs/:id')
  @RequirePermission('quality.ncr.read')
  async ncr(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const [x] = await this.db
      .select({ n: ncr, itemCode: item.code, itemName: item.name, uom: uom.code, batchNo: batch.batchNo, workOrder: workOrder.number, inspection: inspectionRecord.number })
      .from(ncr)
      .innerJoin(item, eq(item.id, ncr.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .leftJoin(batch, eq(batch.id, ncr.batchId))
      .leftJoin(workOrder, eq(workOrder.id, ncr.workOrderId))
      .leftJoin(inspectionRecord, eq(inspectionRecord.id, ncr.inspectionRecordId))
      .where(and(eq(ncr.id, id), eq(ncr.entityId, entityOf(ctx))));
    if (!x) throw new NotFoundException('NCR not found');
    const lines = await this.db
      .select({ d: ncrDisposition, reworkOrder: workOrder.number })
      .from(ncrDisposition)
      .leftJoin(workOrder, eq(workOrder.id, ncrDisposition.workOrderId))
      .where(eq(ncrDisposition.ncrId, id))
      .orderBy(asc(ncrDisposition.lineNo));
    return { ...x.n, itemCode: x.itemCode, itemName: x.itemName, uom: x.uom, batchNo: x.batchNo, workOrder: x.workOrder, inspection: x.inspection, dispositions: lines.map((l) => ({ ...l.d, reworkOrder: l.reworkOrder })) };
  }

  @Post('ncrs')
  @RequirePermission('quality.ncr.create')
  async raise(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(ncrInput, body);
    const n = await this.quality.run(entityId, async (tx) => {
      const [it] = await tx.select().from(item).where(and(eq(item.id, input.itemId), eq(item.tenantId, ctx.tenant.tenantId)));
      if (!it) throw new BadRequestException('Unknown item');
      if (input.fromWarehouseId) {
        const [w] = await tx.select().from(warehouse).where(and(eq(warehouse.id, input.fromWarehouseId), eq(warehouse.entityId, entityId)));
        if (!w || ['at_job_worker', 'customer_owned'].includes(w.type)) throw new BadRequestException({ message: 'Choose one of our warehouses', issues: [{ path: 'fromWarehouseId', message: 'Not allowed' }] });
      }
      return this.quality.raiseNcrIn(tx, ctx, entityId, input);
    });
    return this.ncr(ctx, n.id);
  }

  @Post('ncrs/:id/dispositions')
  @RequirePermission('quality.ncr.submit')
  async propose(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { lines } = parse(dispositionsInput, body);
    await this.quality.run(entityId, (tx) => this.quality.proposeIn(tx, ctx, entityId, id, lines));
    return this.ncr(ctx, id);
  }

  /** MRB approval posts every proposed line; rework and repair open rework work orders. */
  @Post('ncrs/:id/approve')
  @RequirePermission('quality.ncr.approve')
  async approve(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(approveInput, body ?? {});
    await this.quality.run(entityId, async (tx) => {
      await this.orders.prepareIn(tx, ctx, entityId);
      const n = await this.quality.lockNcr(tx, entityId, id);
      if (n.status !== 'open') throw new ConflictException(`This NCR is ${n.status}`);
      const lines = await tx.select().from(ncrDisposition).where(and(eq(ncrDisposition.ncrId, id), eq(ncrDisposition.status, 'proposed'))).orderBy(asc(ncrDisposition.lineNo));
      if (!lines.length) throw new BadRequestException('Propose the dispositions first');
      if (!lines.reduce((s, l) => s.add(l.qty), Dec.ZERO).eq(n.qty)) throw new ConflictException('The proposed dispositions no longer cover the NCR quantity');
      for (const d of lines) {
        if ((d.kind === 'rework' || d.kind === 'repair') && n.mrbWarehouseId) {
          if (!input.reworkWorkCentreId || !input.reworkTargetWarehouseId) throw new BadRequestException({ message: 'Choose the work centre and the warehouse for the rework order', issues: [{ path: 'reworkWorkCentreId', message: 'Required' }] });
          const wo = await this.orders.createReworkIn(tx, ctx, entityId, { ncrId: n.id, ncrNumber: n.number, kind: d.kind, itemId: n.itemId, batchId: n.batchId, qty: d.qty, mrbWarehouseId: n.mrbWarehouseId, targetWarehouseId: input.reworkTargetWarehouseId, workCentreId: input.reworkWorkCentreId });
          await tx.update(ncrDisposition).set({ status: 'posted', approvedBy: ctx.user.id, approvedAt: new Date(), postedAt: new Date(), workOrderId: wo.id }).where(eq(ncrDisposition.id, d.id));
        } else await this.quality.postDispositionIn(tx, ctx, entityId, n, d);
      }
      await tx.update(ncr).set({ status: 'dispositioned' }).where(eq(ncr.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'ncr.approve', targetType: 'ncr', targetId: id, after: { lines: lines.map((l) => ({ kind: l.kind, qty: l.qty })) } }, tx);
    });
    return this.ncr(ctx, id);
  }

  @Post('ncrs/:id/close')
  @RequirePermission('quality.ncr.approve')
  async close(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    await this.quality.run(entityId, async (tx) => {
      const n = await this.quality.lockNcr(tx, entityId, id);
      if (n.status !== 'dispositioned') throw new ConflictException('Approve the dispositions before closing');
      await tx.update(ncr).set({ status: 'closed', closedAt: new Date() }).where(eq(ncr.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'ncr.close', targetType: 'ncr', targetId: id }, tx);
    });
    return this.ncr(ctx, id);
  }

  /** Only before any disposition is approved: the held stock returns where it came from. */
  @Post('ncrs/:id/cancel')
  @RequirePermission('quality.ncr.cancel')
  async cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(reasonInput, body);
    await this.quality.run(entityId, async (tx) => {
      const n = await this.quality.lockNcr(tx, entityId, id);
      if (n.status !== 'open') throw new ConflictException('Dispositions are posted; record the correction with a new NCR');
      if (n.inspectionRecordId) throw new ConflictException('An NCR raised by an inspection stands; disposition it instead');
      if (n.mrbWarehouseId && n.fromWarehouseId) await this.quality.transferIn(tx, ctx, entityId, { itemId: n.itemId, batchId: n.batchId, qty: n.qty, from: n.mrbWarehouseId, to: n.fromWarehouseId, reference: `ncr:${n.id}` });
      await tx.update(ncr).set({ status: 'cancelled', cancelReason: reason }).where(eq(ncr.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'ncr.cancel', targetType: 'ncr', targetId: id, reason }, tx);
    });
    return this.ncr(ctx, id);
  }
}
