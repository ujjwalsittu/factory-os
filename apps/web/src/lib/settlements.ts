// AR/AP settlements (decision 036). Mirrors the API types; all money is decimal strings, arithmetic stays on the server.
import type { DocStatus } from './types';

export type Direction = 'receipt' | 'payment';
export type TradeSide = 'receivable' | 'payable';
export const sideOf = (d: Direction): TradeSide => (d === 'receipt' ? 'receivable' : 'payable');

export interface BillBalance {
  id: string;
  kind: 'bill' | 'advance' | 'journal_credit';
  partyId: string;
  partyName?: string;
  side: TradeSide;
  accountId: string;
  reference: string;
  sourceType: string;
  sourceId: string | null;
  currency: string;
  originalAmount: string;
  recognitionDate: string;
  dueDate: string | null;
  msmeCategory: string | null;
  openAmount: string;
  carryingInr: string;
  overdueDays?: number;
  bucket?: string;
  msmeUnclassified?: boolean;
}
export interface AllocationDraft {
  billId: string;
  amount: string;
}
export interface SettlementInput {
  direction: Direction;
  partyId: string;
  postingDate: string;
  currency: string;
  exchangeRate: string;
  accountId: string;
  amount: string;
  bankReference: string | null;
  narration: string | null;
  allocations: AllocationDraft[];
}
export interface SettlementPreview {
  amount: string;
  allocated: string;
  unapplied: string;
  cashInr: string;
  carryingInr: string;
  forexInr: string;
  disposition: 'posted' | 'no_value_change';
  allocations: (AllocationDraft & { reference: string; openAmount: string; carryingInr: string })[];
}
export interface Settlement extends Omit<SettlementInput, 'allocations'> {
  id: string;
  number: string | null;
  status: DocStatus;
  partyName: string;
  accountName: string;
  voucherId: string | null;
  allocated?: string;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  allocations: (AllocationDraft & { reference?: string | null })[];
  advance?: BillBalance | null;
  laterAllocations?: { id: string; number: string | null; status: DocStatus; postingDate: string; reason: string; voucherId: string | null; allocations: AllocationDraft[] }[];
  vouchers?: { id: string; number: string | null; reversalOf: string | null }[];
}
export interface Outstanding {
  side: TradeSide;
  asOf: string;
  bills: BillBalance[];
  onAccount: BillBalance[];
  buckets: { key: string; label: string; inr: string }[];
  totals: { grossInr: string; onAccountInr: string; netInr: string };
  note: string | null;
}
export interface TradeReconciliationRow {
  accountId: string;
  partyId: string | null;
  partyName: string | null;
  side: TradeSide;
  glInr: string;
  subledgerInr: string;
  difference: string;
}
export const DIRECTION_LABEL: Record<Direction, string> = { receipt: 'Customer receipt', payment: 'Supplier payment' };
