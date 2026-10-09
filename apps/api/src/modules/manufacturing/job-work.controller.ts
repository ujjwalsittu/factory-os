// Job work outward (decision 047): orders, delivery challans, receipts and deadline actions.
import { deadlineState, Dec } from '@factoryos/core';
import {
  batch,
  type Database,
  gstRegistration,
  item,
  jobWorkChallan,
  jobWorkChallanLine,
  jobWorkConsumption,
  jobWorkOrder,
  jobWorkOrderLine,
  jobWorkReceipt,
  jobWorkReceiptLine,
  legalEntity,
  party,
  purchaseInvoice,
  purchaseInvoiceLine,
  uom,
  warehouse,
  workOrder,
  workOrderOperation,
} from '@factoryos/db';
import { Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf } from '../accounting/accounting-lock.js';
import { JobWorkService } from './job-work.service.js';

const quantity = z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/, 'Enter a quantity');
const positive = quantity.refine((v) => Number(v) > 0, 'Must be more than zero');
const isoDate = z.iso.date();
const reason = z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(1000) });
const text = (max: number) => z.string().trim().max(max).nullable().optional();

const orderInput = z.object({
  supplierId: z.uuid(),
  targetItemId: z.uuid(),
  targetQty: positive,
  targetWarehouseId: z.uuid().nullable().optional(),
  natureOfWork: text(200),
  expectedReturnDate: isoDate.nullable().optional(),
  remarks: text(2000),
  materials: z.array(z.object({ itemId: z.uuid(), qty: positive })).max(100).optional(),
});
const challanInput = z.object({
  postingDate: isoDate.optional(),
  fromWarehouseId: z.uuid().nullable().optional(),
  gstRegistrationId: z.uuid().nullable().optional(),
  ewayBillNo: z.string().trim().regex(/^\d{12}$/, 'An e-way bill number has 12 digits').nullable().optional().or(z.literal('')),
  vehicleNo: text(20),
  remarks: text(1000),
  lines: z
    .array(z.object({ itemId: z.uuid().nullable().optional(), batchId: z.uuid().nullable().optional(), qty: positive, goodsType: z.enum(['input', 'capital_good']).nullable().optional() }))
    .min(1)
    .max(200),
});
const receiptInput = z.object({
  postingDate: isoDate.optional(),
  jobWorkerChallanNo: text(40),
  jobWorkerChallanDate: isoDate.nullable().optional(),
  remarks: text(1000),
  consumed: z.array(z.object({ itemId: z.uuid(), batchId: z.uuid().nullable().optional(), qty: positive, lossQty: quantity.nullable().optional(), scrapQty: quantity.nullable().optional() })).max(200).optional(),
  received: z
    .array(z.object({ qty: quantity, rejectedQty: quantity.nullable().optional(), batchId: z.uuid().nullable().optional(), batchNo: z.string().trim().max(40).nullable().optional(), warehouseId: z.uuid().nullable().optional() }))
    .min(1)
    .max(200),
});
const operationSend = challanInput.omit({ lines: true, fromWarehouseId: true }).extend({ supplierId: z.uuid().nullable().optional(), qty: positive, goodsType: z.enum(['input', 'capital_good']).nullable().optional() });
const operationReceive = receiptInput.omit({ consumed: true, received: true }).extend({ supplierId: z.uuid().nullable().optional(), qty: quantity, rejectedQty: quantity.default('0') });

@Controller('manufacturing')
export class JobWorkController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jobWork: JobWorkService,
  ) {}

  @Get('job-work')
  @RequirePermission('manufacturing.job_work.read')
  async list(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { status, supplierId } = parse(z.object({ status: z.enum(['draft', 'open', 'closed', 'cancelled']).optional(), supplierId: z.uuid().optional() }), query);
    const where: SQL[] = [eq(jobWorkOrder.entityId, entityId)];
    if (status) where.push(eq(jobWorkOrder.status, status));
    if (supplierId) where.push(eq(jobWorkOrder.supplierId, supplierId));
    const rows = await this.db
      .select({ order: jobWorkOrder, supplier: party.name, targetCode: item.code, targetName: item.name, workOrder: workOrder.number, operation: workOrderOperation.name, operationSeq: workOrderOperation.seq })
      .from(jobWorkOrder)
      .innerJoin(party, eq(party.id, jobWorkOrder.supplierId))
      .leftJoin(item, eq(item.id, jobWorkOrder.targetItemId))
      .leftJoin(workOrder, eq(workOrder.id, jobWorkOrder.workOrderId))
      .leftJoin(workOrderOperation, eq(workOrderOperation.id, jobWorkOrder.workOrderOperationId))
      .where(and(...where))
      .orderBy(desc(jobWorkOrder.createdAt))
      .limit(500);
    const open = await Promise.all(rows.map((r) => this.jobWork.openLines(this.db, r.order.id)));
    return rows.map((r, i) => ({
      ...r.order,
      supplier: r.supplier,
      target: r.targetCode ? `${r.targetCode} · ${r.targetName}` : null,
      workOrder: r.workOrder,
      operation: r.operation ? `${r.operationSeq} ${r.operation}` : null,
      atVendor: open[i]!.reduce((s, l) => s.add(l.open), Dec.ZERO).toString(),
    }));
  }

  /** Live receipts of a job worker, for charging processing on a purchase invoice. */
  @Get('job-work-receipts')
  @RequirePermission('manufacturing.job_work.read')
  async receipts(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { supplierId } = parse(z.object({ supplierId: z.uuid() }), query);
    const rows = await this.db
      .select({ id: jobWorkReceipt.id, number: jobWorkReceipt.number, postingDate: jobWorkReceipt.postingDate, orderNumber: jobWorkOrder.number, natureOfWork: jobWorkOrder.natureOfWork, kind: jobWorkOrder.kind })
      .from(jobWorkReceipt)
      .innerJoin(jobWorkOrder, eq(jobWorkOrder.id, jobWorkReceipt.orderId))
      .where(and(eq(jobWorkReceipt.entityId, entityId), eq(jobWorkOrder.supplierId, supplierId), eq(jobWorkReceipt.status, 'submitted')))
      .orderBy(desc(jobWorkReceipt.postingDate))
      .limit(200);
    const charged = rows.length
      ? await this.db
          .select({ receiptId: purchaseInvoiceLine.jobWorkReceiptId, number: purchaseInvoice.number })
          .from(purchaseInvoiceLine)
          .innerJoin(purchaseInvoice, eq(purchaseInvoice.id, purchaseInvoiceLine.invoiceId))
          .where(and(inArray(purchaseInvoiceLine.jobWorkReceiptId, rows.map((r) => r.id)), eq(purchaseInvoice.status, 'submitted')))
      : [];
    return rows.map((r) => ({ ...r, chargedBy: charged.find((c) => c.receiptId === r.id)?.number ?? null }));
  }

  @Post('job-work')
  @RequirePermission('manufacturing.job_work.create')
  create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(orderInput, body);
    return this.jobWork.run(entityId, async (tx) => (await this.jobWork.createConversionIn(tx, ctx, entityId, input)).id).then((id) => this.detail(ctx, id));
  }

  @Get('job-work/:id')
  @RequirePermission('manufacturing.job_work.read')
  async detail(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [row] = await this.db
      .select({ order: jobWorkOrder, supplier: party.name, supplierCode: party.code, targetCode: item.code, targetName: item.name, targetTracking: item.tracking, workOrder: workOrder.number, operation: workOrderOperation.name, operationSeq: workOrderOperation.seq, targetWarehouse: warehouse.name })
      .from(jobWorkOrder)
      .innerJoin(party, eq(party.id, jobWorkOrder.supplierId))
      .leftJoin(item, eq(item.id, jobWorkOrder.targetItemId))
      .leftJoin(workOrder, eq(workOrder.id, jobWorkOrder.workOrderId))
      .leftJoin(workOrderOperation, eq(workOrderOperation.id, jobWorkOrder.workOrderOperationId))
      .leftJoin(warehouse, eq(warehouse.id, jobWorkOrder.targetWarehouseId))
      .where(and(eq(jobWorkOrder.id, id), eq(jobWorkOrder.entityId, entityId)));
    if (!row) throw new NotFoundException('Job work order not found');
    const materials = await this.db
      .select({ id: jobWorkOrderLine.id, itemId: jobWorkOrderLine.itemId, qty: jobWorkOrderLine.qty, itemCode: item.code, itemName: item.name, tracking: item.tracking, uom: uom.code })
      .from(jobWorkOrderLine)
      .innerJoin(item, eq(item.id, jobWorkOrderLine.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .where(eq(jobWorkOrderLine.orderId, id))
      .orderBy(asc(jobWorkOrderLine.lineNo));
    const challans = await this.db.select().from(jobWorkChallan).where(eq(jobWorkChallan.orderId, id)).orderBy(asc(jobWorkChallan.postingDate), asc(jobWorkChallan.createdAt));
    const open = new Map((await this.jobWork.openLines(this.db, id)).map((l) => [l.id, l.open]));
    const cLines = challans.length ? await this.challanLines(challans.map((c) => c.id)) : [];
    const today = businessDate();
    const receipts = await this.db.select().from(jobWorkReceipt).where(eq(jobWorkReceipt.orderId, id)).orderBy(asc(jobWorkReceipt.postingDate), asc(jobWorkReceipt.createdAt));
    const rLines = receipts.length
      ? await this.db
          .select({ line: jobWorkReceiptLine, itemCode: item.code, itemName: item.name, batchNo: batch.batchNo, warehouse: warehouse.name })
          .from(jobWorkReceiptLine)
          .innerJoin(item, eq(item.id, jobWorkReceiptLine.itemId))
          .leftJoin(batch, eq(batch.id, jobWorkReceiptLine.batchId))
          .leftJoin(warehouse, eq(warehouse.id, jobWorkReceiptLine.warehouseId))
          .where(inArray(jobWorkReceiptLine.receiptId, receipts.map((r) => r.id)))
          .orderBy(asc(jobWorkReceiptLine.lineNo))
      : [];
    const consumption = receipts.length ? await this.db.select().from(jobWorkConsumption).where(inArray(jobWorkConsumption.receiptId, receipts.map((r) => r.id))) : [];
    const invoices = receipts.length
      ? await this.db
          .select({ receiptId: purchaseInvoiceLine.jobWorkReceiptId, invoiceId: purchaseInvoice.id, number: purchaseInvoice.number, supplierInvoiceNo: purchaseInvoice.supplierInvoiceNo, status: purchaseInvoice.status, taxableValue: purchaseInvoiceLine.taxableValue })
          .from(purchaseInvoiceLine)
          .innerJoin(purchaseInvoice, eq(purchaseInvoice.id, purchaseInvoiceLine.invoiceId))
          .where(and(inArray(purchaseInvoiceLine.jobWorkReceiptId, receipts.map((r) => r.id)), ne(purchaseInvoice.status, 'cancelled')))
      : [];
    const challanNo = new Map(cLines.map((l) => [l.id, challans.find((c) => c.id === l.challanId)?.number ?? null]));
    return {
      ...row.order,
      supplier: row.supplier,
      supplierCode: row.supplierCode,
      target: row.targetCode ? { code: row.targetCode, name: row.targetName, tracking: row.targetTracking } : null,
      targetWarehouse: row.targetWarehouse,
      workOrder: row.workOrder,
      operation: row.operation ? `${row.operationSeq} ${row.operation}` : null,
      materials,
      challans: challans.map((c) => ({
        ...c,
        lines: cLines
          .filter((l) => l.challanId === c.id)
          .map((l) => {
            const due = l.extendedDueBy ?? l.dueBy;
            const atVendor = c.status === 'submitted' ? (open.get(l.id) ?? '0') : '0';
            return { ...l, open: atVendor, deadline: Dec.of(atVendor).gt('0') && !l.deemedSupplyInvoiceNo ? deadlineState(due, today) : null };
          }),
      })),
      receipts: receipts.map((r) => ({
        ...r,
        lines: rLines.filter((l) => l.line.receiptId === r.id).map((l) => ({ ...l.line, itemCode: l.itemCode, itemName: l.itemName, batchNo: l.batchNo, warehouse: l.warehouse })),
        consumed: consumption.filter((c) => c.receiptId === r.id && !c.reversalOf && Dec.of(c.qty).gt('0')).map((c) => ({ challanLineId: c.challanLineId, challan: challanNo.get(c.challanLineId) ?? null, qty: c.qty, lossQty: c.lossQty, scrapQty: c.scrapQty })),
        invoices: invoices.filter((v) => v.receiptId === r.id),
      })),
      atVendor: [...open.values()].reduce((s, v) => s.add(v), Dec.ZERO).toString(),
      charged: invoices.reduce((s, v) => s.add(v.taxableValue ?? '0'), Dec.ZERO).toString(),
    };
  }

  @Post('job-work/:id/challans')
  @RequirePermission('manufacturing.job_work.submit')
  send(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(challanInput, body);
    return this.jobWork.run(entityId, async (tx) => this.jobWork.sendIn(tx, ctx, entityId, await this.jobWork.lockOrder(tx, entityId, id), { ...input, postingDate: input.postingDate ?? businessDate(), ewayBillNo: input.ewayBillNo || null }));
  }

  @Post('job-work/:id/receipts')
  @RequirePermission('manufacturing.job_work.submit')
  receive(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(receiptInput, body);
    return this.jobWork.run(entityId, async (tx) => this.jobWork.receiveIn(tx, ctx, entityId, await this.jobWork.lockOrder(tx, entityId, id), { ...input, postingDate: input.postingDate ?? businessDate() }));
  }

  @Post('job-work/:id/close')
  @RequirePermission('manufacturing.job_work.submit')
  close(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: r } = parse(reason, body);
    return this.jobWork.run(entityId, async (tx) => this.jobWork.closeIn(tx, ctx, entityId, await this.jobWork.lockOrder(tx, entityId, id), r));
  }

  @Post('job-work/:id/cancel')
  @RequirePermission('manufacturing.job_work.cancel')
  cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: r } = parse(reason, body);
    return this.jobWork.run(entityId, async (tx) => this.jobWork.cancelOrderIn(tx, ctx, entityId, await this.jobWork.lockOrder(tx, entityId, id), r));
  }

  @Post('job-work/challans/:id/cancel')
  @RequirePermission('manufacturing.job_work.cancel')
  cancelChallan(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: r } = parse(reason, body);
    return this.jobWork.run(entityId, (tx) => this.jobWork.cancelChallanIn(tx, ctx, entityId, id, r));
  }

  @Post('job-work/receipts/:id/cancel')
  @RequirePermission('manufacturing.job_work.cancel')
  cancelReceipt(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: r } = parse(reason, body);
    return this.jobWork.run(entityId, (tx) => this.jobWork.cancelReceiptIn(tx, ctx, entityId, id, r));
  }

  /** Print data for the delivery challan (rule 55). */
  @Get('job-work/challans/:id')
  @RequirePermission('manufacturing.job_work.read')
  async challan(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [c] = await this.db
      .select({ challan: jobWorkChallan, order: jobWorkOrder, supplier: party, entity: legalEntity, registration: gstRegistration, workOrder: workOrder.number })
      .from(jobWorkChallan)
      .innerJoin(jobWorkOrder, eq(jobWorkOrder.id, jobWorkChallan.orderId))
      .innerJoin(party, eq(party.id, jobWorkOrder.supplierId))
      .innerJoin(legalEntity, eq(legalEntity.id, jobWorkChallan.entityId))
      .leftJoin(gstRegistration, eq(gstRegistration.id, jobWorkChallan.gstRegistrationId))
      .leftJoin(workOrder, eq(workOrder.id, jobWorkOrder.workOrderId))
      .where(and(eq(jobWorkChallan.id, id), eq(jobWorkChallan.entityId, entityId)));
    if (!c) throw new NotFoundException('Challan not found');
    return {
      ...c.challan,
      orderNumber: c.order.number,
      natureOfWork: c.order.natureOfWork,
      workOrder: c.workOrder,
      consigner: { name: c.entity.legalName, address: c.entity.address, gstin: c.registration?.gstin ?? null, stateCode: c.registration?.stateCode ?? null },
      consignee: { name: c.supplier.name, address: c.supplier.addresses[0] ?? null, gstin: c.supplier.gstin, stateCode: c.supplier.stateCode },
      lines: await this.challanLines([c.challan.id]),
    };
  }

  @Post('job-work/challan-lines/:id/extend')
  @RequirePermission('compliance.itc04.update')
  extend(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(z.object({ extendedDueBy: isoDate, extensionRef: z.string().trim().min(3, 'Give the order reference').max(100) }), body);
    return this.jobWork.run(entityId, (tx) => this.jobWork.extendIn(tx, ctx, entityId, id, input));
  }

  @Post('job-work/challan-lines/:id/deemed-supply')
  @RequirePermission('compliance.itc04.update')
  deemed(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { invoiceNo } = parse(z.object({ invoiceNo: z.string().trim().min(1, 'Enter the invoice number').max(16, 'At most 16 characters') }), body);
    return this.jobWork.run(entityId, (tx) => this.jobWork.markDeemedIn(tx, ctx, entityId, id, invoiceNo, businessDate()));
  }

  // From the work order: outsourced operations ---------------------------------------------------------------

  @Get('work-orders/:id/job-work')
  @RequirePermission('manufacturing.job_work.read')
  async forWorkOrder(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [wo] = await this.db.select({ id: workOrder.id }).from(workOrder).where(and(eq(workOrder.id, id), eq(workOrder.entityId, entityId)));
    if (!wo) throw new NotFoundException('Work order not found');
    const orders = await this.db
      .select({ id: jobWorkOrder.id, number: jobWorkOrder.number, status: jobWorkOrder.status, operationId: jobWorkOrder.workOrderOperationId, supplier: party.name })
      .from(jobWorkOrder)
      .innerJoin(party, eq(party.id, jobWorkOrder.supplierId))
      .where(eq(jobWorkOrder.workOrderId, id))
      .orderBy(asc(jobWorkOrder.createdAt));
    return { operations: await this.jobWork.outsourcedReturns(this.db, id), orders };
  }

  @Post('work-orders/:id/operations/:operationId/send')
  @RequirePermission('manufacturing.job_work.submit')
  sendPieces(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Param('operationId', ParseUUIDPipe) operationId: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(operationSend, body);
    return this.jobWork.run(entityId, async (tx) => {
      const { order } = await this.jobWork.operationOrderIn(tx, ctx, entityId, id, operationId, input.supplierId);
      return this.jobWork.sendIn(tx, ctx, entityId, order, { ...input, postingDate: input.postingDate ?? businessDate(), ewayBillNo: input.ewayBillNo || null, lines: [{ qty: input.qty, goodsType: input.goodsType }] });
    });
  }

  @Post('work-orders/:id/operations/:operationId/receive')
  @RequirePermission('manufacturing.job_work.submit')
  receivePieces(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Param('operationId', ParseUUIDPipe) operationId: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(operationReceive, body);
    return this.jobWork.run(entityId, async (tx) => {
      const orders = await tx
        .select()
        .from(jobWorkOrder)
        .where(and(eq(jobWorkOrder.workOrderId, id), eq(jobWorkOrder.workOrderOperationId, operationId), eq(jobWorkOrder.entityId, entityId), eq(jobWorkOrder.status, 'open'), ...(input.supplierId ? [eq(jobWorkOrder.supplierId, input.supplierId)] : [])));
      if (!orders.length) throw new NotFoundException('Nothing is out with a job worker for this operation');
      if (orders.length > 1) throw new NotFoundException('Pieces are out with more than one job worker; choose the job worker');
      const order = await this.jobWork.lockOrder(tx, entityId, orders[0]!.id);
      return this.jobWork.receiveIn(tx, ctx, entityId, order, { ...input, postingDate: input.postingDate ?? businessDate(), received: [{ qty: input.qty, rejectedQty: input.rejectedQty }] });
    });
  }

  private challanLines(challanIds: string[]) {
    return this.db
      .select({
        id: jobWorkChallanLine.id,
        challanId: jobWorkChallanLine.challanId,
        lineNo: jobWorkChallanLine.lineNo,
        itemId: jobWorkChallanLine.itemId,
        itemCode: item.code,
        itemName: item.name,
        uom: uom.code,
        batchId: jobWorkChallanLine.batchId,
        batchNo: batch.batchNo,
        heatNo: batch.heatNo,
        qty: jobWorkChallanLine.qty,
        value: jobWorkChallanLine.value,
        goodsType: jobWorkChallanLine.goodsType,
        hsnCode: jobWorkChallanLine.hsnCode,
        dueBy: jobWorkChallanLine.dueBy,
        extendedDueBy: jobWorkChallanLine.extendedDueBy,
        extensionRef: jobWorkChallanLine.extensionRef,
        deemedSupplyInvoiceNo: jobWorkChallanLine.deemedSupplyInvoiceNo,
      })
      .from(jobWorkChallanLine)
      .innerJoin(item, eq(item.id, jobWorkChallanLine.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .leftJoin(batch, eq(batch.id, jobWorkChallanLine.batchId))
      .where(inArray(jobWorkChallanLine.challanId, challanIds))
      .orderBy(asc(jobWorkChallanLine.lineNo));
  }
}
