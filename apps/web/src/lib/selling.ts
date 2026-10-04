'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useWorkspace } from '@/components/workspace';
import { api } from './api';
import type { Address, DocStatus, TaxPreview } from './types';

export type SellingKind = 'quotations' | 'orders' | 'invoices';
export const SELLING = {
  quotations: {
    title: 'Quotations',
    singular: 'quotation',
    endpoint: 'quotations',
    resource: 'quotation',
    date: 'quotationDate',
  },
  orders: {
    title: 'Sales orders',
    singular: 'sales order',
    endpoint: 'sales-orders',
    resource: 'sales_order',
    date: 'orderDate',
  },
  invoices: {
    title: 'Sales invoices',
    singular: 'invoice',
    endpoint: 'sales-invoices',
    resource: 'sales_invoice',
    date: 'invoiceDate',
  },
} as const;
export const SUPPLIES = {
  regular: 'Domestic',
  sez_with_payment: 'SEZ with IGST',
  sez_without_payment: 'SEZ under LUT',
  export_with_payment: 'Export with IGST',
  export_under_lut: 'Export under LUT',
};
export interface SellingLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  uomCode: string;
  tracking?: 'none' | 'batch' | 'serial';
  isStockItem?: boolean;
  description: string | null;
  hsnCode: string | null;
  qty: string;
  rate: string;
  gstRate: string;
  taxableValue: string | null;
  igst: string | null;
  cgst: string | null;
  sgst: string | null;
  cess: string | null;
  pendingQty?: string;
  invoicedQty?: string;
  soLineId?: string | null;
  warehouseId?: string | null;
  batchId?: string | null;
  warehouseCode?: string | null;
  batchNo?: string | null;
}
export interface SellingDocument {
  id: string;
  number: string | null;
  status: DocStatus;
  customerId: string;
  customerName?: string;
  partyName?: string;
  gstRegistrationId: string | null;
  supplyType: string;
  placeOfSupplyStateCode: string | null;
  currency: string;
  exchangeRate: string;
  remarks: string | null;
  taxableValue: string | null;
  totalTax: string | null;
  grandTotal: string | null;
  igst: string | null;
  cgst: string | null;
  sgst: string | null;
  cess: string | null;
  quotationDate?: string;
  orderDate?: string;
  invoiceDate?: string;
  validTill?: string | null;
  deliveryDate?: string | null;
  customerRef?: string | null;
  customerPoNo?: string | null;
  customerPoDate?: string | null;
  paymentTermsDays?: number | null;
  quotationId?: string | null;
  quotationNumber?: string | null;
  salesOrderId?: string | null;
  soNumber?: string | null;
  closedAt?: string | null;
  dueDate?: string | null;
  createdAt: string;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  creditOverride?: boolean;
  customerGstin?: string | null;
  billingAddress?: Address | null;
  shippingAddress?: Address | null;
  ourGstin?: string | null;
  ourTradeName?: string | null;
  ourAddress?: Address | null;
  lutArn?: string | null;
  shippingBillNo?: string | null;
  shippingBillDate?: string | null;
  portCode?: string | null;
  stockEntryId?: string | null;
  stockEntryNumber?: string | null;
  lines: SellingLine[];
  invoices?: {
    id: string;
    number: string | null;
    status: DocStatus;
    invoiceDate: string;
    grandTotal: string | null;
  }[];
  orders?: { id: string; number: string | null; status: DocStatus }[];
}
export interface SellingRow {
  id: string;
  number: string | null;
  status: DocStatus;
  customerName: string;
  currency: string;
  grandTotal: string | null;
  quotationDate?: string;
  orderDate?: string;
  invoiceDate?: string;
  dueDate?: string | null;
  closedAt?: string | null;
  orderedQty?: string;
  invoicedQty?: string;
}
export interface CreditStatus {
  creditLimit: string | null;
  outstanding: string;
  overdue: string;
  overdueCount: number;
  warnings: string[];
}
export interface NumberSeries {
  docType: string;
  label: string;
  gstin: string | null;
  fy: string;
  pattern: string;
  nextValue: number;
  nextNumber: string;
  used: boolean;
}
export type OutwardPreview = TaxPreview & {
  supplyType: string;
  placeOfSupplyStateCode: string;
  lutArn: string | null;
};

export function useSellingTax(body: string, enabled: boolean) {
  const ws = useWorkspace();
  const [debounced, setDebounced] = useState(body);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(body), 300);
    return () => clearTimeout(timer);
  }, [body]);
  const data = JSON.parse(debounced) as {
    customerId: string;
    date: string;
    lines: unknown[];
  };
  return useQuery({
    queryKey: ['selling-tax', ws.tenantId, ws.entityId, debounced],
    queryFn: () =>
      api<OutwardPreview>('/selling/tax-preview', {
        method: 'POST',
        body: data,
        scope: ws.scope,
      }),
    enabled:
      enabled && !!data.customerId && !!data.date && data.lines.length > 0,
    retry: false,
  });
}
