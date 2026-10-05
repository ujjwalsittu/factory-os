export interface BillBalance {
  id: string;
  partyId: string;
  side: 'receivable' | 'payable';
  accountId: string;
  reference: string;
  sourceType: string;
  sourceId: string;
  currency: string;
  recognitionDate: string;
  dueDate: string | null;
  openAmount: string;
  carryingInr: string;
  msmeCategory: string | null;
}
export interface AllocationInput {
  billId: string;
  amount: string;
}
export interface SettlementInput {
  direction: 'receipt' | 'payment';
  partyId: string;
  postingDate: string;
  currency: string;
  exchangeRate: string;
  accountId: string;
  amount: string;
  bankReference: string;
  narration: string;
  allocations: AllocationInput[];
}
export interface LaterAllocationInput {
  settlementId: string;
  postingDate: string;
  reason: string;
  allocations: AllocationInput[];
}
export interface SettlementPreview {
  amount: string;
  allocated: string;
  unapplied: string;
  cashInr: string;
  carryingInr: string;
  forexInr: string;
  roundingInr: string;
  lines: {
    accountId: string;
    debit: string;
    credit: string;
    partyId?: string;
    billReference?: string;
  }[];
}
export interface AllocationDocument {
  id: string;
  number: string | null;
  status: 'draft' | 'submitted' | 'cancelled';
  draft: LaterAllocationInput;
  voucherId: string | null;
  cancelReason: string | null;
}
export interface AllocationEffect {
  id: string;
  billId: string;
  allocationDocumentId: string | null;
  amount: string;
  carryingInr: string;
  sourceCarryingInr: string;
  reversalOf: string | null;
  billReference?: string;
}
export interface SettlementDocument {
  id: string;
  number: string | null;
  status: 'draft' | 'submitted' | 'cancelled';
  draft: SettlementInput;
  voucherId: string | null;
  onAccountBillId: string | null;
  cancelReason: string | null;
  postedPreview?: SettlementPreview | null;
  partyName?: string;
  accountName?: string;
  available?: { amount: string; carryingInr: string };
  allocationDocuments?: AllocationDocument[];
  allocationEffects?: AllocationEffect[];
}
export interface SettlementChoices {
  active: boolean;
  cutoverDate: string | null;
  parties: {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    isCustomer: boolean;
    isSupplier: boolean;
  }[];
  accounts: { id: string; code: string; name: string; isActive: boolean }[];
}
export interface OutstandingReport {
  active: boolean;
  cutoverDate: string | null;
  asOf: string;
  msmeBasis: string;
  rows: (BillBalance & {
    partyName: string;
    ageDays: number | null;
    ageingBucket: string;
    kind: string;
  })[];
  positions: {
    partyId: string;
    partyName: string;
    side: string;
    grossOpenInr: string;
    onAccountInr: string;
    netInr: string;
  }[];
}
