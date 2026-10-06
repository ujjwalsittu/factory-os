/** Pure contracts. API resolves legal applicability and supplies scoped stored evidence. */
export type Money = string;
export interface TaxProfileRevision {
  readonly id: string;
  readonly revision: string;
  readonly status: 'draft' | 'verified';
  readonly act: '1961' | '2025';
  readonly section: string;
  readonly tableItem: string;
  readonly legacyAlias: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly category: 'tds' | 'tcs';
  readonly residence: 'resident' | 'nonresident';
  readonly paymentNature: string;
  readonly ratePercent: Money;
  readonly higherPanRatePercent: Money | null;
  readonly excludeGst: boolean;
  readonly singleThreshold: Money | null;
  readonly cumulativeThreshold: Money | null;
  readonly thresholdBasis: 'whole' | 'excess';
  readonly roundingPlaces: 0 | 2 | 6;
  readonly roundingMode: 'half-up' | 'down';
  readonly sourceDigest: string;
  readonly certificateAllowed: boolean;
  readonly precedence: 'exclusive';
  readonly accounts: { readonly control: string; readonly tax: string; readonly rounding: string };
}
export interface TaxSourceEvidence {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly obligationId: string;
  readonly partyId: string;
  readonly taxpayerIdentity: string;
  /** Original earlier credit/payment event, not current correction date. */
  readonly eventDate: string;
  readonly currency: string;
  readonly exchangeRate: Money;
  readonly grossBase: Money;
  readonly gst: Money;
  readonly residence: 'resident' | 'nonresident';
  readonly paymentNature: string;
  readonly panStatus: 'valid' | 'missing' | 'inoperative' | 'unknown';
  readonly historyReviewed: boolean;
  readonly originalControlAccountId: string;
}
export interface TaxCertificateState {
  readonly id: string;
  readonly revision: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly ratePercent: Money;
  readonly remainingBase: Money;
  readonly remainingTax: Money | null;
}
export interface TaxCounterState {
  readonly taxpayerIdentity: string;
  readonly taxYear: string;
  readonly cumulativeEligibleBase: Money;
  /** Prior eligible base not yet recognized because of a threshold, at this rule's basis. */
  readonly untaxedEligibleBase: Money;
  /** Advance base already recognized for this same obligation. */
  readonly sourceConsumedBase: Money;
  readonly revision: string;
  readonly latestEventDate: string | null;
  readonly certificate: TaxCertificateState | null;
}
export interface TaxCalculation {
  readonly act: '1961' | '2025';
  readonly profileId: string;
  readonly profileRevision: string;
  readonly certificateId: string | null;
  readonly certificateRevision: string | null;
  readonly eligibleBase: Money;
  readonly previouslyConsumedBase: Money;
  readonly newEligibleBase: Money;
  readonly taxableBase: Money;
  readonly cumulativeAfter: Money;
  readonly remainingUntaxedBase: Money;
  readonly ratePercent: Money;
  readonly tax: Money;
  readonly roundingAdjustment: Money;
  readonly explanation: 'below-threshold' | 'already-consumed' | 'whole-base' | 'excess-base';
}
export interface SettlementComponentInput {
  readonly direction: 'receipt' | 'payment';
  readonly currency: string;
  readonly principal: Money;
  readonly newTax: Money;
  readonly charge: Money;
  readonly allocated: Money;
  readonly reviewedAdvance?: boolean;
}
export interface SettlementComponentResult {
  readonly billSettlement: Money;
  readonly bankMovement: Money;
  readonly cashUnapplied: Money;
}
