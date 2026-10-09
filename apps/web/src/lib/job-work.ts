import type { BadgeTone } from '@factoryos/ui';

/** Job work outward (decision 047). */
export type JobWorkStatus = 'draft' | 'open' | 'closed' | 'cancelled';
export type DeadlineState = 'open' | 'due_soon' | 'overdue' | 'deemed_supply';

export const JW_STATUS: Record<JobWorkStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Not sent', tone: 'neutral' },
  open: { label: 'At job worker', tone: 'info' },
  closed: { label: 'Closed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

export const DEADLINE: Record<DeadlineState, { label: string; tone: BadgeTone }> = {
  open: { label: 'In time', tone: 'neutral' },
  due_soon: { label: 'Due within 30 days', tone: 'warning' },
  overdue: { label: 'Deadline passed', tone: 'danger' },
  deemed_supply: { label: 'Deemed supply invoiced', tone: 'neutral' },
};

export interface JobWorkRow {
  id: string;
  number: string | null;
  kind: 'operation' | 'conversion';
  status: JobWorkStatus;
  supplier: string;
  target: string | null;
  workOrder: string | null;
  operation: string | null;
  natureOfWork: string | null;
  expectedReturnDate: string | null;
  atVendor: string;
  createdAt: string;
}

export interface ChallanLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  uom: string;
  batchId: string | null;
  batchNo: string | null;
  heatNo: string | null;
  qty: string;
  value: string;
  goodsType: 'input' | 'capital_good';
  hsnCode: string | null;
  dueBy: string | null;
  extendedDueBy: string | null;
  extensionRef: string | null;
  deemedSupplyInvoiceNo: string | null;
  open?: string;
  deadline?: DeadlineState | null;
}

export interface Challan {
  id: string;
  number: string | null;
  status: 'draft' | 'submitted' | 'cancelled';
  postingDate: string;
  interstate: boolean;
  ewayBillNo: string | null;
  vehicleNo: string | null;
  remarks: string | null;
  cancelReason: string | null;
  lines: ChallanLine[];
}

export interface JobWorkReceipt {
  id: string;
  number: string | null;
  status: 'submitted' | 'cancelled';
  postingDate: string;
  jobWorkerChallanNo: string | null;
  jobWorkerChallanDate: string | null;
  cancelReason: string | null;
  lines: { id: string; itemCode: string; itemName: string; batchNo: string | null; warehouse: string | null; qty: string; rejectedQty: string; value: string }[];
  consumed: { challanLineId: string; challan: string | null; qty: string; lossQty: string; scrapQty: string }[];
  invoices: { invoiceId: string; number: string | null; supplierInvoiceNo: string; status: string; taxableValue: string | null }[];
}

export interface JobWorkDetail extends Omit<JobWorkRow, 'target'> {
  supplierId: string;
  supplierCode: string;
  workOrderId: string | null;
  targetItemId: string | null;
  targetQty: string | null;
  targetWarehouseId: string | null;
  targetWarehouse: string | null;
  target: { code: string; name: string; tracking: string } | null;
  remarks: string | null;
  closeReason: string | null;
  materials: { id: string; itemId: string; itemCode: string; itemName: string; tracking: string; uom: string; qty: string }[];
  challans: Challan[];
  receipts: JobWorkReceipt[];
  charged: string;
}

export interface ChallanPrint extends Omit<Challan, 'lines'> {
  orderNumber: string | null;
  natureOfWork: string | null;
  workOrder: string | null;
  placeOfSupplyStateCode: string | null;
  consigner: { name: string; address: { line1?: string; line2?: string; city?: string; stateCode?: string; pincode?: string } | null; gstin: string | null; stateCode: string | null };
  consignee: { name: string; address: { line1?: string; line2?: string; city?: string; stateCode?: string; pincode?: string } | null; gstin: string | null; stateCode: string | null };
  lines: ChallanLine[];
}

export interface OutsourcedState {
  operations: { operationId: string; seq: number; name: string; good: string; sent: string; atVendor: string }[];
  orders: { id: string; number: string | null; status: JobWorkStatus; operationId: string | null; supplier: string }[];
}

export interface DeadlineLine {
  id: string;
  orderId: string;
  orderNumber: string | null;
  challanNo: string | null;
  challanDate: string;
  jobWorker: string;
  itemCode: string;
  itemName: string;
  uqc: string;
  qty: string;
  open: string;
  value: string;
  goodsType: 'input' | 'capital_good';
  dueBy: string | null;
  extendedDueBy: string | null;
  extensionRef: string | null;
  deemedSupplyInvoiceNo: string | null;
  due: string | null;
  state: DeadlineState;
}
