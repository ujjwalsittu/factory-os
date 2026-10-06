import { taxFormLabels } from './withholding-profiles.js';
import type { Money, SettlementComponentInput, SettlementComponentResult, TaxCalculation, TaxCounterState, TaxProfileRevision, TaxSourceEvidence } from './withholding-types.js';

const SCALE = 1_000_000n;
/** Bound inputs like numeric(24,6), without permissive float parsing or silent truncation. */
function amount(value: Money): bigint {
  if (!/^\d{1,18}(?:\.\d{1,6})?$/.test(value)) throw new Error('Invalid non-negative decimal amount');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * SCALE + BigInt(fraction.padEnd(6, '0'));
}
function fixed(value: bigint): Money {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(6, '0')}`;
}
function rounded(numerator: bigint, denominator: bigint, halfUp: boolean): bigint {
  const q = numerator / denominator;
  return halfUp && (numerator % denominator) * 2n >= denominator ? q + 1n : q;
}
function rate(value: Money): bigint {
  const n = amount(value);
  if (n > 100n * SCALE) throw new Error('Invalid percentage rate');
  return n;
}
function validDate(value: string): void { taxFormLabels(value); }
function taxYear(date: string): string {
  const start = Number(date.slice(0, 4)) - (date.slice(5, 7) < '04' ? 1 : 0);
  return `${start}-${String(start + 1).slice(-2)}`;
}
const max = (a: bigint, b: bigint): bigint => a > b ? a : b;

export function calculateWithholding(profile: TaxProfileRevision, source: TaxSourceEvidence, state: TaxCounterState): TaxCalculation {
  if (profile.status !== 'verified' || !profile.sourceDigest || !profile.tableItem) throw new Error('A verified profile is required');
  validDate(source.eventDate); validDate(profile.effectiveFrom);
  if (profile.effectiveTo !== null) validDate(profile.effectiveTo);
  if (source.eventDate < profile.effectiveFrom || (profile.effectiveTo !== null && source.eventDate > profile.effectiveTo)) throw new Error('Profile is outside its effective period');
  if (taxFormLabels(source.eventDate).act !== profile.act) throw new Error('Profile Act does not match original event');
  if (source.currency !== 'INR' || amount(source.exchangeRate) !== SCALE) throw new Error('Tax components support INR at exchange rate 1 only');
  if (!source.historyReviewed) throw new Error('Reviewed tax source history is required');
  if (profile.residence !== source.residence || profile.paymentNature !== source.paymentNature || !source.paymentNature) throw new Error('Reviewed applicability does not match source');
  if (!source.taxpayerIdentity || source.taxpayerIdentity !== state.taxpayerIdentity) throw new Error('Taxpayer identity mismatch');
  if (state.taxYear !== taxYear(source.eventDate)) throw new Error('Tax year mismatch');
  if (state.latestEventDate !== null) {
    validDate(state.latestEventDate);
    if (source.eventDate < state.latestEventDate) throw new Error('Backdated tax counter event requires reviewed recalculation');
  }
  if (![0, 2, 6].includes(profile.roundingPlaces) || !['half-up', 'down'].includes(profile.roundingMode)) throw new Error('Unsupported rounding policy');
  const gross = amount(source.grossBase), gst = amount(source.gst);
  if (gst > gross) throw new Error('GST exceeds source gross base');
  const eligible = gross - (profile.excludeGst ? gst : 0n);
  const consumed = amount(state.sourceConsumedBase), before = amount(state.cumulativeEligibleBase), backlog = amount(state.untaxedEligibleBase);
  if (consumed > eligible || consumed > before) throw new Error('Previously consumed base exceeds source/cumulative evidence');
  if (backlog > before) throw new Error('Untaxed base exceeds cumulative evidence');
  const newlyEligible = eligible - consumed, after = before + newlyEligible;
  const single = profile.singleThreshold === null ? null : amount(profile.singleThreshold);
  const cumulative = profile.cumulativeThreshold === null ? null : amount(profile.cumulativeThreshold);
  if (profile.thresholdBasis === 'excess' && (cumulative === null || single !== null)) throw new Error('Excess basis requires one cumulative threshold');
  const triggered = (single === null && cumulative === null) || (single !== null && eligible > single) || (cumulative !== null && after > cumulative);
  let taxable = 0n;
  if (newlyEligible > 0n && triggered) {
    taxable = profile.thresholdBasis === 'excess'
      ? max(after - cumulative!, 0n) - max(before - cumulative!, 0n)
      : newlyEligible + backlog;
  }
  let appliedRate = rate(profile.ratePercent);
  if (source.panStatus === 'unknown') throw new Error('Reviewed PAN status is required');
  if (source.panStatus !== 'valid') {
    if (profile.higherPanRatePercent === null) throw new Error('Verified missing/inoperative PAN treatment is required');
    appliedRate = max(appliedRate, rate(profile.higherPanRatePercent));
  }
  const certificate = state.certificate;
  if (certificate !== null) {
    validDate(certificate.validFrom); validDate(certificate.validTo);
    if (!profile.certificateAllowed || source.panStatus !== 'valid' || source.eventDate < certificate.validFrom || source.eventDate > certificate.validTo) throw new Error('Invalid or expired certificate for this source');
    if (taxable > amount(certificate.remainingBase)) throw new Error('Certificate base capacity exhausted; reviewed split required');
    appliedRate = rate(certificate.ratePercent);
  }
  // Multiply before rounding: pre-rounding to six decimals can change half-paise outcomes.
  const numerator = taxable * appliedRate;
  const denominator = 100n * SCALE;
  const unit = 10n ** BigInt(6 - profile.roundingPlaces);
  const tax = rounded(numerator, denominator * unit, profile.roundingMode === 'half-up') * unit;
  if (certificate?.remainingTax !== null && certificate?.remainingTax !== undefined && tax > amount(certificate.remainingTax)) throw new Error('Certificate tax capacity exhausted; reviewed split required');
  const representedUnrounded = rounded(numerator, denominator, true);
  return {
    act: profile.act, profileId: profile.id, profileRevision: profile.revision,
    certificateId: certificate?.id ?? null, certificateRevision: certificate?.revision ?? null,
    eligibleBase: fixed(eligible), previouslyConsumedBase: fixed(consumed), newEligibleBase: fixed(newlyEligible), taxableBase: fixed(taxable),
    cumulativeAfter: fixed(after), remainingUntaxedBase: fixed(newlyEligible === 0n ? backlog : profile.thresholdBasis === 'whole' && triggered ? 0n : backlog + newlyEligible - taxable),
    ratePercent: fixed(appliedRate), tax: fixed(tax), roundingAdjustment: fixed(tax - representedUnrounded),
    explanation: newlyEligible === 0n ? 'already-consumed' : !triggered ? 'below-threshold' : profile.thresholdBasis === 'whole' ? 'whole-base' : 'excess-base',
  };
}

export function calculateSettlementComponents(input: SettlementComponentInput): SettlementComponentResult {
  if (input.currency !== 'INR') throw new Error('New settlement components support INR only');
  const principal = amount(input.principal), tax = amount(input.newTax), charge = amount(input.charge), allocated = amount(input.allocated);
  if (principal === 0n) throw new Error('Settlement principal must be positive; use standalone tax advice');
  if (input.direction !== 'receipt' && input.direction !== 'payment') throw new Error('Invalid settlement direction');
  if (input.direction === 'receipt' && charge > principal) throw new Error('Receipt charge exceeds principal');
  const clearing = principal + tax;
  if (allocated > clearing) throw new Error('Allocation exceeds bill settlement value');
  if (allocated < tax && !(input.direction === 'payment' && input.reviewedAdvance === true && allocated === 0n)) throw new Error('Tax requires bill allocation or a reviewed supplier advance');
  const cashAllocated = max(allocated - tax, 0n);
  return {
    billSettlement: fixed(clearing), bankMovement: fixed(input.direction === 'receipt' ? principal - charge : principal + charge),
    cashUnapplied: fixed(principal - cashAllocated),
  };
}
