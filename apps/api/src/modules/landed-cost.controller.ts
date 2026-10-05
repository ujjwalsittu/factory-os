import { GlPostingService } from './accounting/gl-posting.service.js';
import { OperationalPostings } from './accounting/operational-postings.js';
import { AcquisitionCostService } from './accounting/acquisition-cost.service.js';
import { lockAccounting } from './accounting/accounting-lock.js';
import { Dec, splitAcquisitionCost, allocateProportion } from '@factoryos/core';
import {
  batch,
  type Database,
  fifoLayer,
  item,
  landedCostAllocation,
  landedCostCharge,
  landedCostLayerChange,
  landedCostReceipt,
  landedCostVoucher,
  party,
  purchaseOrder,
  stockEntry,
  stockEntryLine,
  stockLedgerEntry,
  uom,
} from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';
import { StockPostingService } from './stock-posting.service.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Tx;

const CHARGE_TYPES = ['bcd', 'sws', 'other_duty', 'freight', 'insurance', 'clearing', 'port', 'other'] as const;
const BASES = ['value', 'qty', 'weight'] as const;
/** Kilograms per unit, for allocation by weight. Items stocked in other units can't be weighed. */
const KG_PER_UNIT: Record<string, string> = { KG: '1', G: '0.001', MG: '0.000001', T: '1000', MT: '1000', TON: '1000', QTL: '100' };

const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount in rupees, up to 2 decimals'));
const optMoney = money.nullable().optional();

const chargeInput = z.object({
  chargeType: z.enum(CHARGE_TYPES),
  description: z.string().trim().max(200).nullable().optional(),
  partyId: z.string().uuid().nullable().optional(),
  documentNo: z.string().trim().max(60).nullable().optional(),
  amount: money.refine((v) => Dec.of(v).gt('0'), 'Must be positive'),
  basis: z.enum(BASES).default('value'),
});
const voucherInput = z.object({
  postingDate: z.string().date(),
  boeNo: z.string().trim().max(20).nullable().optional(),
  boeDate: z.string().date().nullable().optional(),
  portCode: z.string().trim().toUpperCase().max(10).nullable().optional(),
  customsExchangeRate: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(/^\d+(\.\d{1,6})?$/))
    .nullable()
    .optional(),
  assessableValue: optMoney,
  importIgst: optMoney,
  importCess: optMoney,
  customsItcEligible: z.boolean().nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
  receiptIds: z.array(z.string().uuid()).min(1, 'Choose at least one receipt').max(50),
  charges: z.array(chargeInput).min(1, 'Add at least one charge').max(50),
});
type VoucherInput = z.infer<typeof voucherInput>;
type ChargeInput = z.infer<typeof chargeInput>;

function entityOf(ctx: TenantRequestContext): string {
  if (!ctx.tenant.activeEntityId) throw new BadRequestException('Select a legal entity first (landed cost is per entity)');
  return ctx.tenant.activeEntityId;
}

const round2 = (d: Dec) => Dec.of(d.toFixed(2));

interface AllocLine {
  receiptLineId: string;
  receiptId: string;
  receiptNumber: string;
  receiptDate: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  uomCode: string;
  batchId: string | null;
  batchNo: string | null;
  warehouseId: string;
  qty: string;
  value: string;
  /** Allocated amount per charge, in charge order. */
  charges: string[];
  total: string;
  /** FIFO layer state now, to show how much will land on stock still on hand. */
  layerId: string | null;
  qtyRemaining: string;
}

/** Landed cost vouchers: Bill of Entry + import charges spread over receipts (decisions 027, 028). */
@Controller()
export class LandedCostController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly gl: GlPostingService,
    private readonly accounting: OperationalPostings,
    private readonly acquisitionCost: AcquisitionCostService,
    private readonly posting: StockPostingService,
  ) {}

  /** Submitted receipts with our own (valued) stock, newest first — the ones a voucher can cover. */
  @Get('landed-costs/receipts')
  @RequirePermission('buying.landed_cost.read')
  async receipts(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { supplierId } = parse(z.object({ supplierId: z.string().uuid().optional() }), query);
    const where: SQL[] = [eq(stockEntry.entityId, entityId), eq(stockEntry.status, 'submitted'), eq(stockEntry.purpose, 'receipt')];
    if (supplierId) where.push(eq(stockEntry.partyId, supplierId));
    return this.db
      .select({
        id: stockEntry.id,
        number: stockEntry.number,
        postingDate: stockEntry.postingDate,
        reference: stockEntry.reference,
        supplierName: party.name,
        poNumber: purchaseOrder.number,
        poCurrency: purchaseOrder.currency,
        value: sql<string>`(select coalesce(sum(l.value), 0) from stock_entry_line l where l.entry_id = "stock_entry"."id" and l.owner_party_id is null)`,
        landedCostCount: sql<number>`(select count(*)::int from landed_cost_receipt r join landed_cost_voucher v on v.id = r.voucher_id where r.receipt_id = "stock_entry"."id" and v.status = 'submitted')`,
      })
      .from(stockEntry)
      .leftJoin(party, eq(party.id, stockEntry.partyId))
      .leftJoin(purchaseOrder, eq(purchaseOrder.id, stockEntry.purchaseOrderId))
      .where(and(...where, sql`exists (select 1 from stock_entry_line l where l.entry_id = "stock_entry"."id" and l.owner_party_id is null)`))
      .orderBy(desc(stockEntry.postingDate), desc(stockEntry.createdAt))
      .limit(200);
  }

  @Get('landed-costs')
  @RequirePermission('buying.landed_cost.read')
  async list(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    return this.db
      .select({
        id: landedCostVoucher.id,
        number: landedCostVoucher.number,
        status: landedCostVoucher.status,
        postingDate: landedCostVoucher.postingDate,
        boeNo: landedCostVoucher.boeNo,
        boeDate: landedCostVoucher.boeDate,
        totalCharges: landedCostVoucher.totalCharges,
        onHandValue: landedCostVoucher.onHandValue,
        varianceValue: landedCostVoucher.varianceValue,
        importIgst: landedCostVoucher.importIgst,
        receipts: sql<string>`(select string_agg(e.number, ', ' order by e.number) from landed_cost_receipt r join stock_entry e on e.id = r.receipt_id where r.voucher_id = "landed_cost_voucher"."id")`,
      })
      .from(landedCostVoucher)
      .where(eq(landedCostVoucher.entityId, entityId))
      .orderBy(desc(landedCostVoucher.createdAt))
      .limit(500);
  }

  @Get('landed-costs/:id')
  @RequirePermission('buying.landed_cost.read')
  async get(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [v] = await this.db.select().from(landedCostVoucher).where(and(eq(landedCostVoucher.id, id), eq(landedCostVoucher.entityId, entityId)));
    if (!v) throw new NotFoundException('Landed cost voucher not found');
    const receiptIds = (await this.db.select({ id: landedCostReceipt.receiptId }).from(landedCostReceipt).where(eq(landedCostReceipt.voucherId, id))).map((r) => r.id);
    const charges = await this.db
      .select({ charge: landedCostCharge, partyName: party.name })
      .from(landedCostCharge)
      .leftJoin(party, eq(party.id, landedCostCharge.partyId))
      .where(eq(landedCostCharge.voucherId, id))
      .orderBy(asc(landedCostCharge.lineNo));
    const chargeRows = charges.map((c) => ({ ...c.charge, partyName: c.partyName }));
    let allocation: AllocLine[] = [];
    let preview: string | null = null;
    if (v.status === 'draft') {
      try {
        allocation = await this.allocate(this.db, entityId, receiptIds, chargeRows);
      } catch (e) {
        preview = (e as Error).message;
      }
    } else {
      allocation = await this.stored(id, chargeRows.map((c) => c.id));
    }
    const changes = v.status === 'draft' ? [] : await this.db.select().from(landedCostLayerChange).where(eq(landedCostLayerChange.voucherId, id));
    const byLine = new Map(changes.map((c) => [c.receiptLineId, c]));
    return {
      ...v,
      receiptIds,
      charges: chargeRows,
      allocation: allocation.map((a) => {
        const c = byLine.get(a.receiptLineId);
        return c ? { ...a, qtyRemaining: c.qtyRemaining, oldRate: c.oldRate, newRate: c.newRate, onHandValue: c.onHandValue, varianceValue: c.varianceValue } : a;
      }),
      roundingValue: changes.reduce((sum, c) => sum.add(c.amount).sub(c.onHandValue).sub(c.varianceValue), Dec.ZERO).toString(),
      allocationError: preview,
    };
  }

  /** Allocation for an unsaved draft, so the form can show where every rupee lands. */
  @Post('landed-costs/preview')
  @RequirePermission('buying.landed_cost.read')
  async preview(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(voucherInput, body);
    return this.allocate(this.db, entityId, input.receiptIds, input.charges);
  }

  @Post('landed-costs')
  @RequirePermission('buying.landed_cost.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(voucherInput, body);
    await this.validateRefs(ctx, entityId, input);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const [v] = await tx
        .insert(landedCostVoucher)
        .values({ ...this.header(input), tenantId: ctx.tenant.tenantId, entityId, createdBy: ctx.user.id })
        .returning();
      await this.writeChildren(tx, v!.id, input);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'landed_cost.create', targetType: 'landed_cost_voucher', targetId: v!.id, after: input }, tx);
      return v;
    });
  }

  @Put('landed-costs/:id')
  @RequirePermission('buying.landed_cost.create')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(voucherInput, body);
    await this.validateRefs(ctx, entityId, input);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const v = await this.lock(tx, entityId, id);
      if (v.status !== 'draft') throw new ConflictException('Only drafts can be edited');
      await tx.update(landedCostVoucher).set({ ...this.header(input), updatedAt: new Date() }).where(eq(landedCostVoucher.id, id));
      await tx.delete(landedCostCharge).where(eq(landedCostCharge.voucherId, id));
      await tx.delete(landedCostReceipt).where(eq(landedCostReceipt.voucherId, id));
      await this.writeChildren(tx, id, input);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'landed_cost.update', targetType: 'landed_cost_voucher', targetId: id, after: input }, tx);
      return { ok: true };
    });
  }

  @Delete('landed-costs/:id')
  @RequirePermission('buying.landed_cost.create')
  async remove(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [v] = await this.db
      .delete(landedCostVoucher)
      .where(and(eq(landedCostVoucher.id, id), eq(landedCostVoucher.entityId, entityId), eq(landedCostVoucher.status, 'draft')))
      .returning();
    if (!v) throw new ConflictException('Only drafts can be deleted');
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'landed_cost.delete_draft', targetType: 'landed_cost_voucher', targetId: id });
    return { ok: true };
  }

  /**
   * Submit (decision 028): each receipt line's share raises its FIFO layer for the quantity still on hand
   * (with a value-only ledger row); the share for quantity already issued becomes the landed-cost variance.
   */
  @Post('landed-costs/:id/submit')
  @RequirePermission('buying.landed_cost.submit')
  async submit(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const v = await this.lock(tx, entityId, id);
      if (v.status !== 'draft') throw new ConflictException('Only drafts can be submitted');
      const customsTax = Dec.of(v.importIgst ?? '0').add(v.importCess ?? '0');
      if (await this.gl.active(tx, entityId) && customsTax.gt('0') && v.customsItcEligible === null) throw new BadRequestException('Choose customs tax credit eligibility before submitting');
      const receiptIds = (await tx.select({ id: landedCostReceipt.receiptId }).from(landedCostReceipt).where(eq(landedCostReceipt.voucherId, id))).map((r) => r.id);
      const charges = await tx.select().from(landedCostCharge).where(eq(landedCostCharge.voucherId, id)).orderBy(asc(landedCostCharge.lineNo));

      // Lock every item touched, in a stable order, then work out the split under the lock.
      const itemIds = [
        ...new Set(
          (await tx.select({ itemId: stockEntryLine.itemId }).from(stockEntryLine).where(and(inArray(stockEntryLine.entryId, receiptIds), isNull(stockEntryLine.ownerPartyId)))).map((r) => r.itemId),
        ),
      ].sort();
      for (const itemId of itemIds) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stock:${entityId}:${itemId}`}))`);
      const lines = await this.allocate(tx, entityId, receiptIds, charges);

      for (const l of lines) {
        if (l.receiptDate > v.postingDate) throw new BadRequestException(`Posting date is before receipt ${l.receiptNumber} (${l.receiptDate})`);
      }
      // Decision 023: no stock posting before an item's last movement.
      for (const itemId of itemIds) {
        const [last] = await tx
          .select({ d: stockLedgerEntry.postingDate })
          .from(stockLedgerEntry)
          .where(and(eq(stockLedgerEntry.entityId, entityId), eq(stockLedgerEntry.itemId, itemId)))
          .orderBy(desc(stockLedgerEntry.postingDate))
          .limit(1);
        if (last && last.d > v.postingDate) {
          const code = lines.find((l) => l.itemId === itemId)?.itemCode;
          throw new BadRequestException(`Posting date ${v.postingDate} is before the last movement of ${code} (${last.d}); use that date or later`);
        }
      }

      const allocRows = lines.flatMap((l) =>
        charges
          .map((c, i) => ({ voucherId: id, chargeId: c.id, receiptLineId: l.receiptLineId, itemId: l.itemId, batchId: l.batchId, amount: l.charges[i]! }))
          .filter((a) => !Dec.of(a.amount).isZero()),
      );
      if (allocRows.length) await tx.insert(landedCostAllocation).values(allocRows);

      let onHandTotal = Dec.ZERO, consumedTotal = Dec.ZERO, chargesRounding = Dec.ZERO;
      for (const l of lines) {
        const total = Dec.of(l.total);
        if (total.isZero()) continue;
        if (!l.layerId) throw new ConflictException(`No cost layer for ${l.itemCode} on ${l.receiptNumber}`);
        const [layer] = await tx.select().from(fifoLayer).where(eq(fifoLayer.id, l.layerId)).for('update');
        const remaining = Dec.of(layer!.qtyRemaining);
        const oldRate = Dec.of(layer!.rate);
        let newRate = oldRate;
        let onHand = Dec.ZERO;
        let ledgerSeq: number | null = null;
        if (remaining.gt(Dec.ZERO)) {
          // Spread over what is still on hand; the rest of the line's share fell on issued material.
          const split = splitAcquisitionCost({ amount: total.toString(), quantity: layer!.qtyIn, remaining: remaining.toString(), oldRate: oldRate.toString() });
          newRate = Dec.of(split.newRate); onHand = Dec.of(split.inventory);
          await tx.update(fifoLayer).set({ rate: newRate.toString() }).where(eq(fifoLayer.id, layer!.id));
          const [sle] = await tx
            .insert(stockLedgerEntry)
            .values({
              tenantId: ctx.tenant.tenantId,
              entityId,
              itemId: l.itemId,
              warehouseId: l.warehouseId,
              batchId: l.batchId,
              ownerPartyId: null,
              qty: '0',
              rate: '0',
              value: onHand.toString(),
              postingDate: v.postingDate,
              voucherType: 'landed_cost',
              voucherId: id,
              voucherLineId: l.receiptLineId,
            })
            .returning();
          ledgerSeq = sle!.seq;
        }
        const consumed = total.sub(Dec.of(allocateProportion(total.toString(), remaining.toString(), layer!.qtyIn)));
        consumedTotal = consumedTotal.add(consumed); chargesRounding = chargesRounding.add(total.sub(onHand).sub(consumed));
        onHandTotal = onHandTotal.add(onHand);
        await tx.insert(landedCostLayerChange).values({
          voucherId: id,
          receiptLineId: l.receiptLineId,
          layerId: layer!.id,
          qtyRemaining: remaining.toString(),
          oldRate: oldRate.toString(),
          newRate: newRate.toString(),
          amount: total.toFixed(2),
          onHandValue: onHand.toString(),
          varianceValue: consumed.toString(),
          ledgerSeq,
        });
      }

      let taxCost = { inventory: '0', consumed: '0', rounding: '0' };
      if (v.customsItcEligible === false && customsTax.gt('0')) {
        const valueTotal = lines.reduce((sum, l) => sum.add(l.value), Dec.ZERO);
        let remainder = customsTax;
        const taxAllocations = lines.map((l, index) => {
          const amount = index === lines.length - 1 ? remainder : valueTotal.gt('0') ? Dec.min(remainder, Dec.of(allocateProportion(customsTax.toString(), l.value, valueTotal.toString()))) : Dec.min(remainder, Dec.of(allocateProportion(customsTax.toString(), '1', String(lines.length))));
          remainder = remainder.sub(amount); return { receiptLineId: l.receiptLineId, amount: amount.toString() };
        });
        taxCost = await this.acquisitionCost.applyIn(tx, ctx, entityId, { type: 'landed_cost', id, purpose: 'main' }, v.postingDate, taxAllocations);
      }
      const totalCharges = charges.reduce((s, c) => s.add(c.amount), Dec.ZERO);
      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'landed_cost_voucher', v.postingDate);
      const [after] = await tx
        .update(landedCostVoucher)
        .set({
          status: 'submitted',
          number,
          totalCharges: totalCharges.toFixed(2),
          onHandValue: onHandTotal.toFixed(2),
          varianceValue: consumedTotal.toFixed(2),
          submittedBy: ctx.user.id,
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(landedCostVoucher.id, id))
        .returning();
      await this.accounting.landedIn(tx, ctx, entityId, after!, onHandTotal.toString(), consumedTotal.toString(), taxCost, chargesRounding.toString());
      await this.audit.record(
        ctx,
        { tenantId: ctx.tenant.tenantId, entityId, action: 'landed_cost.submit', targetType: 'landed_cost_voucher', targetId: id, after: { number, totalCharges: after!.totalCharges, onHandValue: after!.onHandValue, varianceValue: after!.varianceValue } },
        tx,
      );
      return after;
    });
  }

  /** Exact reversal, only while the revalued stock hasn't moved (decision 028). */
  @Post('landed-costs/:id/cancel')
  @RequirePermission('buying.landed_cost.cancel')
  async cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), body);
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const v = await this.lock(tx, entityId, id);
      if (v.status !== 'submitted') throw new ConflictException('Only submitted vouchers can be cancelled');
      await this.gl.reverseIn(tx, ctx, entityId, { type: 'landed_cost', id, purpose: 'main' }, reason);
      await this.acquisitionCost.reverseIn(tx, ctx, entityId, { type: 'landed_cost', id, purpose: 'main' });
      const changes = await tx
        .select({ change: landedCostLayerChange, itemId: stockEntryLine.itemId, itemCode: item.code })
        .from(landedCostLayerChange)
        .innerJoin(stockEntryLine, eq(stockEntryLine.id, landedCostLayerChange.receiptLineId))
        .innerJoin(item, eq(item.id, stockEntryLine.itemId))
        .where(eq(landedCostLayerChange.voucherId, id));
      for (const itemId of [...new Set(changes.map((c) => c.itemId))].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stock:${entityId}:${itemId}`}))`);
      for (const { change: c, itemCode } of changes) {
        const [layer] = await tx.select().from(fifoLayer).where(eq(fifoLayer.id, c.layerId)).for('update');
        if (!layer || !Dec.of(layer.qtyRemaining).eq(c.qtyRemaining) || !Dec.of(layer.rate).eq(c.newRate)) {
          throw new ConflictException(`${itemCode} from this voucher has been issued or revalued since. Record a correcting adjustment instead of cancelling.`);
        }
        await tx.update(fifoLayer).set({ rate: c.oldRate }).where(eq(fifoLayer.id, layer.id));
        if (c.ledgerSeq) {
          const [sle] = await tx.select().from(stockLedgerEntry).where(eq(stockLedgerEntry.seq, c.ledgerSeq));
          await tx.insert(stockLedgerEntry).values({ ...sle!, seq: undefined, postedAt: undefined, value: Dec.of(sle!.value).neg().toString(), isReversal: true });
        }
      }
      await tx.update(landedCostVoucher).set({ status: 'cancelled', cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() }).where(eq(landedCostVoucher.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'landed_cost.cancel', targetType: 'landed_cost_voucher', targetId: id, reason }, tx);
      return { ok: true };
    });
  }

  // ───────────────────────── helpers ─────────────────────────

  private async lock(tx: Tx, entityId: string, id: string) {
    const [v] = await tx.select().from(landedCostVoucher).where(and(eq(landedCostVoucher.id, id), eq(landedCostVoucher.entityId, entityId))).for('update');
    if (!v) throw new NotFoundException('Landed cost voucher not found');
    return v;
  }

  private header(input: VoucherInput) {
    return {
      postingDate: input.postingDate,
      boeNo: input.boeNo ?? null,
      boeDate: input.boeDate ?? null,
      portCode: input.portCode ?? null,
      customsExchangeRate: input.customsExchangeRate ?? null,
      assessableValue: input.assessableValue ?? null,
      importIgst: input.importIgst ?? null,
      importCess: input.importCess ?? null,
      customsItcEligible: input.customsItcEligible ?? null,
      remarks: input.remarks ?? null,
      totalCharges: input.charges.reduce((s, c) => s.add(c.amount), Dec.ZERO).toFixed(2),
    };
  }

  private async writeChildren(tx: Tx, voucherId: string, input: VoucherInput) {
    await tx.insert(landedCostReceipt).values([...new Set(input.receiptIds)].map((receiptId) => ({ voucherId, receiptId })));
    await tx.insert(landedCostCharge).values(
      input.charges.map((c, i) => ({
        voucherId,
        lineNo: i + 1,
        chargeType: c.chargeType,
        description: c.description ?? null,
        partyId: c.partyId ?? null,
        documentNo: c.documentNo ?? null,
        amount: c.amount,
        basis: c.basis,
      })),
    );
  }

  private async validateRefs(ctx: TenantRequestContext, entityId: string, input: VoucherInput) {
    if (input.boeDate && input.boeDate > input.postingDate) throw new BadRequestException({ message: 'The Bill of Entry date is after the posting date', issues: [{ path: 'boeDate', message: 'Check the date' }] });
    const partyIds = [...new Set(input.charges.map((c) => c.partyId).filter((x): x is string => !!x))];
    if (partyIds.length) {
      const found = await this.db.select({ id: party.id }).from(party).where(and(inArray(party.id, partyIds), eq(party.tenantId, ctx.tenant.tenantId)));
      if (found.length !== partyIds.length) throw new BadRequestException('Unknown party on a charge');
    }
    // Throws with a readable message if receipts or bases don't work out.
    await this.allocate(this.db, entityId, input.receiptIds, input.charges);
  }

  /** Split every charge over the receipts' own (valued) lines. Pure apart from reads; rounding remainder goes to the last line. */
  private async allocate(db: Db, entityId: string, receiptIds: string[], charges: Pick<ChargeInput, 'amount' | 'basis'>[]): Promise<AllocLine[]> {
    const ids = [...new Set(receiptIds)];
    const entries = ids.length ? await db.select().from(stockEntry).where(and(inArray(stockEntry.id, ids), eq(stockEntry.entityId, entityId))) : [];
    for (const id of ids) {
      const e = entries.find((x) => x.id === id);
      if (!e) throw new BadRequestException('A chosen receipt is not in this entity');
      if (e.status !== 'submitted' || e.purpose !== 'receipt') throw new BadRequestException(`${e.number ?? 'A draft'} is not a submitted receipt`);
    }
    const rows = await db
      .select({ line: stockEntryLine, entry: stockEntry, itemCode: item.code, itemName: item.name, uomCode: uom.code, batchNo: batch.batchNo })
      .from(stockEntryLine)
      .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
      .innerJoin(item, eq(item.id, stockEntryLine.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .leftJoin(batch, eq(batch.id, stockEntryLine.batchId))
      .where(and(inArray(stockEntryLine.entryId, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']), isNull(stockEntryLine.ownerPartyId)))
      .orderBy(asc(stockEntry.postingDate), asc(stockEntry.number), asc(stockEntryLine.lineNo));
    if (rows.length === 0) throw new BadRequestException('The chosen receipts have no stock of our own (customer material carries no cost)');

    // The cost layer each line created: its ledger row's sequence is the layer's source.
    const layers = await db
      .select({ lineId: stockLedgerEntry.voucherLineId, layerId: fifoLayer.id, qtyRemaining: fifoLayer.qtyRemaining })
      .from(stockLedgerEntry)
      .innerJoin(fifoLayer, eq(fifoLayer.sourceSeq, stockLedgerEntry.seq))
      .where(and(inArray(stockLedgerEntry.voucherId, ids), eq(stockLedgerEntry.isReversal, false), gt(stockLedgerEntry.qty, '0')));
    const layerOf = new Map(layers.map((l) => [l.lineId, l]));

    const shares: Dec[][] = rows.map(() => []);
    for (const [ci, c] of charges.entries()) {
      const weights = rows.map((r) => {
        if (c.basis === 'value') return Dec.of(r.line.value ?? '0');
        if (c.basis === 'qty') return Dec.of(r.line.qty);
        const kg = KG_PER_UNIT[r.uomCode];
        if (!kg) throw new BadRequestException({ message: `Charge ${ci + 1}: ${r.itemCode} is stocked in ${r.uomCode}, not by weight; allocate this charge by value or quantity`, issues: [{ path: `charges.${ci}.basis`, message: 'Not by weight' }] });
        return Dec.of(r.line.qty).mul(kg);
      });
      const sum = weights.reduce((s, w) => s.add(w), Dec.ZERO);
      if (!sum.gt(Dec.ZERO)) throw new BadRequestException({ message: `Charge ${ci + 1}: the receipts have no ${c.basis} to allocate by`, issues: [{ path: `charges.${ci}.basis`, message: 'Nothing to allocate by' }] });
      const amount = Dec.of(c.amount);
      let given = Dec.ZERO;
      const lastIdx = weights.map((w, i) => (w.gt(Dec.ZERO) ? i : -1)).filter((i) => i >= 0).pop()!;
      weights.forEach((w, i) => {
        const s = i === lastIdx ? amount.sub(given) : w.isZero() ? Dec.ZERO : Dec.min(amount.sub(given), round2(Dec.of(allocateProportion(amount.toString(), w.toString(), sum.toString()))));
        given = given.add(s);
        shares[i]!.push(s);
      });
    }

    return rows.map((r, i) => {
      const layer = layerOf.get(r.line.id);
      return {
        receiptLineId: r.line.id,
        receiptId: r.entry.id,
        receiptNumber: r.entry.number ?? '',
        receiptDate: r.entry.postingDate,
        itemId: r.line.itemId,
        itemCode: r.itemCode,
        itemName: r.itemName,
        uomCode: r.uomCode,
        batchId: r.line.batchId,
        batchNo: r.batchNo,
        warehouseId: r.line.toWarehouseId!,
        qty: r.line.qty,
        value: r.line.value ?? '0',
        charges: shares[i]!.map((s) => s.toFixed(2)),
        total: shares[i]!.reduce((s, x) => s.add(x), Dec.ZERO).toFixed(2),
        layerId: layer?.layerId ?? null,
        qtyRemaining: layer?.qtyRemaining ?? '0',
      };
    });
  }

  /** Allocation as posted, rebuilt from the stored rows. */
  private async stored(voucherId: string, chargeIds: string[]): Promise<AllocLine[]> {
    const rows = await this.db
      .select({ a: landedCostAllocation, line: stockEntryLine, entry: stockEntry, itemCode: item.code, itemName: item.name, uomCode: uom.code, batchNo: batch.batchNo })
      .from(landedCostAllocation)
      .innerJoin(stockEntryLine, eq(stockEntryLine.id, landedCostAllocation.receiptLineId))
      .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
      .innerJoin(item, eq(item.id, landedCostAllocation.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .leftJoin(batch, eq(batch.id, landedCostAllocation.batchId))
      .where(eq(landedCostAllocation.voucherId, voucherId))
      .orderBy(asc(stockEntry.postingDate), asc(stockEntry.number), asc(stockEntryLine.lineNo));
    const out = new Map<string, AllocLine>();
    for (const r of rows) {
      let l = out.get(r.line.id);
      if (!l) {
        l = {
          receiptLineId: r.line.id,
          receiptId: r.entry.id,
          receiptNumber: r.entry.number ?? '',
          receiptDate: r.entry.postingDate,
          itemId: r.line.itemId,
          itemCode: r.itemCode,
          itemName: r.itemName,
          uomCode: r.uomCode,
          batchId: r.line.batchId,
          batchNo: r.batchNo,
          warehouseId: r.line.toWarehouseId!,
          qty: r.line.qty,
          value: r.line.value ?? '0',
          charges: chargeIds.map(() => '0.00'),
          total: '0.00',
          layerId: null,
          qtyRemaining: '0',
        };
        out.set(r.line.id, l);
      }
      l.charges[chargeIds.indexOf(r.a.chargeId)] = Dec.of(r.a.amount).toFixed(2);
      l.total = Dec.of(l.total).add(r.a.amount).toFixed(2);
    }
    return [...out.values()];
  }
}
