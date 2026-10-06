import { describe, expect, it } from 'vitest';
import { calculateSettlementComponents, calculateWithholding } from './withholding.js';
import type { TaxProfileRevision, TaxSourceEvidence, TaxCounterState } from './withholding-types.js';

// Synthetic percentages test arithmetic only; never packaged legal defaults.
const profile = (changes: Partial<TaxProfileRevision> = {}): TaxProfileRevision => ({
  id: 'synthetic-fixture', revision: '1', status: 'verified', act: '2025', section: '393', tableItem: 'fixture-only', legacyAlias: 'fixture',
  effectiveFrom: '2026-04-01', effectiveTo: null, category: 'tds', residence: 'resident', paymentNature: 'work',
  ratePercent: '1', higherPanRatePercent: '20', excludeGst: true,
  singleThreshold: '30000', cumulativeThreshold: '100000', thresholdBasis: 'whole', roundingPlaces: 2, roundingMode: 'half-up',
  sourceDigest: 'synthetic-not-statutory', certificateAllowed: true, precedence: 'exclusive', accounts: { control: 'ap', tax: 'tds', rounding: 'rounding' }, ...changes,
});
const source = (changes: Partial<TaxSourceEvidence> = {}): TaxSourceEvidence => ({
  sourceType: 'purchase_invoice', sourceId: 'invoice', obligationId: 'obligation', partyId: 'party', taxpayerIdentity: 'pan-identity',
  eventDate: '2026-10-06', currency: 'INR', exchangeRate: '1', grossBase: '23600', gst: '3600', residence: 'resident', paymentNature: 'work',
  panStatus: 'valid', historyReviewed: true, originalControlAccountId: 'ap', ...changes,
});
const state = (changes: Partial<TaxCounterState> = {}): TaxCounterState => ({
  taxpayerIdentity: 'pan-identity', taxYear: '2026-27', cumulativeEligibleBase: '0', untaxedEligibleBase: '0', sourceConsumedBase: '0',
  revision: '1', latestEventDate: null, certificate: null, ...changes,
});

describe('exact withholding engine', () => {
  it('duplicate_pan_threshold uses shared identity, not party ID', () => {
    const shared = state({ cumulativeEligibleBase: '90000', untaxedEligibleBase: '90000' });
    for (const partyId of ['party-one', 'party-two']) {
      expect(calculateWithholding(profile(), source({ partyId }), shared)).toMatchObject({ taxableBase: '110000.000000', tax: '1100.000000' });
    }
    expect(() => calculateWithholding(profile(), source(), state({ taxpayerIdentity: 'other-pan' }))).toThrow('identity');
  });
  it('threshold_whole_vs_excess', () => {
    const s = source({ grossBase: '20000', gst: '0' });
    const counter = state({ cumulativeEligibleBase: '90000', untaxedEligibleBase: '90000' });
    expect(calculateWithholding(profile(), s, counter).tax).toBe('1100.000000');
    expect(calculateWithholding(profile({ thresholdBasis: 'excess', singleThreshold: null }), s, counter).tax).toBe('100.000000');
    expect(calculateWithholding(profile(), source({ grossBase: '30000', gst: '0' }), state()).tax).toBe('0.000000');
    expect(calculateWithholding(profile(), source({ grossBase: '30000.01', gst: '0' }), state()).tax).toBe('300.000000');
  });
  it('single-event threshold leaves earlier small bases untaxed until cumulative crossing', () => {
    const first=calculateWithholding(profile(),source({grossBase:'35000',gst:'0'}),state({cumulativeEligibleBase:'20000',untaxedEligibleBase:'20000'}));
    expect(first).toMatchObject({taxableBase:'35000.000000',tax:'350.000000',remainingUntaxedBase:'20000.000000'});
    expect(calculateWithholding(profile(),source({grossBase:'60000',gst:'0'}),state({cumulativeEligibleBase:first.cumulativeAfter,untaxedEligibleBase:first.remainingUntaxedBase}))).toMatchObject({taxableBase:'80000.000000',tax:'800.000000',remainingUntaxedBase:'0.000000'});
  });
  it('gst_base_exclusion', () => {
    expect(calculateWithholding(profile({ singleThreshold: null, cumulativeThreshold: null }), source(), state())).toMatchObject({ eligibleBase: '20000.000000', tax: '200.000000' });
    expect(calculateWithholding(profile({ singleThreshold: null, cumulativeThreshold: null, excludeGst: false }), source(), state()).tax).toBe('236.000000');
  });
  it('certificate_capacity_and_expiry', () => {
    const cert = { id: 'certificate', revision: '1', validFrom: '2026-04-01', validTo: '2027-03-31', ratePercent: '0.5', remainingBase: '20000', remainingTax: '100' };
    const p = profile({ singleThreshold: null, cumulativeThreshold: null });
    expect(calculateWithholding(p, source(), state({ certificate: cert })).tax).toBe('100.000000');
    expect(calculateWithholding(p, source(), state({ certificate: { ...cert, ratePercent: '0' } })).tax).toBe('0.000000');
    expect(() => calculateWithholding(p, source(), state({ certificate: { ...cert, remainingBase: '19999.99' } }))).toThrow('capacity');
    expect(() => calculateWithholding(p, source(), state({ certificate: { ...cert, remainingTax: '99' } }))).toThrow('capacity');
    expect(() => calculateWithholding(p, source(), state({ certificate: { ...cert, validTo: '2026-10-05' } }))).toThrow('certificate');
  });
  it('pan_higher_rate', () => {
    const p = profile({ singleThreshold: null, cumulativeThreshold: null });
    for (const panStatus of ['missing', 'inoperative'] as const) expect(calculateWithholding(p, source({ panStatus }), state()).tax).toBe('4000.000000');
    expect(() => calculateWithholding(p, source({ panStatus: 'unknown' }), state())).toThrow('PAN');
    expect(() => calculateWithholding(profile({ ...p, higherPanRatePercent: null }), source({ panStatus: 'missing' }), state())).toThrow('PAN');
  });
  it('earlier_event_and_transition', () => {
    expect(calculateWithholding(profile(), source(), state({ sourceConsumedBase: '20000', cumulativeEligibleBase: '20000' }))).toMatchObject({ newEligibleBase: '0.000000', tax: '0.000000' });
    const old = profile({ act: '1961', effectiveFrom: '2025-04-01', effectiveTo: '2026-03-31' });
    expect(calculateWithholding(old, source({ eventDate: '2026-03-31' }), state({ taxYear: '2025-26' })).act).toBe('1961');
    expect(() => calculateWithholding(profile(), source({ eventDate: '2026-03-31' }), state({ taxYear: '2025-26' }))).toThrow('effective');
    expect(() => calculateWithholding(profile(), source(), state({ sourceConsumedBase: '20001' }))).toThrow('consumed');
  });
  it('prior_year_advance_base_is_not_added_to_current_year_counter', () => {
    expect(calculateWithholding(profile(), source(), state({ sourceConsumedBase:'20000' }))).toMatchObject({ newEligibleBase:'0.000000', tax:'0.000000', cumulativeAfter:'0.000000' });
  });
  it('exact_rounding does not round intermediate rate multiplication', () => {
    const p = profile({ singleThreshold: null, cumulativeThreshold: null, ratePercent: '0.0001' });
    expect(calculateWithholding(p, source({ grossBase: '4999.999999', gst: '0' }), state())).toMatchObject({ tax: '0.000000', roundingAdjustment: '-0.005000' });
    expect(calculateWithholding(p, source({ grossBase: '5000', gst: '0' }), state()).tax).toBe('0.010000');
    expect(calculateWithholding(profile({ ...p, roundingMode: 'down' }), source({ grossBase: '9999.99', gst: '0' }), state()).tax).toBe('0.000000');
  });
  it('source history, chronology, statutory status and applicability must be known', () => {
    expect(() => calculateWithholding(profile({ status: 'draft' }), source(), state())).toThrow('verified');
    expect(() => calculateWithholding(profile(), source({ historyReviewed: false }), state())).toThrow('history');
    expect(() => calculateWithholding(profile(), source(), state({ latestEventDate: '2026-10-07' }))).toThrow('Backdated');
    expect(() => calculateWithholding(profile(), source({ paymentNature: 'unidentified' }), state())).toThrow('applicability');
    expect(() => calculateWithholding(profile(), source(), state({ taxYear: '2025-26' }))).toThrow('year');
  });
  it('invalid amounts and dates are refused', () => {
    for (const grossBase of ['-1', '1e3', 'NaN', '1.0000001']) expect(() => calculateWithholding(profile(), source({ grossBase }), state())).toThrow();
    expect(() => calculateWithholding(profile(), source({ eventDate: '2026-02-30' }), state())).toThrow('date');
    expect(() => calculateWithholding(profile(), source({ gst: '24000' }), state())).toThrow('GST');
  });
});

describe('settlement component semantics', () => {
  it('receipt_and_payment_components', () => {
    expect(calculateSettlementComponents({ direction: 'receipt', currency: 'INR', principal: '90000', newTax: '10000', charge: '100', allocated: '100000' })).toEqual({ billSettlement: '100000.000000', bankMovement: '89900.000000', cashUnapplied: '0.000000' });
    expect(calculateSettlementComponents({ direction: 'payment', currency: 'INR', principal: '117000', newTax: '0', charge: '50', allocated: '117000' }).bankMovement).toBe('117050.000000');
    expect(calculateSettlementComponents({ direction: 'payment', currency: 'INR', principal: '99000', newTax: '1000', charge: '0', allocated: '0', reviewedAdvance: true })).toMatchObject({ billSettlement: '100000.000000', bankMovement: '99000.000000', cashUnapplied: '99000.000000' });
  });
  it('tax cannot become generic unapplied cash', () => {
    expect(() => calculateSettlementComponents({ direction: 'receipt', currency: 'INR', principal: '90', newTax: '10', charge: '0', allocated: '5' })).toThrow('Tax');
    expect(() => calculateSettlementComponents({ direction: 'receipt', currency: 'INR', principal: '90', newTax: '10', charge: '91', allocated: '100' })).toThrow('charge');
    expect(() => calculateSettlementComponents({ direction: 'payment', currency: 'INR', principal: '0', newTax: '10', charge: '0', allocated: '10' })).toThrow('principal');
  });
  it('new_path_refuses_fx', () => {
    expect(() => calculateSettlementComponents({ direction: 'payment', currency: 'USD', principal: '90', newTax: '10', charge: '0', allocated: '100' })).toThrow('INR');
    expect(() => calculateWithholding(profile(), source({ currency: 'USD' }), state())).toThrow('INR');
  });
});
