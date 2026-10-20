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
