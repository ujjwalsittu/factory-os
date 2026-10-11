// Decision 060: every service source bills the same way, alone (its own button) or with others on one invoice (a
// billing run). `prepare` reads what is due; `settle` runs inside the invoice transaction, re-checks the source under its
// lock and records the link to the invoice (null when nothing is invoiced, e.g. hours fully covered by a membership).
import type { Tx } from '../accounting/accounting-lock.js';

export type BillableKind = 'subscription' | 'booking' | 'milestone' | 'campaign';
/** Settle order inside one invoice transaction, so concurrent runs lock rows in the same order. */
export const BILLABLE_ORDER: Record<BillableKind, number> = { subscription: 0, booking: 1, milestone: 2, campaign: 3 };

export interface BillableLine {
  itemId: string;
  description: string;
  qty: string;
  rate: string;
}

export interface Billable {
  kind: BillableKind;
  sourceId: string;
  /** The source's number, for lists and errors. */
  label: string;
  customerId: string;
  /** Goes on the invoice as the customer's PO number; a run groups by customer and this. */
  customerRef: string | null;
  /** Remarks when the source is invoiced alone. */
  remarks: string;
  lines: BillableLine[];
  /** Before GST. */
  amount: string;
  settle: (tx: Tx, invoiceId: string | null) => Promise<void>;
}
