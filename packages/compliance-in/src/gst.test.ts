import { describe, expect, it } from 'vitest';
import { computeGst } from './gst.js';

const MH = '27';
const KA = '29';

describe('computeGst — golden cases', () => {
  it('intra-state: CGST + SGST at half rate each', () => {
    const r = computeGst({ supplierStateCode: MH, placeOfSupplyStateCode: MH, supplyType: 'regular', reverseCharge: false }, [{ taxableValue: '50000', gstRate: '18' }]);
    expect(r.kind).toBe('intra');
    expect([r.cgst, r.sgst, r.igst, r.totalTax, r.invoiceTotal]).toEqual(['4500.00', '4500.00', '0.00', '9000.00', '59000.00']);
    expect(r.lines[0]).toMatchObject({ cgstRate: '9.00', sgstRate: '9.00' });
  });
  it('inter-state: IGST', () => {
    const r = computeGst({ supplierStateCode: KA, placeOfSupplyStateCode: MH, supplyType: 'regular', reverseCharge: false }, [{ taxableValue: '50000', gstRate: '18' }]);
    expect([r.kind, r.igst, r.cgst, r.invoiceTotal]).toEqual(['inter', '9000.00', '0.00', '59000.00']);
  });
  it('rounds each line to paise, half away from zero', () => {
    // 333.33 × 18% = 59.9994 → 60.00; 0.05 × 5% = 0.0025 → 0.00 per half (2.5% → 0.00125)
    const r = computeGst({ supplierStateCode: MH, placeOfSupplyStateCode: MH, supplyType: 'regular', reverseCharge: false }, [
      { taxableValue: '333.33', gstRate: '18' },
      { taxableValue: '0.05', gstRate: '5' },
    ]);
    expect(r.lines.map((l) => [l.cgst, l.sgst])).toEqual([
      ['30.00', '30.00'],
      ['0.00', '0.00'],
    ]);
    expect(r.invoiceTotal).toBe('393.38');
  });
  it('2.5% halves for 5% goods', () => {
    const r = computeGst({ supplierStateCode: MH, placeOfSupplyStateCode: MH, supplyType: 'regular', reverseCharge: false }, [{ taxableValue: '1001', gstRate: '5' }]);
    expect([r.lines[0]!.cgstRate, r.cgst, r.sgst]).toEqual(['2.50', '25.03', '25.03']);
  });
  it('cess is added on top', () => {
    const r = computeGst({ supplierStateCode: MH, placeOfSupplyStateCode: KA, supplyType: 'regular', reverseCharge: false }, [{ taxableValue: '1000', gstRate: '28', cessRate: '12' }]);
    expect([r.igst, r.cess, r.totalTax, r.invoiceTotal]).toEqual(['280.00', '120.00', '400.00', '1400.00']);
  });
  it('SEZ with payment is IGST even within the state', () => {
    const r = computeGst({ supplierStateCode: MH, placeOfSupplyStateCode: MH, supplyType: 'sez_with_payment', reverseCharge: false }, [{ taxableValue: '1000', gstRate: '18' }]);
    expect([r.kind, r.igst, r.cgst]).toEqual(['inter', '180.00', '0.00']);
  });
  it('export under LUT and SEZ without payment are zero-rated', () => {
    for (const supplyType of ['export_under_lut', 'sez_without_payment'] as const) {
      const r = computeGst({ supplierStateCode: MH, placeOfSupplyStateCode: '96', supplyType, reverseCharge: false }, [{ taxableValue: '1000', gstRate: '18' }]);
      expect([r.kind, r.totalTax, r.invoiceTotal]).toEqual(['zero_rated', '0.00', '1000.00']);
    }
  });
  it('import of goods: no tax on the supplier invoice', () => {
    const r = computeGst({ supplierStateCode: '96', placeOfSupplyStateCode: MH, supplyType: 'import_goods', reverseCharge: false }, [{ taxableValue: '96000', gstRate: '18' }]);
    expect([r.kind, r.totalTax, r.invoiceTotal]).toEqual(['customs', '0.00', '96000.00']);
  });
  it('import of services: IGST under reverse charge, not in the invoice total', () => {
    const r = computeGst({ supplierStateCode: '96', placeOfSupplyStateCode: MH, supplyType: 'import_services', reverseCharge: false }, [{ taxableValue: '100000', gstRate: '18' }]);
    expect([r.kind, r.reverseCharge, r.igst, r.invoiceTotal]).toEqual(['inter', true, '18000.00', '100000.00']);
  });
  it('domestic reverse charge: tax computed, payable by recipient', () => {
    const r = computeGst({ supplierStateCode: MH, placeOfSupplyStateCode: MH, supplyType: 'regular', reverseCharge: true }, [{ taxableValue: '20000', gstRate: '5' }]);
    expect([r.cgst, r.sgst, r.totalTax, r.invoiceTotal]).toEqual(['500.00', '500.00', '1000.00', '20000.00']);
  });
  it('rejects rates that do not exist', () => {
    expect(() => computeGst({ supplierStateCode: MH, placeOfSupplyStateCode: MH, supplyType: 'regular', reverseCharge: false }, [{ taxableValue: '1', gstRate: '17' }])).toThrow();
  });
});
