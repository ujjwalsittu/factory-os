// Work orders (decision 044): release freezes the BOM, stock moves through system stock entries, job cards
// absorb time, outputs are valued at actual cost and close sends what is left in WIP to variance.
import { absorptionValue, Dec, formatSerial, isWholeUnits, nextJobCardState, outputValue, runningMinutes, scaleBomQty, splitEqually, type JobCardState } from '@factoryos/core';
import {
  batch,
  bom,
  bomMaterial,
  bomOperation,
  type Database,
  item,
  jobCard,
  jobCardEvent,
  machine,
  serialComponent,
  serialCounter,
  stockBin,
  stockEntry,
  stockEntryLine,
  warehouse,
  workCentre,
  workOrder,
  workOrderCost,
  workOrderMaterial,
  workOrderOperation,
} from '@factoryos/db';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { businessDate, lockAccounting, type Tx } from '../accounting/accounting-lock.js';
import { seedChart } from '../accounting/chart.js';
import { GlPostingService } from '../accounting/gl-posting.service.js';
import { OperationalPostings } from '../accounting/operational-postings.js';
import { StockPostingService } from '../stock-posting.service.js';
import { QualityService } from '../quality/quality.service.js';
import { JobWorkService } from './job-work.service.js';

type WorkOrder = typeof workOrder.$inferSelect;
type Purpose = 'production_issue' | 'production_return' | 'production_output';
export interface MovementLine {
  itemId: string;
  qty: string;
  batchId?: string | null;
  warehouseId?: string | null;
}

@Injectable()
export class WorkOrderService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
    private readonly accounting: OperationalPostings,
    private readonly gl: GlPostingService,
    private readonly jobWork: JobWorkService,
    private readonly quality: QualityService,
  ) {}

  /** Every mutation: accounting lock first (the stock engine takes it too), then the work order row. */
  run<T>(ctx: TenantRequestContext, entityId: string, workOrderId: string, f: (tx: Tx, wo: WorkOrder) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      await this.prepareIn(tx, ctx, entityId);
      return f(tx, await this.lock(tx, entityId, workOrderId));
    });
  }

  /** Accounting lock and the chart roles manufacturing posts to (books active only). */
  async prepareIn(tx: Tx, ctx: TenantRequestContext, entityId: string) {
    await lockAccounting(tx, entityId);
    if (await this.gl.active(tx, entityId)) await seedChart(tx, ctx, entityId);
  }

  async lock(tx: Tx, entityId: string, id: string) {
    const [wo] = await tx.select().from(workOrder).where(and(eq(workOrder.id, id), eq(workOrder.entityId, entityId))).for('update');
    if (!wo) throw new NotFoundException('Work order not found');
    return wo;
  }

  async releaseIn(tx: Tx, ctx: TenantRequestContext, entityId: string, wo: WorkOrder) {
    if (wo.status !== 'draft') throw new ConflictException(`Only drafts can be released (this one is ${wo.status})`);
    if (!wo.bomId) throw new BadRequestException('A rework order is released from its NCR');
    const [b] = await tx.select().from(bom).where(and(eq(bom.id, wo.bomId), eq(bom.entityId, entityId)));
    if (!b || b.itemId !== wo.itemId) throw new BadRequestException('The BOM is not for this item');
    if (b.status !== 'active') throw new BadRequestException(`BOM revision ${b.revision} is ${b.status}; only active BOMs can be released`);
    const mats = await tx.select().from(bomMaterial).where(eq(bomMaterial.bomId, b.id)).orderBy(asc(bomMaterial.lineNo));
    const ops = await tx.select().from(bomOperation).where(eq(bomOperation.bomId, b.id)).orderBy(asc(bomOperation.seq));
    if (mats.length)
      await tx.insert(workOrderMaterial).values(
        mats.map((m) => ({
          workOrderId: wo.id,
          lineNo: m.lineNo,
          itemId: m.itemId,
          qtyPerUnit: Dec.of(m.qty).div(b.quantity).toString(),
          requiredQty: scaleBomQty(m.qty, b.quantity, wo.plannedQty),
          backflush: m.backflush,
        })),
      );
    if (ops.length)
      await tx.insert(workOrderOperation).values(
        ops.map((o) => ({
          workOrderId: wo.id,
          seq: o.seq,
          name: o.name,
          workCentreId: o.workCentreId,
          outsourced: o.outsourced,
          supplierId: o.supplierId,
          plannedMinutes: Dec.of(o.setupMinutes).add(scaleBomQty(o.runMinutesPerUnit, '1', wo.plannedQty)).toString(),
          instructions: o.instructions,
        })),
      );
    const date = businessDate();
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'work_order', date);
    const [after] = await tx
      .update(workOrder)
      .set({ status: 'released', number, releasedBy: ctx.user.id, releasedAt: new Date(), updatedAt: new Date() })
      .where(eq(workOrder.id, wo.id))
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_order.release', targetType: 'work_order', targetId: wo.id, after: { number, bomRevision: b.revision } }, tx);
    return after!;
  }

  /**
   * Rework or repair of an NCR disposition (decision 048): a released, BOM-less work order that issues the
   * nonconforming quantity from MRB, takes rework time on one operation and outputs the item again (through
   * final inspection when the item needs it).
   */
  async createReworkIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    input: { ncrId: string; ncrNumber: string | null; kind: 'rework' | 'repair'; itemId: string; batchId: string | null; qty: string; mrbWarehouseId: string; targetWarehouseId: string; workCentreId: string },
  ) {
    const [centre] = await tx.select().from(workCentre).where(and(eq(workCentre.id, input.workCentreId), eq(workCentre.entityId, entityId)));
    if (!centre?.isActive) throw new BadRequestException({ message: 'Choose an active work centre for the rework', issues: [{ path: 'workCentreId', message: 'Required' }] });
    const [target] = await tx.select().from(warehouse).where(and(eq(warehouse.id, input.targetWarehouseId), eq(warehouse.entityId, entityId)));
    if (!target || ['mrb', 'at_job_worker', 'customer_owned'].includes(target.type)) throw new BadRequestException({ message: 'Choose where reworked goods go', issues: [{ path: 'targetWarehouseId', message: 'Required' }] });
    const date = businessDate();
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'work_order', date);
    const [wo] = await tx
      .insert(workOrder)
      .values({ tenantId: ctx.tenant.tenantId, entityId, number, status: 'released', itemId: input.itemId, bomId: null, reworkOfNcrId: input.ncrId, plannedQty: input.qty, sourceWarehouseId: input.mrbWarehouseId, targetWarehouseId: target.id, remarks: `${input.kind === 'repair' ? 'Repair' : 'Rework'} for NCR ${input.ncrNumber}`, releasedBy: ctx.user.id, releasedAt: new Date(), createdBy: ctx.user.id })
      .returning();
    await tx.insert(workOrderMaterial).values({ workOrderId: wo!.id, lineNo: 1, itemId: input.itemId, qtyPerUnit: '1', requiredQty: input.qty, backflush: false });
    await tx.insert(workOrderOperation).values({ workOrderId: wo!.id, seq: 10, name: input.kind === 'repair' ? 'Repair' : 'Rework', workCentreId: centre.id, plannedMinutes: '0' });
    const issue = await this.movement(tx, ctx, entityId, wo!, 'production_issue', date, [{ itemId: input.itemId, qty: input.qty, batchId: input.batchId, from: input.mrbWarehouseId }], `ncr:${input.ncrId}`);
    await this.cost(tx, ctx, entityId, wo!, 'issue', date, await this.entryValue(tx, issue.id), { stockEntryId: issue.id });
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_order.rework', targetType: 'work_order', targetId: wo!.id, after: { number, ncr: input.ncrNumber, qty: input.qty } }, tx);
    return wo!;
  }

  /** Only while nothing has been posted against it (or everything posted was reversed). */
  async cancelIn(tx: Tx, ctx: TenantRequestContext, entityId: string, wo: WorkOrder, reason: string) {
    if (wo.status === 'cancelled' || wo.status === 'completed') throw new ConflictException(`A ${wo.status} work order can't be cancelled`);
    const [entry] = await tx.select({ id: stockEntry.id }).from(stockEntry).where(and(eq(stockEntry.workOrderId, wo.id), eq(stockEntry.status, 'submitted'))).limit(1);
    if (entry) throw new ConflictException('Material has moved on this work order; cancel those movements first');
    const [card] = await tx.select({ id: jobCard.id }).from(jobCard).where(and(eq(jobCard.workOrderId, wo.id), inArray(jobCard.status, ['running', 'paused', 'completed']))).limit(1);
    if (card) throw new ConflictException('Job cards are open or completed on this work order; cancel them first');
    const [after] = await tx
      .update(workOrder)
      .set({ status: 'cancelled', cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() })
      .where(eq(workOrder.id, wo.id))
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_order.cancel', targetType: 'work_order', targetId: wo.id, reason }, tx);
    return after!;
  }

  async issueIn(tx: Tx, ctx: TenantRequestContext, entityId: string, wo: WorkOrder, postingDate: string, lines: MovementLine[]) {
    this.assertOpen(wo);
    const items = await this.items(tx, lines.map((l) => l.itemId));
    for (const [i, l] of lines.entries()) {
      const it = items.get(l.itemId)!;
      if (l.itemId === wo.itemId) throw new BadRequestException(`Line ${i + 1}: a work order can't consume the item it makes`);
      if (it.tracking !== 'none' && !l.batchId) throw new BadRequestException(`Line ${i + 1}: ${it.code} is ${it.tracking}-tracked; choose the ${it.tracking === 'serial' ? 'serial' : 'batch / heat'}`);
    }
    const entry = await this.movement(tx, ctx, entityId, wo, 'production_issue', postingDate, lines.map((l) => ({ ...l, from: l.warehouseId ?? wo.sourceWarehouseId })));
    await this.cost(tx, ctx, entityId, wo, 'issue', postingDate, await this.entryValue(tx, entry.id), { stockEntryId: entry.id });
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_order.issue', targetType: 'work_order', targetId: wo.id, after: { entry: entry.number } }, tx);
    return entry;
  }

  /** Unused material back to stores, at the cost it was issued at (per item and batch). */
  async returnIn(tx: Tx, ctx: TenantRequestContext, entityId: string, wo: WorkOrder, postingDate: string, lines: MovementLine[]) {
    this.assertOpen(wo);
    await this.assertNoOutput(tx, wo, 'Return material before recording output, or cancel the outputs first');
    const net = await this.netIssued(tx, wo.id);
    const priced = lines.map((l, i) => {
      const key = `${l.itemId}:${l.batchId ?? ''}`;
      const n = net.get(key);
      if (!n || Dec.of(l.qty).gt(n.qty)) throw new BadRequestException(`Line ${i + 1}: only ${n ? Dec.of(n.qty).toFixed(3) : '0'} of this item${l.batchId ? '/batch' : ''} is issued to the work order`);
      const rate = Dec.of(n.value).div(n.qty);
      return { ...l, to: l.warehouseId ?? wo.sourceWarehouseId, rate: rate.toString() };
    });
    const entry = await this.movement(tx, ctx, entityId, wo, 'production_return', postingDate, priced);
    await this.cost(tx, ctx, entityId, wo, 'return', postingDate, Dec.of(await this.entryValue(tx, entry.id)).neg().toString(), { stockEntryId: entry.id });
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_order.return', targetType: 'work_order', targetId: wo.id, after: { entry: entry.number } }, tx);
    return entry;
  }

  /** Finished goods into stock: backflush first, then value the output from WIP (actual costing). */
  async outputIn(tx: Tx, ctx: TenantRequestContext, entityId: string, wo: WorkOrder, postingDate: string, input: { qty: string; batchNo?: string | null; warehouseId?: string | null; asBuilt?: string[][] }) {
    this.assertOpen(wo);
    const q = Dec.of(input.qty);
    const [it] = await tx.select().from(item).where(eq(item.id, wo.itemId));
    const serial = it!.tracking === 'serial';
    if (serial && !isWholeUnits(q.toString())) throw new BadRequestException(`${it!.code} is serial-tracked; output whole units`);
    await this.jobWork.assertOutputAllowed(tx, wo.id, Dec.of(wo.producedQty).add(q).toString());
    const asBuilt = serial ? await this.checkAsBuilt(tx, wo, Number(q.toString()), input.asBuilt) : [];
    let backflushEntryId: string | null = null;
    const flush = (await tx.select().from(workOrderMaterial).where(and(eq(workOrderMaterial.workOrderId, wo.id), eq(workOrderMaterial.backflush, true)))).map((m) => ({
      itemId: m.itemId,
      qty: Dec.of(m.qtyPerUnit).mul(q).toString(),
      from: wo.sourceWarehouseId,
    })).filter((m) => Dec.of(m.qty).gt('0'));
    if (flush.length) {
      const bf = await this.movement(tx, ctx, entityId, wo, 'production_issue', postingDate, flush, 'Backflush');
      await this.cost(tx, ctx, entityId, wo, 'issue', postingDate, await this.entryValue(tx, bf.id), { stockEntryId: bf.id });
      backflushEntryId = bf.id;
    }
    const value = outputValue({ wipBalance: await this.wip(tx, wo.id), outputQty: q.toString(), plannedQty: wo.plannedQty, producedQty: wo.producedQty });
    const outputs = await this.outputCount(tx, wo.id);
    const destination = input.warehouseId ?? wo.targetWarehouseId;
    // Decision 048: items needing final inspection wait in Quarantine until an inspection releases them.
    const hold = it!.requiresFinalInspection ? await this.quality.holdWarehouse(tx, ctx, entityId, 'quarantine') : null;
    const to = hold?.id ?? destination;
    let outLines: { itemId: string; qty: string; to: string; rate: string; newBatchNo: string | null }[];
    if (serial) {
      // Decision 046: one generated serial per unit, each carrying an equal share of the value (last takes the remainder).
      const n = Number(q.toString());
      const [counter] = await tx
        .insert(serialCounter)
        .values({ tenantId: ctx.tenant.tenantId, itemId: it!.id, nextValue: n + 1 })
        .onConflictDoUpdate({ target: [serialCounter.tenantId, serialCounter.itemId], set: { nextValue: sql`${serialCounter.nextValue} + ${n}` } })
        .returning({ next: serialCounter.nextValue });
      const first = counter!.next - n;
      const parts = splitEqually(value, n);
      outLines = parts.map((part, k) => ({ itemId: wo.itemId, qty: '1', to, rate: part, newBatchNo: formatSerial(it!.serialPrefix || it!.code, first + k) }));
    } else {
      const batchNo = it!.tracking === 'batch' ? (input.batchNo?.trim() || (outputs ? `${wo.number}-${outputs + 1}` : wo.number!)) : null;
      outLines = [{ itemId: wo.itemId, qty: q.toString(), to, rate: Dec.of(value).div(q).toString(), newBatchNo: batchNo }];
    }
    const entry = await this.movement(tx, ctx, entityId, wo, 'production_output', postingDate, outLines, backflushEntryId ? `backflush:${backflushEntryId}` : null);
    if (hold) {
      const made = await tx.select().from(stockEntryLine).where(eq(stockEntryLine.entryId, entry.id)).orderBy(asc(stockEntryLine.lineNo));
      for (const l of made)
        await this.quality.openRecordIn(tx, ctx, entityId, { stage: 'final', itemId: l.itemId, batchId: l.batchId, qty: l.qty, sourceType: 'output', sourceId: l.id, workOrderId: wo.id, holdWarehouseId: hold.id, acceptWarehouseId: destination });
    }
    if (asBuilt.length) {
      const made = await tx.select({ lineNo: stockEntryLine.lineNo, batchId: stockEntryLine.batchId }).from(stockEntryLine).where(eq(stockEntryLine.entryId, entry.id)).orderBy(asc(stockEntryLine.lineNo));
      const rows = asBuilt.flatMap((components, k) => components.map((componentBatchId) => ({ tenantId: ctx.tenant.tenantId, entityId, assemblyBatchId: made[k]!.batchId!, componentBatchId, workOrderId: wo.id, stockEntryId: entry.id, createdBy: ctx.user.id })));
      if (rows.length) await tx.insert(serialComponent).values(rows);
    }
    // The stock line's value (qty × rate, rounded) is what leaves WIP; any rounding stays for the close.
    await this.cost(tx, ctx, entityId, wo, 'output', postingDate, Dec.of(await this.entryValue(tx, entry.id)).neg().toString(), { stockEntryId: entry.id, qty: q.toString() });
    await tx.update(workOrder).set({ producedQty: Dec.of(wo.producedQty).add(q).toString(), updatedAt: new Date() }).where(eq(workOrder.id, wo.id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_order.output', targetType: 'work_order', targetId: wo.id, after: { entry: entry.number, qty: q.toString(), value } }, tx);
    return entry;
  }

  /** Reverses one movement. Outputs go newest first; issues and returns only while no output stands. */
  async cancelEntryIn(tx: Tx, ctx: TenantRequestContext, entityId: string, wo: WorkOrder, entryId: string, reason: string) {
    this.assertOpen(wo);
    const [entry] = await tx.select().from(stockEntry).where(and(eq(stockEntry.id, entryId), eq(stockEntry.workOrderId, wo.id))).for('update');
    if (!entry) throw new NotFoundException('Movement not found on this work order');
    if (entry.status !== 'submitted') throw new ConflictException('This movement is already cancelled');
    if (entry.purpose === 'production_output') {
      const [latest] = await tx
        .select({ id: stockEntry.id })
        .from(stockEntry)
        .where(and(eq(stockEntry.workOrderId, wo.id), eq(stockEntry.purpose, 'production_output'), eq(stockEntry.status, 'submitted')))
        .orderBy(desc(stockEntry.submittedAt))
        .limit(1);
      if (latest?.id !== entry.id) throw new ConflictException('Cancel the later outputs first');
      const [row] = await tx.select().from(workOrderCost).where(and(eq(workOrderCost.stockEntryId, entry.id), isNull(workOrderCost.reversalOf)));
      await this.quality.releaseHoldIn(tx, 'output', (await tx.select({ id: stockEntryLine.id }).from(stockEntryLine).where(eq(stockEntryLine.entryId, entry.id))).map((l) => l.id));
      await this.posting.cancelIn(tx, ctx, entityId, entry.id, reason);
      await this.reverseCost(tx, ctx, row!);
      // As-built rows of the cancelled assembly serials are reversed, which frees their components.
      const built = await tx.select().from(serialComponent).where(and(eq(serialComponent.stockEntryId, entry.id), isNull(serialComponent.reversalOf)));
      if (built.length)
        await tx.insert(serialComponent).values(built.map((b) => ({ tenantId: b.tenantId, entityId: b.entityId, assemblyBatchId: b.assemblyBatchId, componentBatchId: b.componentBatchId, workOrderId: b.workOrderId, stockEntryId: b.stockEntryId, reversalOf: b.id, createdBy: ctx.user.id })));
      await tx.update(workOrder).set({ producedQty: Dec.of(wo.producedQty).sub(row!.qty!).toString(), updatedAt: new Date() }).where(eq(workOrder.id, wo.id));
      const flushed = entry.reference?.startsWith('backflush:') ? entry.reference.slice('backflush:'.length) : null;
      if (flushed) {
        const [bfRow] = await tx.select().from(workOrderCost).where(and(eq(workOrderCost.stockEntryId, flushed), isNull(workOrderCost.reversalOf)));
        await this.posting.cancelIn(tx, ctx, entityId, flushed, `${reason} (backflush of the cancelled output)`);
        await this.reverseCost(tx, ctx, bfRow!);
      }
    } else {
      await this.assertNoOutput(tx, wo, 'Cancel the outputs first: their value was taken from this material');
      if (entry.reference === 'Backflush') throw new ConflictException('Backflush is cancelled with its output');
      const [row] = await tx.select().from(workOrderCost).where(and(eq(workOrderCost.stockEntryId, entry.id), isNull(workOrderCost.reversalOf)));
      await this.posting.cancelIn(tx, ctx, entityId, entry.id, reason);
      await this.reverseCost(tx, ctx, row!);
    }
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_order.cancel_movement', targetType: 'work_order', targetId: wo.id, reason, after: { entry: entry.number, purpose: entry.purpose } }, tx);
    return { cancelled: entry.number };
  }

  /** What is left in WIP (labour after the last output, unused issues, rounding) goes to manufacturing variance. */
  async closeIn(tx: Tx, ctx: TenantRequestContext, entityId: string, wo: WorkOrder, postingDate: string) {
    if (wo.status !== 'released') throw new ConflictException(`Only released work orders can be closed (this one is ${wo.status})`);
    const [running] = await tx.select({ id: jobCard.id }).from(jobCard).where(and(eq(jobCard.workOrderId, wo.id), inArray(jobCard.status, ['running', 'paused']))).limit(1);
    if (running) throw new ConflictException('A job card is still running on this work order; stop it first');
    const balance = Dec.of(await this.wip(tx, wo.id));
    if (!balance.isZero()) await this.cost(tx, ctx, entityId, wo, 'variance', postingDate, balance.neg().toString(), {});
    const [after] = await tx
      .update(workOrder)
      .set({ status: 'completed', completedBy: ctx.user.id, completedAt: new Date(), completedOn: postingDate, updatedAt: new Date() })
      .where(eq(workOrder.id, wo.id))
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_order.close', targetType: 'work_order', targetId: wo.id, after: { variance: balance.toString() } }, tx);
    return after!;
  }

  async reopenIn(tx: Tx, ctx: TenantRequestContext, entityId: string, wo: WorkOrder, reason: string) {
    if (wo.status !== 'completed') throw new ConflictException('Only completed work orders can be reopened');
    const [row] = await tx
      .select()
      .from(workOrderCost)
      .where(and(eq(workOrderCost.workOrderId, wo.id), eq(workOrderCost.kind, 'variance'), isNull(workOrderCost.reversalOf), sql`not exists (select 1 from work_order_cost r where r.reversal_of = ${workOrderCost.id})`))
      .orderBy(desc(workOrderCost.createdAt))
      .limit(1);
    if (row) await this.reverseCost(tx, ctx, row);
    const [after] = await tx.update(workOrder).set({ status: 'released', completedBy: null, completedAt: null, completedOn: null, updatedAt: new Date() }).where(eq(workOrder.id, wo.id)).returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_order.reopen', targetType: 'work_order', targetId: wo.id, reason }, tx);
    return after!;
  }

  // Job cards ---------------------------------------------------------------------------------------------

  async startCardIn(tx: Tx, ctx: TenantRequestContext, entityId: string, wo: WorkOrder, operationId: string, machineId: string | null) {
    this.assertOpen(wo);
    const [op] = await tx.select().from(workOrderOperation).where(and(eq(workOrderOperation.id, operationId), eq(workOrderOperation.workOrderId, wo.id)));
    if (!op) throw new NotFoundException('Operation not found on this work order');
    if (op.outsourced) throw new BadRequestException(`Operation ${op.seq} is done by a job worker; send the pieces from the work order instead of starting a job card`);
    if (machineId) {
      const [m] = await tx.select().from(machine).where(and(eq(machine.id, machineId), eq(machine.entityId, entityId)));
      if (!m || m.workCentreId !== op.workCentreId) throw new BadRequestException('Choose a machine of the operation\'s work centre');
      if (!m.isActive) throw new BadRequestException(`Machine ${m.code} is inactive`);
    }
    const [mine] = await tx.select({ id: jobCard.id }).from(jobCard).where(and(eq(jobCard.operatorId, ctx.user.id), inArray(jobCard.status, ['running', 'paused']))).limit(1);
    if (mine) throw new ConflictException('You already have a job card open; stop it before starting another');
    const [card] = await tx
      .insert(jobCard)
      .values({ tenantId: ctx.tenant.tenantId, entityId, workOrderId: wo.id, operationId, machineId, operatorId: ctx.user.id, status: 'running' })
      .returning();
    await tx.insert(jobCardEvent).values({ jobCardId: card!.id, kind: 'start', by: ctx.user.id });
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_card.start', targetType: 'job_card', targetId: card!.id, after: { workOrder: wo.number, seq: op.seq } }, tx);
    return card!;
  }

  async lockCard(tx: Tx, entityId: string, id: string) {
    const [card] = await tx.select().from(jobCard).where(and(eq(jobCard.id, id), eq(jobCard.entityId, entityId))).for('update');
    if (!card) throw new NotFoundException('Job card not found');
    return card;
  }

  /** pause / resume by the operator who owns the card. */
  async moveCardIn(tx: Tx, ctx: TenantRequestContext, entityId: string, wo: WorkOrder, cardId: string, kind: 'pause' | 'resume', reason: string | null) {
    const card = await this.lockCard(tx, entityId, cardId);
    if (card.operatorId !== ctx.user.id) throw new ConflictException('Only the operator running this card can pause or resume it');
    if (card.status === 'cancelled') throw new ConflictException('This job card is cancelled');
    const next = this.next(card.status as JobCardState, kind);
    if (kind === 'pause' && !reason) throw new BadRequestException('Choose why the job is paused');
    await tx.insert(jobCardEvent).values({ jobCardId: card.id, kind, reason, by: ctx.user.id });
    const [after] = await tx.update(jobCard).set({ status: next as 'running' | 'paused' }).where(eq(jobCard.id, card.id)).returning();
    return after!;
  }

  /** Completion: hours from the events, valued at today's work centre rate and absorbed into WIP. */
  async stopCardIn(tx: Tx, ctx: TenantRequestContext, entityId: string, wo: WorkOrder, cardId: string, input: { goodQty: string; reworkQty: string; scrapQty: string; remarks?: string | null }) {
    this.assertOpen(wo);
    const card = await this.lockCard(tx, entityId, cardId);
    if (card.operatorId !== ctx.user.id) throw new ConflictException('Only the operator running this card can stop it');
    if (card.status === 'cancelled') throw new ConflictException('This job card is cancelled');
    this.next(card.status as JobCardState, 'stop');
    const now = new Date();
    await tx.insert(jobCardEvent).values({ jobCardId: card.id, kind: 'stop', at: now, by: ctx.user.id });
    const events = await tx.select().from(jobCardEvent).where(eq(jobCardEvent.jobCardId, card.id)).orderBy(asc(jobCardEvent.at), asc(jobCardEvent.id));
    const minutes = runningMinutes(events, now);
    const [op] = await tx.select().from(workOrderOperation).where(eq(workOrderOperation.id, card.operationId));
    const [centre] = await tx.select().from(workCentre).where(eq(workCentre.id, op!.workCentreId!));
    const value = absorptionValue(minutes, centre!.hourlyRate);
    const postingDate = businessDate();
    const [after] = await tx
      .update(jobCard)
      .set({ status: 'completed', goodQty: input.goodQty, reworkQty: input.reworkQty, scrapQty: input.scrapQty, remarks: input.remarks ?? null, minutes, hourlyRate: centre!.hourlyRate, value, postingDate, completedAt: now })
      .where(eq(jobCard.id, card.id))
      .returning();
    await this.cost(tx, ctx, entityId, wo, 'absorption', postingDate, value, { jobCardId: card.id });
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_card.stop', targetType: 'job_card', targetId: card.id, after: { minutes, value, good: input.goodQty, rework: input.reworkQty, scrap: input.scrapQty } }, tx);
    return after!;
  }

  /** A running card is simply withdrawn; a completed one has its absorption reversed (only while no output stands). */
  async cancelCardIn(tx: Tx, ctx: TenantRequestContext, entityId: string, wo: WorkOrder, cardId: string, reason: string) {
    this.assertOpen(wo);
    const card = await this.lockCard(tx, entityId, cardId);
    if (card.status === 'cancelled') throw new ConflictException('This job card is already cancelled');
    if (card.status === 'completed') {
      await this.assertNoOutput(tx, wo, 'Cancel the outputs first: their value includes this job card');
      const [row] = await tx.select().from(workOrderCost).where(and(eq(workOrderCost.jobCardId, card.id), isNull(workOrderCost.reversalOf)));
      if (row) await this.reverseCost(tx, ctx, row);
    } else {
      await tx.insert(jobCardEvent).values({ jobCardId: card.id, kind: 'stop', reason: `Cancelled: ${reason}`, by: ctx.user.id });
    }
    const [after] = await tx.update(jobCard).set({ status: 'cancelled', cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: reason }).where(eq(jobCard.id, card.id)).returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_card.cancel', targetType: 'job_card', targetId: card.id, reason }, tx);
    return after!;
  }

  // Shared ------------------------------------------------------------------------------------------------

  /** Sum of the WIP ledger. */
  async wip(db: Database | Tx, workOrderId: string): Promise<string> {
    const [r] = await db.select({ v: sql<string>`coalesce(sum(${workOrderCost.amount}), 0)` }).from(workOrderCost).where(eq(workOrderCost.workOrderId, workOrderId));
    return Dec.of(r!.v).toString();
  }

  /** Issued minus returned, per item and batch, from submitted movements. */
  async netIssued(db: Database | Tx, workOrderId: string) {
    const rows = await db
      .select({ purpose: stockEntry.purpose, itemId: stockEntryLine.itemId, batchId: stockEntryLine.batchId, qty: stockEntryLine.qty, value: stockEntryLine.value })
      .from(stockEntryLine)
      .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
      .where(and(eq(stockEntry.workOrderId, workOrderId), eq(stockEntry.status, 'submitted'), inArray(stockEntry.purpose, ['production_issue', 'production_return'])));
    const net = new Map<string, { itemId: string; batchId: string | null; qty: string; value: string }>();
    for (const r of rows) {
      const key = `${r.itemId}:${r.batchId ?? ''}`;
      const sign = r.purpose === 'production_issue' ? 1 : -1;
      const cur = net.get(key) ?? { itemId: r.itemId, batchId: r.batchId, qty: '0', value: '0' };
      net.set(key, {
        ...cur,
        qty: Dec.of(cur.qty).add(sign > 0 ? r.qty : Dec.of(r.qty).neg()).toString(),
        value: Dec.of(cur.value).add(sign > 0 ? (r.value ?? '0') : Dec.of(r.value ?? '0').neg()).toString(),
      });
    }
    for (const [k, v] of net) if (!Dec.of(v.qty).gt('0')) net.delete(k);
    return net;
  }

  /**
   * As-built (decision 046): for each new assembly serial, the component serials that went into it. Required when the
   * BOM has serial-tracked materials: each assembly gets exactly qty-per-unit serials of each, issued to this work
   * order and not already in another live assembly.
   */
  private async checkAsBuilt(tx: Tx, wo: WorkOrder, units: number, asBuilt: string[][] | undefined): Promise<string[][]> {
    const mats = await tx
      .select({ itemId: workOrderMaterial.itemId, qtyPerUnit: workOrderMaterial.qtyPerUnit, code: item.code })
      .from(workOrderMaterial)
      .innerJoin(item, eq(item.id, workOrderMaterial.itemId))
      .where(and(eq(workOrderMaterial.workOrderId, wo.id), eq(item.tracking, 'serial')));
    if (!mats.length) {
      if (asBuilt?.some((a) => a.length)) throw new BadRequestException('This BOM has no serial-tracked components to record');
      return [];
    }
    if (!asBuilt || asBuilt.length !== units) throw new BadRequestException(`Record the component serials for each of the ${units} assemblies`);
    const net = await this.netIssued(tx, wo.id);
    const issued = new Map([...net.values()].filter((n) => n.batchId).map((n) => [n.batchId!, n.itemId]));
    const ids = [...new Set(asBuilt.flat())];
    if (ids.length !== asBuilt.flat().length) throw new BadRequestException('A component serial is listed twice');
    const live = ids.length
      ? await tx
          .select({ componentBatchId: serialComponent.componentBatchId })
          .from(serialComponent)
          .where(and(inArray(serialComponent.componentBatchId, ids), isNull(serialComponent.reversalOf), sql`not exists (select 1 from serial_component r where r.reversal_of = ${serialComponent.id})`))
      : [];
    if (live.length) throw new BadRequestException('A component serial is already built into another assembly');
    asBuilt.forEach((components, k) => {
      for (const id of components) if (!issued.has(id)) throw new BadRequestException(`Assembly ${k + 1}: a component serial wasn't issued to this work order`);
      for (const m of mats) {
        const need = Dec.of(m.qtyPerUnit);
        const have = components.filter((id) => issued.get(id) === m.itemId).length;
        if (!need.eq(String(have))) throw new BadRequestException(`Assembly ${k + 1}: needs ${need.toFixed(0)} serial(s) of ${m.code}, ${have} chosen`);
      }
    });
    return asBuilt;
  }

  private assertOpen(wo: WorkOrder) {
    if (wo.status !== 'released') throw new ConflictException(wo.status === 'completed' ? 'This work order is closed; reopen it first' : `The work order is ${wo.status}; release it first`);
  }

  private next(state: JobCardState, kind: 'pause' | 'resume' | 'stop') {
    try {
      return nextJobCardState(state, kind);
    } catch (e) {
      throw new ConflictException((e as Error).message);
    }
  }

  private async assertNoOutput(tx: Tx, wo: WorkOrder, message: string) {
    if (Dec.of(wo.producedQty).gt('0')) throw new ConflictException(message);
  }

  private async outputCount(tx: Tx, workOrderId: string) {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(stockEntry)
      .where(and(eq(stockEntry.workOrderId, workOrderId), eq(stockEntry.purpose, 'production_output')));
    return r!.n;
  }

  private async items(tx: Tx, ids: string[]) {
    const rows = ids.length ? await tx.select().from(item).where(inArray(item.id, [...new Set(ids)])) : [];
    const map = new Map(rows.map((i) => [i.id, i]));
    ids.forEach((id, i) => {
      if (!map.has(id)) throw new BadRequestException(`Line ${i + 1}: unknown item`);
    });
    return map;
  }

  private async entryValue(tx: Tx, entryId: string): Promise<string> {
    const [r] = await tx.select({ v: sql<string>`coalesce(sum(${stockEntryLine.value}), 0)` }).from(stockEntryLine).where(eq(stockEntryLine.entryId, entryId));
    return Dec.of(r!.v).toString();
  }

  /** A system stock entry for the work order, posted through the stock engine in this transaction. */
  private async movement(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    wo: WorkOrder,
    purpose: Purpose,
    postingDate: string,
    lines: (MovementLine & { from?: string; to?: string; rate?: string; newBatchNo?: string | null })[],
    reference: string | null = null,
  ) {
    if (!lines.length) throw new BadRequestException('Add at least one line');
    const [e] = await tx
      .insert(stockEntry)
      .values({ tenantId: ctx.tenant.tenantId, entityId, purpose, postingDate, workOrderId: wo.id, systemGenerated: true, reference, remarks: wo.number, createdBy: ctx.user.id })
      .returning();
    await tx.insert(stockEntryLine).values(
      lines.map((l, i) => ({
        entryId: e!.id,
        lineNo: i + 1,
        itemId: l.itemId,
        qty: l.qty,
        batchId: l.batchId ?? null,
        newBatchNo: l.newBatchNo ?? null,
        fromWarehouseId: purpose === 'production_issue' ? (l.from ?? null) : null,
        toWarehouseId: purpose === 'production_issue' ? null : (l.to ?? null),
        rate: l.rate ?? null,
      })),
    );
    return this.posting.submitIn(tx, ctx, entityId, e!.id);
  }

  /** Appends a WIP ledger row and posts its GL (books active only). Stock entries post their own GL. */
  private async cost(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    wo: WorkOrder,
    kind: 'issue' | 'return' | 'absorption' | 'output' | 'variance',
    postingDate: string,
    amount: string,
    ref: { stockEntryId?: string; jobCardId?: string; qty?: string },
  ) {
    const [row] = await tx
      .insert(workOrderCost)
      .values({ tenantId: ctx.tenant.tenantId, entityId, workOrderId: wo.id, kind, postingDate, amount, qty: ref.qty ?? null, stockEntryId: ref.stockEntryId ?? null, jobCardId: ref.jobCardId ?? null, createdBy: ctx.user.id })
      .returning();
    if (kind === 'absorption')
      await this.accounting.rolesIn(tx, ctx, entityId, { type: 'job_card', id: ref.jobCardId!, purpose: 'main', number: wo.number }, postingDate, [
        ['wip', amount],
        ['overhead_absorbed', Dec.of(amount).neg()],
      ]);
    if (kind === 'variance')
      await this.accounting.rolesIn(tx, ctx, entityId, { type: 'work_order_variance', id: row!.id, purpose: 'main', number: wo.number }, postingDate, [
        ['production_variance', Dec.of(amount).neg()],
        ['wip', amount],
      ]);
    return row!;
  }

  /** Appends the negating row. Stock-entry rows have their GL reversed by the stock engine's cancel. */
  private async reverseCost(tx: Tx, ctx: TenantRequestContext, row: typeof workOrderCost.$inferSelect) {
    await tx.insert(workOrderCost).values({
      tenantId: row.tenantId,
      entityId: row.entityId,
      workOrderId: row.workOrderId,
      kind: row.kind,
      postingDate: row.postingDate,
      amount: Dec.of(row.amount).neg().toString(),
      qty: row.qty === null ? null : Dec.of(row.qty).neg().toString(),
      stockEntryId: row.stockEntryId,
      jobCardId: row.jobCardId,
      reversalOf: row.id,
      createdBy: ctx.user.id,
    });
    if (row.kind === 'absorption') await this.gl.reverseIn(tx, ctx, row.entityId, { type: 'job_card', id: row.jobCardId!, purpose: 'main' }, 'Job card cancelled');
    if (row.kind === 'variance') await this.gl.reverseIn(tx, ctx, row.entityId, { type: 'work_order_variance', id: row.id, purpose: 'main' }, 'Work order reopened');
  }
}

/** Stock you can issue to a work order: our own stock in issue-able warehouses, oldest (then soonest-expiring) batch first. */
export async function availableStock(db: Database | Tx, entityId: string, itemIds: string[]) {
  if (!itemIds.length) return [];
  const rows = await db
    .select({ itemId: stockBin.itemId, warehouseId: stockBin.warehouseId, warehouse: warehouse.name, batchId: stockBin.batchId, batchNo: batch.batchNo, heatNo: batch.heatNo, expiryDate: batch.expiryDate, kind: batch.kind, lengthMm: batch.lengthMm, qty: stockBin.qty })
    .from(stockBin)
    .innerJoin(warehouse, eq(warehouse.id, stockBin.warehouseId))
    .leftJoin(batch, eq(batch.id, stockBin.batchId))
    .where(and(eq(stockBin.entityId, entityId), isNull(stockBin.ownerPartyId), gt(stockBin.qty, '0'), eq(warehouse.availableForIssue, true), inArray(stockBin.itemId, itemIds)))
    .orderBy(asc(stockBin.itemId), sql`${batch.createdAt} asc nulls first`, sql`${batch.expiryDate} asc nulls last`, asc(batch.batchNo), asc(warehouse.name));
  return rows.map((r) => ({ ...r, qty: Dec.of(r.qty).toString() }));
}
