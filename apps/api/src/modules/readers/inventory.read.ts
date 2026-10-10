// Pure SELECT readers for stock balance and the stock ledger (decision 050). The ordinary inventory endpoints and
// support access both call these; every label join is bound to the same tenant/entity as the rows it labels.
import { Dec } from '@factoryos/core';
import { batch, fifoLayer, item, party, stockBin, stockEntry, stockLedgerEntry, uom, warehouse } from '@factoryos/db';
import type { SupportPanelResult, SupportQuery } from '@factoryos/auth';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, ne, type SQL, sql } from 'drizzle-orm';
import { table } from '../support-access/support-access.present.js';
import type { SupportExecutor, SupportScope } from '../support-access/support-access.types.js';
import { SupportError } from '../support-access/support-access.store.js';

export type ReadScope = { tenantId: string; entityId: string };

export async function stockBalance(db: SupportExecutor, s: ReadScope, q: { itemId?: string; warehouseId?: string; batchId?: string; owner?: string }) {
  const where: SQL[] = [eq(stockBin.entityId, s.entityId), ne(stockBin.qty, '0')];
  if (q.itemId) where.push(eq(stockBin.itemId, q.itemId));
  if (q.warehouseId) where.push(eq(stockBin.warehouseId, q.warehouseId));
  if (q.batchId) where.push(eq(stockBin.batchId, q.batchId));
  if (q.owner === 'company') where.push(isNull(stockBin.ownerPartyId));
  else if (q.owner === 'customers') where.push(isNotNull(stockBin.ownerPartyId));
  else if (q.owner) where.push(eq(stockBin.ownerPartyId, q.owner));
  const rows = await db
    .select({
      itemId: stockBin.itemId,
      itemCode: item.code,
      itemName: item.name,
      uomCode: uom.code,
      reorderLevel: item.reorderLevel,
      warehouseId: stockBin.warehouseId,
      warehouseCode: warehouse.code,
      warehouseName: warehouse.name,
      warehouseType: warehouse.type,
      batchId: stockBin.batchId,
      batchNo: batch.batchNo,
      heatNo: batch.heatNo,
      expiryDate: batch.expiryDate,
      ownerPartyId: stockBin.ownerPartyId,
      ownerName: party.name,
      qty: stockBin.qty,
    })
    .from(stockBin)
    .innerJoin(item, and(eq(item.id, stockBin.itemId), eq(item.tenantId, s.tenantId)))
    .innerJoin(uom, eq(uom.id, item.stockUomId))
    .innerJoin(warehouse, and(eq(warehouse.id, stockBin.warehouseId), eq(warehouse.entityId, s.entityId)))
    .leftJoin(batch, and(eq(batch.id, stockBin.batchId), eq(batch.tenantId, s.tenantId)))
    .leftJoin(party, and(eq(party.id, stockBin.ownerPartyId), eq(party.tenantId, s.tenantId)))
    .where(and(...where))
    .orderBy(asc(item.code), sql`${party.name} nulls first`, asc(warehouse.code), asc(batch.batchNo));

  // FIFO value per (item, batch) from open layers; allocate to warehouses by owned quantity.
  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  const layers = itemIds.length
    ? await db
        .select({ itemId: fifoLayer.itemId, batchId: fifoLayer.batchId, qty: sql<string>`sum(${fifoLayer.qtyRemaining})`, value: sql<string>`sum(${fifoLayer.qtyRemaining} * ${fifoLayer.rate})` })
        .from(fifoLayer)
        .where(and(eq(fifoLayer.entityId, s.entityId), inArray(fifoLayer.itemId, itemIds), gt(fifoLayer.qtyRemaining, '0')))
        .groupBy(fifoLayer.itemId, fifoLayer.batchId)
    : [];
  const key = (i: string, b: string | null) => `${i}:${b ?? ''}`;
  const valued = new Map(layers.map((l) => [key(l.itemId, l.batchId), { qty: Dec.of(l.qty), value: Dec.of(l.value) }]));
  return rows.map((r) => {
    const v = valued.get(key(r.itemId, r.batchId));
    const owned = r.ownerPartyId === null;
    const value = owned && v && v.qty.gt(Dec.ZERO) ? v.value.mul(Dec.of(r.qty).div(v.qty)) : Dec.ZERO;
    return { ...r, ownership: owned ? 'company' : 'customer', value: value.toFixed(2) };
  });
}

/** Movements of one item with a running balance; running totals include movements before the shown range. */
export async function stockLedger(db: SupportExecutor, s: ReadScope, q: { itemId: string; warehouseId?: string; batchId?: string; owner?: string; from?: string; to?: string }) {
  const where: SQL[] = [eq(stockLedgerEntry.entityId, s.entityId), eq(stockLedgerEntry.itemId, q.itemId)];
  if (q.warehouseId) where.push(eq(stockLedgerEntry.warehouseId, q.warehouseId));
  if (q.batchId) where.push(eq(stockLedgerEntry.batchId, q.batchId));
  if (q.owner === 'company') where.push(isNull(stockLedgerEntry.ownerPartyId));
  else if (q.owner === 'customers') where.push(isNotNull(stockLedgerEntry.ownerPartyId));
  else if (q.owner) where.push(eq(stockLedgerEntry.ownerPartyId, q.owner));
  if (q.to) where.push(lte(stockLedgerEntry.postingDate, q.to));
  const rows = await db
    .select({
      seq: stockLedgerEntry.seq,
      postingDate: stockLedgerEntry.postingDate,
      warehouseCode: warehouse.code,
      batchNo: batch.batchNo,
      heatNo: batch.heatNo,
      ownerName: party.name,
      qty: stockLedgerEntry.qty,
      rate: stockLedgerEntry.rate,
      value: stockLedgerEntry.value,
      isReversal: stockLedgerEntry.isReversal,
      voucherType: stockLedgerEntry.voucherType,
      voucherId: stockLedgerEntry.voucherId,
      voucherNumber: sql<string | null>`coalesce(${stockEntry.number}, (select v.number from landed_cost_voucher v where v.id = "stock_ledger_entry"."voucher_id" and v.entity_id = ${s.entityId}))`,
      purpose: stockEntry.purpose,
      balanceQty: sql<string>`sum(${stockLedgerEntry.qty}) over (order by ${stockLedgerEntry.postingDate}, ${stockLedgerEntry.seq})`,
      balanceValue: sql<string>`sum(${stockLedgerEntry.value}) over (order by ${stockLedgerEntry.postingDate}, ${stockLedgerEntry.seq})`,
    })
    .from(stockLedgerEntry)
    .innerJoin(warehouse, and(eq(warehouse.id, stockLedgerEntry.warehouseId), eq(warehouse.entityId, s.entityId)))
    .leftJoin(batch, and(eq(batch.id, stockLedgerEntry.batchId), eq(batch.tenantId, s.tenantId)))
    .leftJoin(stockEntry, and(eq(stockEntry.id, stockLedgerEntry.voucherId), eq(stockEntry.entityId, s.entityId)))
    .leftJoin(party, and(eq(party.id, stockLedgerEntry.ownerPartyId), eq(party.tenantId, s.tenantId)))
    .where(and(...where))
    .orderBy(asc(stockLedgerEntry.postingDate), asc(stockLedgerEntry.seq));
  // Running totals include earlier movements; the date filter only trims what's shown.
  return q.from ? rows.filter((r) => r.postingDate >= q.from!) : rows;
}

const BALANCE = [
  { key: 'itemCode', label: 'Item' },
  { key: 'itemName', label: 'Name' },
  { key: 'warehouseCode', label: 'Warehouse' },
  { key: 'batchNo', label: 'Batch' },
  { key: 'heatNo', label: 'Heat' },
  { key: 'ownerName', label: 'Owner' },
  { key: 'qty', label: 'Quantity' },
  { key: 'uomCode', label: 'Unit' },
  { key: 'value', label: 'Value' },
];
const LEDGER = [
  { key: 'postingDate', label: 'Date' },
  { key: 'voucherNumber', label: 'Voucher' },
  { key: 'purpose', label: 'Purpose' },
  { key: 'warehouseCode', label: 'Warehouse' },
  { key: 'batchNo', label: 'Batch' },
  { key: 'qty', label: 'Quantity' },
  { key: 'rate', label: 'Rate' },
  { key: 'value', label: 'Value' },
  { key: 'balanceQty', label: 'Balance quantity' },
  { key: 'balanceValue', label: 'Balance value' },
];

export async function readInventory(db: SupportExecutor, scope: SupportScope, query: Extract<SupportQuery, { area: 'inventory' }>): Promise<SupportPanelResult> {
  if (query.area !== 'inventory' || !scope.permissions.has('inventory.report.read')) throw new SupportError('SUPPORT_UNAVAILABLE', 'permission');
  if (query.panel === 'balance') return table(BALANCE, await stockBalance(db, scope, query), query);
  return table(LEDGER, await stockLedger(db, scope, { ...query, itemId: query.itemId! }), query);
}
