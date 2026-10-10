// Pure SELECT readers for work orders (decision 050). The list is shared with the ordinary endpoint. The support
// detail is its own narrower SELECT: the ordinary detail calls service helpers and joins user rows for operator
// names, which support must never read; here job cards carry only recorded facts.
import { bom, item, jobCard, machine, salesOrder, uom, warehouse, workCentre, workOrder, workOrderCost, workOrderMaterial, workOrderOperation } from '@factoryos/db';
import type { SupportPanelResult, SupportQuery } from '@factoryos/auth';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { detail, presentTable, project, table } from '../support-access/support-access.present.js';
import type { SupportExecutor, SupportScope } from '../support-access/support-access.types.js';
import { SupportError } from '../support-access/support-access.store.js';
import type { ReadScope } from './inventory.read.js';
import { readPurchaseInvoices } from './purchase-invoices.read.js';
import { readSalesInvoices } from './sales-invoices.read.js';

export async function workOrderList(db: SupportExecutor, s: ReadScope, q: { status?: 'draft' | 'released' | 'completed' | 'cancelled' }) {
  const where = [eq(workOrder.entityId, s.entityId)];
  if (q.status) where.push(eq(workOrder.status, q.status));
  return db
    .select({
      id: workOrder.id,
      number: workOrder.number,
      status: workOrder.status,
      itemCode: item.code,
      itemName: item.name,
      revision: sql<string>`coalesce(${bom.revision}, 'Rework')`,
      plannedQty: workOrder.plannedQty,
      producedQty: workOrder.producedQty,
      plannedStart: workOrder.plannedStart,
      plannedEnd: workOrder.plannedEnd,
      priority: workOrder.priority,
      scheduledFinish: workOrder.scheduledFinish,
      salesOrder: salesOrder.number,
      createdAt: workOrder.createdAt,
      wip: sql<string>`(select coalesce(sum(c.amount), 0) from work_order_cost c where c.work_order_id = "work_order"."id")`,
    })
    .from(workOrder)
    .innerJoin(item, and(eq(item.id, workOrder.itemId), eq(item.tenantId, s.tenantId)))
    .leftJoin(bom, and(eq(bom.id, workOrder.bomId), eq(bom.entityId, s.entityId)))
    .leftJoin(salesOrder, and(eq(salesOrder.id, workOrder.salesOrderId), eq(salesOrder.entityId, s.entityId)))
    .where(and(...where))
    .orderBy(desc(workOrder.createdAt), desc(workOrder.id))
    .limit(500);
}

/** Frozen BOM and routing, recorded WIP and job-card facts of one work order; null outside this entity. */
export async function workOrderFacts(db: SupportExecutor, s: ReadScope, id: string) {
  const [row] = await db
    .select({ wo: workOrder, itemCode: item.code, itemName: item.name, uom: uom.code, revision: sql<string>`coalesce(${bom.revision}, 'Rework')`, salesOrder: salesOrder.number })
    .from(workOrder)
    .innerJoin(item, and(eq(item.id, workOrder.itemId), eq(item.tenantId, s.tenantId)))
    .innerJoin(uom, eq(uom.id, item.stockUomId))
    .leftJoin(bom, and(eq(bom.id, workOrder.bomId), eq(bom.entityId, s.entityId)))
    .leftJoin(salesOrder, and(eq(salesOrder.id, workOrder.salesOrderId), eq(salesOrder.entityId, s.entityId)))
    .where(and(eq(workOrder.id, id), eq(workOrder.entityId, s.entityId)));
  if (!row) return null;
  const whs = new Map(
    (await db.select({ id: warehouse.id, name: warehouse.name }).from(warehouse).where(and(eq(warehouse.entityId, s.entityId), inArray(warehouse.id, [row.wo.sourceWarehouseId, row.wo.targetWarehouseId])))).map((w) => [w.id, w.name]),
  );
  const materials = await db
    .select({ lineNo: workOrderMaterial.lineNo, itemCode: item.code, itemName: item.name, uom: uom.code, qtyPerUnit: workOrderMaterial.qtyPerUnit, requiredQty: workOrderMaterial.requiredQty, backflush: workOrderMaterial.backflush })
    .from(workOrderMaterial)
    .innerJoin(item, and(eq(item.id, workOrderMaterial.itemId), eq(item.tenantId, s.tenantId)))
    .innerJoin(uom, eq(uom.id, item.stockUomId))
    .where(eq(workOrderMaterial.workOrderId, row.wo.id))
    .orderBy(asc(workOrderMaterial.lineNo));
  const operations = await db
    .select({ seq: workOrderOperation.seq, name: workOrderOperation.name, workCentre: workCentre.name, outsourced: workOrderOperation.outsourced, plannedMinutes: workOrderOperation.plannedMinutes })
    .from(workOrderOperation)
    .leftJoin(workCentre, and(eq(workCentre.id, workOrderOperation.workCentreId), eq(workCentre.entityId, s.entityId)))
    .where(eq(workOrderOperation.workOrderId, row.wo.id))
    .orderBy(asc(workOrderOperation.seq));
  const cards = await db
    .select({ seq: workOrderOperation.seq, operation: workOrderOperation.name, machine: machine.code, status: jobCard.status, goodQty: jobCard.goodQty, reworkQty: jobCard.reworkQty, scrapQty: jobCard.scrapQty, minutes: jobCard.minutes, value: jobCard.value, postingDate: jobCard.postingDate, completedAt: jobCard.completedAt })
    .from(jobCard)
    .innerJoin(workOrderOperation, and(eq(workOrderOperation.id, jobCard.operationId), eq(workOrderOperation.workOrderId, row.wo.id)))
    .leftJoin(machine, and(eq(machine.id, jobCard.machineId), eq(machine.entityId, s.entityId)))
    .where(eq(jobCard.workOrderId, row.wo.id))
    .orderBy(asc(workOrderOperation.seq), asc(jobCard.createdAt));
  const wip = await db
    .select({ kind: workOrderCost.kind, amount: sql<string>`sum(${workOrderCost.amount})`, qty: sql<string | null>`sum(${workOrderCost.qty})` })
    .from(workOrderCost)
    .where(eq(workOrderCost.workOrderId, row.wo.id))
    .groupBy(workOrderCost.kind)
    .orderBy(asc(workOrderCost.kind));
  return { ...row, sourceWarehouse: whs.get(row.wo.sourceWarehouseId) ?? null, targetWarehouse: whs.get(row.wo.targetWarehouseId) ?? null, materials, operations, cards, wip };
}

const LIST = [
  { key: 'number', label: 'Number' },
  { key: 'status', label: 'Status' },
  { key: 'itemCode', label: 'Item' },
  { key: 'revision', label: 'Revision' },
  { key: 'plannedQty', label: 'Planned' },
  { key: 'producedQty', label: 'Produced' },
  { key: 'plannedEnd', label: 'Due' },
  { key: 'wip', label: 'WIP' },
];
const MATERIALS = [
  { key: 'lineNo', label: '#' },
  { key: 'itemCode', label: 'Item' },
  { key: 'itemName', label: 'Name' },
  { key: 'qtyPerUnit', label: 'Per unit' },
  { key: 'requiredQty', label: 'Required' },
  { key: 'uom', label: 'Unit' },
];
const OPERATIONS = [
  { key: 'seq', label: 'Seq' },
  { key: 'name', label: 'Operation' },
  { key: 'workCentre', label: 'Work centre' },
  { key: 'outsourced', label: 'Outsourced' },
  { key: 'plannedMinutes', label: 'Planned minutes' },
];
const CARDS = [
  { key: 'seq', label: 'Seq' },
  { key: 'operation', label: 'Operation' },
  { key: 'machine', label: 'Machine' },
  { key: 'status', label: 'Status' },
  { key: 'goodQty', label: 'Good' },
  { key: 'reworkQty', label: 'Rework' },
  { key: 'scrapQty', label: 'Scrap' },
  { key: 'minutes', label: 'Minutes' },
  { key: 'value', label: 'Value' },
];
const WIP = [
  { key: 'kind', label: 'Cost' },
  { key: 'qty', label: 'Quantity' },
  { key: 'amount', label: 'Amount' },
];

export async function readWorkOrders(db: SupportExecutor, scope: SupportScope, query: Extract<SupportQuery, { area: 'sales-invoices' | 'purchase-invoices' | 'work-orders' }>): Promise<SupportPanelResult> {
  if (query.area !== 'work-orders' || !scope.permissions.has('manufacturing.work_order.read')) throw new SupportError('SUPPORT_UNAVAILABLE', 'permission');
  if (query.panel === 'list') return table(LIST, await workOrderList(db, scope, { status: query.status as 'draft' | 'released' | 'completed' | 'cancelled' | undefined }), query);
  const wo = await workOrderFacts(db, scope, query.id!);
  if (!wo) throw new SupportError('SUPPORT_NOT_FOUND');
  const sub = (cols: typeof WIP, rows: readonly object[]) => presentTable(cols, project(cols, rows), null);
  return detail(
    [
      { label: 'Number', value: wo.wo.number },
      { label: 'Status', value: wo.wo.status },
      { label: 'Item', value: `${wo.itemCode} ${wo.itemName}` },
      { label: 'Revision', value: wo.revision },
      { label: 'Planned quantity', value: wo.wo.plannedQty },
      { label: 'Produced quantity', value: wo.wo.producedQty },
      { label: 'Planned start', value: wo.wo.plannedStart },
      { label: 'Planned end', value: wo.wo.plannedEnd },
      { label: 'Sales order', value: wo.salesOrder },
      { label: 'Source warehouse', value: wo.sourceWarehouse },
      { label: 'Target warehouse', value: wo.targetWarehouse },
    ],
    [
      { label: 'Materials', table: sub(MATERIALS, wo.materials) },
      { label: 'Routing', table: sub(OPERATIONS, wo.operations) },
      { label: 'Job cards', table: sub(CARDS, wo.cards) },
      { label: 'WIP by cost', table: sub(WIP, wo.wip) },
    ],
  );
}

/** Explicitly enumerated dispatcher: no other area or path ever reaches a reader. */
export function readDocument(db: SupportExecutor, scope: SupportScope, query: Extract<SupportQuery, { area: 'sales-invoices' | 'purchase-invoices' | 'work-orders' }>): Promise<SupportPanelResult> {
  switch (query.area) {
    case 'sales-invoices':
      return readSalesInvoices(db, scope, query);
    case 'purchase-invoices':
      return readPurchaseInvoices(db, scope, query);
    case 'work-orders':
      return readWorkOrders(db, scope, query);
  }
}
