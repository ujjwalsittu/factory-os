import type { BadgeTone } from '@factoryos/ui';

/** Shapes of the GST returns API (decision 074). Figures are decimal strings in INR. */
export type Taxes = { igst: string; cgst: string; sgst: string; cess: string };
export type Amounts = Taxes & { taxable: string };
export type ReturnKind = 'gstr1' | 'gstr3b';
export type ReturnStatus = 'draft' | 'reviewed' | 'approved' | 'filed';

export interface Gstr1Entry {
  section: 'b2b' | 'b2cl' | 'exp' | 'cdnr' | 'cdnur';
  documentId: string;
  documentType: 'invoice' | 'credit_note' | 'debit_note';
  number: string;
  date: string;
  counterpartyGstin: string | null;
  placeOfSupply: string | null;
  subtype: string | null;
  reverseCharge: boolean;
  value: string;
  amounts: Amounts;
}
export interface Attention {
  documentId: string;
  documentType: 'invoice' | 'credit_note' | 'debit_note';
  number: string;
  reason: string;
  blocking: boolean;
}
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
export interface Gstr1 {
  entries: Gstr1Entry[];
  b2cs: (Amounts & { placeOfSupply: string; rate: string })[];
  nil: { table: string; nil: string }[];
  hsn: (Amounts & { part: 'b2b' | 'b2c'; hsn: string; uqc: string; rate: string; qty: string })[];
  attention: Attention[];
  totals: Record<'b2b' | 'b2cl' | 'b2cs' | 'exp' | 'cdnr' | 'cdnur', Amounts>;
  documents: { nature: string; series: string; from: string; to: string; total: number; cancelled: number; gaps: string[] }[];
}
export interface Gstr3b {
  '3.1': Record<'a' | 'b' | 'c' | 'd' | 'e', Amounts>;
  '3.2': { placeOfSupply: string; unregistered: { taxable: string; igst: string }; composition: { taxable: string; igst: string } }[];
  '4': Record<'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'b1' | 'b2' | 'c' | 'd1' | 'd2', Taxes>;
  '5': { compositionExemptNil: { inter: string; intra: string }; nonGst: { inter: string; intra: string } };
  '6.1': Taxes;
}
export interface Preview {
  gstr1: Gstr1;
  gstr3b: Gstr3b;
  checks: Check[];
  attention: Attention[];
}
export interface ReturnRow {
  id: string;
  gstRegistrationId: string;
  gstin: string;
  period: string;
  kind: ReturnKind;
  status: ReturnStatus;
  preparedAt: string;
  arn: string | null;
  filedOn: string | null;
}
export interface ReturnLine {
  id: string;
  section: string;
  documentType: string;
  documentId: string;
  documentNumber: string;
  documentDate: string;
  late: string | null;
}
export interface ReturnDetail extends ReturnRow {
  snapshot: { gstr1?: Gstr1; gstr3b?: Gstr3b; checks: Check[]; attention?: Attention[] };
  snapshotHash: string;
  preparedBy: string;
  reviewedAt: string | null;
  approvedAt: string | null;
  filedAt: string | null;
  lines: ReturnLine[];
  changedSinceFiling: { documentId: string; documentType: string; number: string; what: string }[];
}

export const KIND_LABEL: Record<ReturnKind, string> = { gstr1: 'GSTR-1', gstr3b: 'GSTR-3B' };
export const STATUS: Record<ReturnStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  reviewed: { label: 'Reviewed', tone: 'info' },
  approved: { label: 'Approved', tone: 'accent' },
  filed: { label: 'Filed', tone: 'success' },
};
export const SECTION_LABEL: Record<string, string> = {
  b2b: 'B2B · registered buyers (4A, 4B, 6B, 6C)',
  b2cl: 'B2CL · large inter-State to unregistered (5)',
  exp: 'EXP · exports (6A)',
  cdnr: 'CDNR · notes to registered buyers (9B)',
  cdnur: 'CDNUR · notes to unregistered buyers (9B)',
  summary: 'B2CS and nil-rated (summarised)',
  outward: 'Outward documents read for 3B',
  inward: 'Inward documents read for 3B',
};

/** The page of a document a return line or entry points to. */
export function documentHref(type: string, id: string): string {
  switch (type) {
    case 'sales_invoice':
    case 'invoice':
      return `/app/selling/invoices/${id}`;
    case 'sales_note':
    case 'credit_note':
    case 'debit_note':
      return `/app/selling/notes/${id}`;
    case 'purchase_invoice':
      return `/app/buying/invoices/${id}`;
    case 'supplier_note':
      return `/app/buying/supplier-notes/${id}`;
    case 'landed_cost':
      return `/app/buying/landed-costs/${id}`;
    default:
      return '/app/accounts/bank-charges';
  }
}

/** Months from `back` before the current one to the current one, newest first, as YYYY-MM. */
export function recentMonths(today: string, back = 18): string[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: back + 1 }, (_, k) => {
    const t = y * 12 + (m - 1) - k;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
  });
}

export const monthLabel = (period: string) => new Date(`${period}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

/**
 * Common GST Unit Quantity Codes for the HSN summary. The full list lives with the GST offline tool, which is not yet
 * pinned (decision 074a); check against it before filing.
 */
export const UQC_CODES: [string, string][] = [
  ['NOS', 'Numbers'],
  ['PCS', 'Pieces'],
  ['SET', 'Sets'],
  ['PAC', 'Packs'],
  ['BOX', 'Box'],
  ['ROL', 'Rolls'],
  ['KGS', 'Kilograms'],
  ['GMS', 'Grams'],
  ['TON', 'Tonnes'],
  ['MTR', 'Metres'],
  ['CMS', 'Centimetres'],
  ['SQM', 'Square metres'],
  ['CBM', 'Cubic metres'],
  ['LTR', 'Litres'],
  ['MLT', 'Millilitres'],
  ['OTH', 'Others'],
];
