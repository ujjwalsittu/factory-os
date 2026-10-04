import { Dec } from '@factoryos/core';

/**
 * GST computation (docs/05 §1). Pure and deterministic: the same inputs always give the same tax,
 * so invoices can be recomputed and checked at any time.
 *
 * Scope: the rules FactoryOS needs for Phase 1. Place of supply is decided by the caller
 * (goods: where delivered; services: Sec 12/13 IGST Act); this module turns it into tax.
 */
export const GST_RATES = ['0', '0.1', '0.25', '1.5', '3', '5', '6', '7.5', '12', '18', '28', '40'] as const;

export type SupplyType =
  /** Domestic B2B/B2C supply. */
  | 'regular'
  /** To an SEZ unit/developer: inter-state by law; with or without payment of IGST (LUT/bond). */
  | 'sez_with_payment'
  | 'sez_without_payment'
  /** Export: zero-rated, with IGST paid (refund route) or under LUT. */
  | 'export_with_payment'
  | 'export_under_lut'
  /** Import of goods: IGST is paid at customs on the Bill of Entry, not on the supplier's invoice. */
  | 'import_goods'
  /** Import of services: IGST payable by the recipient under reverse charge. */
  | 'import_services';

export interface TaxContext {
  /** State code of the supplier's registration (or '96' for a foreign supplier). */
  supplierStateCode: string;
  /** State code of the place of supply. */
  placeOfSupplyStateCode: string;
  supplyType: SupplyType;
  /** Recipient pays the tax (notified supplies, unregistered/foreign suppliers of services). */
  reverseCharge: boolean;
}

export interface TaxLineInput {
  taxableValue: string;
  gstRate: string;
  cessRate?: string;
}

export interface TaxLine {
  taxableValue: string;
  igstRate: string;
  igst: string;
  cgstRate: string;
  cgst: string;
  sgstRate: string;
  sgst: string;
  cessRate: string;
  cess: string;
  /** Tax on the line (IGST + CGST + SGST + cess), whether charged by supplier or payable under RCM. */
  totalTax: string;
}

export interface TaxResult {
  kind: 'intra' | 'inter' | 'zero_rated' | 'customs';
  reverseCharge: boolean;
  lines: TaxLine[];
  taxableValue: string;
  igst: string;
  cgst: string;
  sgst: string;
  cess: string;
  totalTax: string;
  /** Amount on the invoice: taxable value plus tax charged by the supplier (excludes RCM tax). */
  invoiceTotal: string;
  notes: string[];
}

const round2 = (d: Dec) => Dec.of(d.toFixed(2));
const pct = (rate: Dec) => rate.div('100');

export function computeGst(ctx: TaxContext, lines: TaxLineInput[]): TaxResult {
  for (const l of lines) {
    if (!(GST_RATES as readonly string[]).includes(String(Number(l.gstRate)))) throw new Error(`Invalid GST rate ${l.gstRate}`);
    if (Dec.of(l.taxableValue).isNeg()) throw new Error('Taxable value cannot be negative');
  }
  const notes: string[] = [];
  let kind: TaxResult['kind'];
  let reverseCharge = ctx.reverseCharge;

  switch (ctx.supplyType) {
    case 'export_under_lut':
    case 'sez_without_payment':
      kind = 'zero_rated';
      notes.push('Zero-rated supply under LUT/bond: no IGST charged.');
      break;
    case 'import_goods':
      kind = 'customs';
      notes.push('Import of goods: IGST and customs duty are paid on the Bill of Entry, not on this invoice.');
      break;
    case 'import_services':
      kind = 'inter';
      reverseCharge = true;
      notes.push('Import of services: IGST payable by the recipient under reverse charge.');
      break;
    case 'sez_with_payment':
    case 'export_with_payment':
      kind = 'inter';
      break;
    default:
      kind = ctx.supplierStateCode === ctx.placeOfSupplyStateCode ? 'intra' : 'inter';
  }
  if (reverseCharge && kind !== 'customs') notes.push('Reverse charge: tax is payable by the recipient, not charged on the invoice.');

  const out: TaxLine[] = lines.map((l) => {
    const taxable = round2(Dec.of(l.taxableValue));
    const rate = Dec.of(l.gstRate);
    const cessRate = Dec.of(l.cessRate ?? '0');
    const zero = kind === 'zero_rated' || kind === 'customs';
    const igstRate = kind === 'inter' ? rate : Dec.ZERO;
    const halfRate = kind === 'intra' ? rate.div('2') : Dec.ZERO;
    const igst = zero ? Dec.ZERO : round2(taxable.mul(pct(igstRate)));
    const cgst = zero ? Dec.ZERO : round2(taxable.mul(pct(halfRate)));
    const sgst = cgst;
    const cess = zero ? Dec.ZERO : round2(taxable.mul(pct(cessRate)));
    const totalTax = igst.add(cgst).add(sgst).add(cess);
    return {
      taxableValue: taxable.toFixed(2),
      igstRate: (zero ? Dec.ZERO : igstRate).toFixed(2),
      igst: igst.toFixed(2),
      cgstRate: halfRate.toFixed(3).replace(/0$/, ''),
      cgst: cgst.toFixed(2),
      sgstRate: halfRate.toFixed(3).replace(/0$/, ''),
      sgst: sgst.toFixed(2),
      cessRate: (zero ? Dec.ZERO : cessRate).toFixed(2),
      cess: cess.toFixed(2),
      totalTax: totalTax.toFixed(2),
    };
  });

  const sum = (k: keyof TaxLine) => out.reduce((s, l) => s.add(l[k]), Dec.ZERO);
  const taxableValue = sum('taxableValue');
  const totalTax = sum('totalTax');
  return {
    kind,
    reverseCharge,
    lines: out,
    taxableValue: taxableValue.toFixed(2),
    igst: sum('igst').toFixed(2),
    cgst: sum('cgst').toFixed(2),
    sgst: sum('sgst').toFixed(2),
    cess: sum('cess').toFixed(2),
    totalTax: totalTax.toFixed(2),
    invoiceTotal: (reverseCharge ? taxableValue : taxableValue.add(totalTax)).toFixed(2),
    notes,
  };
}

/** Supply type for an inward supply from a party with the given GST treatment. */
export function inwardSupplyType(partyTreatment: string, isService: boolean): SupplyType {
  if (partyTreatment === 'overseas') return isService ? 'import_services' : 'import_goods';
  return 'regular';
}
