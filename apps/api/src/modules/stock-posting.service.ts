import { acquisitionCostChange, receiptInvoiceAllocation } from '@factoryos/db';
import { OperationalPostings } from './accounting/operational-postings.js';
import { GlPostingService } from './accounting/gl-posting.service.js';
import { lockAccounting } from './accounting/accounting-lock.js';
import { consumeFifo, Dec, formatSeries, fyCode, InsufficientStockError } from '@factoryos/core';
import {
  batch,
  type Database,
  fifoConsumption,
  fifoLayer,
  item,
  landedCostLayerChange,
  landedCostReceipt,
  landedCostVoucher,
  legalEntity,
  numberSeries,
  party,
  purchaseOrder,
  purchaseOrderLine,
  qualityInspection,
  stockBin,
  stockEntry,
  stockEntryLine,
  stockLedgerEntry,
  warehouse,
  wasteMovement,
} from '@factoryos/db';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { DB } from '../common/tokens.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Line = typeof stockEntryLine.$inferSelect;

export const DEFAULT_SERIES: Record<string, string> = {
  stock_entry: '{ENTITY}/SE/{FY}/{#####}',
  purchase_order: '{ENTITY}/PO/{FY}/{####}',
  quality_inspection: '{ENTITY}/QI/{FY}/{#####}',
  purchase_invoice: '{ENTITY}/PI/{FY}/{#####}',
  landed_cost_voucher: '{ENTITY}/LCV/{FY}/{#####}',
  quotation: '{ENTITY}/QTN/{FY}/{####}',
  sales_order: '{ENTITY}/SO/{FY}/{####}',
  /** Per GSTIN (doc type `sales_invoice:<gst registration id>`), ≤ 16 characters (decision 029). */
  sales_invoice: '{ENTITY}/{FY}/{#####}',
  credit_note: '{ENTITY}/CN/{FY}/{####}',
  debit_note: '{ENTITY}/DN/{FY}/{####}',
  customer_receipt: '{ENTITY}/RCT/{FY}/{#####}',
  supplier_payment: '{ENTITY}/PAY/{FY}/{#####}',
  supplier_return_claim: '{ENTITY}/PRC/{FY}/{#####}',
  supplier_note: '{ENTITY}/PN/{FY}/{#####}',
  settlement_allocation: '{ENTITY}/ADJ/{FY}/{#####}',
};

/** Statutory documents whose number goes on a GST return: at most 16 characters. */
const GST_DOCS = new Set(['sales_invoice', 'credit_note', 'debit_note']);

/** Waste categories that are hazardous under the Hazardous Waste Rules 2016 (docs/03 §9). */
const HAZARDOUS = new Set(['metal_powder', 'coolant_oil', 'solvent']);

/**
 * Posts stock entries to the append-only ledger (decision 018: FIFO per entity × item, per batch for
 * batch-tracked items). Every step runs in the caller's transaction so a document posts entirely or not at all.
 */
@Injectable()
export class StockPostingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly accounting: OperationalPostings,
    private readonly gl: GlPostingService,
  ) {}

  submit(ctx: TenantRequestContext, entityId: string, entryId: string) {
    return this.db.transaction((tx) => this.submitIn(tx, ctx, entityId, entryId));
  }

  /** Same as submit, inside the caller's transaction (e.g. an inspection posting its transfer). */
  async submitIn(tx: Tx, ctx: TenantRequestContext, entityId: string, entryId: string) {
    await lockAccounting(tx, entityId);
    {
      const entry = await this.lockEntry(tx, entityId, entryId);
      if (entry.status !== 'draft') throw new ConflictException(`Only drafts can be submitted (this one is ${entry.status})`);
      const lines = await tx.select().from(stockEntryLine).where(eq(stockEntryLine.entryId, entryId)).orderBy(asc(stockEntryLine.lineNo));
      if (lines.length === 0) throw new BadRequestException('Add at least one line');

      // Serialise postings per item to keep FIFO layers and balances consistent. Sorted to avoid deadlocks.
      const itemIds = [...new Set(lines.map((l) => l.itemId))].sort();
      for (const id of itemIds) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stock:${entityId}:${id}`}))`);

      const items = new Map((await tx.select().from(item).where(inArray(item.id, itemIds))).map((i) => [i.id, i]));
      const whIds = [...new Set(lines.flatMap((l) => [l.fromWarehouseId, l.toWarehouseId]).filter((x): x is string => !!x))];
      const whs = new Map(
        (whIds.length ? await tx.select().from(warehouse).where(and(inArray(warehouse.id, whIds), eq(warehouse.entityId, entityId))) : []).map((w) => [w.id, w]),
      );

      // Goods receipt against a purchase order: same supplier, PO approved and open, no over-receipt.
      const poLines = new Map<string, typeof purchaseOrderLine.$inferSelect>();
      // INR per unit of the PO currency: receipts are valued in INR at the PO's rate (decision 026).
      let poExchangeRate = '1';
      if (entry.purchaseOrderId) {
        if (entry.purpose !== 'receipt') throw new BadRequestException('Only receipts can reference a purchase order');
        const [po] = await tx.select().from(purchaseOrder).where(and(eq(purchaseOrder.id, entry.purchaseOrderId), eq(purchaseOrder.entityId, entityId))).for('update');
        if (!po || po.status !== 'submitted') throw new BadRequestException('The purchase order must be submitted (approved) before receiving against it');
        if (po.closedAt) throw new BadRequestException(`Purchase order ${po.number} is closed`);
        if (entry.partyId !== po.supplierId) throw new BadRequestException('The receipt supplier differs from the purchase order supplier');
        poExchangeRate = po.exchangeRate;
        for (const l of await tx.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.poId, po.id)).for('update')) poLines.set(l.id, l);
      }
      for (const line of lines) {
        if (!line.poLineId) continue;
        const pl = poLines.get(line.poLineId);
        if (!pl) throw new BadRequestException(`Line ${line.lineNo}: not a line of this purchase order`);
        if (pl.itemId !== line.itemId) throw new BadRequestException(`Line ${line.lineNo}: item differs from the purchase order line`);
        if (line.ownerPartyId) throw new BadRequestException(`Line ${line.lineNo}: purchased material belongs to us, not a customer`);
        const pending = Dec.of(pl.qty).sub(pl.receivedQty);
        if (Dec.of(line.qty).gt(pending)) throw new BadRequestException(`Line ${line.lineNo}: only ${pending.toFixed(3)} still due on the purchase order`);
        if (line.rate === null) {
          line.rate = Dec.of(pl.rate).mul(poExchangeRate).toString();
          await tx.update(stockEntryLine).set({ rate: line.rate }).where(eq(stockEntryLine.id, line.id));
        }
        await tx.update(purchaseOrderLine).set({ receivedQty: sql`${purchaseOrderLine.receivedQty} + ${line.qty}` }).where(eq(purchaseOrderLine.id, pl.id));
      }

      // Owners of customer-supplied material (decision 024) must be customers of this tenant.
      const ownerIds = [...new Set(lines.map((l) => l.ownerPartyId).filter((x): x is string => !!x))];
      const owners = new Map(
        (ownerIds.length ? await tx.select().from(party).where(and(inArray(party.id, ownerIds), eq(party.tenantId, ctx.tenant.tenantId))) : []).map((p) => [p.id, p]),
      );

      // Backdating would require re-valuing later issues; until the repost engine exists it is refused.
      for (const id of itemIds) {
        const [last] = await tx
          .select({ d: stockLedgerEntry.postingDate })
          .from(stockLedgerEntry)
          .where(and(eq(stockLedgerEntry.entityId, entityId), eq(stockLedgerEntry.itemId, id)))
          .orderBy(desc(stockLedgerEntry.postingDate))
          .limit(1);
        if (last && last.d > entry.postingDate) {
          throw new BadRequestException(`Posting date ${entry.postingDate} is before the last movement of ${items.get(id)?.code} (${last.d}). Backdated posting arrives with the repost engine.`);
        }
      }

      for (const line of lines) {
        const it = items.get(line.itemId);
        if (!it || it.tenantId !== ctx.tenant.tenantId) throw new BadRequestException(`Line ${line.lineNo}: unknown item`);
        if (!it.isStockItem) throw new BadRequestException(`Line ${line.lineNo}: ${it.code} is not a stock item`);
        if (it.tracking === 'serial') throw new BadRequestException(`Line ${line.lineNo}: serial-tracked items arrive in Phase 2`);
        const q = Dec.of(line.qty);
        if (!q.gt(Dec.ZERO)) throw new BadRequestException(`Line ${line.lineNo}: quantity must be positive`);
        const from = line.fromWarehouseId ? whs.get(line.fromWarehouseId) : undefined;
        const to = line.toWarehouseId ? whs.get(line.toWarehouseId) : undefined;
        if ((line.fromWarehouseId && !from) || (line.toWarehouseId && !to)) throw new BadRequestException(`Line ${line.lineNo}: warehouse not in this entity`);

        const direction = lineDirection(entry.purpose, line);
        let batchId = line.batchId;
        const owner = line.ownerPartyId;
        if (owner && !owners.get(owner)?.isCustomer) throw new BadRequestException(`Line ${line.lineNo}: the material owner must be a customer`);
        if (entry.purpose === 'return' && (!owner || owner !== entry.partyId)) {
          throw new BadRequestException(`Line ${line.lineNo}: only the customer's own material can be returned to them`);
        }
        if (entry.purpose === 'delivery' && owner) throw new BadRequestException(`Line ${line.lineNo}: customer material goes back with a return, not a sales delivery`);
        if (entry.purpose === 'scrap' && !line.wasteCategory) throw new BadRequestException(`Line ${line.lineNo}: choose a waste category`);
        for (const w of [from, to]) {
          if (w?.type === 'customer_owned' && !owner) throw new BadRequestException(`Line ${line.lineNo}: ${w.name} holds customer material; choose the owner`);
        }

        if (direction === 'in' || direction === 'transfer') {
          if (!to) throw new BadRequestException(`Line ${line.lineNo}: choose a target warehouse`);
        }
        if (direction === 'out' || direction === 'transfer') {
          if (!from) throw new BadRequestException(`Line ${line.lineNo}: choose a source warehouse`);
          if ((entry.purpose === 'issue' || entry.purpose === 'delivery') && !from.availableForIssue) {
            throw new BadRequestException(`Line ${line.lineNo}: ${from.name} is not available for issue (${from.type}). Transfer the stock out first.`);
          }
        }
        if (direction === 'transfer' && from!.id === to!.id) throw new BadRequestException(`Line ${line.lineNo}: source and target are the same`);

        if (it.tracking === 'batch') {
          if (direction === 'in' && !batchId) {
            if (!line.newBatchNo) throw new BadRequestException(`Line ${line.lineNo}: ${it.code} is batch-tracked; enter a batch / heat number`);
            const [b] = await tx
              .insert(batch)
              .values({
                tenantId: ctx.tenant.tenantId,
                itemId: it.id,
                batchNo: line.newBatchNo,
                heatNo: line.heatNo,
                supplierId: entry.partyId,
                expiryDate: line.expiryDate ?? (it.shelfLifeDays ? addDays(entry.postingDate, it.shelfLifeDays) : null),
              })
              .onConflictDoNothing()
              .returning();
            if (!b) throw new BadRequestException(`Line ${line.lineNo}: batch ${line.newBatchNo} already exists for ${it.code}; select it instead`);
            batchId = b.id;
          }
          if (!batchId) throw new BadRequestException(`Line ${line.lineNo}: ${it.code} is batch-tracked; select a batch`);
          const [b] = await tx.select().from(batch).where(and(eq(batch.id, batchId), eq(batch.itemId, it.id)));
          if (!b) throw new BadRequestException(`Line ${line.lineNo}: batch doesn't belong to ${it.code}`);
          if (direction !== 'in' && b.expiryDate && b.expiryDate < entry.postingDate && (entry.purpose === 'issue' || entry.purpose === 'delivery')) {
            throw new BadRequestException(`Line ${line.lineNo}: batch ${b.batchNo} expired on ${b.expiryDate}`);
          }
        } else if (batchId || line.newBatchNo) {
          throw new BadRequestException(`Line ${line.lineNo}: ${it.code} is not batch-tracked`);
        }

        const base = { tenantId: ctx.tenant.tenantId, entityId, itemId: it.id, batchId, ownerPartyId: owner, postingDate: entry.postingDate, voucherType: 'stock_entry', voucherId: entry.id, voucherLineId: line.id };

        if (direction === 'in') {
          const owned = !owner;
          if (owned && line.rate === null) throw new BadRequestException(`Line ${line.lineNo}: enter the unit cost`);
          if (!owned && line.rate !== null && Dec.of(line.rate).gt(Dec.ZERO)) {
            throw new BadRequestException(`Line ${line.lineNo}: customer-supplied material has no cost to us; leave the unit cost empty`);
          }
          const rate = owned ? Dec.of(line.rate!) : Dec.ZERO;
          const value = q.mul(rate);
          const [sle] = await tx.insert(stockLedgerEntry).values({ ...base, warehouseId: to!.id, qty: q.toString(), rate: rate.toString(), value: value.toString() }).returning();
          if (owned) {
            await tx.insert(fifoLayer).values({ tenantId: ctx.tenant.tenantId, entityId, itemId: it.id, batchId, qtyIn: q.toString(), qtyRemaining: q.toString(), rate: rate.toString(), sourceSeq: sle!.seq, postingDate: entry.postingDate, voucherId: entry.id });
          }
          await this.moveBin(tx, ctx.tenant.tenantId, entityId, it.id, to!.id, batchId, owner, q);
          await tx.update(stockEntryLine).set({ batchId, rate: rate.toString(), value: value.toString() }).where(eq(stockEntryLine.id, line.id));
        } else if (direction === 'out') {
          await this.moveBin(tx, ctx.tenant.tenantId, entityId, it.id, from!.id, batchId, owner, q.neg(), `Line ${line.lineNo}: ${it.code}`);
          const owned = !owner;
          let value = Dec.ZERO;
          let consumed: { layerId: string; qty: Dec }[] = [];
          if (owned) {
            const layers = await tx
              .select()
              .from(fifoLayer)
              .where(and(eq(fifoLayer.entityId, entityId), eq(fifoLayer.itemId, it.id), batchId ? eq(fifoLayer.batchId, batchId) : isNull(fifoLayer.batchId), gt(fifoLayer.qtyRemaining, '0')))
              .orderBy(asc(fifoLayer.postingDate), asc(fifoLayer.sourceSeq))
              .for('update');
            try {
              const r = consumeFifo(layers.map((l) => ({ id: l.id, qty: Dec.of(l.qtyRemaining), rate: Dec.of(l.rate) })), q);
              value = r.value;
              consumed = r.consumed;
            } catch (e) {
              if (e instanceof InsufficientStockError) throw new BadRequestException(`Line ${line.lineNo}: ${it.code} has ${e.available.toFixed(3)} valued in stock, ${e.requested.toFixed(3)} requested`);
              throw e;
            }
            for (const c of consumed) {
              await tx.update(fifoLayer).set({ qtyRemaining: sql`${fifoLayer.qtyRemaining} - ${c.qty.toString()}` }).where(eq(fifoLayer.id, c.layerId));
            }
          }
          const rate = value.div(q);
          const [sle] = await tx.insert(stockLedgerEntry).values({ ...base, warehouseId: from!.id, qty: q.neg().toString(), rate: rate.toString(), value: value.neg().toString() }).returning();
          if (consumed.length) await tx.insert(fifoConsumption).values(consumed.map((c) => ({ sleSeq: sle!.seq, layerId: c.layerId, qty: c.qty.toString() })));
          await tx.update(stockEntryLine).set({ rate: rate.toString(), value: value.toString() }).where(eq(stockEntryLine.id, line.id));
          if (entry.purpose === 'scrap') {
            // Scrapped stock enters the waste register with the same owner (decision 025).
            await tx.insert(wasteMovement).values({
              tenantId: ctx.tenant.tenantId,
              entityId,
              kind: 'generated',
              movementDate: entry.postingDate,
              category: line.wasteCategory as typeof wasteMovement.$inferInsert.category,
              material: `${it.code} · ${it.name}`,
              itemId: it.id,
              qty: q.toString(),
              uomId: it.stockUomId,
              ownerPartyId: owner,
              hazardous: HAZARDOUS.has(line.wasteCategory!),
              warehouseId: from!.id,
              sourceRef: entry.reference,
              stockEntryId: entry.id,
              createdBy: ctx.user.id,
            });
          }
        } else {
          // Transfer inside one entity: FIFO layers are entity-level, so value doesn't move between warehouses.
          // Ownership travels with the stock: a transfer can never turn customer material into ours.
          await this.moveBin(tx, ctx.tenant.tenantId, entityId, it.id, from!.id, batchId, owner, q.neg(), `Line ${line.lineNo}: ${it.code}`);
          await this.moveBin(tx, ctx.tenant.tenantId, entityId, it.id, to!.id, batchId, owner, q);
          await tx.insert(stockLedgerEntry).values([
            { ...base, warehouseId: from!.id, qty: q.neg().toString(), rate: '0', value: '0' },
            { ...base, warehouseId: to!.id, qty: q.toString(), rate: '0', value: '0' },
          ]);
        }
      }

      const number = await this.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'stock_entry', entry.postingDate);
      const [after] = await tx
        .update(stockEntry)
        .set({ status: 'submitted', number, submittedBy: ctx.user.id, submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(stockEntry.id, entryId))
        .returning();
      if(!['sales_return','purchase_return','purchase_return_receipt'].includes(entry.purpose))await this.accounting.stockIn(tx, ctx, entityId, after!);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'stock_entry.submit', targetType: 'stock_entry', targetId: entryId, after: { number, purpose: entry.purpose } }, tx);
      return after!;
    }
  }

  /** Exact reversal: restores FIFO layers and balances, appends negating ledger rows. */
  cancel(ctx: TenantRequestContext, entityId: string, entryId: string, reason: string) {
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      const entry = await this.lockEntry(tx, entityId, entryId);
      // Postings made by another document (e.g. an inspection) are cancelled through that document.
      if (entry.systemGenerated) throw new ConflictException('This entry was posted by another document; cancel that document instead');
      return this.cancelIn(tx, ctx, entityId, entryId, reason);
    });
  }

  async cancelIn(tx: Tx, ctx: TenantRequestContext, entityId: string, entryId: string, reason: string) {
    await lockAccounting(tx, entityId);
    {
      const entry = await this.lockEntry(tx, entityId, entryId);
      if (entry.status !== 'submitted') throw new ConflictException('Only submitted entries can be cancelled');
      await this.gl.reverseIn(tx, ctx, entityId, { type: ['sales_return','purchase_return','purchase_return_receipt'].includes(entry.purpose)?entry.purpose:'stock_entry', id: entryId, purpose: 'main' }, reason);
      // Decision 028: landed cost sits on top of the receipt's value; it must go first.
      const [lcv] = await tx
        .select({ number: landedCostVoucher.number })
        .from(landedCostReceipt)
        .innerJoin(landedCostVoucher, eq(landedCostVoucher.id, landedCostReceipt.voucherId))
        .where(and(eq(landedCostReceipt.receiptId, entryId), eq(landedCostVoucher.status, 'submitted')))
        .limit(1);
      if (lcv) throw new ConflictException(`Landed cost voucher ${lcv.number} covers this receipt. Cancel it first.`);
      if (entry.purchaseOrderId) {
        const lines = await tx.select().from(stockEntryLine).where(eq(stockEntryLine.entryId, entryId));
        const allocations = await tx.select().from(receiptInvoiceAllocation).where(and(eq(receiptInvoiceAllocation.entityId, entityId), inArray(receiptInvoiceAllocation.receiptLineId, lines.map(l => l.id))));
        if (lines.some(l => allocations.filter(a => a.receiptLineId === l.id).reduce((sum, a) => sum.add(a.qty), Dec.ZERO).gt('0'))) throw new ConflictException('This receipt is allocated to a purchase invoice. Cancel the invoice first.');
        const inspected = await tx
          .select({ id: qualityInspection.id })
          .from(qualityInspection)
          .where(and(inArray(qualityInspection.receiptLineId, lines.map((l) => l.id)), eq(qualityInspection.status, 'submitted')));
        if (inspected.length) throw new ConflictException('This receipt has been inspected. Cancel the inspections first.');
        for (const l of lines.filter((x) => x.poLineId)) {
          const [pl] = await tx
            .update(purchaseOrderLine)
            .set({ receivedQty: sql`${purchaseOrderLine.receivedQty} - ${l.qty}` })
            .where(eq(purchaseOrderLine.id, l.poLineId!))
            .returning();
          if (Dec.of(pl!.billedQty).gt(pl!.receivedQty)) throw new ConflictException('This receipt has already been invoiced. Cancel the purchase invoice first.');
        }
      }
      const sles = await tx
        .select()
        .from(stockLedgerEntry)
        .where(and(eq(stockLedgerEntry.voucherId, entryId), eq(stockLedgerEntry.isReversal, false)))
        .orderBy(desc(stockLedgerEntry.seq));
      const itemIds = [...new Set(sles.map((s) => s.itemId))].sort();
      for (const id of itemIds) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stock:${entityId}:${id}`}))`);

      for (const s of sles) {
        const q = Dec.of(s.qty);
        if (q.gt(Dec.ZERO)) {
          const [layer] = await tx.select().from(fifoLayer).where(eq(fifoLayer.sourceSeq, s.seq)).for('update');
          if (layer) {
            const [cost] = await tx.select().from(acquisitionCostChange).where(and(eq(acquisitionCostChange.layerId, layer.id), isNull(acquisitionCostChange.reversedAt))).limit(1);
            if (cost) throw new ConflictException('Acquisition cost covers this receipt; cancel its invoice first');
            const [landed] = await tx.select({ number: landedCostVoucher.number })
              .from(landedCostLayerChange)
              .innerJoin(landedCostVoucher, eq(landedCostVoucher.id, landedCostLayerChange.voucherId))
              .where(and(eq(landedCostLayerChange.layerId, layer.id), eq(landedCostVoucher.status, 'submitted'))).limit(1);
            if (landed) throw new ConflictException(`Landed cost ${landed.number ?? ''} changed this layer; cancel it first`);
          }
          if (layer && !Dec.of(layer.qtyRemaining).eq(layer.qtyIn)) {
            throw new ConflictException('Stock from this entry has already been issued. Cancel the later issues first.');
          }
          if (layer) await tx.update(fifoLayer).set({ qtyRemaining: '0' }).where(eq(fifoLayer.id, layer.id));
          await this.moveBin(tx, s.tenantId, entityId, s.itemId, s.warehouseId, s.batchId, s.ownerPartyId, q.neg(), 'Cancelling would make stock negative; later movements used it');
        } else {
          const used = await tx.select().from(fifoConsumption).where(eq(fifoConsumption.sleSeq, s.seq));
          // Decision 028: if landed cost was added to these layers after this issue, putting the quantity back
          // at today's (higher) rate would create value the ledger never recorded.
          if (used.length) {
            const [cost] = await tx.select().from(acquisitionCostChange).where(and(inArray(acquisitionCostChange.layerId, used.map(c => c.layerId)), isNull(acquisitionCostChange.reversedAt), gt(acquisitionCostChange.createdAt, s.postedAt))).limit(1);
            if (cost) throw new ConflictException('Acquisition cost was added after this issue; use a current receipt or adjustment');
            const [later] = await tx
              .select({ number: landedCostVoucher.number })
              .from(landedCostLayerChange)
              .innerJoin(landedCostVoucher, eq(landedCostVoucher.id, landedCostLayerChange.voucherId))
              .where(and(inArray(landedCostLayerChange.layerId, used.map((c) => c.layerId)), eq(landedCostVoucher.status, 'submitted'), gt(landedCostLayerChange.ledgerSeq, s.seq)))
              .limit(1);
            if (later) throw new ConflictException(`Landed cost (${later.number}) was added to this stock after it was issued. Return the material with a receipt or adjustment instead.`);
          }
          for (const c of used) {
            await tx.update(fifoLayer).set({ qtyRemaining: sql`${fifoLayer.qtyRemaining} + ${c.qty}` }).where(eq(fifoLayer.id, c.layerId));
          }
          await this.moveBin(tx, s.tenantId, entityId, s.itemId, s.warehouseId, s.batchId, s.ownerPartyId, q.neg());
        }
        await tx.insert(stockLedgerEntry).values({
          tenantId: s.tenantId,
          entityId,
          itemId: s.itemId,
          warehouseId: s.warehouseId,
          batchId: s.batchId,
          ownerPartyId: s.ownerPartyId,
          qty: q.neg().toString(),
          rate: s.rate,
          value: Dec.of(s.value).neg().toString(),
          postingDate: s.postingDate,
          voucherType: s.voucherType,
          voucherId: s.voucherId,
          voucherLineId: s.voucherLineId,
          isReversal: true,
        });
      }

      // Waste generated by a scrap entry is withdrawn too, unless some of it has already been disposed of.
      const waste = await tx.select().from(wasteMovement).where(and(eq(wasteMovement.stockEntryId, entryId), isNull(wasteMovement.cancelledAt)));
      for (const w of waste) {
        const [bal] = await tx.execute<{ balance: string }>(sql`
          select coalesce(sum(case when kind = 'generated' then qty else -qty end), 0) as balance
          from waste_movement
          where entity_id = ${entityId} and category = ${w.category} and material = ${w.material}
            and owner_party_id is not distinct from ${w.ownerPartyId} and cancelled_at is null`).then((r) => r.rows);
        if (Dec.of(bal!.balance).lt(w.qty)) throw new ConflictException('Waste from this scrap entry has already been disposed of. Cancel the disposal first.');
        await tx.update(wasteMovement).set({ cancelledAt: new Date(), cancelledBy: ctx.user.id, cancelReason: `Stock entry cancelled: ${reason}` }).where(eq(wasteMovement.id, w.id));
      }

      const [after] = await tx
        .update(stockEntry)
        .set({ status: 'cancelled', cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() })
        .where(eq(stockEntry.id, entryId))
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'stock_entry.cancel', targetType: 'stock_entry', targetId: entryId, reason }, tx);
      return after!;
    }
  }

  private async lockEntry(tx: Tx, entityId: string, entryId: string) {
    const [entry] = await tx.select().from(stockEntry).where(and(eq(stockEntry.id, entryId), eq(stockEntry.entityId, entityId))).for('update');
    if (!entry) throw new NotFoundException('Stock entry not found');
    return entry;
  }

  /** Adjusts a balance row; refuses to go below zero (negative stock is disallowed, docs/03 §3). */
  private async moveBin(tx: Tx, tenantId: string, entityId: string, itemId: string, warehouseId: string, batchId: string | null, ownerPartyId: string | null, delta: Dec, context = '') {
    const [row] = await tx
      .insert(stockBin)
      .values({ tenantId, entityId, itemId, warehouseId, batchId, ownerPartyId, qty: delta.toString() })
      .onConflictDoUpdate({
        target: [stockBin.entityId, stockBin.itemId, stockBin.warehouseId, stockBin.batchId, stockBin.ownerPartyId],
        set: { qty: sql`${stockBin.qty} + ${delta.toString()}`, updatedAt: new Date() },
      })
      .returning({ qty: stockBin.qty });
    if (Dec.of(row!.qty).isNeg()) {
      const had = Dec.of(row!.qty).sub(delta);
      throw new BadRequestException(`${context ? `${context}: ` : ''}only ${had.toFixed(3)} ${ownerPartyId ? "of this customer's material " : ''}in this warehouse${batchId ? '/batch' : ''}, ${delta.abs().toFixed(3)} needed`);
    }
  }

  /** Gapless per entity × document type × FY. Runs inside the posting transaction, so a failed post doesn't burn a number. */
  async allocateNumber(tx: Tx, tenantId: string, entityId: string, docType: string, postingDate: string): Promise<string> {
    const [e] = await tx.select({ code: legalEntity.code, fy: legalEntity.fyStartMonth }).from(legalEntity).where(eq(legalEntity.id, entityId));
    const fy = fyCode(new Date(`${postingDate}T00:00:00Z`), e!.fy);
    const base = docType.split(':')[0]!;
    const pattern = DEFAULT_SERIES[base]!;
    const [row] = await tx
      .insert(numberSeries)
      .values({ tenantId, entityId, docType, fy, pattern, nextValue: 2 })
      .onConflictDoUpdate({ target: [numberSeries.entityId, numberSeries.docType, numberSeries.fy], set: { nextValue: sql`${numberSeries.nextValue} + 1` } })
      .returning({ next: numberSeries.nextValue, pattern: numberSeries.pattern });
    const number = formatSeries(row!.pattern, { entityCode: e!.code, fy, counter: row!.next - 1 });
    if (GST_DOCS.has(base) && number.length > 16) throw new BadRequestException(`${number} is longer than the 16 characters GST allows; shorten the entity code`);
    return number;
  }

  /** Move a series forward, e.g. to continue after invoices already raised in Tally (decision 029). Never backwards. */
  async setNextValue(tx: Tx, tenantId: string, entityId: string, docType: string, fy: string, nextValue: number) {
    const base = docType.split(':')[0]!;
    if (!DEFAULT_SERIES[base]) throw new BadRequestException('Unknown document type');
    const [cur] = await tx.select().from(numberSeries).where(and(eq(numberSeries.entityId, entityId), eq(numberSeries.docType, docType), eq(numberSeries.fy, fy))).for('update');
    if (cur && nextValue < cur.nextValue) throw new BadRequestException(`Numbers up to ${cur.nextValue - 1} may already be used; the series can only move forward`);
    if (cur) await tx.update(numberSeries).set({ nextValue }).where(eq(numberSeries.id, cur.id));
    else await tx.insert(numberSeries).values({ tenantId, entityId, docType, fy, pattern: DEFAULT_SERIES[base]!, nextValue });
    return { before: cur?.nextValue ?? 1, after: nextValue };
  }
}

/** receipt → in; issue → out; transfer → transfer; adjustment → in or out depending on which warehouse is set. */
function lineDirection(purpose: string, line: Line): 'in' | 'out' | 'transfer' {
  if (purpose === 'receipt' || purpose === 'purchase_return_receipt') return 'in';
  if (purpose === 'issue' || purpose === 'return' || purpose === 'scrap' || purpose === 'delivery' || purpose === 'purchase_return') return 'out';
  if (purpose === 'transfer') return 'transfer';
  if (line.toWarehouseId && !line.fromWarehouseId) return 'in';
  if (line.fromWarehouseId && !line.toWarehouseId) return 'out';
  throw new BadRequestException(`Line ${line.lineNo}: an adjustment line sets either a target (increase) or a source (decrease) warehouse`);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
