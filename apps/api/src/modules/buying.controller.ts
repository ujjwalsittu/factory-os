import { computeGst, GST_RATES, inwardSupplyType, type TaxResult } from '@factoryos/compliance-in';
import { Dec, fyCode } from '@factoryos/core';
import {
  batch,
  type Database,
  gstRegistration,
  hsnCode,
  item,
  party,
  purchaseInvoice,
  purchaseInvoiceLine,
  purchaseOrder,
  purchaseOrderLine,
  qualityInspection,
  stockEntry,
  stockEntryLine,
  uom,
  user,
  warehouse,
} from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lte, ne, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';
import { StockPostingService } from './stock-posting.service.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Party = typeof party.$inferSelect;
type GstReg = typeof gstRegistration.$inferSelect;

const qtyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,6})?$/, 'Must be a number with up to 6 decimals'));
const gstRate = z
  .union([z.string(), z.number()])
  .transform((v) => String(Number(v)))
  .pipe(z.enum(GST_RATES));

const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code').default('INR');
const exchangeRate = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,6})?$/, 'Exchange rate: a number with up to 6 decimals'))
  .nullable()
  .optional();

const poLineInput = z.object({ itemId: z.string().uuid(), description: z.string().trim().max(500).nullable().optional(), qty: qtyString, rate: qtyString, gstRate: gstRate.optional() });
const poInput = z.object({
  supplierId: z.string().uuid(),
  gstRegistrationId: z.string().uuid().nullable().optional(),
  orderDate: z.string().date(),
  expectedDate: z.string().date().nullable().optional(),
  supplierQuoteRef: z.string().trim().max(100).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
  currency,
  exchangeRate,
  lines: z.array(poLineInput).min(1).max(300),
});

const piLineInput = z.object({ itemId: z.string().uuid(), poLineId: z.string().uuid().nullable().optional(), qty: qtyString, rate: qtyString, gstRate: gstRate.optional() });
const piInput = z.object({
  supplierId: z.string().uuid(),
  gstRegistrationId: z.string().uuid().nullable().optional(),
  purchaseOrderId: z.string().uuid().nullable().optional(),
  supplierInvoiceNo: z.string().trim().min(1).max(16, 'GST invoice numbers are at most 16 characters'),
  supplierInvoiceDate: z.string().date(),
  postingDate: z.string().date(),
  reverseCharge: z.boolean().default(false),
  itcEligible: z.boolean().default(true),
  acceptRateVariance: z.boolean().default(false),
  remarks: z.string().trim().max(2000).nullable().optional(),
  currency,
  exchangeRate,
  lines: z.array(piLineInput).min(1).max(300),
});

const inspectionInput = z.object({
  receiptLineId: z.string().uuid(),
  inspectionDate: z.string().date(),
  qtyAccepted: qtyString,
  qtyRejected: qtyString,
  acceptWarehouseId: z.string().uuid().nullable().optional(),
  rejectWarehouseId: z.string().uuid().nullable().optional(),
  checks: z.string().trim().max(2000).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
});

function entityOf(ctx: TenantRequestContext): string {
  if (!ctx.tenant.activeEntityId) throw new BadRequestException('Select a legal entity first (buying is per entity)');
  return ctx.tenant.activeEntityId;
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Purchase orders → goods receipt (stock engine) → incoming inspection → purchase invoice (slice 1b). */
@Controller()
export class BuyingController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
  ) {}

  // ───────────────────────── Tax preview ─────────────────────────

  /** Live GST for a draft purchase document (the server is the only place tax is computed). */
  @Post('buying/tax-preview')
  @RequirePermission('buying.purchase_order.read')
  async taxPreview(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(
      z.object({
        supplierId: z.string().uuid(),
        gstRegistrationId: z.string().uuid().nullable().optional(),
        reverseCharge: z.boolean().default(false),
        date: z.string().date(),
        lines: z.array(z.object({ itemId: z.string().uuid(), qty: qtyString, rate: qtyString, gstRate: gstRate.optional() })).max(300),
      }),
      body,
    );
    const supplier = await this.supplier(ctx, input.supplierId);
    const reg = await this.ourRegistration(entityId, input.gstRegistrationId);
    const lines = await this.withRates(ctx, input.lines, input.date);
    return { ...this.tax(supplier, reg, lines, input.reverseCharge), gstRates: lines.map((l) => l.gstRate) };
  }

  // ───────────────────────── Purchase orders ─────────────────────────

  @Get('purchase-orders')
  @RequirePermission('buying.purchase_order.read')
  async listPOs(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { status, supplierId, open } = parse(
      z.object({ status: z.enum(['draft', 'submitted', 'cancelled']).optional(), supplierId: z.string().uuid().optional(), open: z.enum(['true']).optional() }),
      query,
    );
    const where: SQL[] = [eq(purchaseOrder.entityId, entityId)];
    if (status) where.push(eq(purchaseOrder.status, status));
    if (supplierId) where.push(eq(purchaseOrder.supplierId, supplierId));
    if (open) where.push(eq(purchaseOrder.status, 'submitted'), sql`${purchaseOrder.closedAt} is null`);
    return this.db
      .select({
        id: purchaseOrder.id,
        number: purchaseOrder.number,
        status: purchaseOrder.status,
        closedAt: purchaseOrder.closedAt,
        orderDate: purchaseOrder.orderDate,
        expectedDate: purchaseOrder.expectedDate,
        supplierId: purchaseOrder.supplierId,
        supplierName: party.name,
        grandTotal: purchaseOrder.grandTotal,
        currency: purchaseOrder.currency,
        orderedQty: sql<string>`(select coalesce(sum(l.qty), 0) from purchase_order_line l where l.po_id = "purchase_order"."id")`,
        receivedQty: sql<string>`(select coalesce(sum(l.received_qty), 0) from purchase_order_line l where l.po_id = "purchase_order"."id")`,
        billedQty: sql<string>`(select coalesce(sum(l.billed_qty), 0) from purchase_order_line l where l.po_id = "purchase_order"."id")`,
      })
      .from(purchaseOrder)
      .innerJoin(party, eq(party.id, purchaseOrder.supplierId))
      .where(and(...where))
      .orderBy(desc(purchaseOrder.createdAt))
      .limit(500);
  }

  @Get('purchase-orders/:id')
  @RequirePermission('buying.purchase_order.read')
  async getPO(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [po] = await this.db
      .select({ po: purchaseOrder, supplierName: party.name })
      .from(purchaseOrder)
      .innerJoin(party, eq(party.id, purchaseOrder.supplierId))
      .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.entityId, entityId)));
    if (!po) throw new NotFoundException('Purchase order not found');
    const lines = await this.db
      .select({ line: purchaseOrderLine, itemCode: item.code, itemName: item.name, tracking: item.tracking, uomCode: uom.code, requiresInspection: item.requiresIncomingInspection })
      .from(purchaseOrderLine)
      .innerJoin(item, eq(item.id, purchaseOrderLine.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .where(eq(purchaseOrderLine.poId, id))
      .orderBy(asc(purchaseOrderLine.lineNo));
    const receipts = await this.db
      .select({ id: stockEntry.id, number: stockEntry.number, status: stockEntry.status, postingDate: stockEntry.postingDate, reference: stockEntry.reference })
      .from(stockEntry)
      .where(eq(stockEntry.purchaseOrderId, id))
      .orderBy(asc(stockEntry.createdAt));
    const invoices = await this.db
      .select({ id: purchaseInvoice.id, number: purchaseInvoice.number, status: purchaseInvoice.status, supplierInvoiceNo: purchaseInvoice.supplierInvoiceNo, grandTotal: purchaseInvoice.grandTotal })
      .from(purchaseInvoice)
      .where(eq(purchaseInvoice.purchaseOrderId, id))
      .orderBy(asc(purchaseInvoice.createdAt));
    return {
      ...po.po,
      supplierName: po.supplierName,
      lines: lines.map((l) => ({
        ...l.line,
        itemCode: l.itemCode,
        itemName: l.itemName,
        tracking: l.tracking,
        uomCode: l.uomCode,
        requiresInspection: l.requiresInspection,
        pendingQty: Dec.of(l.line.qty).sub(l.line.receivedQty).toString(),
        unbilledQty: Dec.of(l.line.receivedQty).sub(l.line.billedQty).toString(),
      })),
      receipts,
      invoices,
    };
  }

  @Post('purchase-orders')
  @RequirePermission('buying.purchase_order.create')
  async createPO(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(poInput, body);
    const { header, lines } = await this.preparePO(ctx, entityId, input);
    return this.db.transaction(async (tx) => {
      const [po] = await tx.insert(purchaseOrder).values({ ...header, tenantId: ctx.tenant.tenantId, entityId, createdBy: ctx.user.id }).returning();
      await tx.insert(purchaseOrderLine).values(lines.map((l, i) => ({ ...l, poId: po!.id, lineNo: i + 1 })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'purchase_order.create', targetType: 'purchase_order', targetId: po!.id, after: input }, tx);
      return po;
    });
  }

  @Put('purchase-orders/:id')
  @RequirePermission('buying.purchase_order.create')
  async updatePO(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(poInput, body);
    const { header, lines } = await this.preparePO(ctx, entityId, input);
    return this.db.transaction(async (tx) => {
      const po = await this.lockPO(tx, entityId, id);
      if (po.status !== 'draft') throw new ConflictException('Only draft purchase orders can be edited');
      await tx.update(purchaseOrder).set({ ...header, updatedAt: new Date() }).where(eq(purchaseOrder.id, id));
      await tx.delete(purchaseOrderLine).where(eq(purchaseOrderLine.poId, id));
      await tx.insert(purchaseOrderLine).values(lines.map((l, i) => ({ ...l, poId: id, lineNo: i + 1 })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'purchase_order.update', targetType: 'purchase_order', targetId: id, after: input }, tx);
      return { ok: true };
    });
  }

  @Delete('purchase-orders/:id')
  @RequirePermission('buying.purchase_order.create')
  async deletePO(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      const [po] = await tx.delete(purchaseOrder).where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.entityId, entityId), eq(purchaseOrder.status, 'draft'))).returning();
      if (!po) throw new ConflictException('Only drafts can be deleted');
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'purchase_order.delete_draft', targetType: 'purchase_order', targetId: id }, tx);
      return { ok: true };
    });
  }

  @Post('purchase-orders/:id/submit')
  @RequirePermission('buying.purchase_order.submit')
  async submitPO(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      const po = await this.lockPO(tx, entityId, id);
      if (po.status !== 'draft') throw new ConflictException('Only drafts can be submitted');
      const supplier = await this.supplier(ctx, po.supplierId);
      if (!supplier.isActive) throw new BadRequestException(`${supplier.name} is inactive`);
      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'purchase_order', po.orderDate);
      const [after] = await tx.update(purchaseOrder).set({ status: 'submitted', number, submittedBy: ctx.user.id, submittedAt: new Date(), updatedAt: new Date() }).where(eq(purchaseOrder.id, id)).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'purchase_order.submit', targetType: 'purchase_order', targetId: id, after: { number } }, tx);
      return after;
    });
  }

  @Post('purchase-orders/:id/cancel')
  @RequirePermission('buying.purchase_order.cancel')
  async cancelPO(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), body);
    return this.db.transaction(async (tx) => {
      const po = await this.lockPO(tx, entityId, id);
      if (po.status !== 'submitted') throw new ConflictException('Only submitted purchase orders can be cancelled');
      const [used] = await tx.select({ n: sql<string>`coalesce(sum(${purchaseOrderLine.receivedQty} + ${purchaseOrderLine.billedQty}), 0)` }).from(purchaseOrderLine).where(eq(purchaseOrderLine.poId, id));
      if (Dec.of(used!.n).gt('0')) throw new ConflictException('Goods have been received or billed against this PO. Close it instead.');
      await tx.update(purchaseOrder).set({ status: 'cancelled', cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() }).where(eq(purchaseOrder.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'purchase_order.cancel', targetType: 'purchase_order', targetId: id, reason }, tx);
      return { ok: true };
    });
  }

  /** Short-close: the remaining quantity won't be delivered. */
  @Post('purchase-orders/:id/close')
  @RequirePermission('buying.purchase_order.submit')
  async closePO(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), body);
    return this.db.transaction(async (tx) => {
      const po = await this.lockPO(tx, entityId, id);
      if (po.status !== 'submitted' || po.closedAt) throw new ConflictException('Only open purchase orders can be closed');
      await tx.update(purchaseOrder).set({ closedAt: new Date(), updatedAt: new Date() }).where(eq(purchaseOrder.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'purchase_order.close', targetType: 'purchase_order', targetId: id, reason }, tx);
      return { ok: true };
    });
  }

  // ───────────────────────── Incoming inspection ─────────────────────────

  /** Received lines waiting in quarantine for incoming inspection (docs/03 §5). */
  @Get('inspections/pending')
  @RequirePermission('quality.inspection.read')
  async pendingInspections(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const rows = await this.db.execute<Record<string, string>>(sql`
      select l.id as receipt_line_id, e.id as receipt_id, e.number as receipt_number, e.posting_date, e.reference,
             p.name as supplier_name, o.name as owner_name, i.id as item_id, i.code as item_code, i.name as item_name, u.code as uom_code,
             b.batch_no, b.heat_no, w.id as warehouse_id, w.code as warehouse_code, l.qty,
             coalesce((select sum(q.qty_inspected) from quality_inspection q where q.receipt_line_id = l.id and q.status = 'submitted'), 0) as inspected
      from stock_entry_line l
      join stock_entry e on e.id = l.entry_id
      join item i on i.id = l.item_id
      join uom u on u.id = i.stock_uom_id
      join warehouse w on w.id = l.to_warehouse_id
      left join batch b on b.id = l.batch_id
      left join party p on p.id = e.party_id
      left join party o on o.id = l.owner_party_id
      where e.entity_id = ${entityId} and e.status = 'submitted' and e.purpose = 'receipt'
        and w.type = 'quarantine' and i.requires_incoming_inspection
      order by e.posting_date, e.number, l.line_no`);
    return rows.rows
      .map((r) => ({
        receiptLineId: r.receipt_line_id,
        receiptId: r.receipt_id,
        receiptNumber: r.receipt_number,
        postingDate: r.posting_date,
        reference: r.reference,
        supplierName: r.supplier_name,
        ownerName: r.owner_name,
        itemId: r.item_id,
        itemCode: r.item_code,
        itemName: r.item_name,
        uomCode: r.uom_code,
        batchNo: r.batch_no,
        heatNo: r.heat_no,
        warehouseId: r.warehouse_id,
        warehouseCode: r.warehouse_code,
        qty: r.qty,
        inspected: r.inspected,
        pending: Dec.of(r.qty!).sub(r.inspected!).toFixed(6),
      }))
      .filter((r) => Dec.of(r.pending).gt('0'));
  }

  @Get('inspections')
  @RequirePermission('quality.inspection.read')
  async inspections(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    return this.db
      .select({
        id: qualityInspection.id,
        number: qualityInspection.number,
        status: qualityInspection.status,
        inspectionDate: qualityInspection.inspectionDate,
        result: qualityInspection.result,
        qtyInspected: qualityInspection.qtyInspected,
        qtyAccepted: qualityInspection.qtyAccepted,
        qtyRejected: qualityInspection.qtyRejected,
        checks: qualityInspection.checks,
        remarks: qualityInspection.remarks,
        cancelReason: qualityInspection.cancelReason,
        itemCode: item.code,
        itemName: item.name,
        batchNo: batch.batchNo,
        receiptNumber: sql<string>`(select e.number from stock_entry_line l join stock_entry e on e.id = l.entry_id where l.id = "quality_inspection"."receipt_line_id")`,
        transferEntryId: qualityInspection.transferEntryId,
        inspectorName: user.name,
      })
      .from(qualityInspection)
      .innerJoin(item, eq(item.id, qualityInspection.itemId))
      .innerJoin(user, eq(user.id, qualityInspection.createdBy))
      .leftJoin(batch, eq(batch.id, qualityInspection.batchId))
      .where(eq(qualityInspection.entityId, entityId))
      .orderBy(desc(qualityInspection.createdAt))
      .limit(500);
  }

  /** Record an inspection and move the stock: accepted → stores, rejected → MRB, in one transaction. */
  @Post('inspections')
  @RequirePermission('quality.inspection.submit')
  async recordInspection(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(inspectionInput, body);
    const accepted = Dec.of(input.qtyAccepted);
    const rejected = Dec.of(input.qtyRejected);
    const inspected = accepted.add(rejected);
    if (!inspected.gt('0')) throw new BadRequestException({ message: 'Enter the accepted and/or rejected quantity', issues: [{ path: 'qtyAccepted', message: 'Required' }] });

    return this.db.transaction(async (tx) => {
      const [rl] = await tx
        .select({ line: stockEntryLine, entry: stockEntry, wh: warehouse })
        .from(stockEntryLine)
        .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
        .innerJoin(warehouse, eq(warehouse.id, stockEntryLine.toWarehouseId))
        .where(and(eq(stockEntryLine.id, input.receiptLineId), eq(stockEntry.entityId, entityId)))
        .for('update', { of: stockEntryLine });
      if (!rl || rl.entry.status !== 'submitted' || rl.entry.purpose !== 'receipt') throw new BadRequestException('Not a submitted receipt line of this entity');
      if (rl.wh.type !== 'quarantine') throw new BadRequestException('Only stock received into quarantine is inspected here');
      const [done] = await tx
        .select({ q: sql<string>`coalesce(sum(${qualityInspection.qtyInspected}), 0)` })
        .from(qualityInspection)
        .where(and(eq(qualityInspection.receiptLineId, input.receiptLineId), eq(qualityInspection.status, 'submitted')));
      const pending = Dec.of(rl.line.qty).sub(done!.q);
      if (inspected.gt(pending)) throw new BadRequestException({ message: `Only ${pending.toFixed(3)} is waiting for inspection`, issues: [{ path: 'qtyAccepted', message: `At most ${pending.toFixed(3)} in total` }] });

      const pick = async (id: string | null | undefined, type: string, label: string) => {
        const where = id ? and(eq(warehouse.id, id), eq(warehouse.entityId, entityId)) : and(eq(warehouse.entityId, entityId), eq(warehouse.type, type as 'stores'), eq(warehouse.isActive, true));
        const [w] = await tx.select().from(warehouse).where(where).orderBy(asc(warehouse.code)).limit(1);
        if (!w) throw new BadRequestException(`No ${label} warehouse found; create one or choose it`);
        return w;
      };
      const acceptWh = accepted.gt('0') ? await pick(input.acceptWarehouseId, 'stores', 'stores') : null;
      const rejectWh = rejected.gt('0') ? await pick(input.rejectWarehouseId, 'mrb', 'MRB / hold') : null;

      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'quality_inspection', input.inspectionDate);
      const [transfer] = await tx
        .insert(stockEntry)
        .values({
          tenantId: ctx.tenant.tenantId,
          entityId,
          purpose: 'transfer',
          postingDate: input.inspectionDate,
          reference: number,
          remarks: `Incoming inspection ${number} of ${rl.entry.number}`,
          systemGenerated: true,
          createdBy: ctx.user.id,
        })
        .returning();
      const moves = [
        acceptWh && { toWarehouseId: acceptWh.id, qty: accepted.toString() },
        rejectWh && { toWarehouseId: rejectWh.id, qty: rejected.toString() },
      ].filter((m): m is { toWarehouseId: string; qty: string } => !!m);
      await tx.insert(stockEntryLine).values(
        moves.map((m, i) => ({
          entryId: transfer!.id,
          lineNo: i + 1,
          itemId: rl.line.itemId,
          qty: m.qty,
          fromWarehouseId: rl.wh.id,
          toWarehouseId: m.toWarehouseId,
          batchId: rl.line.batchId,
          ownerPartyId: rl.line.ownerPartyId,
        })),
      );
      await this.posting.submitIn(tx, ctx, entityId, transfer!.id);

      const result = rejected.isZero() ? 'accepted' : accepted.isZero() ? 'rejected' : 'partial';
      const [qi] = await tx
        .insert(qualityInspection)
        .values({
          tenantId: ctx.tenant.tenantId,
          entityId,
          number,
          status: 'submitted',
          receiptLineId: rl.line.id,
          itemId: rl.line.itemId,
          batchId: rl.line.batchId,
          ownerPartyId: rl.line.ownerPartyId,
          fromWarehouseId: rl.wh.id,
          acceptWarehouseId: acceptWh?.id ?? null,
          rejectWarehouseId: rejectWh?.id ?? null,
          qtyInspected: inspected.toString(),
          qtyAccepted: accepted.toString(),
          qtyRejected: rejected.toString(),
          result,
          checks: input.checks ?? null,
          remarks: input.remarks ?? null,
          transferEntryId: transfer!.id,
          inspectionDate: input.inspectionDate,
          createdBy: ctx.user.id,
          submittedBy: ctx.user.id,
          submittedAt: new Date(),
        })
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'quality_inspection.submit', targetType: 'quality_inspection', targetId: qi!.id, after: qi }, tx);
      return qi;
    });
  }

  @Post('inspections/:id/cancel')
  @RequirePermission('quality.inspection.cancel')
  async cancelInspection(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), body);
    return this.db.transaction(async (tx) => {
      const [qi] = await tx.select().from(qualityInspection).where(and(eq(qualityInspection.id, id), eq(qualityInspection.entityId, entityId))).for('update');
      if (!qi) throw new NotFoundException('Inspection not found');
      if (qi.status !== 'submitted') throw new ConflictException('Only submitted inspections can be cancelled');
      // Moves the stock back to quarantine; refused if it has already been issued from stores/MRB.
      if (qi.transferEntryId) await this.posting.cancelIn(tx, ctx, entityId, qi.transferEntryId, `Inspection ${qi.number} cancelled: ${reason}`);
      await tx.update(qualityInspection).set({ status: 'cancelled', cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() }).where(eq(qualityInspection.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'quality_inspection.cancel', targetType: 'quality_inspection', targetId: id, reason }, tx);
      return { ok: true };
    });
  }

  // ───────────────────────── Purchase invoices ─────────────────────────

  @Get('purchase-invoices')
  @RequirePermission('buying.purchase_invoice.read')
  async listInvoices(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { status } = parse(z.object({ status: z.enum(['draft', 'submitted', 'cancelled']).optional() }), query);
    const where: SQL[] = [eq(purchaseInvoice.entityId, entityId)];
    if (status) where.push(eq(purchaseInvoice.status, status));
    return this.db
      .select({
        id: purchaseInvoice.id,
        number: purchaseInvoice.number,
        status: purchaseInvoice.status,
        supplierName: party.name,
        supplierInvoiceNo: purchaseInvoice.supplierInvoiceNo,
        supplierInvoiceDate: purchaseInvoice.supplierInvoiceDate,
        postingDate: purchaseInvoice.postingDate,
        dueDate: purchaseInvoice.dueDate,
        msmeCategory: purchaseInvoice.msmeCategory,
        reverseCharge: purchaseInvoice.reverseCharge,
        taxableValue: purchaseInvoice.taxableValue,
        totalTax: purchaseInvoice.totalTax,
        grandTotal: purchaseInvoice.grandTotal,
        currency: purchaseInvoice.currency,
        poNumber: purchaseOrder.number,
      })
      .from(purchaseInvoice)
      .innerJoin(party, eq(party.id, purchaseInvoice.supplierId))
      .leftJoin(purchaseOrder, eq(purchaseOrder.id, purchaseInvoice.purchaseOrderId))
      .where(and(...where))
      .orderBy(desc(purchaseInvoice.createdAt))
      .limit(500);
  }

  @Get('purchase-invoices/:id')
  @RequirePermission('buying.purchase_invoice.read')
  async getInvoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [inv] = await this.db
      .select({ inv: purchaseInvoice, supplierName: party.name, supplierGstin: party.gstin, poNumber: purchaseOrder.number })
      .from(purchaseInvoice)
      .innerJoin(party, eq(party.id, purchaseInvoice.supplierId))
      .leftJoin(purchaseOrder, eq(purchaseOrder.id, purchaseInvoice.purchaseOrderId))
      .where(and(eq(purchaseInvoice.id, id), eq(purchaseInvoice.entityId, entityId)));
    if (!inv) throw new NotFoundException('Purchase invoice not found');
    const lines = await this.db
      .select({ line: purchaseInvoiceLine, itemCode: item.code, itemName: item.name, uomCode: uom.code, poRate: purchaseOrderLine.rate })
      .from(purchaseInvoiceLine)
      .innerJoin(item, eq(item.id, purchaseInvoiceLine.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .leftJoin(purchaseOrderLine, eq(purchaseOrderLine.id, purchaseInvoiceLine.poLineId))
      .where(eq(purchaseInvoiceLine.invoiceId, id))
      .orderBy(asc(purchaseInvoiceLine.lineNo));
    return { ...inv.inv, supplierName: inv.supplierName, supplierGstin: inv.supplierGstin, poNumber: inv.poNumber, lines: lines.map((l) => ({ ...l.line, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, poRate: l.poRate })) };
  }

  @Post('purchase-invoices')
  @RequirePermission('buying.purchase_invoice.create')
  async createInvoice(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(piInput, body);
    const { header, lines } = await this.prepareInvoice(ctx, entityId, input);
    return this.db.transaction(async (tx) => {
      const [inv] = await tx.insert(purchaseInvoice).values({ ...header, tenantId: ctx.tenant.tenantId, entityId, createdBy: ctx.user.id }).returning();
      await tx.insert(purchaseInvoiceLine).values(lines.map((l, i) => ({ ...l, invoiceId: inv!.id, lineNo: i + 1 })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'purchase_invoice.create', targetType: 'purchase_invoice', targetId: inv!.id, after: input }, tx);
      return inv;
    });
  }

  @Put('purchase-invoices/:id')
  @RequirePermission('buying.purchase_invoice.create')
  async updateInvoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(piInput, body);
    const { header, lines } = await this.prepareInvoice(ctx, entityId, input);
    return this.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(purchaseInvoice).where(and(eq(purchaseInvoice.id, id), eq(purchaseInvoice.entityId, entityId))).for('update');
      if (!inv) throw new NotFoundException('Purchase invoice not found');
      if (inv.status !== 'draft') throw new ConflictException('Only drafts can be edited');
      await tx.update(purchaseInvoice).set({ ...header, updatedAt: new Date() }).where(eq(purchaseInvoice.id, id));
      await tx.delete(purchaseInvoiceLine).where(eq(purchaseInvoiceLine.invoiceId, id));
      await tx.insert(purchaseInvoiceLine).values(lines.map((l, i) => ({ ...l, invoiceId: id, lineNo: i + 1 })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'purchase_invoice.update', targetType: 'purchase_invoice', targetId: id, after: input }, tx);
      return { ok: true };
    });
  }

  @Delete('purchase-invoices/:id')
  @RequirePermission('buying.purchase_invoice.create')
  async deleteInvoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [inv] = await this.db.delete(purchaseInvoice).where(and(eq(purchaseInvoice.id, id), eq(purchaseInvoice.entityId, entityId), eq(purchaseInvoice.status, 'draft'))).returning();
    if (!inv) throw new ConflictException('Only drafts can be deleted');
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'purchase_invoice.delete_draft', targetType: 'purchase_invoice', targetId: id });
    return { ok: true };
  }

  /**
   * Submit: duplicate check, 3-way match (can't bill more than received), rate variance vs PO, MSME due date,
   * number. GL posting arrives with slice 1d.
   */
  @Post('purchase-invoices/:id/submit')
  @RequirePermission('buying.purchase_invoice.submit')
  async submitInvoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { acceptRateVariance } = parse(z.object({ acceptRateVariance: z.boolean().default(false) }), body ?? {});
    return this.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(purchaseInvoice).where(and(eq(purchaseInvoice.id, id), eq(purchaseInvoice.entityId, entityId))).for('update');
      if (!inv) throw new NotFoundException('Purchase invoice not found');
      if (inv.status !== 'draft') throw new ConflictException('Only drafts can be submitted');

      // The same supplier invoice can't be booked twice in a financial year.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pinv:${entityId}:${inv.supplierId}`}))`);
      const fy = fyCode(new Date(`${inv.supplierInvoiceDate}T00:00:00Z`));
      const dupes = await tx
        .select({ number: purchaseInvoice.number, date: purchaseInvoice.supplierInvoiceDate })
        .from(purchaseInvoice)
        .where(
          and(
            eq(purchaseInvoice.entityId, entityId),
            eq(purchaseInvoice.supplierId, inv.supplierId),
            eq(purchaseInvoice.status, 'submitted'),
            sql`upper(${purchaseInvoice.supplierInvoiceNo}) = upper(${inv.supplierInvoiceNo})`,
            ne(purchaseInvoice.id, id),
          ),
        );
      const dupe = dupes.find((d) => fyCode(new Date(`${d.date}T00:00:00Z`)) === fy);
      if (dupe) throw new ConflictException(`Supplier invoice ${inv.supplierInvoiceNo} is already booked as ${dupe.number}`);

      const lines = await tx.select().from(purchaseInvoiceLine).where(eq(purchaseInvoiceLine.invoiceId, id)).orderBy(asc(purchaseInvoiceLine.lineNo));
      const poLineIds = lines.map((l) => l.poLineId).filter((x): x is string => !!x);
      const poLines = new Map((poLineIds.length ? await tx.select().from(purchaseOrderLine).where(inArray(purchaseOrderLine.id, poLineIds)).for('update') : []).map((l) => [l.id, l]));
      const variances: string[] = [];
      for (const l of lines) {
        if (!l.poLineId) continue;
        const pl = poLines.get(l.poLineId)!;
        if (pl.poId !== inv.purchaseOrderId) throw new BadRequestException(`Line ${l.lineNo}: not a line of the linked purchase order`);
        const unbilled = Dec.of(pl.receivedQty).sub(pl.billedQty);
        if (Dec.of(l.qty).gt(unbilled)) throw new BadRequestException(`Line ${l.lineNo}: only ${unbilled.toFixed(3)} received and not yet billed (3-way match)`);
        if (!Dec.of(l.rate).eq(pl.rate)) variances.push(`line ${l.lineNo}: ${inv.currency} ${Dec.of(l.rate).toFixed(2)} vs PO ${inv.currency} ${Dec.of(pl.rate).toFixed(2)}`);
      }
      if (variances.length && !acceptRateVariance) {
        throw new BadRequestException({ message: `Rate differs from the purchase order (${variances.join('; ')}). Confirm the variance to submit.`, issues: [{ path: 'acceptRateVariance', message: 'Confirm rate variance' }] });
      }
      for (const l of lines.filter((x) => x.poLineId)) {
        await tx.update(purchaseOrderLine).set({ billedQty: sql`${purchaseOrderLine.billedQty} + ${l.qty}` }).where(eq(purchaseOrderLine.id, l.poLineId!));
      }

      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'purchase_invoice', inv.postingDate);
      const [after] = await tx
        .update(purchaseInvoice)
        .set({ status: 'submitted', number, submittedBy: ctx.user.id, submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(purchaseInvoice.id, id))
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'purchase_invoice.submit', targetType: 'purchase_invoice', targetId: id, after: { number, grandTotal: inv.grandTotal, variances } }, tx);
      return after;
    });
  }

  @Post('purchase-invoices/:id/cancel')
  @RequirePermission('buying.purchase_invoice.cancel')
  async cancelInvoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), body);
    return this.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(purchaseInvoice).where(and(eq(purchaseInvoice.id, id), eq(purchaseInvoice.entityId, entityId))).for('update');
      if (!inv) throw new NotFoundException('Purchase invoice not found');
      if (inv.status !== 'submitted') throw new ConflictException('Only submitted invoices can be cancelled');
      const lines = await tx.select().from(purchaseInvoiceLine).where(eq(purchaseInvoiceLine.invoiceId, id));
      for (const l of lines.filter((x) => x.poLineId)) {
        await tx.update(purchaseOrderLine).set({ billedQty: sql`${purchaseOrderLine.billedQty} - ${l.qty}` }).where(eq(purchaseOrderLine.id, l.poLineId!));
      }
      await tx.update(purchaseInvoice).set({ status: 'cancelled', cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() }).where(eq(purchaseInvoice.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'purchase_invoice.cancel', targetType: 'purchase_invoice', targetId: id, reason }, tx);
      return { ok: true };
    });
  }

  // ───────────────────────── helpers ─────────────────────────

  private async lockPO(tx: Tx, entityId: string, id: string) {
    const [po] = await tx.select().from(purchaseOrder).where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.entityId, entityId))).for('update');
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  private async supplier(ctx: TenantRequestContext, id: string): Promise<Party> {
    const [p] = await this.db.select().from(party).where(and(eq(party.id, id), eq(party.tenantId, ctx.tenant.tenantId)));
    if (!p?.isSupplier) throw new BadRequestException({ message: 'Choose a supplier', issues: [{ path: 'supplierId', message: 'Not a supplier' }] });
    return p;
  }

  /** Our receiving GSTIN: the one chosen, else the entity's first registration. */
  private async ourRegistration(entityId: string, id?: string | null): Promise<GstReg> {
    const [r] = await this.db
      .select()
      .from(gstRegistration)
      .where(id ? and(eq(gstRegistration.id, id), eq(gstRegistration.entityId, entityId)) : eq(gstRegistration.entityId, entityId))
      .orderBy(asc(gstRegistration.createdAt))
      .limit(1);
    if (!r) throw new BadRequestException('Add a GST registration for this entity first (Settings → Entities & GST)');
    return r;
  }

  /** Fill each line's GST rate from its HSN/SAC (effective on `date`) unless given. */
  private async withRates<T extends { itemId: string; qty: string; rate: string; gstRate?: string | undefined }>(ctx: TenantRequestContext, lines: T[], date: string) {
    const items = new Map((await this.db.select().from(item).where(and(eq(item.tenantId, ctx.tenant.tenantId), inArray(item.id, [...new Set(lines.map((l) => l.itemId))])))).map((i) => [i.id, i]));
    const out: (T & { gstRate: string; isService: boolean; hsn: string | null })[] = [];
    for (const [idx, l] of lines.entries()) {
      const it = items.get(l.itemId);
      if (!it) throw new BadRequestException(`Line ${idx + 1}: unknown item`);
      let rate = l.gstRate;
      if (rate === undefined) {
        if (!it.hsnCode) throw new BadRequestException({ message: `Line ${idx + 1}: ${it.code} has no HSN/SAC; enter the GST rate`, issues: [{ path: `lines.${idx}.gstRate`, message: 'Required' }] });
        const [h] = await this.db
          .select({ rate: hsnCode.gstRate })
          .from(hsnCode)
          .where(and(eq(hsnCode.tenantId, ctx.tenant.tenantId), eq(hsnCode.code, it.hsnCode), lte(hsnCode.effectiveFrom, date)))
          .orderBy(desc(hsnCode.effectiveFrom))
          .limit(1);
        if (!h) throw new BadRequestException({ message: `Line ${idx + 1}: no GST rate on file for HSN ${it.hsnCode}; add it under Units & HSN/SAC or enter the rate`, issues: [{ path: `lines.${idx}.gstRate`, message: 'Required' }] });
        rate = String(Number(h.rate));
      }
      out.push({ ...l, gstRate: rate, isService: it.type === 'service', hsn: it.hsnCode });
    }
    return out;
  }

  /** Decision 026: foreign currency only for overseas suppliers, with an exchange rate; INR is always 1. */
  private currencyOf(supplier: Party, input: { currency: string; exchangeRate?: string | null }) {
    if (input.currency === 'INR') return { currency: 'INR', exchangeRate: '1' };
    if (supplier.gstTreatment !== 'overseas') {
      throw new BadRequestException({ message: `${supplier.name} is not an overseas supplier; Indian suppliers are billed in INR`, issues: [{ path: 'currency', message: 'Use INR' }] });
    }
    if (!input.exchangeRate || !Dec.of(input.exchangeRate).gt('0')) {
      throw new BadRequestException({ message: `Enter the exchange rate (INR per 1 ${input.currency})`, issues: [{ path: 'exchangeRate', message: 'Required' }] });
    }
    return { currency: input.currency, exchangeRate: input.exchangeRate };
  }

  private tax(supplier: Party, reg: GstReg, lines: { qty: string; rate: string; gstRate: string; isService: boolean }[], reverseCharge: boolean): TaxResult {
    const overseas = supplier.gstTreatment === 'overseas';
    // Unregistered and composition suppliers can't charge GST (RCM aside).
    const noGst = ['unregistered', 'composition'].includes(supplier.gstTreatment) && !reverseCharge;
    const supplyType = inwardSupplyType(supplier.gstTreatment, lines.length > 0 && lines.every((l) => l.isService));
    return computeGst(
      { supplierStateCode: overseas ? '96' : (supplier.stateCode ?? reg.stateCode), placeOfSupplyStateCode: reg.stateCode, supplyType, reverseCharge },
      lines.map((l) => ({ taxableValue: Dec.of(l.qty).mul(l.rate).toFixed(2), gstRate: noGst ? '0' : l.gstRate })),
    );
  }

  private async preparePO(ctx: TenantRequestContext, entityId: string, input: z.infer<typeof poInput>) {
    const supplier = await this.supplier(ctx, input.supplierId);
    const reg = await this.ourRegistration(entityId, input.gstRegistrationId);
    const lines = await this.withRates(ctx, input.lines, input.orderDate);
    for (const [i, l] of lines.entries()) if (!Dec.of(l.qty).gt('0')) throw new BadRequestException(`Line ${i + 1}: quantity must be positive`);
    const t = this.tax(supplier, reg, lines, false);
    return {
      header: {
        ...this.currencyOf(supplier, input),
        supplierId: supplier.id,
        gstRegistrationId: reg.id,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate ?? null,
        supplierQuoteRef: input.supplierQuoteRef ?? null,
        paymentTermsDays: input.paymentTermsDays ?? supplier.creditDays ?? null,
        remarks: input.remarks ?? null,
        taxableValue: t.taxableValue,
        totalTax: t.totalTax,
        grandTotal: t.invoiceTotal,
      },
      lines: lines.map((l, i) => ({ itemId: l.itemId, description: l.description ?? null, qty: l.qty, rate: l.rate, gstRate: l.gstRate, taxableValue: t.lines[i]!.taxableValue })),
    };
  }

  private async prepareInvoice(ctx: TenantRequestContext, entityId: string, input: z.infer<typeof piInput>) {
    const supplier = await this.supplier(ctx, input.supplierId);
    const reg = await this.ourRegistration(entityId, input.gstRegistrationId);
    if (input.purchaseOrderId) {
      const [po] = await this.db.select().from(purchaseOrder).where(and(eq(purchaseOrder.id, input.purchaseOrderId), eq(purchaseOrder.entityId, entityId)));
      if (!po || po.status !== 'submitted') throw new BadRequestException('Link a submitted purchase order');
      if (po.supplierId !== supplier.id) throw new BadRequestException('The purchase order belongs to another supplier');
      if (po.currency !== input.currency) throw new BadRequestException({ message: `The purchase order is in ${po.currency}`, issues: [{ path: 'currency', message: `Use ${po.currency}` }] });
    } else if (input.lines.some((l) => l.poLineId)) {
      throw new BadRequestException('Lines reference a purchase order that is not linked');
    }
    if (input.supplierInvoiceDate > input.postingDate) throw new BadRequestException({ message: 'The supplier invoice date is after the posting date', issues: [{ path: 'supplierInvoiceDate', message: 'Check the date' }] });
    const lines = await this.withRates(ctx, input.lines, input.supplierInvoiceDate);
    const t = this.tax(supplier, reg, lines, input.reverseCharge);
    // MSME: micro and small suppliers must be paid within 45 days of acceptance (Sec 43B(h)).
    const msme = ['micro', 'small'].includes(supplier.msmeCategory ?? '');
    const terms = supplier.creditDays ?? (msme ? 45 : 30);
    const dueDays = msme ? Math.min(terms, 45) : terms;
    return {
      header: {
        ...this.currencyOf(supplier, input),
        supplierId: supplier.id,
        gstRegistrationId: reg.id,
        purchaseOrderId: input.purchaseOrderId ?? null,
        supplierInvoiceNo: input.supplierInvoiceNo.toUpperCase(),
        supplierInvoiceDate: input.supplierInvoiceDate,
        postingDate: input.postingDate,
        placeOfSupplyStateCode: reg.stateCode,
        supplyType: inwardSupplyType(supplier.gstTreatment, lines.every((l) => l.isService)),
        reverseCharge: t.reverseCharge,
        itcEligible: input.itcEligible,
        dueDate: addDays(input.supplierInvoiceDate, dueDays),
        msmeCategory: supplier.msmeCategory,
        taxableValue: t.taxableValue,
        igst: t.igst,
        cgst: t.cgst,
        sgst: t.sgst,
        cess: t.cess,
        totalTax: t.totalTax,
        grandTotal: t.invoiceTotal,
        remarks: input.remarks ?? null,
      },
      lines: lines.map((l, i) => ({
        itemId: l.itemId,
        poLineId: l.poLineId ?? null,
        hsnCode: l.hsn,
        qty: l.qty,
        rate: l.rate,
        gstRate: l.gstRate,
        taxableValue: t.lines[i]!.taxableValue,
        igst: t.lines[i]!.igst,
        cgst: t.lines[i]!.cgst,
        sgst: t.lines[i]!.sgst,
        cess: t.lines[i]!.cess,
      })),
    };
  }
}
