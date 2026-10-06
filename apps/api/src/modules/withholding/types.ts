import type { TaxCalculation, TaxCounterState, TaxProfileRevision, TaxSourceEvidence } from '@factoryos/compliance-in';
import type { AccountingLine } from '@factoryos/core';
import type { taxConfiguration, taxRemittance } from '@factoryos/db';
export interface TaxSnapshot {
  profile: TaxProfileRevision;
  source: TaxSourceEvidence;
  state: TaxCounterState;
  calculation: TaxCalculation;
  counterRevision: string;
}
export interface TaxPreview {
  snapshot: TaxSnapshot;
  previewHash: string;
  lines: AccountingLine[];
  billEffects: { billId:string; amount:string }[];
}
export interface RecognizedTax {
  assessmentId: string;
  eventId: string;
  amount: string;
  snapshot: Record<string,unknown>;
  billEffects: { billId:string; amount:string }[];
}
export interface TaxActivationInput { date:string; openingId:string; reviewedHash:string; }
export type TaxConfiguration = typeof taxConfiguration.$inferSelect;
export interface TaxAdviceInput {
  direction: 'customer_tds'|'supplier_tcs'; partyId:string; postingDate:string; amount:string; reference:string;
  evidence: { document:string; reason:string }; allocations:{billId:string;amount:string}[];
}
export interface TaxRemittanceInput {
  postingDate:string; tan:string; act:'1961'|'2025'; taxYear:string; category:'tds'|'tcs'; period:string;
  reference:string; amount:string; bankAccountId:string; evidence:{document:string;reason:string}; allocations:{eventId:string;amount:string}[];
}
export type TaxRemittance = typeof taxRemittance.$inferSelect;
export interface TaxCorrectionInput {
  originalEventId:string; postingDate:string; reason:string; evidence:{document:string}; baseDelta:string; taxDelta:string;
}
