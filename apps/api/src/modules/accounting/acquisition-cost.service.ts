import { Dec, splitAcquisitionCost } from '@factoryos/core';
import {
  acquisitionCostChange,
  fifoLayer,
  stockEntry,
  stockEntryLine,
  stockLedgerEntry,
} from '@factoryos/db';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { SourceRef } from './gl-posting.service.js';
import type { Tx } from './accounting-lock.js';
@Injectable()
export class AcquisitionCostService {
  async applyIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    source: SourceRef,
    postingDate: string,
    allocations: { receiptLineId: string; amount: string }[],
  ) {
    const grouped = new Map<string, Dec>();
    for (const a of allocations) {
      if (Dec.of(a.amount).lt('0'))
        throw new BadRequestException('Acquisition costs cannot be negative');
      grouped.set(
        a.receiptLineId,
        (grouped.get(a.receiptLineId) ?? Dec.ZERO).add(a.amount),
      );
    }
    let inventory = Dec.ZERO,
      consumed = Dec.ZERO,
      rounding = Dec.ZERO;
    for (const [receiptLineId, amount] of grouped) {
      if (amount.isZero()) continue;
      const [r] = await tx
        .select({ line: stockEntryLine, entry: stockEntry })
        .from(stockEntryLine)
        .innerJoin(stockEntry, eq(stockEntryLine.entryId, stockEntry.id))
        .where(
          and(
            eq(stockEntryLine.id, receiptLineId),
            eq(stockEntry.entityId, entityId),
            eq(stockEntry.status, 'submitted'),
          ),
        );
      if (!r || r.line.ownerPartyId || !r.line.toWarehouseId)
        throw new BadRequestException(
          'Acquisition costs require company-owned submitted receipts',
        );
      const [sle] = await tx
        .select()
        .from(stockLedgerEntry)
        .where(
          and(
            eq(stockLedgerEntry.voucherLineId, receiptLineId),
            eq(stockLedgerEntry.voucherId, r.entry.id),
            eq(stockLedgerEntry.isReversal, false),
          ),
        );
      const [layer] = sle
        ? await tx
            .select()
            .from(fifoLayer)
            .where(
              and(
                eq(fifoLayer.sourceSeq, sle.seq),
                eq(fifoLayer.entityId, entityId),
              ),
            )
            .for('update')
        : [];
      if (!layer) throw new ConflictException('Receipt cost layer not found');
      const split = splitAcquisitionCost({
        amount: amount.toString(),
        quantity: layer.qtyIn,
        remaining: layer.qtyRemaining,
        oldRate: layer.rate,
      });
      let seq: string | null = null;
      if (!Dec.of(split.inventory).isZero()) {
        await tx
          .update(fifoLayer)
          .set({ rate: split.newRate })
          .where(eq(fifoLayer.id, layer.id));
        const [movement] = await tx
          .insert(stockLedgerEntry)
          .values({
            tenantId: ctx.tenant.tenantId,
            entityId,
            itemId: r.line.itemId,
            batchId: r.line.batchId,
            warehouseId: r.line.toWarehouseId,
            ownerPartyId: null,
            postingDate,
            qty: '0',
            rate: '0',
            value: split.inventory,
            voucherType: `${source.type}_cost`,
            voucherId: source.id,
            voucherLineId: receiptLineId,
          })
          .returning();
        seq = String(movement!.seq);
      }
      await tx.insert(acquisitionCostChange).values({
        tenantId: ctx.tenant.tenantId,
        entityId,
        sourceType: source.type,
        sourceId: source.id,
        layerId: layer.id,
        oldRate: layer.rate,
        newRate: split.newRate,
        qtyRemaining: layer.qtyRemaining,
        onHand: split.inventory,
        consumed: split.consumed,
        rounding: split.rounding,
        stockLedgerSeq: seq,
      });
      inventory = inventory.add(split.inventory);
      consumed = consumed.add(split.consumed);
      rounding = rounding.add(split.rounding);
    }
    return {
      inventory: inventory.toString(),
      consumed: consumed.toString(),
      rounding: rounding.toString(),
    };
  }
  async reverseIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    source: SourceRef,
  ) {
    const changes = await tx
      .select()
      .from(acquisitionCostChange)
      .where(
        and(
          eq(acquisitionCostChange.entityId, entityId),
          eq(acquisitionCostChange.sourceType, source.type),
          eq(acquisitionCostChange.sourceId, source.id),
          isNull(acquisitionCostChange.reversedAt),
        ),
      )
      .for('update');
    for (const c of changes) {
      const [layer] = await tx
        .select()
        .from(fifoLayer)
        .where(
          and(eq(fifoLayer.id, c.layerId), eq(fifoLayer.entityId, entityId)),
        )
        .for('update');
      if (
        !layer ||
        !Dec.of(layer.qtyRemaining).eq(c.qtyRemaining) ||
        !Dec.of(layer.rate).eq(c.newRate)
      )
        throw new ConflictException(
          'Acquisition-cost stock moved or was revalued; record a current adjustment instead',
        );
      await tx
        .update(fifoLayer)
        .set({ rate: c.oldRate })
        .where(eq(fifoLayer.id, c.layerId));
      if (c.stockLedgerSeq) {
        const seq = Number(c.stockLedgerSeq);
        if (!Number.isSafeInteger(seq))
          throw new ConflictException(
            'Ledger sequence exceeds supported range',
          );
        const [s] = await tx
          .select()
          .from(stockLedgerEntry)
          .where(
            and(
              eq(stockLedgerEntry.seq, seq),
              eq(stockLedgerEntry.entityId, entityId),
            ),
          );
        if (!s)
          throw new ConflictException(
            'Cost adjustment ledger evidence missing',
          );
        await tx.insert(stockLedgerEntry).values({
          ...s,
          seq: undefined,
          postedAt: undefined,
          value: Dec.of(s.value).neg().toString(),
          isReversal: true,
        });
      }
      await tx
        .update(acquisitionCostChange)
        .set({ reversedAt: new Date() })
        .where(eq(acquisitionCostChange.id, c.id));
    }
  }
}
