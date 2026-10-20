import { jsonb, text } from 'drizzle-orm/pg-core';

/** Decision 075: where a document came from. Tally documents keep Tally's GUID, number and amounts. */
export interface TallyTaxDifference {
  expected: Record<'cgst' | 'sgst' | 'igst' | 'cess', string>;
  tally: Record<'cgst' | 'sgst' | 'igst' | 'cess', string>;
}
export const tallySource = () => ({
  /** factoryos (entered here) or tally (created from an imported Tally voucher). */
  source: text('source').notNull().default('factoryos'),
  tallyGuid: text('tally_guid'),
  /** Set when FactoryOS's GST calculation differs from the tax on the Tally voucher; Tally's figures stand. */
  taxDifference: jsonb('tax_difference').$type<TallyTaxDifference>(),
});

/** A note line as Tally gave it, kept on a note from Tally that has no FactoryOS invoice lines to point at (075a). */
export interface TallyNoteLine {
  itemId: string;
  hsnCode: string | null;
  qty: string;
  rate: string;
  gstRate: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
}
/** Decision 075a: a note from Tally is a value note; its original invoice is linked when it is a FactoryOS document. */
export const tallyNoteSource = () => ({
  ...tallySource(),
  /** Tally's Agst Ref bill, kept as text when the invoice is not a FactoryOS document (e.g. before the cut-over). */
  tallyBillReference: text('tally_bill_reference'),
  tallyLines: jsonb('tally_lines').$type<TallyNoteLine[]>(),
});
