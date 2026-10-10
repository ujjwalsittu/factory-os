// Pure SELECT readers for purchase invoices (decision 050): list and frozen detail. Shared by the ordinary buying
// endpoints and support access; every join is bound to the invoice's tenant/entity.
import { item, party, purchaseInvoice, purchaseInvoiceLine, purchaseOrder, purchaseOrderLine, uom } from '@factoryos/db';
import type { SupportPanelResult, SupportQuery } from '@factoryos/auth';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { detail, presentTable, project, table } from '../support-access/support-access.present.js';
import type { SupportExecutor, SupportScope } from '../support-access/support-access.types.js';
import { SupportError } from '../support-access/support-access.store.js';
import type { ReadScope } from './inventory.read.js';
import { INVOICE_LINES } from './sales-invoices.read.js';

export async function purchaseInvoiceList(db: SupportExecutor, s: ReadScope, q: { status?: 'draft' | 'submitted' | 'cancelled' }) {
  const where: SQL[] = [eq(purchaseInvoice.entityId, s.entityId)];
  if (q.status) where.push(eq(purchaseInvoice.status, q.status));
  return db
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
    .innerJoin(party, and(eq(party.id, purchaseInvoice.supplierId), eq(party.tenantId, s.tenantId)))
    .leftJoin(purchaseOrder, and(eq(purchaseOrder.id, purchaseInvoice.purchaseOrderId), eq(purchaseOrder.entityId, s.entityId)))
    .where(and(...where))
    .orderBy(desc(purchaseInvoice.createdAt), desc(purchaseInvoice.id))
    .limit(500);
}

/** Null when the invoice is not in this entity. */
export async function purchaseInvoiceDetail(db: SupportExecutor, s: ReadScope, id: string) {
  const [inv] = await db
    .select({ inv: purchaseInvoice, supplierName: party.name, supplierGstin: party.gstin, poNumber: purchaseOrder.number })
    .from(purchaseInvoice)
    .innerJoin(party, and(eq(party.id, purchaseInvoice.supplierId), eq(party.tenantId, s.tenantId)))
    .leftJoin(purchaseOrder, and(eq(purchaseOrder.id, purchaseInvoice.purchaseOrderId), eq(purchaseOrder.entityId, s.entityId)))
    .where(and(eq(purchaseInvoice.id, id), eq(purchaseInvoice.entityId, s.entityId)));
  if (!inv) return null;
  const lines = await db
    .select({ line: purchaseInvoiceLine, itemCode: item.code, itemName: item.name, uomCode: uom.code, poRate: purchaseOrderLine.rate })
    .from(purchaseInvoiceLine)
    .innerJoin(item, and(eq(item.id, purchaseInvoiceLine.itemId), eq(item.tenantId, s.tenantId)))
    .innerJoin(uom, eq(uom.id, item.stockUomId))
    .leftJoin(purchaseOrderLine, eq(purchaseOrderLine.id, purchaseInvoiceLine.poLineId))
    .where(eq(purchaseInvoiceLine.invoiceId, inv.inv.id))
    .orderBy(asc(purchaseInvoiceLine.lineNo));
  return { ...inv.inv, supplierName: inv.supplierName, supplierGstin: inv.supplierGstin, poNumber: inv.poNumber, lines: lines.map((l) => ({ ...l.line, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, poRate: l.poRate })) };
}

const LIST = [
  { key: 'number', label: 'Number' },
  { key: 'status', label: 'Status' },
  { key: 'postingDate', label: 'Date' },
  { key: 'supplierName', label: 'Supplier' },
  { key: 'supplierInvoiceNo', label: 'Supplier invoice' },
  { key: 'currency', label: 'Currency' },
  { key: 'taxableValue', label: 'Taxable' },
  { key: 'totalTax', label: 'Tax' },
  { key: 'grandTotal', label: 'Total' },
];

export async function readPurchaseInvoices(db: SupportExecutor, scope: SupportScope, query: Extract<SupportQuery, { area: 'sales-invoices' | 'purchase-invoices' | 'work-orders' }>): Promise<SupportPanelResult> {
  if (query.area !== 'purchase-invoices' || !scope.permissions.has('buying.purchase_invoice.read')) throw new SupportError('SUPPORT_UNAVAILABLE', 'permission');
  if (query.panel === 'list') return table(LIST, await purchaseInvoiceList(db, scope, { status: query.status as 'draft' | 'submitted' | 'cancelled' | undefined }), query);
  const inv = await purchaseInvoiceDetail(db, scope, query.id!);
  if (!inv) throw new SupportError('SUPPORT_NOT_FOUND');
  return detail(
    [
      { label: 'Number', value: inv.number },
      { label: 'Status', value: inv.status },
      { label: 'Posting date', value: inv.postingDate },
      { label: 'Supplier', value: inv.supplierName },
      { label: 'Supplier GSTIN', value: inv.supplierGstin },
      { label: 'Supplier invoice', value: inv.supplierInvoiceNo },
      { label: 'Purchase order', value: inv.poNumber },
      { label: 'Currency', value: inv.currency },
      { label: 'Taxable value', value: inv.taxableValue },
      { label: 'Total tax', value: inv.totalTax },
      { label: 'Grand total', value: inv.grandTotal },
      { label: 'Due date', value: inv.dueDate },
    ],
    [{ label: 'Lines', table: presentTable(INVOICE_LINES, project(INVOICE_LINES, inv.lines), null) }],
  );
}
