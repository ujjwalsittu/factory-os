// Pure SELECT readers for sales invoices (decision 050): list and frozen detail. Shared by the ordinary selling
// endpoints and support access; every join is bound to the invoice's tenant/entity.
import { batch, gstRegistration, item, party, salesInvoice, salesInvoiceLine, salesOrder, stockEntry, uom, warehouse } from '@factoryos/db';
import type { SupportPanelResult, SupportQuery } from '@factoryos/auth';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { detail, presentTable, project, table } from '../support-access/support-access.present.js';
import type { SupportExecutor, SupportScope } from '../support-access/support-access.types.js';
import { SupportError } from '../support-access/support-access.store.js';
import type { ReadScope } from './inventory.read.js';

export async function salesInvoiceList(db: SupportExecutor, s: ReadScope, q: { status?: 'draft' | 'submitted' | 'cancelled'; customerId?: string }) {
  const where: SQL[] = [eq(salesInvoice.entityId, s.entityId)];
  if (q.status) where.push(eq(salesInvoice.status, q.status));
  if (q.customerId) where.push(eq(salesInvoice.customerId, q.customerId));
  return db
    .select({
      id: salesInvoice.id,
      number: salesInvoice.number,
      status: salesInvoice.status,
      invoiceDate: salesInvoice.invoiceDate,
      dueDate: salesInvoice.dueDate,
      customerName: party.name,
      supplyType: salesInvoice.supplyType,
      currency: salesInvoice.currency,
      taxableValue: salesInvoice.taxableValue,
      totalTax: salesInvoice.totalTax,
      grandTotal: salesInvoice.grandTotal,
      soNumber: salesOrder.number,
      gstin: gstRegistration.gstin,
    })
    .from(salesInvoice)
    .innerJoin(party, and(eq(party.id, salesInvoice.customerId), eq(party.tenantId, s.tenantId)))
    .leftJoin(salesOrder, and(eq(salesOrder.id, salesInvoice.salesOrderId), eq(salesOrder.entityId, s.entityId)))
    .leftJoin(gstRegistration, and(eq(gstRegistration.id, salesInvoice.gstRegistrationId), eq(gstRegistration.entityId, s.entityId)))
    .where(and(...where))
    .orderBy(desc(salesInvoice.createdAt), desc(salesInvoice.id))
    .limit(500);
}

/** Null when the invoice is not in this entity. */
export async function salesInvoiceDetail(db: SupportExecutor, s: ReadScope, id: string) {
  const [inv] = await db
    .select({ inv: salesInvoice, partyName: party.name, soNumber: salesOrder.number, reg: gstRegistration })
    .from(salesInvoice)
    .innerJoin(party, and(eq(party.id, salesInvoice.customerId), eq(party.tenantId, s.tenantId)))
    .leftJoin(salesOrder, and(eq(salesOrder.id, salesInvoice.salesOrderId), eq(salesOrder.entityId, s.entityId)))
    .leftJoin(gstRegistration, and(eq(gstRegistration.id, salesInvoice.gstRegistrationId), eq(gstRegistration.entityId, s.entityId)))
    .where(and(eq(salesInvoice.id, id), eq(salesInvoice.entityId, s.entityId)));
  if (!inv) return null;
  const rows = await db
    .select({ line: salesInvoiceLine, itemCode: item.code, itemName: item.name, tracking: item.tracking, isStockItem: item.isStockItem, uomCode: uom.code, batchNo: batch.batchNo, warehouseCode: warehouse.code })
    .from(salesInvoiceLine)
    .innerJoin(item, and(eq(item.id, salesInvoiceLine.itemId), eq(item.tenantId, s.tenantId)))
    .innerJoin(uom, eq(uom.id, item.stockUomId))
    .leftJoin(batch, and(eq(batch.id, salesInvoiceLine.batchId), eq(batch.tenantId, s.tenantId)))
    .leftJoin(warehouse, and(eq(warehouse.id, salesInvoiceLine.warehouseId), eq(warehouse.entityId, s.entityId)))
    .where(eq(salesInvoiceLine.invoiceId, inv.inv.id))
    .orderBy(asc(salesInvoiceLine.lineNo));
  const [stock] = inv.inv.stockEntryId
    ? await db.select({ number: stockEntry.number, status: stockEntry.status }).from(stockEntry).where(and(eq(stockEntry.id, inv.inv.stockEntryId), eq(stockEntry.entityId, s.entityId)))
    : [];
  return {
    ...inv.inv,
    partyName: inv.partyName,
    soNumber: inv.soNumber,
    ourGstin: inv.reg?.gstin ?? null,
    ourStateCode: inv.reg?.stateCode ?? null,
    ourAddress: inv.reg?.address ?? null,
    ourTradeName: inv.reg?.tradeName ?? null,
    stockEntryNumber: stock?.number ?? null,
    lines: rows.map((r) => ({ ...r.line, itemCode: r.itemCode, itemName: r.itemName, tracking: r.tracking, isStockItem: r.isStockItem, uomCode: r.uomCode, batchNo: r.batchNo, warehouseCode: r.warehouseCode })),
  };
}

const LIST = [
  { key: 'number', label: 'Number' },
  { key: 'status', label: 'Status' },
  { key: 'invoiceDate', label: 'Date' },
  { key: 'customerName', label: 'Customer' },
  { key: 'currency', label: 'Currency' },
  { key: 'taxableValue', label: 'Taxable' },
  { key: 'totalTax', label: 'Tax' },
  { key: 'grandTotal', label: 'Total' },
];
export const INVOICE_LINES = [
  { key: 'lineNo', label: '#' },
  { key: 'itemCode', label: 'Item' },
  { key: 'itemName', label: 'Name' },
  { key: 'hsnCode', label: 'HSN/SAC' },
  { key: 'qty', label: 'Quantity' },
  { key: 'uomCode', label: 'Unit' },
  { key: 'rate', label: 'Rate' },
  { key: 'taxableValue', label: 'Taxable' },
  { key: 'gstRate', label: 'GST %' },
  { key: 'cgst', label: 'CGST' },
  { key: 'sgst', label: 'SGST' },
  { key: 'igst', label: 'IGST' },
  { key: 'cess', label: 'Cess' },
];

export async function readSalesInvoices(db: SupportExecutor, scope: SupportScope, query: Extract<SupportQuery, { area: 'sales-invoices' | 'purchase-invoices' | 'work-orders' }>): Promise<SupportPanelResult> {
  if (query.area !== 'sales-invoices' || !scope.permissions.has('selling.sales_invoice.read')) throw new SupportError('SUPPORT_UNAVAILABLE', 'permission');
  if (query.panel === 'list') return table(LIST, await salesInvoiceList(db, scope, { status: query.status as 'draft' | 'submitted' | 'cancelled' | undefined }), query);
  const inv = await salesInvoiceDetail(db, scope, query.id!);
  if (!inv) throw new SupportError('SUPPORT_NOT_FOUND');
  return detail(
    [
      { label: 'Number', value: inv.number },
      { label: 'Status', value: inv.status },
      { label: 'Invoice date', value: inv.invoiceDate },
      { label: 'Due date', value: inv.dueDate },
      { label: 'Customer', value: inv.partyName },
      { label: 'Customer GSTIN', value: inv.customerGstin },
      { label: 'Our GSTIN', value: inv.ourGstin },
      { label: 'Sales order', value: inv.soNumber },
      { label: 'Currency', value: inv.currency },
      { label: 'Taxable value', value: inv.taxableValue },
      { label: 'Total tax', value: inv.totalTax },
      { label: 'Grand total', value: inv.grandTotal },
      { label: 'Delivery', value: inv.stockEntryNumber },
    ],
    [{ label: 'Lines', table: presentTable(INVOICE_LINES, project(INVOICE_LINES, inv.lines), null) }],
  );
}
