import {guardSandboxSourceIn} from './gst-sandbox/source-guards.js';
import { salesNote } from '@factoryos/db';
import { OperationalPostings } from './accounting/operational-postings.js';
import { BillService } from './accounting/bill.service.js';
import { GlPostingService } from './accounting/gl-posting.service.js';
import { lockAccounting } from './accounting/accounting-lock.js';
import { computeGst, GST_RATES, type SupplyType, type TaxResult } from '@factoryos/compliance-in';
import { Dec } from '@factoryos/core';
import {
  accountingSettings,
  type Database,
  gstRegistration,
  hsnCode,
  item,
  party,
  quotation,
  quotationLine,
  salesInvoice,
  salesInvoiceLine,
  salesOrder,
  salesOrderLine,
  stockEntry,
  stockEntryLine,
  uom,
  warehouse,
} from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lte, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';
import { FaiService } from './quality/fai.service.js';
import { StockPostingService } from './stock-posting.service.js';
import { salesInvoiceDetail, salesInvoiceList } from './readers/sales-invoices.read.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Party = typeof party.$inferSelect;
type GstReg = typeof gstRegistration.$inferSelect;
type Address = { label?: string; line1: string; line2?: string; city: string; stateCode: string; pincode: string; country?: string };

const OUTWARD_TYPES = ['regular', 'sez_with_payment', 'sez_without_payment', 'export_with_payment', 'export_under_lut'] as const;

const qtyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,6})?$/, 'Must be a number with up to 6 decimals'));
const gstRate = z
  .union([z.string(), z.number()])
  .transform((v) => String(Number(v)))
  .pipe(z.enum(GST_RATES));
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code').default('INR');
const exchangeRate = qtyString.nullable().optional();
const stateCode = z.string().regex(/^\d{2}$/, 'Two-digit state code').nullable().optional();

const lineInput = z.object({
  itemId: z.string().uuid(),
  description: z.string().trim().max(500).nullable().optional(),
  qty: qtyString,
  rate: qtyString,
  gstRate: gstRate.optional(),
});
const docInput = {
  customerId: z.string().uuid(),
  gstRegistrationId: z.string().uuid().nullable().optional(),
  supplyType: z.enum(OUTWARD_TYPES).nullable().optional(),
  placeOfSupplyStateCode: stateCode,
  currency,
  exchangeRate,
  remarks: z.string().trim().max(2000).nullable().optional(),
};
const quotationInput = z.object({
  ...docInput,
  quotationDate: z.string().date(),
  validTill: z.string().date().nullable().optional(),
  customerRef: z.string().trim().max(100).nullable().optional(),
  lines: z.array(lineInput).min(1).max(300),
});
const orderInput = z.object({
  ...docInput,
  orderDate: z.string().date(),
  deliveryDate: z.string().date().nullable().optional(),
  quotationId: z.string().uuid().nullable().optional(),
  customerPoNo: z.string().trim().max(60).nullable().optional(),
  customerPoDate: z.string().date().nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  lines: z.array(lineInput).min(1).max(300),
});
const invoiceInput = z.object({
  ...docInput,
  invoiceDate: z.string().date(),
  salesOrderId: z.string().uuid().nullable().optional(),
  customerPoNo: z.string().trim().max(60).nullable().optional(),
  /** Which of the customer's addresses to bill / ship to (by label); defaults to the first. */
  billingAddressLabel: z.string().trim().max(40).nullable().optional(),
  shippingAddressLabel: z.string().trim().max(40).nullable().optional(),
  shippingBillNo: z.string().trim().max(20).nullable().optional(),
  shippingBillDate: z.string().date().nullable().optional(),
  portCode: z.string().trim().toUpperCase().max(10).nullable().optional(),
  lines: z
    .array(
      lineInput.extend({
        soLineId: z.string().uuid().nullable().optional(),
        warehouseId: z.string().uuid().nullable().optional(),
        batchId: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1)
    .max(300),
});
const submitInput = z.object({ acceptCreditWarning: z.boolean().default(false) });

function entityOf(ctx: TenantRequestContext): string {
  if (!ctx.tenant.activeEntityId) throw new BadRequestException('Select a legal entity first (selling is per entity)');
  return ctx.tenant.activeEntityId;
}
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const todayIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const reason = z.object({ reason: z.string().trim().min(5).max(500) });

type Ctxs = { customer: Party; reg: GstReg; supplyType: SupplyType; pos: string; currency: string; exchangeRate: string };

/** Quotation → sales order → sales invoice (slice 1c). The invoice ships the goods (decision 030). */
@Controller()
export class SellingController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly accounting: OperationalPostings,
    private readonly gl: GlPostingService,
    private readonly posting: StockPostingService,
    private readonly bills: BillService,
    private readonly fai: FaiService,
  ) {}

  // ───────────────────────── Tax preview & credit ─────────────────────────

  @Post('selling/tax-preview')
  @RequirePermission('selling.quotation.read')
  async taxPreview(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(
      z.object({ ...docInput, date: z.string().date(), shippingAddressLabel: z.string().nullable().optional(), lines: z.array(lineInput).max(300) }),
      body,
    );
    const c = await this.context(ctx, entityId, input, input.date, input.shippingAddressLabel);
    const lines = await this.withRates(ctx, input.lines, input.date);
    return { ...this.tax(c, lines), gstRates: lines.map((l) => l.gstRate), supplyType: c.supplyType, placeOfSupplyStateCode: c.pos, lutArn: this.needsLut(c.supplyType) ? c.reg.lutArn : null };
  }

  /** Credit position of a customer (decision 032). Until receipts exist every submitted invoice is outstanding. */
  @Get('selling/credit-status')
  @RequirePermission('selling.sales_order.read')
  async creditStatus(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { customerId } = parse(z.object({ customerId: z.string().uuid() }), query);
    const customer = await this.customer(ctx, customerId);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      return this.credit(tx, ctx, entityId, customer, '0');
    });
  }

  // ───────────────────────── Quotations ─────────────────────────

  @Get('quotations')
  @RequirePermission('selling.quotation.read')
  async listQuotations(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { status } = parse(z.object({ status: z.enum(['draft', 'submitted', 'cancelled']).optional() }), query);
    const where: SQL[] = [eq(quotation.entityId, entityId)];
    if (status) where.push(eq(quotation.status, status));
    return this.db
      .select({
        id: quotation.id,
        number: quotation.number,
        status: quotation.status,
        quotationDate: quotation.quotationDate,
        validTill: quotation.validTill,
        customerName: party.name,
        customerRef: quotation.customerRef,
        currency: quotation.currency,
        grandTotal: quotation.grandTotal,
        orderNumber: sql<string | null>`(select so.number from sales_order so where so.quotation_id = "quotation"."id" and so.status <> 'cancelled' order by so.created_at limit 1)`,
      })
      .from(quotation)
      .innerJoin(party, eq(party.id, quotation.customerId))
      .where(and(...where))
      .orderBy(desc(quotation.createdAt))
      .limit(500);
  }

  @Get('quotations/:id')
  @RequirePermission('selling.quotation.read')
  async getQuotation(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [q] = await this.db
      .select({ q: quotation, customerName: party.name })
      .from(quotation)
      .innerJoin(party, eq(party.id, quotation.customerId))
      .where(and(eq(quotation.id, id), eq(quotation.entityId, entityId)));
    if (!q) throw new NotFoundException('Quotation not found');
    const lines = await this.quotationLines(id);
    const orders = await this.db.select({ id: salesOrder.id, number: salesOrder.number, status: salesOrder.status }).from(salesOrder).where(eq(salesOrder.quotationId, id));
    return { ...q.q, customerName: q.customerName, lines, orders };
  }

  @Post('quotations')
  @RequirePermission('selling.quotation.create')
  async createQuotation(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(quotationInput, body);
    const { header, lines } = await this.prepare(ctx, entityId, input, input.quotationDate);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const [q] = await tx
        .insert(quotation)
        .values({ ...header, quotationDate: input.quotationDate, validTill: input.validTill ?? null, customerRef: input.customerRef ?? null, tenantId: ctx.tenant.tenantId, entityId, createdBy: ctx.user.id })
        .returning();
      await tx.insert(quotationLine).values(lines.map((l, i) => ({ ...l, quotationId: q!.id, lineNo: i + 1 })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'quotation.create', targetType: 'quotation', targetId: q!.id, after: input }, tx);
      return q;
    });
  }

  @Put('quotations/:id')
  @RequirePermission('selling.quotation.create')
  async updateQuotation(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(quotationInput, body);
    const { header, lines } = await this.prepare(ctx, entityId, input, input.quotationDate);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const [q] = await tx.select().from(quotation).where(and(eq(quotation.id, id), eq(quotation.entityId, entityId))).for('update');
      if (!q) throw new NotFoundException('Quotation not found');
      if (q.status !== 'draft') throw new ConflictException('Only drafts can be edited');
      await tx.update(quotation).set({ ...header, quotationDate: input.quotationDate, validTill: input.validTill ?? null, customerRef: input.customerRef ?? null, updatedAt: new Date() }).where(eq(quotation.id, id));
      await tx.delete(quotationLine).where(eq(quotationLine.quotationId, id));
      await tx.insert(quotationLine).values(lines.map((l, i) => ({ ...l, quotationId: id, lineNo: i + 1 })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'quotation.update', targetType: 'quotation', targetId: id, after: input }, tx);
      return { ok: true };
    });
  }

  @Delete('quotations/:id')
  @RequirePermission('selling.quotation.create')
  async deleteQuotation(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [q] = await this.db.delete(quotation).where(and(eq(quotation.id, id), eq(quotation.entityId, entityId), eq(quotation.status, 'draft'))).returning();
    if (!q) throw new ConflictException('Only drafts can be deleted');
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'quotation.delete_draft', targetType: 'quotation', targetId: id });
    return { ok: true };
  }

  @Post('quotations/:id/submit')
  @RequirePermission('selling.quotation.submit')
  async submitQuotation(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const [q] = await tx.select().from(quotation).where(and(eq(quotation.id, id), eq(quotation.entityId, entityId))).for('update');
      if (!q) throw new NotFoundException('Quotation not found');
      if (q.status !== 'draft') throw new ConflictException('Only drafts can be submitted');
      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'quotation', q.quotationDate);
      const [after] = await tx.update(quotation).set({ status: 'submitted', number, submittedBy: ctx.user.id, submittedAt: new Date(), updatedAt: new Date() }).where(eq(quotation.id, id)).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'quotation.submit', targetType: 'quotation', targetId: id, after: { number } }, tx);
      return after;
    });
  }

  @Post('quotations/:id/cancel')
  @RequirePermission('selling.quotation.cancel')
  async cancelQuotation(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: why } = parse(reason, body);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const [q] = await tx.select().from(quotation).where(and(eq(quotation.id, id), eq(quotation.entityId, entityId))).for('update');
      if (!q) throw new NotFoundException('Quotation not found');
      if (q.status !== 'submitted') throw new ConflictException('Only submitted quotations can be cancelled');
      await tx.update(quotation).set({ status: 'cancelled', cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: why, updatedAt: new Date() }).where(eq(quotation.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'quotation.cancel', targetType: 'quotation', targetId: id, reason: why }, tx);
      return { ok: true };
    });
  }

  /** Customer accepted: a draft sales order with the quotation's lines and prices. */
  @Post('quotations/:id/order')
  @RequirePermission('selling.sales_order.create')
  async orderFromQuotation(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { customerPoNo, customerPoDate } = parse(z.object({ customerPoNo: z.string().trim().max(60).nullable().optional(), customerPoDate: z.string().date().nullable().optional() }), body ?? {});
    const q = await this.getQuotation(ctx, id);
    if (q.status !== 'submitted') throw new ConflictException('Submit the quotation before ordering it');
    if (q.orders.some((o) => o.status !== 'cancelled')) throw new ConflictException(`Already ordered as ${q.orders.find((o) => o.status !== 'cancelled')!.number ?? 'a draft order'}`);
    return this.createOrder(
      ctx,
      parse(orderInput, {
      customerId: q.customerId,
      gstRegistrationId: q.gstRegistrationId,
      supplyType: q.supplyType,
      placeOfSupplyStateCode: q.placeOfSupplyStateCode,
      currency: q.currency,
      exchangeRate: q.exchangeRate,
      orderDate: todayIst(),
      quotationId: q.id,
      customerPoNo: customerPoNo ?? null,
      customerPoDate: customerPoDate ?? null,
      remarks: q.remarks,
      lines: q.lines.map((l) => ({ itemId: l.itemId, description: l.description, qty: l.qty, rate: l.rate, gstRate: String(Number(l.gstRate)) })),
      }),
    );
  }

  // ───────────────────────── Sales orders ─────────────────────────

  @Get('sales-orders')
  @RequirePermission('selling.sales_order.read')
  async listOrders(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { status, customerId, open } = parse(
      z.object({ status: z.enum(['draft', 'submitted', 'cancelled']).optional(), customerId: z.string().uuid().optional(), open: z.enum(['true']).optional() }),
      query,
    );
    const where: SQL[] = [eq(salesOrder.entityId, entityId)];
    if (status) where.push(eq(salesOrder.status, status));
    if (customerId) where.push(eq(salesOrder.customerId, customerId));
    if (open) where.push(eq(salesOrder.status, 'submitted'), sql`${salesOrder.closedAt} is null`);
    return this.db
      .select({
        id: salesOrder.id,
        number: salesOrder.number,
        status: salesOrder.status,
        closedAt: salesOrder.closedAt,
        orderDate: salesOrder.orderDate,
        deliveryDate: salesOrder.deliveryDate,
        customerId: salesOrder.customerId,
        customerName: party.name,
        customerPoNo: salesOrder.customerPoNo,
        currency: salesOrder.currency,
        grandTotal: salesOrder.grandTotal,
        orderedQty: sql<string>`(select coalesce(sum(l.qty), 0) from sales_order_line l where l.so_id = "sales_order"."id")`,
        invoicedQty: sql<string>`(select coalesce(sum(l.invoiced_qty), 0) from sales_order_line l where l.so_id = "sales_order"."id")`,
      })
      .from(salesOrder)
      .innerJoin(party, eq(party.id, salesOrder.customerId))
      .where(and(...where))
      .orderBy(desc(salesOrder.createdAt))
      .limit(500);
  }

  @Get('sales-orders/:id')
  @RequirePermission('selling.sales_order.read')
  async getOrder(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [o] = await this.db
      .select({ o: salesOrder, customerName: party.name, quotationNumber: quotation.number })
      .from(salesOrder)
      .innerJoin(party, eq(party.id, salesOrder.customerId))
      .leftJoin(quotation, eq(quotation.id, salesOrder.quotationId))
      .where(and(eq(salesOrder.id, id), eq(salesOrder.entityId, entityId)));
    if (!o) throw new NotFoundException('Sales order not found');
    const lines = (await this.orderLines(id)).map((l) => ({ ...l, pendingQty: Dec.of(l.qty).sub(l.invoicedQty).toFixed(6) }));
    const invoices = await this.db
      .select({ id: salesInvoice.id, number: salesInvoice.number, status: salesInvoice.status, invoiceDate: salesInvoice.invoiceDate, grandTotal: salesInvoice.grandTotal })
      .from(salesInvoice)
      .where(eq(salesInvoice.salesOrderId, id))
      .orderBy(asc(salesInvoice.createdAt));
    return { ...o.o, customerName: o.customerName, quotationNumber: o.quotationNumber, lines, invoices };
  }

  @Post('sales-orders')
  @RequirePermission('selling.sales_order.create')
  async createOrderRoute(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.createOrder(ctx, parse(orderInput, body));
  }

  private async createOrder(ctx: TenantRequestContext, input: z.infer<typeof orderInput>) {
    const entityId = entityOf(ctx);
    const { header, lines } = await this.prepare(ctx, entityId, input, input.orderDate);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const [o] = await tx.insert(salesOrder).values({ ...header, ...this.orderFields(input), tenantId: ctx.tenant.tenantId, entityId, createdBy: ctx.user.id }).returning();
      await tx.insert(salesOrderLine).values(lines.map((l, i) => ({ ...l, soId: o!.id, lineNo: i + 1 })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'sales_order.create', targetType: 'sales_order', targetId: o!.id, after: input }, tx);
      return o;
    });
  }

  @Put('sales-orders/:id')
  @RequirePermission('selling.sales_order.create')
  async updateOrder(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(orderInput, body);
    const { header, lines } = await this.prepare(ctx, entityId, input, input.orderDate);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const o = await this.lockOrder(tx, entityId, id);
      if (o.status !== 'draft') throw new ConflictException('Only drafts can be edited');
      await tx.update(salesOrder).set({ ...header, ...this.orderFields(input), quotationId: o.quotationId, updatedAt: new Date() }).where(eq(salesOrder.id, id));
      await tx.delete(salesOrderLine).where(eq(salesOrderLine.soId, id));
      await tx.insert(salesOrderLine).values(lines.map((l, i) => ({ ...l, soId: id, lineNo: i + 1 })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'sales_order.update', targetType: 'sales_order', targetId: id, after: input }, tx);
      return { ok: true };
    });
  }

  @Delete('sales-orders/:id')
  @RequirePermission('selling.sales_order.create')
  async deleteOrder(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [o] = await this.db.delete(salesOrder).where(and(eq(salesOrder.id, id), eq(salesOrder.entityId, entityId), eq(salesOrder.status, 'draft'))).returning();
    if (!o) throw new ConflictException('Only drafts can be deleted');
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'sales_order.delete_draft', targetType: 'sales_order', targetId: id });
    return { ok: true };
  }

  @Post('sales-orders/:id/submit')
  @RequirePermission('selling.sales_order.submit')
  async submitOrder(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { acceptCreditWarning } = parse(submitInput, body ?? {});
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const o = await this.lockOrder(tx, entityId, id);
      if (o.status !== 'draft') throw new ConflictException('Only drafts can be submitted');
      const customer = await this.customer(ctx, o.customerId);
      if (!customer.isActive) throw new BadRequestException(`${customer.name} is inactive`);
      const override = await this.checkCredit(ctx, tx, entityId, customer, Dec.of(o.grandTotal ?? '0').mul(o.exchangeRate).toFixed(2), acceptCreditWarning, 'selling.sales_order.approve');
      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'sales_order', o.orderDate);
      const [after] = await tx
        .update(salesOrder)
        .set({ status: 'submitted', number, creditOverride: override, submittedBy: ctx.user.id, submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(salesOrder.id, id))
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'sales_order.submit', targetType: 'sales_order', targetId: id, after: { number, creditOverride: override } }, tx);
      return after;
    });
  }

  @Post('sales-orders/:id/cancel')
  @RequirePermission('selling.sales_order.cancel')
  async cancelOrder(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: why } = parse(reason, body);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const o = await this.lockOrder(tx, entityId, id);
      if (o.status !== 'submitted') throw new ConflictException('Only submitted orders can be cancelled');
      const [used] = await tx.select({ n: sql<string>`coalesce(sum(${salesOrderLine.invoicedQty}), 0)` }).from(salesOrderLine).where(eq(salesOrderLine.soId, id));
      if (Dec.of(used!.n).gt('0')) throw new ConflictException('Goods have been invoiced against this order. Close it instead.');
      await tx.update(salesOrder).set({ status: 'cancelled', cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: why, updatedAt: new Date() }).where(eq(salesOrder.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'sales_order.cancel', targetType: 'sales_order', targetId: id, reason: why }, tx);
      return { ok: true };
    });
  }

  @Post('sales-orders/:id/close')
  @RequirePermission('selling.sales_order.submit')
  async closeOrder(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: why } = parse(reason, body);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const o = await this.lockOrder(tx, entityId, id);
      if (o.status !== 'submitted' || o.closedAt) throw new ConflictException('Only open orders can be closed');
      await tx.update(salesOrder).set({ closedAt: new Date(), updatedAt: new Date() }).where(eq(salesOrder.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'sales_order.close', targetType: 'sales_order', targetId: id, reason: why }, tx);
      return { ok: true };
    });
  }

  // ───────────────────────── Sales invoices ─────────────────────────

  @Get('sales-invoices')
  @RequirePermission('selling.sales_invoice.read')
  async listInvoices(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { status, customerId } = parse(z.object({ status: z.enum(['draft', 'submitted', 'cancelled']).optional(), customerId: z.string().uuid().optional() }), query);
    return salesInvoiceList(this.db, { tenantId: ctx.tenant.tenantId, entityId }, { status, customerId });
  }

  @Get('sales-invoices/:id')
  @RequirePermission('selling.sales_invoice.read')
  async getInvoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const inv = await salesInvoiceDetail(this.db, { tenantId: ctx.tenant.tenantId, entityId }, id);
    if (!inv) throw new NotFoundException('Sales invoice not found');
    return inv;
  }

  @Post('sales-invoices')
  @RequirePermission('selling.sales_invoice.create')
  async createInvoice(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(invoiceInput, body);
    const { header, lines } = await this.prepareInvoice(ctx, entityId, input);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const [inv] = await tx.insert(salesInvoice).values({ ...header, tenantId: ctx.tenant.tenantId, entityId, createdBy: ctx.user.id }).returning();
      await tx.insert(salesInvoiceLine).values(lines.map((l, i) => ({ ...l, invoiceId: inv!.id, lineNo: i + 1 })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'sales_invoice.create', targetType: 'sales_invoice', targetId: inv!.id, after: input }, tx);
      return inv;
    });
  }

  @Put('sales-invoices/:id')
  @RequirePermission('selling.sales_invoice.create')
  async updateInvoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(invoiceInput, body);
    const { header, lines } = await this.prepareInvoice(ctx, entityId, input);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const inv = await this.lockInvoice(tx, entityId, id);
      if (inv.status !== 'draft') throw new ConflictException('Only drafts can be edited');
      await tx.update(salesInvoice).set({ ...header, updatedAt: new Date() }).where(eq(salesInvoice.id, id));
      await tx.delete(salesInvoiceLine).where(eq(salesInvoiceLine.invoiceId, id));
      await tx.insert(salesInvoiceLine).values(lines.map((l, i) => ({ ...l, invoiceId: id, lineNo: i + 1 })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'sales_invoice.update', targetType: 'sales_invoice', targetId: id, after: input }, tx);
      return { ok: true };
    });
  }

  @Delete('sales-invoices/:id')
  @RequirePermission('selling.sales_invoice.create')
  async deleteInvoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [inv] = await this.db.delete(salesInvoice).where(and(eq(salesInvoice.id, id), eq(salesInvoice.entityId, entityId), eq(salesInvoice.status, 'draft'))).returning();
    if (!inv) throw new ConflictException('Only drafts can be deleted');
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'sales_invoice.delete_draft', targetType: 'sales_invoice', targetId: id });
    return { ok: true };
  }

  /**
   * Submit: credit check, order match, LUT check, number from the GSTIN's series, and the goods leave stock
   * through a system-generated delivery entry (decision 030), all in one transaction.
   */
  @Post('sales-invoices/:id/submit')
  @RequirePermission('selling.sales_invoice.submit')
  async submitInvoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { acceptCreditWarning } = parse(submitInput, body ?? {});
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const inv = await this.lockInvoice(tx, entityId, id);
      if (inv.status !== 'draft') throw new ConflictException('Only drafts can be submitted');
      const customer = await this.customer(ctx, inv.customerId);
      if (!customer.isActive) throw new BadRequestException(`${customer.name} is inactive`);
      const [reg] = await tx.select().from(gstRegistration).where(eq(gstRegistration.id, inv.gstRegistrationId!));
      this.assertLut(reg!, inv.supplyType as SupplyType, inv.invoiceDate);
      if (inv.invoiceDate > todayIst()) throw new BadRequestException({ message: 'A tax invoice cannot be dated in the future', issues: [{ path: 'invoiceDate', message: 'Use today or earlier' }] });
      const override = await this.checkCredit(ctx, tx, entityId, customer, Dec.of(inv.grandTotal ?? '0').mul(inv.exchangeRate).toFixed(2), acceptCreditWarning, 'selling.sales_invoice.approve');

      const lines = await tx.select().from(salesInvoiceLine).where(eq(salesInvoiceLine.invoiceId, id)).orderBy(asc(salesInvoiceLine.lineNo));
      // Against a sales order: same customer and currency, order open, no more than still pending.
      if (inv.salesOrderId) {
        const so = await this.lockOrder(tx, entityId, inv.salesOrderId);
        if (so.status !== 'submitted') throw new BadRequestException('The sales order must be submitted');
        if (so.closedAt) throw new BadRequestException(`Sales order ${so.number} is closed`);
        const soLines = new Map((await tx.select().from(salesOrderLine).where(eq(salesOrderLine.soId, so.id)).for('update')).map((l) => [l.id, l]));
        for (const l of lines) {
          if (!l.soLineId) continue;
          const sl = soLines.get(l.soLineId);
          if (!sl) throw new BadRequestException(`Line ${l.lineNo}: not a line of ${so.number}`);
          const pending = Dec.of(sl.qty).sub(sl.invoicedQty);
          if (Dec.of(l.qty).gt(pending)) throw new BadRequestException(`Line ${l.lineNo}: only ${pending.toFixed(3)} still to invoice on ${so.number}`);
          await tx.update(salesOrderLine).set({ invoicedQty: sql`${salesOrderLine.invoicedQty} + ${l.qty}` }).where(eq(salesOrderLine.id, sl.id));
        }
      }

      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, `sales_invoice:${inv.gstRegistrationId}`, inv.invoiceDate);

      // Goods ship with the invoice; services don't touch stock.
      const items = new Map((await tx.select().from(item).where(inArray(item.id, [...new Set(lines.map((l) => l.itemId))]))).map((i) => [i.id, i]));
      // Decision 048: items needing a first article inspection ship only once it is approved.
      await this.fai.assertInvoiceable(tx, entityId, [...items.values()]);
      const stockLines = lines.filter((l) => items.get(l.itemId)?.isStockItem);
      let stockEntryId: string | null = null;
      if (stockLines.length) {
        const defaultWh = await this.defaultDispatchWarehouse(tx, entityId);
        const [entry] = await tx
          .insert(stockEntry)
          .values({
            tenantId: ctx.tenant.tenantId,
            entityId,
            purpose: 'delivery',
            postingDate: inv.invoiceDate,
            partyId: inv.customerId,
            reference: number,
            remarks: `Shipped on sales invoice ${number}`,
            systemGenerated: true,
            createdBy: ctx.user.id,
          })
          .returning();
        await tx.insert(stockEntryLine).values(
          stockLines.map((l, i) => {
            const wh = l.warehouseId ?? defaultWh;
            if (!wh) throw new BadRequestException(`Line ${l.lineNo}: choose the warehouse the goods ship from`);
            return { entryId: entry!.id, lineNo: i + 1, itemId: l.itemId, qty: l.qty, fromWarehouseId: wh, batchId: l.batchId };
          }),
        );
        try {
          await this.posting.submitIn(tx, ctx, entityId, entry!.id);
        } catch (e) {
          // Line numbers in stock errors refer to the delivery; point at the invoice instead.
          if (e instanceof BadRequestException) throw new BadRequestException(`Can't ship the goods: ${(e.getResponse() as { message: string }).message}`);
          throw e;
        }
        stockEntryId = entry!.id;
      }

      const [after] = await tx
        .update(salesInvoice)
        .set({ status: 'submitted', number, stockEntryId, creditOverride: override, submittedBy: ctx.user.id, submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(salesInvoice.id, id))
        .returning();
      await this.accounting.salesIn(tx, ctx, entityId, after!);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'sales_invoice.submit', targetType: 'sales_invoice', targetId: id, after: { number, grandTotal: inv.grandTotal, creditOverride: override } }, tx);
      return after;
    });
  }

  /** Reverses the delivery and frees the order quantity. (After e-invoicing applies, a credit note instead.) */
  @Post('sales-invoices/:id/cancel')
  @RequirePermission('selling.sales_invoice.cancel')
  async cancelInvoice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason: why } = parse(reason, body);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const inv = await this.lockInvoice(tx, entityId, id);
      if (inv.status !== 'submitted') throw new ConflictException('Only submitted invoices can be cancelled');
      await guardSandboxSourceIn(tx,ctx,entityId,'sales_invoice',id);
      const liveNotes=await tx.select({number:salesNote.number}).from(salesNote).where(and(eq(salesNote.tenantId,ctx.tenant.tenantId),eq(salesNote.entityId,entityId),eq(salesNote.originalInvoiceId,id),eq(salesNote.status,'submitted')));
      if(liveNotes.length)throw new ConflictException(`Cancel notes ${liveNotes.map(n=>n.number).join(', ')} first`);
      await this.gl.reverseIn(tx, ctx, entityId, { type: 'sales_invoice', id, purpose: 'main' }, why);
      if (inv.stockEntryId) await this.posting.cancelIn(tx, ctx, entityId, inv.stockEntryId, `Sales invoice ${inv.number} cancelled: ${why}`);
      const lines = await tx.select().from(salesInvoiceLine).where(eq(salesInvoiceLine.invoiceId, id));
      for (const l of lines.filter((x) => x.soLineId)) {
        await tx.update(salesOrderLine).set({ invoicedQty: sql`${salesOrderLine.invoicedQty} - ${l.qty}` }).where(eq(salesOrderLine.id, l.soLineId!));
      }
      await tx.update(salesInvoice).set({ status: 'cancelled', cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: why, updatedAt: new Date() }).where(eq(salesInvoice.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'sales_invoice.cancel', targetType: 'sales_invoice', targetId: id, reason: why }, tx);
      return { ok: true };
    });
  }

  // ───────────────────────── helpers ─────────────────────────

  private async quotationLines(id: string) {
    const rows = await this.db
      .select({ line: quotationLine, itemCode: item.code, itemName: item.name, tracking: item.tracking, isStockItem: item.isStockItem, uomCode: uom.code })
      .from(quotationLine)
      .innerJoin(item, eq(item.id, quotationLine.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .where(eq(quotationLine.quotationId, id))
      .orderBy(asc(quotationLine.lineNo));
    return rows.map(({ line, ...r }) => ({ ...line, ...r }));
  }

  private async orderLines(id: string) {
    const rows = await this.db
      .select({ line: salesOrderLine, itemCode: item.code, itemName: item.name, tracking: item.tracking, isStockItem: item.isStockItem, uomCode: uom.code })
      .from(salesOrderLine)
      .innerJoin(item, eq(item.id, salesOrderLine.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .where(eq(salesOrderLine.soId, id))
      .orderBy(asc(salesOrderLine.lineNo));
    return rows.map(({ line, ...r }) => ({ ...line, ...r }));
  }

  private async lockOrder(tx: Tx, entityId: string, id: string) {
    const [o] = await tx.select().from(salesOrder).where(and(eq(salesOrder.id, id), eq(salesOrder.entityId, entityId))).for('update');
    if (!o) throw new NotFoundException('Sales order not found');
    return o;
  }

  private async lockInvoice(tx: Tx, entityId: string, id: string) {
    const [inv] = await tx.select().from(salesInvoice).where(and(eq(salesInvoice.id, id), eq(salesInvoice.entityId, entityId))).for('update');
    if (!inv) throw new NotFoundException('Sales invoice not found');
    return inv;
  }

  private orderFields(input: z.infer<typeof orderInput>) {
    return {
      orderDate: input.orderDate,
      deliveryDate: input.deliveryDate ?? null,
      quotationId: input.quotationId ?? null,
      customerPoNo: input.customerPoNo ?? null,
      customerPoDate: input.customerPoDate ?? null,
      paymentTermsDays: input.paymentTermsDays ?? null,
    };
  }

  private async customer(ctx: TenantRequestContext, id: string): Promise<Party> {
    const [p] = await this.db.select().from(party).where(and(eq(party.id, id), eq(party.tenantId, ctx.tenant.tenantId)));
    if (!p?.isCustomer) throw new BadRequestException({ message: 'Choose a customer', issues: [{ path: 'customerId', message: 'Not a customer' }] });
    return p;
  }

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

  private needsLut = (t: SupplyType) => t === 'export_under_lut' || t === 'sez_without_payment';

  /** Decision 031: zero-rated supplies without IGST need a LUT valid on the document date. */
  private assertLut(reg: GstReg, supplyType: SupplyType, date: string) {
    if (!this.needsLut(supplyType)) return;
    if (!reg.lutArn || !reg.lutValidFrom || !reg.lutValidTo || date < reg.lutValidFrom || date > reg.lutValidTo) {
      throw new BadRequestException({
        message: `No LUT valid on ${date} for GSTIN ${reg.gstin}. Record it under Settings → Entities & GST, or supply with payment of IGST.`,
        issues: [{ path: 'supplyType', message: 'LUT required' }],
      });
    }
  }

  /** Customer + our GSTIN → supply type, place of supply, currency (decisions 026, 031). */
  private async context(
    ctx: TenantRequestContext,
    entityId: string,
    input: { customerId: string; gstRegistrationId?: string | null; supplyType?: (typeof OUTWARD_TYPES)[number] | null; placeOfSupplyStateCode?: string | null; currency: string; exchangeRate?: string | null },
    date: string,
    shippingLabel?: string | null,
  ): Promise<Ctxs> {
    const customer = await this.customer(ctx, input.customerId);
    const reg = await this.ourRegistration(entityId, input.gstRegistrationId);
    const t = customer.gstTreatment;
    const allowed: SupplyType[] = t === 'overseas' ? ['export_under_lut', 'export_with_payment'] : t === 'sez' ? ['sez_without_payment', 'sez_with_payment'] : ['regular'];
    const supplyType = input.supplyType ?? allowed[0]!;
    if (!allowed.includes(supplyType)) {
      throw new BadRequestException({ message: `${customer.name} (${t}) can't be billed as ${supplyType.replace(/_/g, ' ')}`, issues: [{ path: 'supplyType', message: `Use ${allowed.join(' or ')}` }] });
    }
    this.assertLut(reg, supplyType, date);
    let cur = { currency: 'INR', exchangeRate: '1' };
    if (input.currency !== 'INR') {
      if (t !== 'overseas') throw new BadRequestException({ message: 'Only export invoices can be in foreign currency', issues: [{ path: 'currency', message: 'Use INR' }] });
      if (!input.exchangeRate || !Dec.of(input.exchangeRate).gt('0')) throw new BadRequestException({ message: `Enter the exchange rate (INR per 1 ${input.currency})`, issues: [{ path: 'exchangeRate', message: 'Required' }] });
      cur = { currency: input.currency, exchangeRate: input.exchangeRate };
    }
    // Place of supply: abroad for exports; else as given, the ship-to address, or the customer's registered state.
    const addresses = (customer.addresses ?? []) as Address[];
    const ship = addresses.find((a) => a.label === shippingLabel) ?? addresses[0];
    const pos = t === 'overseas' ? '96' : (input.placeOfSupplyStateCode ?? ship?.stateCode ?? customer.stateCode);
    if (!pos) throw new BadRequestException({ message: `Enter the place of supply for ${customer.name} (no state on file)`, issues: [{ path: 'placeOfSupplyStateCode', message: 'Required' }] });
    return { customer, reg, supplyType, pos, ...cur };
  }

  private tax(c: Ctxs, lines: { qty: string; rate: string; gstRate: string; cessRate?: string }[]): TaxResult {
    return computeGst(
      { supplierStateCode: c.reg.stateCode, placeOfSupplyStateCode: c.pos, supplyType: c.supplyType, reverseCharge: false },
      lines.map((l) => ({ taxableValue: Dec.of(l.qty).mul(l.rate).toFixed(2), gstRate: l.gstRate, cessRate: l.cessRate })),
    );
  }

  /** GST rate (and cess) from each item's HSN/SAC effective on `date`, unless given. */
  private async withRates<T extends { itemId: string; qty: string; rate: string; gstRate?: string | undefined }>(ctx: TenantRequestContext, lines: T[], date: string) {
    const ids = [...new Set(lines.map((l) => l.itemId))];
    const items = new Map((ids.length ? await this.db.select().from(item).where(and(eq(item.tenantId, ctx.tenant.tenantId), inArray(item.id, ids))) : []).map((i) => [i.id, i]));
    const out: (T & { gstRate: string; cessRate: string; hsn: string | null; isStockItem: boolean; tracking: string })[] = [];
    for (const [idx, l] of lines.entries()) {
      const it = items.get(l.itemId);
      if (!it) throw new BadRequestException(`Line ${idx + 1}: unknown item`);
      if (!it.isActive) throw new BadRequestException(`Line ${idx + 1}: ${it.code} is inactive`);
      if (!Dec.of(l.qty).gt('0')) throw new BadRequestException({ message: `Line ${idx + 1}: quantity must be positive`, issues: [{ path: `lines.${idx}.qty`, message: 'Must be positive' }] });
      let rate = l.gstRate;
      let cess = '0';
      if (it.hsnCode) {
        const [h] = await this.db
          .select({ rate: hsnCode.gstRate, cess: hsnCode.cessRate })
          .from(hsnCode)
          .where(and(eq(hsnCode.tenantId, ctx.tenant.tenantId), eq(hsnCode.code, it.hsnCode), lte(hsnCode.effectiveFrom, date)))
          .orderBy(desc(hsnCode.effectiveFrom))
          .limit(1);
        if (rate === undefined && h) rate = String(Number(h.rate));
        if (h?.cess) cess = String(Number(h.cess));
      }
      if (rate === undefined) {
        throw new BadRequestException({ message: `Line ${idx + 1}: no GST rate on file for ${it.code}${it.hsnCode ? ` (HSN ${it.hsnCode})` : ' (no HSN/SAC)'}; enter the rate`, issues: [{ path: `lines.${idx}.gstRate`, message: 'Required' }] });
      }
      out.push({ ...l, gstRate: rate, cessRate: cess, hsn: it.hsnCode, isStockItem: it.isStockItem, tracking: it.tracking });
    }
    return out;
  }

  private async prepare(ctx: TenantRequestContext, entityId: string, input: z.infer<typeof quotationInput> | z.infer<typeof orderInput>, date: string) {
    const c = await this.context(ctx, entityId, input, date);
    const lines = await this.withRates(ctx, input.lines, date);
    const t = this.tax(c, lines);
    return {
      header: {
        customerId: c.customer.id,
        gstRegistrationId: c.reg.id,
        supplyType: c.supplyType,
        placeOfSupplyStateCode: c.pos,
        currency: c.currency,
        exchangeRate: c.exchangeRate,
        remarks: input.remarks ?? null,
        taxableValue: t.taxableValue,
        igst: t.igst,
        cgst: t.cgst,
        sgst: t.sgst,
        cess: t.cess,
        totalTax: t.totalTax,
        grandTotal: t.invoiceTotal,
      },
      lines: lines.map((l, i) => ({
        itemId: l.itemId,
        description: l.description ?? null,
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

  private async prepareInvoice(ctx: TenantRequestContext, entityId: string, input: z.infer<typeof invoiceInput>) {
    const c = await this.context(ctx, entityId, input, input.invoiceDate, input.shippingAddressLabel);
    let paymentTerms: number | null = null;
    if (input.salesOrderId) {
      const [so] = await this.db.select().from(salesOrder).where(and(eq(salesOrder.id, input.salesOrderId), eq(salesOrder.entityId, entityId)));
      if (!so || so.status !== 'submitted') throw new BadRequestException('Link a submitted sales order');
      if (so.customerId !== c.customer.id) throw new BadRequestException('The sales order belongs to another customer');
      if (so.currency !== c.currency) throw new BadRequestException({ message: `The sales order is in ${so.currency}`, issues: [{ path: 'currency', message: `Use ${so.currency}` }] });
      paymentTerms = so.paymentTermsDays;
    } else if (input.lines.some((l) => l.soLineId)) {
      throw new BadRequestException('Lines reference a sales order that is not linked');
    }
    if (input.shippingBillDate && input.shippingBillDate < input.invoiceDate) {
      throw new BadRequestException({ message: 'The shipping bill is dated before the invoice', issues: [{ path: 'shippingBillDate', message: 'Check the date' }] });
    }
    const lines = await this.withRates(ctx, input.lines, input.invoiceDate);
    // Stock lines ship from a warehouse of this entity, with a batch when the item is batch-tracked.
    const whIds = [...new Set(lines.map((l) => l.warehouseId).filter((x): x is string => !!x))];
    if (whIds.length) {
      const found = await this.db.select({ id: warehouse.id }).from(warehouse).where(and(inArray(warehouse.id, whIds), eq(warehouse.entityId, entityId)));
      if (found.length !== whIds.length) throw new BadRequestException('A warehouse is not in this entity');
    }
    for (const [i, l] of lines.entries()) {
      if (!l.isStockItem && (l.warehouseId || l.batchId)) throw new BadRequestException(`Line ${i + 1}: services don't ship from a warehouse`);
      // Decision 046: one line per serial.
      if (l.isStockItem && l.tracking === 'serial' && !Dec.of(l.qty).eq('1')) throw new BadRequestException({ message: `Line ${i + 1}: serial-tracked items go one serial per line (quantity 1)`, issues: [{ path: `lines.${i}.qty`, message: 'One serial per line' }] });
    }
    const t = this.tax(c, lines);
    const addresses = (c.customer.addresses ?? []) as Address[];
    const bill = addresses.find((a) => a.label === input.billingAddressLabel) ?? addresses[0] ?? null;
    const ship = addresses.find((a) => a.label === input.shippingAddressLabel) ?? bill;
    const terms = paymentTerms ?? c.customer.creditDays ?? 0;
    return {
      header: {
        customerId: c.customer.id,
        gstRegistrationId: c.reg.id,
        supplyType: c.supplyType,
        placeOfSupplyStateCode: c.pos,
        currency: c.currency,
        exchangeRate: c.exchangeRate,
        remarks: input.remarks ?? null,
        invoiceDate: input.invoiceDate,
        dueDate: addDays(input.invoiceDate, terms),
        salesOrderId: input.salesOrderId ?? null,
        customerPoNo: input.customerPoNo ?? null,
        customerName: c.customer.name,
        customerGstin: c.customer.gstin,
        billingAddress: bill,
        shippingAddress: ship,
        lutArn: this.needsLut(c.supplyType) ? c.reg.lutArn : null,
        shippingBillNo: input.shippingBillNo ?? null,
        shippingBillDate: input.shippingBillDate ?? null,
        portCode: input.portCode ?? null,
        taxableValue: t.taxableValue,
        igst: t.igst,
        cgst: t.cgst,
        sgst: t.sgst,
        cess: t.cess,
        totalTax: t.totalTax,
        grandTotal: t.invoiceTotal,
      },
      lines: lines.map((l, i) => ({
        itemId: l.itemId,
        description: l.description ?? null,
        hsnCode: l.hsn,
        soLineId: l.soLineId ?? null,
        warehouseId: l.isStockItem ? (l.warehouseId ?? null) : null,
        batchId: l.isStockItem && l.tracking !== 'none' ? (l.batchId ?? null) : null,
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

  /** Finished goods first, then stores: where an invoice ships from when a line doesn't say. */
  private async defaultDispatchWarehouse(tx: Tx, entityId: string): Promise<string | null> {
    for (const type of ['finished_goods', 'stores'] as const) {
      const [w] = await tx.select({ id: warehouse.id }).from(warehouse).where(and(eq(warehouse.entityId, entityId), eq(warehouse.type, type), eq(warehouse.isActive, true))).orderBy(asc(warehouse.code)).limit(1);
      if (w) return w.id;
    }
    return null;
  }

  /** Outstanding (INR) and overdue for a customer; `adding` is the document about to be submitted. */
  /**
   * With accounting active, exposure is the customer's real outstanding from the receivables subledger (net of
   * receipts and money on account, floored at zero); overdue counts only bills still open. Before activation,
   * every submitted invoice counts as unpaid (decision 032). Caller holds the entity accounting lock.
   */
  private async credit(tx: Tx, ctx: TenantRequestContext, entityId: string, customer: Party, adding: string) {
    const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
    if (settings?.active) {
      await this.bills.syncIn(tx, ctx, entityId);
      const p = await this.bills.positionIn(tx, entityId, customer.id, 'receivable');
      return this.creditResult(customer, Dec.of(p.netInr), adding, p.overdueInr, p.overdueCount, { grossOpen: p.grossOpenInr, onAccount: p.onAccountInr });
    }
    const [row] = await tx
      .select({
        outstanding: sql<string>`coalesce(sum(${salesInvoice.grandTotal} * ${salesInvoice.exchangeRate}), 0)`,
        overdue: sql<string>`coalesce(sum(case when ${salesInvoice.dueDate} < ${todayIst()} then ${salesInvoice.grandTotal} * ${salesInvoice.exchangeRate} else 0 end), 0)`,
        overdueCount: sql<number>`count(*) filter (where ${salesInvoice.dueDate} < ${todayIst()})::int`,
      })
      .from(salesInvoice)
      .where(and(eq(salesInvoice.entityId, entityId), eq(salesInvoice.customerId, customer.id), eq(salesInvoice.status, 'submitted')));
    return this.creditResult(customer, Dec.of(row!.outstanding), adding, row!.overdue, row!.overdueCount, null);
  }

  private creditResult(customer: Party, outstanding: Dec, adding: string, overdueInr: string, overdueCount: number, detail: { grossOpen: string; onAccount: string } | null) {
    const limit = customer.creditLimit;
    const after = outstanding.add(adding);
    const warnings: string[] = [];
    if (limit !== null) {
      if (after.gt(limit)) warnings.push(`${customer.name} would be at ₹${after.toFixed(2)} against a credit limit of ₹${Dec.of(limit).toFixed(2)}`);
      if (overdueCount > 0) warnings.push(`${overdueCount} invoice(s) overdue, ₹${Dec.of(overdueInr).toFixed(2)}`);
    }
    return { creditLimit: limit, outstanding: outstanding.toFixed(2), overdue: Dec.of(overdueInr).toFixed(2), overdueCount, warnings, basis: detail ? 'books' : 'submitted_invoices', ...(detail && detail) };
  }

  /** Decision 032: warn; an approver may override with acceptCreditWarning. Returns whether it was overridden. */
  private async checkCredit(ctx: TenantRequestContext, tx: Tx, entityId: string, customer: Party, adding: string, accept: boolean, approvePermission: string): Promise<boolean> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credit:${entityId}:${customer.id}`}))`);
    const c = await this.credit(tx, ctx, entityId, customer, adding);
    if (!c.warnings.length) return false;
    if (!accept) {
      throw new BadRequestException({ message: `Credit check: ${c.warnings.join('; ')}.`, issues: [{ path: 'acceptCreditWarning', message: ctx.tenant.permissions.has(approvePermission) ? 'Confirm to submit anyway' : 'Needs an approver' }] });
    }
    if (!ctx.tenant.permissions.has(approvePermission)) throw new BadRequestException({ message: `Credit check: ${c.warnings.join('; ')}. Only an approver can submit over it.`, issues: [{ path: 'acceptCreditWarning', message: 'Needs an approver' }] });
    return true;
  }
}
