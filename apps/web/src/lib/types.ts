export interface Me {
  user: { id: string; email: string; name: string };
  platformAdmin: 'superadmin' | 'support' | null;
  tenants: { id: string; name: string; slug: string; status: string; isOwner: boolean }[];
  canCreateTenant: boolean;
}

export interface TenantContextData {
  tenantId: string;
  isOwner: boolean;
  allEntities: boolean;
  activeEntityId: string | null;
  entities: { id: string; shortName: string; legalName: string; code: string; parentEntityId: string | null }[];
  permissions: string[];
}

export interface Address {
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  stateCode: string;
  pincode: string;
  country?: string;
}

export interface GstRegistration {
  id: string;
  gstin: string;
  stateCode: string;
  type: string;
  tradeName: string | null;
  einvoiceApplicableFrom: string | null;
  irpProvider: string;
  ewbProvider: string;
  returnsProvider: string;
  address: Address | null;
  lutArn: string | null;
  lutValidFrom: string | null;
  lutValidTo: string | null;
}

export interface Plant {
  id: string;
  name: string;
  code: string;
}

export interface LegalEntity {
  id: string;
  legalName: string;
  shortName: string;
  code: string;
  pan: string | null;
  cin: string | null;
  parentEntityId: string | null;
  fyStartMonth: number;
  isActive: boolean;
  gstRegistrations: GstRegistration[];
  plants: Plant[];
}

export interface Role {
  id: string;
  systemKey: string | null;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  memberCount: number;
}

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  twoFactorEnabled: boolean | null;
  status: 'active' | 'disabled';
  isOwner: boolean;
  roles: { roleId: string; roleName: string; entityIds: string[] | null }[];
}

export interface Invitation {
  id: string;
  email: string;
  status: string;
  roles: { roleId: string; entityIds: string[] | null }[];
  expiresAt: string;
}

export interface AuditEvent {
  seq: number;
  occurredAt: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  hash: string;
  prevHash: string | null;
}

export interface ResourceDef {
  module: string;
  resource: string;
  label: string;
  actions: string[];
}

// ---- Phase 1a: masters & inventory ----
export interface Uom {
  id: string;
  code: string;
  name: string;
  decimals: number;
}

export interface HsnCode {
  id: string;
  code: string;
  kind: 'hsn' | 'sac';
  description: string;
  gstRate: string;
  cessRate: string;
  effectiveFrom: string;
}

export type ItemType =
  | 'raw_material'
  | 'powder'
  | 'component'
  | 'consumable'
  | 'sub_assembly'
  | 'finished_good'
  | 'kit'
  | 'tool'
  | 'gauge'
  | 'service'
  | 'scrap';

export interface Item {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: ItemType;
  tracking: 'none' | 'batch' | 'serial';
  isStockItem: boolean;
  stockUomId: string;
  uomCode?: string;
  uomDecimals?: number;
  hsnCode: string | null;
  revision: string | null;
  serialPrefix?: string | null;
  drawingNo: string | null;
  shelfLifeDays: number | null;
  mslLevel: string | null;
  requiresIncomingInspection: boolean;
  exportControlled: boolean;
  reorderLevel: string | null;
  isActive: boolean;
}

export interface Party {
  id: string;
  code: string;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  gstTreatment: string;
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  msmeUdyam: string | null;
  msmeCategory: string | null;
  creditDays: number | null;
  creditLimit: string | null;
  addresses: (Address & { label: string })[];
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  availableForIssue: boolean;
  isActive: boolean;
}

export interface Batch {
  id: string;
  batchNo: string;
  heatNo: string | null;
  expiryDate: string | null;
  qty: string;
}

export type StockPurpose = 'receipt' | 'issue' | 'transfer' | 'adjustment' | 'return' | 'scrap' | 'delivery';
export type DocStatus = 'draft' | 'submitted' | 'cancelled';

export interface StockEntryRow {
  id: string;
  number: string | null;
  purpose: StockPurpose;
  status: DocStatus;
  postingDate: string;
  reference: string | null;
  partyName: string | null;
  createdByName: string;
  lineCount: number;
  totalValue: string;
}

export interface StockEntryLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  tracking: 'none' | 'batch' | 'serial';
  uomCode: string;
  qty: string;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  batchId: string | null;
  batchNo: string | null;
  newBatchNo: string | null;
  heatNo: string | null;
  expiryDate: string | null;
  rate: string | null;
  value: string | null;
  remarks: string | null;
  ownerPartyId: string | null;
  wasteCategory: string | null;
  poLineId: string | null;
}

export interface StockEntryDetail {
  id: string;
  number: string | null;
  purpose: StockPurpose;
  status: DocStatus;
  postingDate: string;
  partyId: string | null;
  reference: string | null;
  remarks: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  ownerPartyId: string | null;
  ownerName: string | null;
  purchaseOrderId: string | null;
  systemGenerated: boolean;
  lines: StockEntryLine[];
}

export interface BalanceRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  uomCode: string;
  reorderLevel: string | null;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  warehouseType: string;
  batchId: string | null;
  batchNo: string | null;
  heatNo: string | null;
  expiryDate: string | null;
  qty: string;
  value: string;
  ownership: 'company' | 'customer';
  ownerPartyId: string | null;
  ownerName: string | null;
}

export interface LedgerRow {
  seq: number;
  postingDate: string;
  warehouseCode: string;
  batchNo: string | null;
  heatNo: string | null;
  ownerName: string | null;
  qty: string;
  rate: string;
  value: string;
  isReversal: boolean;
  voucherType: string;
  voucherId: string;
  voucherNumber: string | null;
  purpose: StockPurpose | null;
  balanceQty: string;
  balanceValue: string;
}

// ---- Customer material & waste (decisions 024, 025) ----
export interface WasteMovement {
  id: string;
  kind: 'generated' | 'disposed';
  movementDate: string;
  category: string;
  material: string;
  qty: string;
  uomCode: string;
  ownerPartyId: string | null;
  ownerName: string | null;
  hazardous: boolean;
  sourceRef: string | null;
  stockEntryId: string | null;
  stockEntryNumber: string | null;
  disposalMethod: string | null;
  counterpartyName: string | null;
  documentNo: string | null;
  consentRef: string | null;
  remarks: string | null;
  createdByName: string;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface WasteBalance {
  category: string;
  material: string;
  ownerPartyId: string | null;
  ownerName: string | null;
  uomCode: string;
  hazardous: boolean;
  generated: string;
  disposed: string;
  balance: string;
  firstGenerated: string | null;
}

export interface CustomerStatement {
  customer: { id: string; name: string; gstin: string | null; code: string };
  from: string;
  to: string;
  items: {
    itemId: string;
    itemCode: string;
    itemName: string;
    uomCode: string;
    batchNo: string | null;
    heatNo: string | null;
    opening: string;
    received: string;
    consumed: string;
    returned: string;
    scrapped: string;
    adjusted: string;
    closing: string;
  }[];
  movements: { postingDate: string; number: string | null; entryId: string; purpose: StockPurpose; reference: string | null; itemCode: string; batchNo: string | null; qty: string; isReversal: boolean }[];
  waste: { category: string; material: string; uomCode: string; opening: string; generated: string; returned: string; disposedWithConsent: string; pending: string }[];
}

export interface TaxPreview {
  kind: 'intra' | 'inter' | 'zero_rated' | 'customs';
  reverseCharge: boolean;
  lines: { taxableValue: string; igst: string; cgst: string; sgst: string; cess: string }[];
  taxableValue: string;
  igst: string;
  cgst: string;
  sgst: string;
  cess: string;
  totalTax: string;
  invoiceTotal: string;
  notes: string[];
  gstRates: string[];
}

export interface PurchaseOrderRow {
  id: string;
  number: string | null;
  status: DocStatus;
  closedAt: string | null;
  orderDate: string;
  expectedDate: string | null;
  supplierId: string;
  supplierName: string;
  grandTotal: string | null;
  currency: string;
  orderedQty: string;
  receivedQty: string;
  billedQty: string;
}

export interface PurchaseOrderLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  tracking: 'none' | 'batch' | 'serial';
  uomCode: string;
  requiresInspection: boolean;
  description: string | null;
  qty: string;
  rate: string;
  gstRate: string;
  taxableValue: string | null;
  receivedQty: string;
  billedQty: string;
  pendingQty: string;
  unbilledQty: string;
}

export interface PurchaseOrderDetail {
  id: string;
  number: string | null;
  status: DocStatus;
  closedAt: string | null;
  supplierId: string;
  supplierName: string;
  gstRegistrationId: string | null;
  orderDate: string;
  expectedDate: string | null;
  supplierQuoteRef: string | null;
  paymentTermsDays: number | null;
  remarks: string | null;
  currency: string;
  exchangeRate: string;
  taxableValue: string | null;
  totalTax: string | null;
  grandTotal: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: PurchaseOrderLine[];
  receipts: { id: string; number: string | null; status: DocStatus; postingDate: string; reference: string | null }[];
  invoices: { id: string; number: string | null; status: DocStatus; supplierInvoiceNo: string; grandTotal: string | null }[];
}

export interface PendingInspection {
  receiptLineId: string;
  receiptId: string;
  receiptNumber: string;
  postingDate: string;
  reference: string | null;
  supplierName: string | null;
  ownerName: string | null;
  itemId: string;
  itemCode: string;
  itemName: string;
  uomCode: string;
  batchNo: string | null;
  heatNo: string | null;
  warehouseId: string;
  warehouseCode: string;
  qty: string;
  inspected: string;
  pending: string;
}

export interface InspectionRow {
  id: string;
  number: string | null;
  status: DocStatus;
  inspectionDate: string;
  result: 'accepted' | 'rejected' | 'partial' | null;
  qtyInspected: string;
  qtyAccepted: string;
  qtyRejected: string;
  checks: string | null;
  remarks: string | null;
  cancelReason: string | null;
  itemCode: string;
  itemName: string;
  batchNo: string | null;
  receiptNumber: string;
  transferEntryId: string | null;
  inspectorName: string;
}

export interface PurchaseInvoiceRow {
  id: string;
  number: string | null;
  status: DocStatus;
  supplierName: string;
  supplierInvoiceNo: string;
  supplierInvoiceDate: string;
  postingDate: string;
  dueDate: string | null;
  msmeCategory: string | null;
  reverseCharge: boolean;
  taxableValue: string | null;
  totalTax: string | null;
  grandTotal: string | null;
  currency: string;
  poNumber: string | null;
}

export interface PurchaseInvoiceLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  uomCode: string;
  poLineId: string | null;
  poRate: string | null;
  hsnCode: string | null;
  qty: string;
  rate: string;
  gstRate: string;
  taxableValue: string | null;
  igst: string | null;
  cgst: string | null;
  sgst: string | null;
  cess: string | null;
}

export interface PurchaseInvoiceDetail {
  id: string;
  number: string | null;
  status: DocStatus;
  supplierId: string;
  supplierName: string;
  supplierGstin: string | null;
  gstRegistrationId: string | null;
  purchaseOrderId: string | null;
  poNumber: string | null;
  supplierInvoiceNo: string;
  supplierInvoiceDate: string;
  postingDate: string;
  supplyType: string;
  reverseCharge: boolean;
  itcEligible: boolean;
  dueDate: string | null;
  msmeCategory: string | null;
  currency: string;
  exchangeRate: string;
  taxableValue: string | null;
  igst: string | null;
  cgst: string | null;
  sgst: string | null;
  cess: string | null;
  totalTax: string | null;
  grandTotal: string | null;
  remarks: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: PurchaseInvoiceLine[];
}

// ---- Imports & landed cost (decisions 026–028) ----
export type LandedChargeType = 'bcd' | 'sws' | 'other_duty' | 'freight' | 'insurance' | 'clearing' | 'port' | 'other';
export type AllocationBasis = 'value' | 'qty' | 'weight';

export interface LandedCostRow {
  id: string;
  number: string | null;
  status: DocStatus;
  postingDate: string;
  boeNo: string | null;
  boeDate: string | null;
  totalCharges: string | null;
  onHandValue: string | null;
  varianceValue: string | null;
  importIgst: string | null;
  receipts: string | null;
}

export interface LandedCostReceiptOption {
  id: string;
  number: string;
  postingDate: string;
  reference: string | null;
  supplierName: string | null;
  poNumber: string | null;
  poCurrency: string | null;
  value: string;
  landedCostCount: number;
}

export interface LandedCostAllocationLine {
  receiptLineId: string;
  receiptId: string;
  receiptNumber: string;
  itemCode: string;
  itemName: string;
  uomCode: string;
  batchNo: string | null;
  qty: string;
  value: string;
  charges: string[];
  total: string;
  qtyRemaining: string;
  oldRate?: string;
  newRate?: string;
  onHandValue?: string;
  varianceValue?: string;
}

export interface LandedCostCharge {
  id: string;
  lineNo: number;
  chargeType: LandedChargeType;
  description: string | null;
  partyId: string | null;
  partyName: string | null;
  documentNo: string | null;
  amount: string;
  basis: AllocationBasis;
}

export interface LandedCostDetail {
  id: string;
  number: string | null;
  status: DocStatus;
  postingDate: string;
  boeNo: string | null;
  boeDate: string | null;
  portCode: string | null;
  customsExchangeRate: string | null;
  assessableValue: string | null;
  importIgst: string | null;
  importCess: string | null;
  customsItcEligible: boolean | null;
  remarks: string | null;
  totalCharges: string | null;
  onHandValue: string | null;
  varianceValue: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  receiptIds: string[];
  charges: LandedCostCharge[];
  allocation: LandedCostAllocationLine[];
  allocationError: string | null;
  roundingValue: string;
}
