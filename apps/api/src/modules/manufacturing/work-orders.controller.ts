// Work orders, their movements, job cards and traceability (decision 044).
import { Dec, runningMinutes } from '@factoryos/core';
import {
  batch,
  bom,
  type Database,
  item,
  jobCard,
  jobCardEvent,
  machine,
  salesOrder,
  serialComponent,
  stockEntry,
  stockEntryLine,
  uom,
  user,
  warehouse,
  workCentre,
  workOrder,
  workOrderCost,
  workOrderMaterial,
  workOrderOperation,
} from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf, type Tx } from '../accounting/accounting-lock.js';
import { availableStock, WorkOrderService } from './work-order.service.js';

const quantity = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,6})?$/, 'A quantity with up to 6 decimals'));
const positive = quantity.refine((v) => Dec.of(v).gt('0'), 'Must be more than zero');
const reason = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });
const orderInput = z.object({
  itemId: z.uuid(),
  bomId: z.uuid().optional(),
  plannedQty: positive,
  sourceWarehouseId: z.uuid(),
  targetWarehouseId: z.uuid(),
  salesOrderId: z.uuid().nullable().optional(),
  plannedStart: z.iso.date().nullable().optional(),
  plannedEnd: z.iso.date().nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
});
const movementInput = z.object({
  postingDate: z.iso.date().optional(),
  lines: z
    .array(z.object({ itemId: z.uuid(), qty: positive, batchId: z.uuid().nullable().optional(), warehouseId: z.uuid().nullable().optional() }))
    .min(1, 'Add at least one line')
    .max(100),
});
const outputInput = z.object({
  postingDate: z.iso.date().optional(),
  qty: positive,
  batchNo: z.string().trim().max(40).nullable().optional(),
  warehouseId: z.uuid().nullable().optional(),
  /** Serial assemblies: per new serial, the component serial (batch) ids built into it (decision 046). */
  asBuilt: z.array(z.array(z.uuid()).max(100)).max(1000).optional(),
});
const stopInput = z.object({ goodQty: quantity.default('0'), reworkQty: quantity.default('0'), scrapQty: quantity.default('0'), remarks: z.string().trim().max(1000).nullable().optional() });

const operatorUser = alias(user, 'operator');

@Controller('manufacturing')
export class WorkOrdersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly orders: WorkOrderService,
  ) {}

  @Get('work-orders')
  @RequirePermission('manufacturing.work_order.read')
  async list(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { status } = parse(z.object({ status: z.enum(['draft', 'released', 'completed', 'cancelled']).optional() }), query);
    const where = [eq(workOrder.entityId, entityId)];
    if (status) where.push(eq(workOrder.status, status));
    return this.db
      .select({
        id: workOrder.id,
        number: workOrder.number,
        status: workOrder.status,
        itemCode: item.code,
        itemName: item.name,
        revision: bom.revision,
        plannedQty: workOrder.plannedQty,
        producedQty: workOrder.producedQty,
        plannedStart: workOrder.plannedStart,
        plannedEnd: workOrder.plannedEnd,
        salesOrder: salesOrder.number,
        createdAt: workOrder.createdAt,
        wip: sql<string>`(select coalesce(sum(c.amount), 0) from work_order_cost c where c.work_order_id = "work_order"."id")`,
      })
      .from(workOrder)
      .innerJoin(item, eq(item.id, workOrder.itemId))
      .innerJoin(bom, eq(bom.id, workOrder.bomId))
      .leftJoin(salesOrder, eq(salesOrder.id, workOrder.salesOrderId))
      .where(and(...where))
      .orderBy(desc(workOrder.createdAt))
      .limit(500);
  }

  @Get('work-orders/:id')
  @RequirePermission('manufacturing.work_order.read')
  async get(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.detail(this.db, entityOf(ctx), id);
  }

  @Post('work-orders')
  @RequirePermission('manufacturing.work_order.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(orderInput, body);
    return this.db.transaction(async (tx) => {
      const fields = await this.validate(tx, ctx, entityId, input);
      const [row] = await tx
        .insert(workOrder)
        .values({ tenantId: ctx.tenant.tenantId, entityId, ...fields, createdBy: ctx.user.id })
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_order.create', targetType: 'work_order', targetId: row!.id }, tx);
      return this.detail(tx, entityId, row!.id);
    });
  }

  @Put('work-orders/:id')
  @RequirePermission('manufacturing.work_order.create')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(orderInput, body);
    return this.db.transaction(async (tx) => {
      const wo = await this.orders.lock(tx, entityId, id);
      if (wo.status !== 'draft') throw new ConflictException('Only drafts can be edited');
      const fields = await this.validate(tx, ctx, entityId, input);
      await tx.update(workOrder).set({ ...fields, updatedAt: new Date() }).where(eq(workOrder.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_order.update', targetType: 'work_order', targetId: id }, tx);
      return this.detail(tx, entityId, id);
    });
  }

  @Post('work-orders/:id/release')
  @RequirePermission('manufacturing.work_order.submit')
  release(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.orders.run(ctx, entityId, id, async (tx, wo) => {
      await this.orders.releaseIn(tx, ctx, entityId, wo);
      return this.detail(tx, entityId, id);
    });
  }

  @Post('work-orders/:id/cancel')
  @RequirePermission('manufacturing.work_order.cancel')
  cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: why } = parse(reason, body);
    return this.orders.run(ctx, entityId, id, async (tx, wo) => {
      await this.orders.cancelIn(tx, ctx, entityId, wo, why);
      return this.detail(tx, entityId, id);
    });
  }

  @Get('work-orders/:id/availability')
  @RequirePermission('manufacturing.work_order.read')
  async availability(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { itemId } = parse(z.object({ itemId: z.uuid().optional() }), query);
    const [wo] = await this.db.select().from(workOrder).where(and(eq(workOrder.id, id), eq(workOrder.entityId, entityId)));
    if (!wo) throw new NotFoundException('Work order not found');
    const ids = itemId ? [itemId] : (await this.db.select({ id: workOrderMaterial.itemId }).from(workOrderMaterial).where(eq(workOrderMaterial.workOrderId, id))).map((m) => m.id);
    return availableStock(this.db, entityId, ids);
  }

  @Post('work-orders/:id/issue')
  @RequirePermission('manufacturing.work_order.submit')
  issue(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(movementInput, body);
    return this.orders.run(ctx, entityId, id, async (tx, wo) => {
      await this.orders.issueIn(tx, ctx, entityId, wo, input.postingDate ?? businessDate(), input.lines);
      return this.detail(tx, entityId, id);
    });
  }

  @Post('work-orders/:id/return')
  @RequirePermission('manufacturing.work_order.submit')
  giveBack(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(movementInput, body);
    return this.orders.run(ctx, entityId, id, async (tx, wo) => {
      await this.orders.returnIn(tx, ctx, entityId, wo, input.postingDate ?? businessDate(), input.lines);
      return this.detail(tx, entityId, id);
    });
  }

  @Post('work-orders/:id/output')
  @RequirePermission('manufacturing.work_order.submit')
  output(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(outputInput, body);
    return this.orders.run(ctx, entityId, id, async (tx, wo) => {
      await this.orders.outputIn(tx, ctx, entityId, wo, input.postingDate ?? businessDate(), input);
      return this.detail(tx, entityId, id);
    });
  }

  @Post('work-orders/:id/movements/:entryId/cancel')
  @RequirePermission('manufacturing.work_order.cancel')
  cancelMovement(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: why } = parse(reason, body);
    return this.orders.run(ctx, entityId, id, async (tx, wo) => {
      await this.orders.cancelEntryIn(tx, ctx, entityId, wo, entryId, why);
      return this.detail(tx, entityId, id);
    });
  }

  @Post('work-orders/:id/close')
  @RequirePermission('manufacturing.work_order.approve')
  close(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { postingDate } = parse(z.object({ postingDate: z.iso.date().optional() }), body ?? {});
    return this.orders.run(ctx, entityId, id, async (tx, wo) => {
      await this.orders.closeIn(tx, ctx, entityId, wo, postingDate ?? businessDate());
      return this.detail(tx, entityId, id);
    });
  }

  @Post('work-orders/:id/reopen')
  @RequirePermission('manufacturing.work_order.approve')
  reopen(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: why } = parse(reason, body);
    return this.orders.run(ctx, entityId, id, async (tx, wo) => {
      await this.orders.reopenIn(tx, ctx, entityId, wo, why);
      return this.detail(tx, entityId, id);
    });
  }

  // Job cards -----------------------------------------------------------------------------------------

  /** Shop floor: released work orders' operations, the caller's open card and who is on what. */
  @Get('shop-floor')
  @RequirePermission('manufacturing.job_card.read')
  async shopFloor(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const ops = await this.db
      .select({
        operationId: workOrderOperation.id,
        seq: workOrderOperation.seq,
        name: workOrderOperation.name,
        plannedMinutes: workOrderOperation.plannedMinutes,
        instructions: workOrderOperation.instructions,
        workCentreId: workCentre.id,
        workCentre: workCentre.name,
        workOrderId: workOrder.id,
        number: workOrder.number,
        itemCode: item.code,
        itemName: item.name,
        plannedQty: workOrder.plannedQty,
        producedQty: workOrder.producedQty,
        goodQty: sql<string>`(select coalesce(sum(j.good_qty), 0) from job_card j where j.operation_id = "work_order_operation"."id" and j.status = 'completed')`,
      })
      .from(workOrderOperation)
      .innerJoin(workOrder, eq(workOrder.id, workOrderOperation.workOrderId))
      .innerJoin(item, eq(item.id, workOrder.itemId))
      .innerJoin(workCentre, eq(workCentre.id, workOrderOperation.workCentreId))
      .where(and(eq(workOrder.entityId, entityId), eq(workOrder.status, 'released')))
      .orderBy(asc(workOrder.plannedEnd), asc(workOrder.number), asc(workOrderOperation.seq))
      .limit(500);
    const open = await this.cards(this.db, entityId, { open: true });
    const machines = await this.db.select({ id: machine.id, code: machine.code, name: machine.name, workCentreId: machine.workCentreId }).from(machine).where(and(eq(machine.entityId, entityId), eq(machine.isActive, true))).orderBy(asc(machine.code));
    return { operations: ops, openCards: open, mine: open.find((c) => c.operatorId === ctx.user.id) ?? null, machines };
  }

  @Post('job-cards')
  @RequirePermission('manufacturing.job_card.update')
  start(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(z.object({ operationId: z.uuid(), machineId: z.uuid().nullable().optional() }), body);
    return this.db.transaction(async (tx) => {
      const [op] = await tx.select({ workOrderId: workOrderOperation.workOrderId }).from(workOrderOperation).where(eq(workOrderOperation.id, input.operationId));
      if (!op) throw new NotFoundException('Operation not found');
      const wo = await this.orders.lock(tx, entityId, op.workOrderId);
      const card = await this.orders.startCardIn(tx, ctx, entityId, wo, input.operationId, input.machineId ?? null);
      return (await this.cards(tx, entityId, { ids: [card.id] }))[0];
    });
  }

  @Post('job-cards/:id/pause')
  @RequirePermission('manufacturing.job_card.update')
  pause(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { reason: why } = parse(z.object({ reason: z.string().trim().min(2, 'Choose why the job is paused').max(200) }), body);
    return this.onCard(ctx, id, (tx, entityId, wo) => this.orders.moveCardIn(tx, ctx, entityId, wo, id, 'pause', why));
  }

  @Post('job-cards/:id/resume')
  @RequirePermission('manufacturing.job_card.update')
  resume(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.onCard(ctx, id, (tx, entityId, wo) => this.orders.moveCardIn(tx, ctx, entityId, wo, id, 'resume', null));
  }

  @Post('job-cards/:id/stop')
  @RequirePermission('manufacturing.job_card.submit')
  stop(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(stopInput, body);
    if (Dec.of(input.goodQty).add(input.reworkQty).add(input.scrapQty).isZero()) throw new BadRequestException('Enter the quantity made (good, rework or scrap)');
    return this.onCard(ctx, id, (tx, entityId, wo) => this.orders.stopCardIn(tx, ctx, entityId, wo, id, input), true);
  }

  @Post('job-cards/:id/cancel')
  @RequirePermission('manufacturing.work_order.cancel')
  cancelCard(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { reason: why } = parse(reason, body);
    return this.onCard(ctx, id, (tx, entityId, wo) => this.orders.cancelCardIn(tx, ctx, entityId, wo, id, why), true);
  }

  // Traceability --------------------------------------------------------------------------------------

  /** Backward: which work orders made this batch and from what. Forward: which work orders consumed it and what they made. */
  @Get('trace/:batchId')
  @RequirePermission('manufacturing.work_order.read')
  async trace(@Ctx() ctx: TenantRequestContext, @Param('batchId', ParseUUIDPipe) batchId: string) {
    const entityId = entityOf(ctx);
    const [b] = await this.db
      .select({ id: batch.id, batchNo: batch.batchNo, heatNo: batch.heatNo, itemCode: item.code, itemName: item.name })
      .from(batch)
      .innerJoin(item, eq(item.id, batch.itemId))
      .where(and(eq(batch.id, batchId), eq(batch.tenantId, ctx.tenant.tenantId)));
    if (!b) throw new NotFoundException('Batch not found');
    const movements = (purpose: 'production_issue' | 'production_output', batchFilter?: string, orderIds?: string[]) =>
      this.db
        .select({ workOrderId: stockEntry.workOrderId, number: workOrder.number, batchId: stockEntryLine.batchId, batchNo: batch.batchNo, heatNo: batch.heatNo, itemCode: item.code, itemName: item.name, qty: sql<string>`sum(${stockEntryLine.qty})` })
        .from(stockEntryLine)
        .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
        .innerJoin(workOrder, eq(workOrder.id, stockEntry.workOrderId))
        .innerJoin(item, eq(item.id, stockEntryLine.itemId))
        .leftJoin(batch, eq(batch.id, stockEntryLine.batchId))
        .where(
          and(
            eq(stockEntry.entityId, entityId),
            eq(stockEntry.purpose, purpose),
            eq(stockEntry.status, 'submitted'),
            batchFilter ? eq(stockEntryLine.batchId, batchFilter) : undefined,
            orderIds ? inArray(stockEntry.workOrderId, orderIds.length ? orderIds : ['00000000-0000-0000-0000-000000000000']) : undefined,
          ),
        )
        .groupBy(stockEntry.workOrderId, workOrder.number, stockEntryLine.batchId, batch.batchNo, batch.heatNo, item.code, item.name);
    const madeBy = await movements('production_output', batchId);
    const madeFrom = await movements('production_issue', undefined, madeBy.map((m) => m.workOrderId!));
    const usedIn = await movements('production_issue', batchId);
    const madeInto = await movements('production_output', undefined, usedIn.map((m) => m.workOrderId!));
    return { batch: b, backward: { workOrders: madeBy, consumed: madeFrom }, forward: { workOrders: usedIn, produced: madeInto } };
  }

  // Helpers -------------------------------------------------------------------------------------------

  /** Card operations lock the work order; stop and cancel post to WIP, so they take the accounting lock first. */
  private onCard<T>(ctx: TenantRequestContext, cardId: string, f: (tx: Tx, entityId: string, wo: Awaited<ReturnType<WorkOrderService['lock']>>) => Promise<T>, accounting = false) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      if (accounting) await this.orders.prepareIn(tx, ctx, entityId);
      const [c] = await tx.select({ workOrderId: jobCard.workOrderId }).from(jobCard).where(and(eq(jobCard.id, cardId), eq(jobCard.entityId, entityId)));
      if (!c) throw new NotFoundException('Job card not found');
      const wo = await this.orders.lock(tx, entityId, c.workOrderId);
      await f(tx, entityId, wo);
      return (await this.cards(tx, entityId, { ids: [cardId] }))[0];
    });
  }

  private async validate(tx: Tx, ctx: TenantRequestContext, entityId: string, input: z.infer<typeof orderInput>) {
    const [it] = await tx.select().from(item).where(and(eq(item.id, input.itemId), eq(item.tenantId, ctx.tenant.tenantId)));
    if (!it) throw new BadRequestException('Unknown item');
    let bomId = input.bomId;
    if (!bomId) {
      const [d] = await tx.select({ id: bom.id }).from(bom).where(and(eq(bom.entityId, entityId), eq(bom.itemId, it.id), eq(bom.isDefault, true)));
      if (!d) throw new BadRequestException(`${it.code} has no active default BOM`);
      bomId = d.id;
    }
    const [b] = await tx.select().from(bom).where(and(eq(bom.id, bomId), eq(bom.entityId, entityId)));
    if (!b || b.itemId !== it.id) throw new BadRequestException('The BOM is not for this item');
    if (b.status !== 'active') throw new BadRequestException(`BOM revision ${b.revision} is ${b.status}`);
    const whs = await tx.select().from(warehouse).where(and(inArray(warehouse.id, [input.sourceWarehouseId, input.targetWarehouseId]), eq(warehouse.entityId, entityId)));
    const src = whs.find((w) => w.id === input.sourceWarehouseId);
    const dst = whs.find((w) => w.id === input.targetWarehouseId);
    if (!src || !dst) throw new BadRequestException('Warehouse not in this entity');
    if (!src.availableForIssue) throw new BadRequestException(`${src.name} is not available for issue`);
    if (src.type === 'customer_owned' || dst.type === 'customer_owned') throw new BadRequestException('Customer-owned warehouses are used with job work');
    if (input.salesOrderId) {
      const [so] = await tx.select().from(salesOrder).where(and(eq(salesOrder.id, input.salesOrderId), eq(salesOrder.entityId, entityId)));
      if (!so || so.status !== 'submitted') throw new BadRequestException('Link a submitted sales order');
    }
    if (input.plannedStart && input.plannedEnd && input.plannedEnd < input.plannedStart) throw new BadRequestException('The planned end is before the start');
    return {
      itemId: it.id,
      bomId: b.id,
      plannedQty: input.plannedQty,
      sourceWarehouseId: src.id,
      targetWarehouseId: dst.id,
      salesOrderId: input.salesOrderId ?? null,
      plannedStart: input.plannedStart ?? null,
      plannedEnd: input.plannedEnd ?? null,
      remarks: input.remarks ?? null,
    };
  }

  private async cards(db: Database | Tx, entityId: string, filter: { ids?: string[]; workOrderId?: string; open?: boolean }) {
    const where = [eq(jobCard.entityId, entityId)];
    if (filter.ids) where.push(inArray(jobCard.id, filter.ids));
    if (filter.workOrderId) where.push(eq(jobCard.workOrderId, filter.workOrderId));
    if (filter.open) where.push(inArray(jobCard.status, ['running', 'paused']));
    const rows = await db
      .select({ card: jobCard, operator: operatorUser.name, seq: workOrderOperation.seq, operation: workOrderOperation.name, number: workOrder.number, machine: machine.code, workCentre: workCentre.name })
      .from(jobCard)
      .innerJoin(operatorUser, eq(operatorUser.id, jobCard.operatorId))
      .innerJoin(workOrderOperation, eq(workOrderOperation.id, jobCard.operationId))
      .innerJoin(workOrder, eq(workOrder.id, jobCard.workOrderId))
      .innerJoin(workCentre, eq(workCentre.id, workOrderOperation.workCentreId))
      .leftJoin(machine, eq(machine.id, jobCard.machineId))
      .where(and(...where))
      .orderBy(desc(jobCard.createdAt));
    const ids = rows.map((r) => r.card.id);
    const events = ids.length ? await db.select().from(jobCardEvent).where(inArray(jobCardEvent.jobCardId, ids)).orderBy(asc(jobCardEvent.at), asc(jobCardEvent.id)) : [];
    return rows.map((r) => {
      const ev = events.filter((e) => e.jobCardId === r.card.id);
      const lastPause = [...ev].reverse().find((e) => e.kind === 'pause');
      return {
        ...r.card,
        operator: r.operator,
        seq: r.seq,
        operation: r.operation,
        number: r.number,
        machine: r.machine,
        workCentre: r.workCentre,
        startedAt: ev[0]?.at ?? r.card.createdAt,
        pauseReason: r.card.status === 'paused' ? (lastPause?.reason ?? null) : null,
        // Live minutes for open cards; completed cards show the recorded figure.
        minutes: r.card.minutes ?? runningMinutes(ev),
        events: ev.map((e) => ({ kind: e.kind, at: e.at, reason: e.reason })),
      };
    });
  }

  private async detail(db: Database | Tx, entityId: string, id: string) {
    const [row] = await db
      .select({ wo: workOrder, itemCode: item.code, itemName: item.name, tracking: item.tracking, uom: uom.code, revision: bom.revision, salesOrder: salesOrder.number })
      .from(workOrder)
      .innerJoin(item, eq(item.id, workOrder.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .innerJoin(bom, eq(bom.id, workOrder.bomId))
      .leftJoin(salesOrder, eq(salesOrder.id, workOrder.salesOrderId))
      .where(and(eq(workOrder.id, id), eq(workOrder.entityId, entityId)));
    if (!row) throw new NotFoundException('Work order not found');
    const whs = new Map((await db.select({ id: warehouse.id, name: warehouse.name }).from(warehouse).where(inArray(warehouse.id, [row.wo.sourceWarehouseId, row.wo.targetWarehouseId]))).map((w) => [w.id, w.name]));
    const net = await this.orders.netIssued(db, id);
    const materials = (
      await db
        .select({ m: workOrderMaterial, itemCode: item.code, itemName: item.name, tracking: item.tracking, uom: uom.code })
        .from(workOrderMaterial)
        .innerJoin(item, eq(item.id, workOrderMaterial.itemId))
        .innerJoin(uom, eq(uom.id, item.stockUomId))
        .where(eq(workOrderMaterial.workOrderId, id))
        .orderBy(asc(workOrderMaterial.lineNo))
    ).map((r) => {
      const lines = [...net.values()].filter((n) => n.itemId === r.m.itemId);
      return { ...r.m, itemCode: r.itemCode, itemName: r.itemName, tracking: r.tracking, uom: r.uom, issuedQty: lines.reduce((s, n) => s.add(n.qty), Dec.ZERO).toString() };
    });
    // Material issued that isn't on the BOM (substitutes, extra consumables) is shown too.
    const extraIds = [...new Set([...net.values()].map((n) => n.itemId).filter((i) => !materials.some((m) => m.itemId === i)))];
    const extras = extraIds.length
      ? (await db.select({ id: item.id, code: item.code, name: item.name, tracking: item.tracking, uom: uom.code }).from(item).innerJoin(uom, eq(uom.id, item.stockUomId)).where(inArray(item.id, extraIds))).map((i) => ({
          itemId: i.id,
          itemCode: i.code,
          itemName: i.name,
          tracking: i.tracking,
          uom: i.uom,
          issuedQty: [...net.values()].filter((n) => n.itemId === i.id).reduce((s, n) => s.add(n.qty), Dec.ZERO).toString(),
        }))
      : [];
    const operations = await db
      .select({ op: workOrderOperation, workCentre: workCentre.name, hourlyRate: workCentre.hourlyRate })
      .from(workOrderOperation)
      .innerJoin(workCentre, eq(workCentre.id, workOrderOperation.workCentreId))
      .where(eq(workOrderOperation.workOrderId, id))
      .orderBy(asc(workOrderOperation.seq));
    const cards = await this.cards(db, entityId, { workOrderId: id });
    const entries = await db
      .select({ id: stockEntry.id, number: stockEntry.number, purpose: stockEntry.purpose, status: stockEntry.status, postingDate: stockEntry.postingDate, reference: stockEntry.reference, submittedAt: stockEntry.submittedAt, cancelReason: stockEntry.cancelReason })
      .from(stockEntry)
      .where(eq(stockEntry.workOrderId, id))
      .orderBy(asc(stockEntry.createdAt));
    const lines = entries.length
      ? await db
          .select({ entryId: stockEntryLine.entryId, itemId: stockEntryLine.itemId, itemCode: item.code, itemName: item.name, qty: stockEntryLine.qty, value: stockEntryLine.value, rate: stockEntryLine.rate, batchId: stockEntryLine.batchId, batchNo: batch.batchNo, heatNo: batch.heatNo, warehouse: warehouse.name })
          .from(stockEntryLine)
          .innerJoin(item, eq(item.id, stockEntryLine.itemId))
          .leftJoin(batch, eq(batch.id, stockEntryLine.batchId))
          .leftJoin(warehouse, sql`${warehouse.id} = coalesce(${stockEntryLine.fromWarehouseId}, ${stockEntryLine.toWarehouseId})`)
          .where(inArray(stockEntryLine.entryId, entries.map((e) => e.id)))
          .orderBy(asc(stockEntryLine.lineNo))
      : [];
    const costs = await db.select().from(workOrderCost).where(eq(workOrderCost.workOrderId, id));
    // Live as-built rows (decision 046): which component serial is in which assembly serial.
    const assembly = alias(batch, 'assembly');
    const asBuilt = await db
      .select({ assemblyBatchId: serialComponent.assemblyBatchId, assemblyNo: assembly.batchNo, componentBatchId: serialComponent.componentBatchId, componentNo: batch.batchNo })
      .from(serialComponent)
      .innerJoin(batch, eq(batch.id, serialComponent.componentBatchId))
      .innerJoin(assembly, eq(assembly.id, serialComponent.assemblyBatchId))
      .where(and(eq(serialComponent.workOrderId, id), isNull(serialComponent.reversalOf), sql`not exists (select 1 from serial_component r where r.reversal_of = ${serialComponent.id})`));
    const sum = (k: string) => costs.filter((c) => c.kind === k).reduce((s, c) => s.add(c.amount), Dec.ZERO);
    const wip = costs.reduce((s, c) => s.add(c.amount), Dec.ZERO);
    return {
      ...row.wo,
      itemCode: row.itemCode,
      itemName: row.itemName,
      tracking: row.tracking,
      uom: row.uom,
      revision: row.revision,
      salesOrder: row.salesOrder,
      sourceWarehouse: whs.get(row.wo.sourceWarehouseId),
      targetWarehouse: whs.get(row.wo.targetWarehouseId),
      materials: [...materials, ...extras.map((e) => ({ ...e, id: null, lineNo: null, qtyPerUnit: null, requiredQty: null, backflush: false }))],
      operations: operations.map((o) => ({
        ...o.op,
        workCentre: o.workCentre,
        hourlyRate: o.hourlyRate,
        actualMinutes: cards.filter((c) => c.operationId === o.op.id && c.status === 'completed').reduce((s, c) => s.add(c.minutes ?? '0'), Dec.ZERO).toString(),
        goodQty: cards.filter((c) => c.operationId === o.op.id && c.status === 'completed').reduce((s, c) => s.add(c.goodQty ?? '0'), Dec.ZERO).toString(),
      })),
      jobCards: cards,
      movements: entries.map((e) => ({ ...e, backflush: e.reference === 'Backflush', lines: lines.filter((l) => l.entryId === e.id) })),
      asBuilt,
      cost: {
        material: sum('issue').add(sum('return')).toString(),
        absorbed: sum('absorption').toString(),
        output: sum('output').neg().toString(),
        variance: sum('variance').neg().toString(),
        wip: wip.toString(),
        unitCost: Dec.of(row.wo.producedQty).gt('0') ? sum('output').neg().div(row.wo.producedQty).toString() : null,
      },
    };
  }
}
