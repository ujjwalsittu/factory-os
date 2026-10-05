export interface Account {
  id: string;
  code: string;
  name: string;
  groupId: string;
  role: string | null;
  isActive: boolean;
}
export interface AccountGroup {
  id: string;
  name: string;
  root: string;
  parentId: string | null;
}
export interface AccountingSettings {
  active: boolean;
  cutoverDate: string | null;
  activatedAt: string | null;
  openingVoucherId: string | null;
  mappings: Record<string, string>;
}
export interface JournalLine {
  accountId: string;
  debit: string;
  credit: string;
  partyId?: string;
  billReference?: string;
}
export interface Entry extends JournalLine {
  id: string;
  voucherId: string;
  postingDate: string;
  number?: string;
  narration?: string;
  balance?: string;
}
export interface Journal {
  id: string;
  number: string | null;
  status: 'draft' | 'submitted' | 'cancelled';
  postingDate: string;
  narration: string;
  sourceType: string;
  sourceId: string;
  sourceNumber: string | null;
  purpose: string;
  currency: string;
  exchangeRate: string;
  draftLines: JournalLine[];
  entries?: Entry[];
  reversalOf: string | null;
  reversal?: Journal | null;
  clearingSourceId?: string | null;
  debit?: string;
  credit?: string;
}
export interface OpeningBill {
  partyId: string;
  reference: string;
  side: 'debit' | 'credit';
  amount: string;
  invoiceId?: string;
  currency?: string;
  exchangeRate?: string;
  originalAmount?: string;
}
export interface ReceiptBaseline {
  receiptLineId: string;
  qty: string;
  baseCost: string;
}
export interface Settlement {
  invoiceId: string;
  amount: string;
  reason: string;
}
export interface Worksheet {
  id: string;
  lines: JournalLine[];
  bills: OpeningBill[];
  receiptBaselines: ReceiptBaseline[];
  settlements: Settlement[];
}
export interface Reconciliation {
  worksheetId: string | null;
  snapshotToken: string;
  inventoryValue: string;
  grniValue: string;
  receiptBaselines: ReceiptBaseline[];
  cutoverDate: string;
  invoices: {
    id: string;
    partyId: string;
    side: 'debit' | 'credit';
    number: string;
    amount: string;
    currency: string;
    exchangeRate?: string;
    originalAmount?: string;
    remaining?: string;
  }[];
  differences: {
    control: string;
    expected: string;
    declared: string;
    difference: string;
  }[];
}
export interface TrialBalance {
  accounts: (Account & {
    opening: string;
    debit: string;
    credit: string;
    balance: string;
  })[];
  debit: string;
  credit: string;
}
export interface Ledger {
  account: Account;
  entries: Entry[];
  opening: string;
  closing: string;
}
export const emptyLine = (): JournalLine => ({
  accountId: '',
  debit: '0',
  credit: '0',
});
export const sourceHref = (v: Journal): string | null => {
  if (v.sourceType === 'stock_entry')
    return `/app/inventory/entries/${v.sourceId}`;
  if (v.sourceType === 'purchase_invoice')
    return `/app/buying/invoices/${v.sourceId}`;
  if (v.sourceType === 'sales_invoice')
    return `/app/selling/invoices/${v.sourceId}`;
  if (v.sourceType === 'landed_cost')
    return `/app/buying/landed-costs/${v.sourceId}`;
  return null;
};

export interface AccountingStatus {
  active: boolean;
  cutoverDate: string | null;
  activatedAt: string | null;
}
export interface SourceAccountingStatus {
  state:
    | 'inactive'
    | 'draft'
    | 'historical'
    | 'posted'
    | 'no_value_change'
    | 'missing';
  active: boolean;
  cutoverDate: string | null;
  reason: string | null;
  vouchers: Journal[];
}
