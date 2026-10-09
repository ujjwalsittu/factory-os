// Job work outward under Sec 143 (decision 047). Conversion orders move our stock into an "At vendor" warehouse
// on a delivery challan and receive goods back by consuming it there; operation orders send work-order pieces
// (WIP, not stock) for an outsourced routing step. Receipts discharge challan lines oldest first.
import { allocateOldestFirst, consumeFifo, Dec, jobWorkDueBy, maxExtendedDueBy, scaleBomQty, type JobWorkGoodsType } from '@factoryos/core';
import {
  bom,
  bomMaterial,
  type Database,
  fifoLayer,
  gstRegistration,
  item,
  jobWorkChallan,
  jobWorkChallanLine,
  jobWorkConsumption,
  jobWorkOrder,
  jobWorkOrderLine,
  jobWorkReceipt,
  jobWorkReceiptLine,
  party,
  purchaseInvoice,
  purchaseInvoiceLine,
  stockEntry,
  stockEntryLine,
  warehouse,
  workOrder,
  workOrderCost,
  workOrderOperation,
} from '@factoryos/db';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { lockAccounting, type Tx } from '../accounting/accounting-lock.js';
import { AcquisitionCostService } from '../accounting/acquisition-cost.service.js';
import { seedChart } from '../accounting/chart.js';
import { GlPostingService } from '../accounting/gl-posting.service.js';
import { QualityService } from '../quality/quality.service.js';
import { StockPostingService } from '../stock-posting.service.js';

type Order = typeof jobWorkOrder.$inferSelect;
type Item = typeof item.$inferSelect;

export interface ConversionOrderInput {
  supplierId: string;
  targetItemId: string;
  targetQty: string;
  targetWarehouseId?: string | null;
  natureOfWork?: string | null;
  expectedReturnDate?: string | null;
  remarks?: string | null;
  materials?: { itemId: string; qty: string }[];
}
export interface ChallanInput {
  postingDate: string;
  fromWarehouseId?: string | null;
  gstRegistrationId?: string | null;
  ewayBillNo?: string | null;
  vehicleNo?: string | null;
  remarks?: string | null;
  /** Conversion: our stock by batch. Operation: one line, the number of pieces. */
  lines: { itemId?: string | null; batchId?: string | null; qty: string; goodsType?: JobWorkGoodsType | null }[];
}
export interface ReceiptInput {
  postingDate: string;
  jobWorkerChallanNo?: string | null;
  jobWorkerChallanDate?: string | null;
  remarks?: string | null;
  /** Conversion: what was used up at the job worker, per item/batch; loss and scrap are part of the quantity. */
  consumed?: { itemId: string; batchId?: string | null; qty: string; lossQty?: string | null; scrapQty?: string | null }[];
  /** Conversion: the goods received back. Operation: one line with good and rejected pieces. */
  received: { qty: string; rejectedQty?: string | null; batchId?: string | null; batchNo?: string | null; warehouseId?: string | null }[];
}

@Injectable()
export class JobWorkService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
    private readonly cost: AcquisitionCostService,
    private readonly gl: GlPostingService,
    private readonly quality: QualityService,
  ) {}

  run<T>(entityId: string, f: (tx: Tx) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      return f(tx);
    });
  }

  async lockOrder(tx: Tx, entityId: string, id: string) {
    const [o] = await tx.select().from(jobWorkOrder).where(and(eq(jobWorkOrder.id, id), eq(jobWorkOrder.entityId, entityId))).for('update');
    if (!o) throw new NotFoundException('Job work order not found');
    return o;
  }

  // Orders -----------------------------------------------------------------------------------------------

  async createConversionIn(tx: Tx, ctx: TenantRequestContext, entityId: string, input: ConversionOrderInput) {
    await this.jobWorker(tx, ctx, input.supplierId);
    const [target] = await tx.select().from(item).where(and(eq(item.id, input.targetItemId), eq(item.tenantId, ctx.tenant.tenantId)));
    if (!target) throw new BadRequestException({ message: 'Unknown item', issues: [{ path: 'targetItemId', message: 'Unknown item' }] });
    if (!target.isStockItem) throw new BadRequestException({ message: `${target.code} is not a stock item`, issues: [{ path: 'targetItemId', message: 'Choose a stock item' }] });
    if (input.targetWarehouseId) await this.ourWarehouse(tx, entityId, input.targetWarehouseId, 'targetWarehouseId');
    let materials = input.materials ?? [];
    if (!materials.length) {
      // Default: the target's active default BOM, scaled to the order quantity.
      const [b] = await tx.select().from(bom).where(and(eq(bom.entityId, entityId), eq(bom.itemId, target.id), eq(bom.status, 'active'), eq(bom.isDefault, true)));
      if (b) materials = (await tx.select().from(bomMaterial).where(eq(bomMaterial.bomId, b.id)).orderBy(asc(bomMaterial.lineNo))).map((m) => ({ itemId: m.itemId, qty: scaleBomQty(m.qty, b.quantity, input.targetQty) }));
    }
    if (!materials.length) throw new BadRequestException({ message: 'List the material to send, or give the item an active BOM', issues: [{ path: 'materials', message: 'Required' }] });
    const items = await this.items(tx, ctx, materials.map((m) => m.itemId));
    materials.forEach((m, i) => {
      if (!items.get(m.itemId)!.isStockItem) throw new BadRequestException({ message: `Material ${i + 1}: not a stock item`, issues: [{ path: `materials.${i}.itemId`, message: 'Choose a stock item' }] });
    });
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'job_work_order', new Date().toISOString().slice(0, 10));
    const [o] = await tx
      .insert(jobWorkOrder)
      .values({
        tenantId: ctx.tenant.tenantId,
        entityId,
        number,
        kind: 'conversion',
        supplierId: input.supplierId,
        targetItemId: target.id,
        targetQty: input.targetQty,
        targetWarehouseId: input.targetWarehouseId ?? null,
        natureOfWork: input.natureOfWork ?? null,
        expectedReturnDate: input.expectedReturnDate ?? null,
        remarks: input.remarks ?? null,
        createdBy: ctx.user.id,
      })
      .returning();
    await tx.insert(jobWorkOrderLine).values(materials.map((m, i) => ({ orderId: o!.id, lineNo: i + 1, itemId: m.itemId, qty: m.qty })));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_work.create', targetType: 'job_work_order', targetId: o!.id, after: { number, kind: 'conversion' } }, tx);
    return o!;
  }

  /** One order per work-order operation and job worker, reused while open. */
  async operationOrderIn(tx: Tx, ctx: TenantRequestContext, entityId: string, workOrderId: string, operationId: string, supplierId: string | null | undefined) {
    const [wo] = await tx.select().from(workOrder).where(and(eq(workOrder.id, workOrderId), eq(workOrder.entityId, entityId))).for('update');
    if (!wo) throw new NotFoundException('Work order not found');
    if (wo.status !== 'released') throw new ConflictException(`Work order ${wo.number ?? ''} is ${wo.status}; pieces go out only while it is released`);
    const [op] = await tx.select().from(workOrderOperation).where(and(eq(workOrderOperation.id, operationId), eq(workOrderOperation.workOrderId, wo.id)));
    if (!op) throw new NotFoundException('Operation not found on this work order');
    if (!op.outsourced) throw new BadRequestException(`Operation ${op.seq} is done in-house; mark it outsourced in the BOM`);
    const supplier = supplierId ?? op.supplierId;
    if (!supplier) throw new BadRequestException({ message: 'Choose the job worker', issues: [{ path: 'supplierId', message: 'Required' }] });
    await this.jobWorker(tx, ctx, supplier);
    const [open] = await tx
      .select()
      .from(jobWorkOrder)
      .where(and(eq(jobWorkOrder.workOrderOperationId, op.id), eq(jobWorkOrder.supplierId, supplier), inArray(jobWorkOrder.status, ['draft', 'open'])))
      .for('update');
    if (open) return { order: open, wo, op };
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'job_work_order', new Date().toISOString().slice(0, 10));
    const [o] = await tx
      .insert(jobWorkOrder)
      .values({ tenantId: ctx.tenant.tenantId, entityId, number, kind: 'operation', supplierId: supplier, workOrderId: wo.id, workOrderOperationId: op.id, natureOfWork: op.name, createdBy: ctx.user.id })
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_work.create', targetType: 'job_work_order', targetId: o!.id, after: { number, kind: 'operation', workOrder: wo.number, operation: op.seq } }, tx);
    return { order: o!, wo, op };
  }

  async closeIn(tx: Tx, ctx: TenantRequestContext, entityId: string, order: Order, reason: string) {
    if (order.status !== 'open') throw new ConflictException(`Only open orders can be closed (this one is ${order.status})`);
    const open = await this.openLines(tx, order.id);
    // Goods treated as supplied to the job worker (Sec 143(3)/(4)) no longer hold the order open.
    if (open.some((l) => Dec.of(l.open).gt('0') && !l.deemedSupply)) throw new ConflictException('Goods are still at the job worker; receive them first, or record the deemed supply in ITC-04');
    const [after] = await tx.update(jobWorkOrder).set({ status: 'closed', closeReason: reason, updatedAt: new Date() }).where(eq(jobWorkOrder.id, order.id)).returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_work.close', targetType: 'job_work_order', targetId: order.id, reason }, tx);
    return after!;
  }

  async cancelOrderIn(tx: Tx, ctx: TenantRequestContext, entityId: string, order: Order, reason: string) {
    if (order.status !== 'draft') throw new ConflictException('Cancel the challans first; only orders with nothing sent can be cancelled');
    const [after] = await tx.update(jobWorkOrder).set({ status: 'cancelled', closeReason: reason, updatedAt: new Date() }).where(eq(jobWorkOrder.id, order.id)).returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_work.cancel', targetType: 'job_work_order', targetId: order.id, reason }, tx);
    return after!;
  }

  // Challans ---------------------------------------------------------------------------------------------

  async sendIn(tx: Tx, ctx: TenantRequestContext, entityId: string, order: Order, input: ChallanInput) {
    if (order.status !== 'draft' && order.status !== 'open') throw new ConflictException(`This order is ${order.status}`);
    if (!input.lines.length) throw new BadRequestException('Add at least one line');
    const [supplier] = await tx.select().from(party).where(eq(party.id, order.supplierId));
    const reg = await this.registration(tx, entityId, input.gstRegistrationId);
    const supplierState = supplier!.stateCode ?? (supplier!.gstin ? supplier!.gstin.slice(0, 2) : null);
    const interstate = !!reg && !!supplierState && supplierState !== reg.stateCode;
    const vendorWh = await this.vendorWarehouse(tx, ctx, entityId, supplier!);
    let lines: { itemId: string; batchId: string | null; qty: string; value: string; goodsType: JobWorkGoodsType; it: Item }[];
    let entryId: string | null = null;
    let fromWarehouseId: string | null = null;
    if (order.kind === 'conversion') {
      if (!input.fromWarehouseId) throw new BadRequestException({ message: 'Choose the warehouse the material leaves from', issues: [{ path: 'fromWarehouseId', message: 'Required' }] });
      fromWarehouseId = (await this.ourWarehouse(tx, entityId, input.fromWarehouseId, 'fromWarehouseId')).id;
      const planned = new Set((await tx.select({ itemId: jobWorkOrderLine.itemId }).from(jobWorkOrderLine).where(eq(jobWorkOrderLine.orderId, order.id))).map((l) => l.itemId));
      const items = await this.items(tx, ctx, input.lines.map((l) => l.itemId ?? ''));
      lines = [];
      for (const [i, l] of input.lines.entries()) {
        const it = items.get(l.itemId!)!;
        if (!planned.has(it.id)) throw new BadRequestException({ message: `Line ${i + 1}: ${it.code} is not on this order`, issues: [{ path: `lines.${i}.itemId`, message: 'Not on the order' }] });
        lines.push({ itemId: it.id, batchId: l.batchId ?? null, qty: l.qty, value: await this.fifoValue(tx, entityId, it, l.batchId ?? null, l.qty, i), goodsType: l.goodsType ?? defaultGoodsType(it), it });
      }
      const [e] = await tx
        .insert(stockEntry)
        .values({ tenantId: ctx.tenant.tenantId, entityId, purpose: 'job_work_out', postingDate: input.postingDate, partyId: order.supplierId, systemGenerated: true, reference: order.number, remarks: `Job work ${order.number}`, createdBy: ctx.user.id })
        .returning();
      await tx.insert(stockEntryLine).values(lines.map((l, i) => ({ entryId: e!.id, lineNo: i + 1, itemId: l.itemId, batchId: l.batchId, qty: l.qty, fromWarehouseId, toWarehouseId: vendorWh.id })));
      await this.posting.submitIn(tx, ctx, entityId, e!.id);
      entryId = e!.id;
    } else {
      if (input.lines.length !== 1) throw new BadRequestException('Send the work-order pieces as one line');
      const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, order.workOrderId!)).for('update');
      if (wo!.status !== 'released') throw new ConflictException(`Work order ${wo!.number ?? ''} is ${wo!.status}`);
      const [it] = await tx.select().from(item).where(eq(item.id, wo!.itemId));
      const q = Dec.of(input.lines[0]!.qty);
      const sent = await this.operationSent(tx, order.workOrderOperationId!);
      if (sent.add(q).gt(wo!.plannedQty)) throw new BadRequestException({ message: `Only ${qtyText(Dec.of(wo!.plannedQty).sub(sent).toString())} more pieces of this work order can go out for this operation`, issues: [{ path: 'lines.0.qty', message: 'Too many pieces' }] });
      // Challan value: today's WIP spread over the pieces still in progress (for the challan and ITC-04 only).
      const inProgress = Dec.of(wo!.plannedQty).sub(wo!.producedQty);
      const [w] = await tx.select({ v: sql<string>`coalesce(sum(${workOrderCost.amount}), 0)` }).from(workOrderCost).where(eq(workOrderCost.workOrderId, wo!.id));
      const wip = Dec.of(w!.v);
      const value = inProgress.gt('0') && wip.gt('0') ? Dec.min(wip, wip.mul(q).div(inProgress)) : Dec.ZERO;
      lines = [{ itemId: it!.id, batchId: null, qty: q.toString(), value: value.toString(), goodsType: input.lines[0]!.goodsType ?? 'input', it: it! }];
    }
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, `job_work_challan:${reg?.id ?? 'none'}`, input.postingDate);
    const [c] = await tx
      .insert(jobWorkChallan)
      .values({
        tenantId: ctx.tenant.tenantId,
        entityId,
        orderId: order.id,
        number,
        status: 'submitted',
        postingDate: input.postingDate,
        gstRegistrationId: reg?.id ?? null,
        fromWarehouseId,
        stockEntryId: entryId,
        interstate,
        placeOfSupplyStateCode: supplierState,
        ewayBillNo: input.ewayBillNo?.trim() || null,
        vehicleNo: input.vehicleNo?.trim() || null,
        remarks: input.remarks ?? null,
        createdBy: ctx.user.id,
      })
      .returning();
    await tx.insert(jobWorkChallanLine).values(
      lines.map((l, i) => ({
        challanId: c!.id,
        lineNo: i + 1,
        itemId: l.itemId,
        batchId: l.batchId,
        qty: l.qty,
        value: l.value,
        goodsType: l.goodsType,
        hsnCode: l.it.hsnCode,
        dueBy: jobWorkDueBy(input.postingDate, l.goodsType, l.it.jobWorkExemptTool),
      })),
    );
    if (order.status === 'draft') await tx.update(jobWorkOrder).set({ status: 'open', updatedAt: new Date() }).where(eq(jobWorkOrder.id, order.id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_work.challan', targetType: 'job_work_challan', targetId: c!.id, after: { number, order: order.number, lines: lines.length } }, tx);
    return { ...c!, warning: interstate && !c!.ewayBillNo ? 'Interstate movement: record the e-way bill number if one was generated' : null };
  }

  async cancelChallanIn(tx: Tx, ctx: TenantRequestContext, entityId: string, challanId: string, reason: string) {
    const [c] = await tx.select().from(jobWorkChallan).where(and(eq(jobWorkChallan.id, challanId), eq(jobWorkChallan.entityId, entityId))).for('update');
    if (!c) throw new NotFoundException('Challan not found');
    if (c.status !== 'submitted') throw new ConflictException('This challan is already cancelled');
    const order = await this.lockOrder(tx, entityId, c.orderId);
    const lines = await tx.select({ id: jobWorkChallanLine.id }).from(jobWorkChallanLine).where(eq(jobWorkChallanLine.challanId, c.id));
    const [used] = await tx.select({ q: sql<string>`coalesce(sum(${jobWorkConsumption.qty}), 0)` }).from(jobWorkConsumption).where(inArray(jobWorkConsumption.challanLineId, lines.map((l) => l.id)));
    if (Dec.of(used!.q).gt('0')) throw new ConflictException('Goods have come back against this challan; cancel those receipts first');
    if (c.stockEntryId) await this.posting.cancelIn(tx, ctx, entityId, c.stockEntryId, `Challan ${c.number} cancelled: ${reason}`);
    const [after] = await tx.update(jobWorkChallan).set({ status: 'cancelled', cancelReason: reason }).where(eq(jobWorkChallan.id, c.id)).returning();
    const [live] = await tx.select({ id: jobWorkChallan.id }).from(jobWorkChallan).where(and(eq(jobWorkChallan.orderId, order.id), eq(jobWorkChallan.status, 'submitted'))).limit(1);
    if (!live && order.status === 'open') await tx.update(jobWorkOrder).set({ status: 'draft', updatedAt: new Date() }).where(eq(jobWorkOrder.id, order.id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_work.challan_cancel', targetType: 'job_work_challan', targetId: c.id, reason }, tx);
    return after!;
  }

  /** Commissioner's extension (Sec 143(1) second proviso): at most one more year for inputs, two for capital goods. */
  async extendIn(tx: Tx, ctx: TenantRequestContext, entityId: string, lineId: string, input: { extendedDueBy: string; extensionRef: string }) {
    const line = await this.challanLine(tx, entityId, lineId);
    if (!line.dueBy) throw new BadRequestException('This line has no return limit');
    const max = maxExtendedDueBy(line.dueBy, line.goodsType);
    if (input.extendedDueBy <= line.dueBy || input.extendedDueBy > max) throw new BadRequestException({ message: `The extended date must be after ${line.dueBy} and no later than ${max}`, issues: [{ path: 'extendedDueBy', message: `Up to ${max}` }] });
    const [after] = await tx.update(jobWorkChallanLine).set({ extendedDueBy: input.extendedDueBy, extensionRef: input.extensionRef }).where(eq(jobWorkChallanLine.id, line.id)).returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_work.extend', targetType: 'job_work_challan_line', targetId: line.id, after: input }, tx);
    return after!;
  }

  /** Sec 143(3)/(4): Accounts records the invoice raised for goods deemed supplied to the job worker. */
  async markDeemedIn(tx: Tx, ctx: TenantRequestContext, entityId: string, lineId: string, invoiceNo: string, today: string) {
    const line = await this.challanLine(tx, entityId, lineId);
    const due = line.extendedDueBy ?? line.dueBy;
    if (!due || today <= due) throw new BadRequestException('The return deadline for this line has not passed');
    if (line.deemedSupplyInvoiceNo) throw new ConflictException(`Already recorded with invoice ${line.deemedSupplyInvoiceNo}`);
    const [after] = await tx.update(jobWorkChallanLine).set({ deemedSupplyInvoiceNo: invoiceNo, deemedSupplyMarkedBy: ctx.user.id, deemedSupplyMarkedAt: new Date() }).where(eq(jobWorkChallanLine.id, line.id)).returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_work.deemed_supply', targetType: 'job_work_challan_line', targetId: line.id, after: { invoiceNo } }, tx);
    return after!;
  }

  // Receipts ---------------------------------------------------------------------------------------------

  async receiveIn(tx: Tx, ctx: TenantRequestContext, entityId: string, order: Order, input: ReceiptInput) {
    if (order.status !== 'open') throw new ConflictException(order.status === 'draft' ? 'Nothing has been sent on this order yet' : `This order is ${order.status}`);
    if (!input.received.length) throw new BadRequestException('Add what came back');
    const open = await this.openLines(tx, order.id);
    const consumption: { challanLineId: string; qty: string; lossQty: string; scrapQty: string }[] = [];
    let entryId: string | null = null;
    let receiptLines: { itemId: string; batchId: string | null; qty: string; rejectedQty: string; value: string; warehouseId: string | null; stockEntryLineId: string | null }[];
    if (order.kind === 'operation') {
      if (input.received.length !== 1) throw new BadRequestException('Receive the pieces as one line');
      const r = input.received[0]!;
      const good = Dec.of(r.qty);
      const rejected = Dec.of(r.rejectedQty ?? '0');
      const total = good.add(rejected);
      if (!total.gt('0')) throw new BadRequestException({ message: 'Enter the good or rejected pieces', issues: [{ path: 'received.0.qty', message: 'Required' }] });
      for (const a of this.allocate(total.toString(), open, 'received.0.qty')) consumption.push({ challanLineId: a.id, qty: a.qty, lossQty: '0', scrapQty: '0' });
      // Rejected pieces are the loss, recorded against the oldest lines first.
      let rest = rejected;
      for (const c of consumption) {
        const take = Dec.min(rest, Dec.of(c.qty));
        c.lossQty = take.toString();
        rest = rest.sub(take);
      }
      const [wo] = await tx.select({ itemId: workOrder.itemId }).from(workOrder).where(eq(workOrder.id, order.workOrderId!));
      receiptLines = [{ itemId: wo!.itemId, batchId: null, qty: good.toString(), rejectedQty: rejected.toString(), value: '0', warehouseId: null, stockEntryLineId: null }];
    } else {
      const consumed = input.consumed ?? [];
      if (!consumed.length) throw new BadRequestException({ message: 'Enter the material used up at the job worker', issues: [{ path: 'consumed', message: 'Required' }] });
      const [target] = await tx.select().from(item).where(eq(item.id, order.targetItemId!));
      const [supplier] = await tx.select().from(party).where(eq(party.id, order.supplierId));
      const vendorWh = await this.vendorWarehouse(tx, ctx, entityId, supplier!);
      const outLines: { itemId: string; batchId: string | null; qty: string }[] = [];
      for (const [i, c] of consumed.entries()) {
        const q = Dec.of(c.qty);
        const loss = Dec.of(c.lossQty ?? '0');
        const scrap = Dec.of(c.scrapQty ?? '0');
        if (!q.gt('0')) throw new BadRequestException({ message: `Material ${i + 1}: quantity must be positive`, issues: [{ path: `consumed.${i}.qty`, message: 'Must be positive' }] });
        if (loss.add(scrap).gt(q)) throw new BadRequestException({ message: `Material ${i + 1}: loss and scrap are part of the quantity used`, issues: [{ path: `consumed.${i}.lossQty`, message: 'More than the quantity used' }] });
        const candidates = open.filter((l) => l.itemId === c.itemId && (c.batchId ? l.batchId === c.batchId : true));
        const parts = this.allocate(q.toString(), candidates, `consumed.${i}.qty`);
        let lossLeft = loss;
        let scrapLeft = scrap;
        for (const p of parts) {
          const lq = Dec.min(lossLeft, Dec.of(p.qty));
          const sq = Dec.min(scrapLeft, Dec.of(p.qty).sub(lq));
          lossLeft = lossLeft.sub(lq);
          scrapLeft = scrapLeft.sub(sq);
          consumption.push({ challanLineId: p.id, qty: p.qty, lossQty: lq.toString(), scrapQty: sq.toString() });
          const line = open.find((l) => l.id === p.id)!;
          line.open = Dec.of(line.open).sub(p.qty).toString();
          const same = outLines.find((o) => o.itemId === line.itemId && o.batchId === line.batchId);
          if (same) same.qty = Dec.of(same.qty).add(p.qty).toString();
          else outLines.push({ itemId: line.itemId, batchId: line.batchId, qty: p.qty });
        }
      }
      const sameItem = outLines.every((o) => o.itemId === target!.id);
      const inLines = input.received.map((r, i) => {
        if (!Dec.of(r.qty).gt('0')) throw new BadRequestException({ message: `Received line ${i + 1}: quantity must be positive`, issues: [{ path: `received.${i}.qty`, message: 'Must be positive' }] });
        const to = r.warehouseId ?? order.targetWarehouseId;
        if (!to) throw new BadRequestException({ message: `Received line ${i + 1}: choose the warehouse`, issues: [{ path: `received.${i}.warehouseId`, message: 'Required' }] });
        // Same-item processing keeps the batch (heat) identity when only one batch went out.
        const keep = sameItem && target!.tracking !== 'none' && !r.batchNo && outLines.length === 1 ? outLines[0]!.batchId : null;
        return { itemId: target!.id, batchId: r.batchId ?? keep, newBatchNo: r.batchNo?.trim() || (target!.tracking !== 'none' && !(r.batchId ?? keep) ? `${order.number}-${i + 1}` : null), qty: r.qty, to };
      });
      for (const l of inLines) await this.ourWarehouse(tx, entityId, l.to, 'received');
      // Decision 048: returned goods of items needing incoming inspection wait in Quarantine.
      const hold = target!.requiresIncomingInspection ? await this.quality.holdWarehouse(tx, ctx, entityId, 'quarantine') : null;
      const destination = new Map(inLines.map((l, i) => [i, l.to]));
      if (hold) for (const l of inLines) l.to = hold.id;
      const [e] = await tx
        .insert(stockEntry)
        .values({ tenantId: ctx.tenant.tenantId, entityId, purpose: 'job_work_in', postingDate: input.postingDate, partyId: order.supplierId, systemGenerated: true, reference: order.number, remarks: `Job work ${order.number}`, createdBy: ctx.user.id })
        .returning();
      await tx.insert(stockEntryLine).values([
        ...outLines.map((l, i) => ({ entryId: e!.id, lineNo: i + 1, itemId: l.itemId, batchId: l.batchId, qty: l.qty, fromWarehouseId: vendorWh.id })),
        ...inLines.map((l, i) => ({ entryId: e!.id, lineNo: outLines.length + i + 1, itemId: l.itemId, batchId: l.batchId, newBatchNo: l.newBatchNo, qty: l.qty, toWarehouseId: l.to })),
      ]);
      await this.posting.submitIn(tx, ctx, entityId, e!.id);
      entryId = e!.id;
      const posted = await tx.select().from(stockEntryLine).where(and(eq(stockEntryLine.entryId, e!.id), isNull(stockEntryLine.fromWarehouseId))).orderBy(asc(stockEntryLine.lineNo));
      receiptLines = posted.map((p) => ({ itemId: p.itemId, batchId: p.batchId, qty: p.qty, rejectedQty: '0', value: p.value ?? '0', warehouseId: p.toWarehouseId, stockEntryLineId: p.id }));
      if (hold)
        for (const [k, p] of posted.entries())
          await this.quality.openRecordIn(tx, ctx, entityId, { stage: 'incoming', itemId: p.itemId, batchId: p.batchId, qty: p.qty, sourceType: 'job_work_receipt', sourceId: p.id, holdWarehouseId: hold.id, acceptWarehouseId: destination.get(k)!, remarks: `Job work ${order.number}` });
    }
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'job_work_receipt', input.postingDate);
    const [rc] = await tx
      .insert(jobWorkReceipt)
      .values({
        tenantId: ctx.tenant.tenantId,
        entityId,
        orderId: order.id,
        number,
        postingDate: input.postingDate,
        jobWorkerChallanNo: input.jobWorkerChallanNo?.trim() || null,
        jobWorkerChallanDate: input.jobWorkerChallanDate ?? null,
        stockEntryId: entryId,
        remarks: input.remarks ?? null,
        createdBy: ctx.user.id,
      })
      .returning();
    await tx.insert(jobWorkReceiptLine).values(receiptLines.map((l, i) => ({ receiptId: rc!.id, lineNo: i + 1, ...l })));
    await tx.insert(jobWorkConsumption).values(consumption.map((c) => ({ tenantId: ctx.tenant.tenantId, entityId, receiptId: rc!.id, ...c, createdBy: ctx.user.id })));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_work.receipt', targetType: 'job_work_receipt', targetId: rc!.id, after: { number, order: order.number } }, tx);
    return rc!;
  }

  async cancelReceiptIn(tx: Tx, ctx: TenantRequestContext, entityId: string, receiptId: string, reason: string) {
    const [rc] = await tx.select().from(jobWorkReceipt).where(and(eq(jobWorkReceipt.id, receiptId), eq(jobWorkReceipt.entityId, entityId))).for('update');
    if (!rc) throw new NotFoundException('Receipt not found');
    if (rc.status !== 'submitted') throw new ConflictException('This receipt is already cancelled');
    const order = await this.lockOrder(tx, entityId, rc.orderId);
    const [invoiced] = await tx
      .select({ number: purchaseInvoice.number })
      .from(purchaseInvoiceLine)
      .innerJoin(purchaseInvoice, eq(purchaseInvoice.id, purchaseInvoiceLine.invoiceId))
      .where(and(eq(purchaseInvoiceLine.jobWorkReceiptId, rc.id), ne(purchaseInvoice.status, 'cancelled')))
      .limit(1);
    if (invoiced) throw new ConflictException(`Purchase invoice ${invoiced.number ?? '(draft)'} charges this receipt; cancel or change it first`);
    if (order.kind === 'operation') await this.assertOutputGate(tx, order.workOrderOperationId!, rc.id);
    if (rc.stockEntryId) {
      await this.quality.releaseHoldIn(tx, 'job_work_receipt', (await tx.select({ id: stockEntryLine.id }).from(stockEntryLine).where(eq(stockEntryLine.entryId, rc.stockEntryId))).map((l) => l.id));
      await this.posting.cancelIn(tx, ctx, entityId, rc.stockEntryId, `Job work receipt ${rc.number} cancelled: ${reason}`);
    }
    const rows = await tx.select().from(jobWorkConsumption).where(and(eq(jobWorkConsumption.receiptId, rc.id), isNull(jobWorkConsumption.reversalOf)));
    if (rows.length)
      await tx.insert(jobWorkConsumption).values(
        rows.map((r) => ({ tenantId: r.tenantId, entityId: r.entityId, receiptId: r.receiptId, challanLineId: r.challanLineId, qty: Dec.of(r.qty).neg().toString(), lossQty: Dec.of(r.lossQty).neg().toString(), scrapQty: Dec.of(r.scrapQty).neg().toString(), reversalOf: r.id, createdBy: ctx.user.id })),
      );
    const [after] = await tx.update(jobWorkReceipt).set({ status: 'cancelled', cancelReason: reason }).where(eq(jobWorkReceipt.id, rc.id)).returning();
    if (order.status === 'closed') await tx.update(jobWorkOrder).set({ status: 'open', closeReason: null, updatedAt: new Date() }).where(eq(jobWorkOrder.id, order.id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'job_work.receipt_cancel', targetType: 'job_work_receipt', targetId: rc.id, reason }, tx);
    return after!;
  }

  // Processing charge ------------------------------------------------------------------------------------

  /** A purchase invoice line may charge one live job work receipt of the same supplier, with a service item. */
  async validateChargeLines(db: Database | Tx, entityId: string, supplierId: string, lines: { itemId: string; jobWorkReceiptId?: string | null }[]) {
    for (const [i, l] of lines.entries()) {
      if (!l.jobWorkReceiptId) continue;
      const [r] = await db
        .select({ receipt: jobWorkReceipt, supplierId: jobWorkOrder.supplierId })
        .from(jobWorkReceipt)
        .innerJoin(jobWorkOrder, eq(jobWorkOrder.id, jobWorkReceipt.orderId))
        .where(and(eq(jobWorkReceipt.id, l.jobWorkReceiptId), eq(jobWorkReceipt.entityId, entityId)));
      const issue = (message: string) => new BadRequestException({ message: `Line ${i + 1}: ${message}`, issues: [{ path: `lines.${i}.jobWorkReceiptId`, message }] });
      if (!r) throw issue('unknown job work receipt');
      if (r.receipt.status !== 'submitted') throw issue('that job work receipt is cancelled');
      if (r.supplierId !== supplierId) throw issue('the job work receipt is from another job worker');
      const [it] = await db.select({ isStockItem: item.isStockItem, code: item.code }).from(item).where(eq(item.id, l.itemId));
      if (it?.isStockItem) throw issue(`${it.code} is a stock item; charge processing with a service item`);
    }
  }

  /**
   * Submit of a purchase invoice (decision 047): each line linked to a job work receipt adds its INR taxable value
   * to cost. Operation orders: a job_work row in the work order's WIP ledger. Conversion orders: the returned
   * batch's FIFO layers (on hand raises inventory, already consumed goes to production). Runs with books
   * active or not; returns the GL roles each line posts instead of purchases.
   */
  async chargeIn(tx: Tx, ctx: TenantRequestContext, entityId: string, invoice: typeof purchaseInvoice.$inferSelect) {
    const lines = await tx.select().from(purchaseInvoiceLine).where(eq(purchaseInvoiceLine.invoiceId, invoice.id)).orderBy(asc(purchaseInvoiceLine.lineNo));
    const linked = lines.filter((l) => l.jobWorkReceiptId);
    const postings = new Map<string, [string, string][]>();
    if (!linked.length) return postings;
    await this.validateChargeLines(tx, entityId, invoice.supplierId, linked);
    if (await this.gl.active(tx, entityId)) await seedChart(tx, ctx, entityId);
    for (const l of linked) {
      const [dup] = await tx
        .select({ number: purchaseInvoice.number })
        .from(purchaseInvoiceLine)
        .innerJoin(purchaseInvoice, eq(purchaseInvoice.id, purchaseInvoiceLine.invoiceId))
        .where(and(eq(purchaseInvoiceLine.jobWorkReceiptId, l.jobWorkReceiptId!), eq(purchaseInvoice.status, 'submitted'), ne(purchaseInvoice.id, invoice.id)))
        .limit(1);
      if (dup) throw new ConflictException(`Line ${l.lineNo}: purchase invoice ${dup.number} already charges this job work receipt`);
      const amount = Dec.of(l.taxableValue ?? '0').mul(invoice.exchangeRate);
      const [rc] = await tx.select().from(jobWorkReceipt).where(eq(jobWorkReceipt.id, l.jobWorkReceiptId!)).for('update');
      const [order] = await tx.select().from(jobWorkOrder).where(eq(jobWorkOrder.id, rc!.orderId));
      if (order!.kind === 'operation') {
        const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, order!.workOrderId!)).for('update');
        if (wo!.status !== 'released') throw new ConflictException(`Line ${l.lineNo}: work order ${wo!.number} is ${wo!.status === 'completed' ? 'closed; reopen it' : wo!.status} to add the processing charge to its cost`);
        await tx.insert(workOrderCost).values({ tenantId: ctx.tenant.tenantId, entityId, workOrderId: wo!.id, kind: 'job_work', postingDate: invoice.postingDate, amount: amount.toString(), purchaseInvoiceLineId: l.id, createdBy: ctx.user.id });
        postings.set(l.id, [['wip', amount.toString()]]);
      } else {
        const got = await tx.select().from(jobWorkReceiptLine).where(eq(jobWorkReceiptLine.receiptId, rc!.id)).orderBy(asc(jobWorkReceiptLine.lineNo));
        const total = got.reduce((s, g) => s.add(g.qty), Dec.ZERO);
        let left = amount;
        const allocations = got.map((g, k) => {
          const share = k === got.length - 1 ? left : Dec.min(left, amount.mul(g.qty).div(total));
          left = left.sub(share);
          return { receiptLineId: g.stockEntryLineId!, amount: share.toString() };
        });
        const split = await this.cost.applyIn(tx, ctx, entityId, { type: 'job_work_charge', id: invoice.id, purpose: 'main' }, invoice.postingDate, allocations);
        postings.set(l.id, [
          ['inventory', split.inventory],
          ['production', split.consumed],
          ['rounding', split.rounding],
        ]);
      }
    }
    return postings;
  }

  /** Cancel of a purchase invoice: reverses the WIP rows and FIFO changes its job work lines made. */
  async reverseChargeIn(tx: Tx, ctx: TenantRequestContext, entityId: string, invoiceId: string) {
    const lines = await tx.select().from(purchaseInvoiceLine).where(eq(purchaseInvoiceLine.invoiceId, invoiceId));
    const ids = lines.filter((l) => l.jobWorkReceiptId).map((l) => l.id);
    if (!ids.length) return;
    const rows = await tx.select().from(workOrderCost).where(and(inArray(workOrderCost.purchaseInvoiceLineId, ids), isNull(workOrderCost.reversalOf)));
    for (const r of rows) {
      const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, r.workOrderId)).for('update');
      if (wo!.status !== 'released') throw new ConflictException(`Work order ${wo!.number} is ${wo!.status === 'completed' ? 'closed; reopen it' : wo!.status} before cancelling its processing charge`);
      // A live output after the charge took a share of it.
      const outputs = await tx
        .select({ id: workOrderCost.id })
        .from(workOrderCost)
        .where(and(eq(workOrderCost.workOrderId, wo!.id), eq(workOrderCost.kind, 'output'), isNull(workOrderCost.reversalOf), gt(workOrderCost.createdAt, r.createdAt), sql`not exists (select 1 from work_order_cost x where x.reversal_of = ${workOrderCost.id})`))
        .limit(1);
      if (outputs.length) throw new ConflictException(`Output of work order ${wo!.number} already took this charge; cancel the later outputs first`);
      await tx.insert(workOrderCost).values({ tenantId: r.tenantId, entityId: r.entityId, workOrderId: r.workOrderId, kind: r.kind, postingDate: r.postingDate, amount: Dec.of(r.amount).neg().toString(), purchaseInvoiceLineId: r.purchaseInvoiceLineId, reversalOf: r.id, createdBy: ctx.user.id });
    }
    await this.cost.reverseIn(tx, ctx, entityId, { type: 'job_work_charge', id: invoiceId, purpose: 'main' });
  }

  // Work-order gate ----------------------------------------------------------------------------------------

  /** Good pieces back from the job worker for each outsourced operation of a work order (decision 047). */
  async outsourcedReturns(db: Database | Tx, workOrderId: string, excludeReceiptId?: string) {
    const ops = await db.select().from(workOrderOperation).where(and(eq(workOrderOperation.workOrderId, workOrderId), eq(workOrderOperation.outsourced, true))).orderBy(asc(workOrderOperation.seq));
    if (!ops.length) return [];
    const rows = await db
      .select({ opId: jobWorkOrder.workOrderOperationId, good: sql<string>`coalesce(sum(${jobWorkReceiptLine.qty}), 0)` })
      .from(jobWorkReceiptLine)
      .innerJoin(jobWorkReceipt, eq(jobWorkReceipt.id, jobWorkReceiptLine.receiptId))
      .innerJoin(jobWorkOrder, eq(jobWorkOrder.id, jobWorkReceipt.orderId))
      .where(and(inArray(jobWorkOrder.workOrderOperationId, ops.map((o) => o.id)), eq(jobWorkReceipt.status, 'submitted'), excludeReceiptId ? ne(jobWorkReceipt.id, excludeReceiptId) : sql`true`))
      .groupBy(jobWorkOrder.workOrderOperationId);
    const sentRows = await db
      .select({ opId: jobWorkOrder.workOrderOperationId, sent: sql<string>`coalesce(sum(${jobWorkChallanLine.qty}), 0)` })
      .from(jobWorkChallanLine)
      .innerJoin(jobWorkChallan, eq(jobWorkChallan.id, jobWorkChallanLine.challanId))
      .innerJoin(jobWorkOrder, eq(jobWorkOrder.id, jobWorkChallan.orderId))
      .where(and(inArray(jobWorkOrder.workOrderOperationId, ops.map((o) => o.id)), eq(jobWorkChallan.status, 'submitted')))
      .groupBy(jobWorkOrder.workOrderOperationId);
    const consumed = await db
      .select({ opId: jobWorkOrder.workOrderOperationId, q: sql<string>`coalesce(sum(${jobWorkConsumption.qty}), 0)` })
      .from(jobWorkConsumption)
      .innerJoin(jobWorkChallanLine, eq(jobWorkChallanLine.id, jobWorkConsumption.challanLineId))
      .innerJoin(jobWorkChallan, eq(jobWorkChallan.id, jobWorkChallanLine.challanId))
      .innerJoin(jobWorkOrder, eq(jobWorkOrder.id, jobWorkChallan.orderId))
      .where(inArray(jobWorkOrder.workOrderOperationId, ops.map((o) => o.id)))
      .groupBy(jobWorkOrder.workOrderOperationId);
    return ops.map((o) => {
      const sent = Dec.of(sentRows.find((r) => r.opId === o.id)?.sent ?? '0');
      const back = Dec.of(consumed.find((r) => r.opId === o.id)?.q ?? '0');
      return { operationId: o.id, seq: o.seq, name: o.name, good: Dec.of(rows.find((r) => r.opId === o.id)?.good ?? '0').toString(), sent: sent.toString(), atVendor: sent.sub(back).toString() };
    });
  }

  /** Output can't pass the good pieces returned from any outsourced operation. */
  async assertOutputAllowed(tx: Tx, workOrderId: string, producedAfter: string) {
    for (const r of await this.outsourcedReturns(tx, workOrderId)) {
      if (Dec.of(producedAfter).gt(r.good))
        throw new ConflictException(`Operation ${r.seq} (${r.name}) is done by a job worker: only ${qtyText(r.good)} good pieces are back, ${qtyText(producedAfter)} would be produced`);
    }
  }

  private async assertOutputGate(tx: Tx, operationId: string, receiptId: string) {
    const [op] = await tx.select({ workOrderId: workOrderOperation.workOrderId }).from(workOrderOperation).where(eq(workOrderOperation.id, operationId));
    const [wo] = await tx.select({ produced: workOrder.producedQty }).from(workOrder).where(eq(workOrder.id, op!.workOrderId));
    for (const r of await this.outsourcedReturns(tx, op!.workOrderId, receiptId)) {
      if (r.operationId === operationId && Dec.of(wo!.produced).gt(r.good)) throw new ConflictException('Output already counts these pieces; cancel the later outputs first');
    }
  }

  // Helpers ----------------------------------------------------------------------------------------------

  /** Challan lines of an order with what is still at the job worker, oldest first. */
  async openLines(db: Database | Tx, orderId: string) {
    const rows = await db
      .select({
        id: jobWorkChallanLine.id,
        itemId: jobWorkChallanLine.itemId,
        batchId: jobWorkChallanLine.batchId,
        qty: jobWorkChallanLine.qty,
        deemed: jobWorkChallanLine.deemedSupplyInvoiceNo,
        used: sql<string>`coalesce((select sum(c.qty) from job_work_consumption c where c.challan_line_id = "job_work_challan_line"."id"), 0)`,
      })
      .from(jobWorkChallanLine)
      .innerJoin(jobWorkChallan, eq(jobWorkChallan.id, jobWorkChallanLine.challanId))
      .where(and(eq(jobWorkChallan.orderId, orderId), eq(jobWorkChallan.status, 'submitted')))
      .orderBy(asc(jobWorkChallan.postingDate), asc(jobWorkChallan.createdAt), asc(jobWorkChallanLine.lineNo));
    return rows.map((r) => ({ id: r.id, itemId: r.itemId, batchId: r.batchId, deemedSupply: r.deemed, open: Dec.of(r.qty).sub(r.used).toString() }));
  }

  private allocate(qty: string, lines: { id: string; open: string }[], path: string) {
    try {
      return allocateOldestFirst(qty, lines);
    } catch (e) {
      throw new BadRequestException({ message: (e as Error).message, issues: [{ path, message: (e as Error).message }] });
    }
  }

  private async operationSent(tx: Tx, operationId: string) {
    const [r] = await tx
      .select({ q: sql<string>`coalesce(sum(${jobWorkChallanLine.qty}), 0)` })
      .from(jobWorkChallanLine)
      .innerJoin(jobWorkChallan, eq(jobWorkChallan.id, jobWorkChallanLine.challanId))
      .innerJoin(jobWorkOrder, eq(jobWorkOrder.id, jobWorkChallan.orderId))
      .where(and(eq(jobWorkOrder.workOrderOperationId, operationId), eq(jobWorkChallan.status, 'submitted')));
    return Dec.of(r!.q);
  }

  private async challanLine(tx: Tx, entityId: string, lineId: string) {
    const [r] = await tx
      .select({ line: jobWorkChallanLine, status: jobWorkChallan.status })
      .from(jobWorkChallanLine)
      .innerJoin(jobWorkChallan, eq(jobWorkChallan.id, jobWorkChallanLine.challanId))
      .where(and(eq(jobWorkChallanLine.id, lineId), eq(jobWorkChallan.entityId, entityId)))
      .for('update');
    if (!r) throw new NotFoundException('Challan line not found');
    if (r.status !== 'submitted') throw new ConflictException('This challan is cancelled');
    return r.line;
  }

  /** What the next FIFO issue of this quantity would cost: the challan's taxable value for our stock. */
  private async fifoValue(tx: Tx, entityId: string, it: Item, batchId: string | null, qty: string, i: number) {
    const layers = await tx
      .select()
      .from(fifoLayer)
      .where(and(eq(fifoLayer.entityId, entityId), eq(fifoLayer.itemId, it.id), batchId ? eq(fifoLayer.batchId, batchId) : isNull(fifoLayer.batchId), gt(fifoLayer.qtyRemaining, '0')))
      .orderBy(asc(fifoLayer.postingDate), asc(fifoLayer.sourceSeq));
    try {
      return consumeFifo(layers.map((l) => ({ id: l.id, qty: Dec.of(l.qtyRemaining), rate: Dec.of(l.rate) })), Dec.of(qty)).value.toString();
    } catch {
      throw new BadRequestException({ message: `Line ${i + 1}: not enough ${it.code} valued in stock`, issues: [{ path: `lines.${i}.qty`, message: 'Not enough stock' }] });
    }
  }

  private async jobWorker(tx: Tx, ctx: TenantRequestContext, supplierId: string) {
    const [p] = await tx.select().from(party).where(and(eq(party.id, supplierId), eq(party.tenantId, ctx.tenant.tenantId)));
    if (!p) throw new BadRequestException({ message: 'Unknown supplier', issues: [{ path: 'supplierId', message: 'Unknown supplier' }] });
    if (!p.isJobWorker) throw new BadRequestException({ message: `${p.name} is not marked as a job worker`, issues: [{ path: 'supplierId', message: 'Mark the supplier as a job worker' }] });
    return p;
  }

  /** "At <vendor>": one per job worker per entity, created on first use, never available for issue. */
  async vendorWarehouse(tx: Tx, ctx: TenantRequestContext, entityId: string, supplier: typeof party.$inferSelect) {
    const code = `JW-${supplier.code}`.slice(0, 40);
    const [existing] = await tx.select().from(warehouse).where(and(eq(warehouse.entityId, entityId), eq(warehouse.code, code)));
    if (existing) {
      if (existing.type !== 'at_job_worker') throw new ConflictException(`Warehouse ${code} exists but is not a job worker's warehouse; rename it`);
      return existing;
    }
    const [w] = await tx
      .insert(warehouse)
      .values({ tenantId: ctx.tenant.tenantId, entityId, code, name: `At ${supplier.name}`, type: 'at_job_worker', availableForIssue: false })
      .returning();
    return w!;
  }

  private async ourWarehouse(tx: Tx, entityId: string, id: string, path: string) {
    const [w] = await tx.select().from(warehouse).where(and(eq(warehouse.id, id), eq(warehouse.entityId, entityId)));
    if (!w) throw new BadRequestException({ message: 'Unknown warehouse', issues: [{ path, message: 'Unknown warehouse' }] });
    if (w.type === 'at_job_worker' || w.type === 'customer_owned') throw new BadRequestException({ message: `${w.name} can't be used here`, issues: [{ path, message: 'Choose one of our warehouses' }] });
    return w;
  }

  private async registration(tx: Tx, entityId: string, id: string | null | undefined) {
    const regs = await tx.select().from(gstRegistration).where(eq(gstRegistration.entityId, entityId));
    if (id) {
      const r = regs.find((x) => x.id === id);
      if (!r) throw new BadRequestException({ message: 'Unknown GST registration', issues: [{ path: 'gstRegistrationId', message: 'Unknown' }] });
      return r;
    }
    if (regs.length > 1) throw new BadRequestException({ message: 'Choose the GSTIN the goods leave from', issues: [{ path: 'gstRegistrationId', message: 'Required' }] });
    return regs[0] ?? null;
  }

  private async items(tx: Tx, ctx: TenantRequestContext, ids: string[]) {
    const rows = ids.length ? await tx.select().from(item).where(and(inArray(item.id, [...new Set(ids.filter(Boolean))]), eq(item.tenantId, ctx.tenant.tenantId))) : [];
    const map = new Map(rows.map((i) => [i.id, i]));
    ids.forEach((id, i) => {
      if (!map.has(id)) throw new BadRequestException({ message: `Line ${i + 1}: unknown item`, issues: [{ path: `lines.${i}.itemId`, message: 'Unknown item' }] });
    });
    return map;
  }
}

/** Tools and gauges are capital goods (three years); everything else is an input (one year). */
export function defaultGoodsType(it: Pick<Item, 'type'>): JobWorkGoodsType {
  return it.type === 'tool' || it.type === 'gauge' ? 'capital_good' : 'input';
}

/** "3", "0.5": a quantity for messages, without trailing zeros. */
function qtyText(q: string): string {
  return Dec.of(q).toString().replace(/\.?0+$/, '');
}
