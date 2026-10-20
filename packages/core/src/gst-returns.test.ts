import { describe, expect, it } from 'vitest';
import {
  b2clThreshold,
  buildGstr1,
  buildGstr3b,
  checkDocumentSeries,
  checkGstr1Against3b,
  documentSummary,
  sectionOf,
  type GstLine,
  type InwardDoc,
  type OutwardDoc,
} from './gst-returns.js';

// Invented data only (decision 074: golden tests never use real documents). Our state is Maharashtra, 27.
const OUR = '27';
const line = (taxable: string, rate: string, split: 'igst' | 'local', hsn = '84829900', qty = '1', uqc = 'NOS'): GstLine => {
  const tax = (Number(taxable) * Number(rate)) / 100;
  return {
    hsn,
    uqc,
    qty,
    gstRate: rate,
    taxable,
    igst: split === 'igst' ? tax.toFixed(2) : '0.00',
    cgst: split === 'local' ? (tax / 2).toFixed(2) : '0.00',
    sgst: split === 'local' ? (tax / 2).toFixed(2) : '0.00',
    cess: '0.00',
  };
};
let seq = 0;
const doc = (o: Partial<OutwardDoc> & Pick<OutwardDoc, 'lines'>): OutwardDoc => {
  const value = o.lines.reduce((s, l) => s + Number(l.taxable) + Number(l.igst) + Number(l.cgst) + Number(l.sgst), 0).toFixed(2);
  return {
    type: 'invoice',
    id: `d${++seq}`,
    number: `INV/${seq}`,
    date: '2026-11-10',
    counterpartyGstin: null,
    treatment: 'unregistered',
    supplyType: 'regular',
    placeOfSupply: OUR,
    reverseCharge: false,
    portCode: null,
    shippingBillNo: null,
    shippingBillDate: null,
    value,
    ...o,
  };
};

describe('GSTR-1 sections', () => {
  it('places invoices by registration, State and value', () => {
    expect(sectionOf(doc({ counterpartyGstin: '27AAAAA0000A1Z5', treatment: 'registered', lines: [line('1000', '18', 'local')] }), OUR).section).toBe('b2b');
    expect(sectionOf(doc({ placeOfSupply: '29', lines: [line('150000', '18', 'igst')] }), OUR).section).toBe('b2cl');
    expect(sectionOf(doc({ placeOfSupply: '29', lines: [line('50000', '18', 'igst')] }), OUR).section).toBe('b2cs');
    expect(sectionOf(doc({ lines: [line('500000', '18', 'local')] }), OUR).section).toBe('b2cs');
    expect(sectionOf(doc({ supplyType: 'export_under_lut', treatment: 'overseas', placeOfSupply: '96', lines: [line('9000', '0', 'igst')] }), OUR).section).toBe('exp');
  });

  it('uses the B2CL threshold in force on the date', () => {
    expect(b2clThreshold('2024-07-31')).toBe('250000');
    expect(b2clThreshold('2024-08-01')).toBe('100000');
    const before = doc({ date: '2024-07-15', placeOfSupply: '29', lines: [line('150000', '18', 'igst')] });
    expect(sectionOf(before, OUR).section).toBe('b2cs');
  });

  it('needs attention for a registered customer without a GSTIN', () => {
    const g = buildGstr1([doc({ treatment: 'registered', lines: [line('1000', '18', 'local')] })], OUR, { turnoverAboveFiveCrore: false });
    expect(g.entries).toEqual([]);
    expect(g.attention[0]).toMatchObject({ blocking: true });
  });

  it('marks SEZ, exports and notes with their sub-types', () => {
    const sez = doc({ counterpartyGstin: '27BBBBB0000B1Z5', treatment: 'sez', supplyType: 'sez_without_payment', lines: [line('2000', '18', 'igst')] });
    const exp = doc({ supplyType: 'export_with_payment', treatment: 'overseas', placeOfSupply: '96', portCode: 'INNSA1', shippingBillNo: '1234567', shippingBillDate: '2026-11-11', lines: [line('3000', '18', 'igst')] });
    const cn = doc({ type: 'credit_note', placeOfSupply: '29', original: { number: 'INV/X', date: '2026-10-02', value: '200000' }, lines: [line('1000', '18', 'igst')] });
    const g = buildGstr1([sez, exp, cn], OUR, { turnoverAboveFiveCrore: false });
    expect(g.entries.map((e) => `${e.section}:${e.subtype}`)).toEqual(['b2b:SEWOP', 'cdnur:B2CL', 'exp:WPAY']);
    expect(g.entries.find((e) => e.section === 'cdnur')!.amounts.taxable).toBe('-1000.00');
    expect(g.attention).toEqual([]);
  });

  it('nets B2CS by place of supply and rate, with notes against small invoices', () => {
    const g = buildGstr1(
      [
        doc({ lines: [line('1000', '18', 'local'), line('500', '12', 'local')] }),
        doc({ lines: [line('2000', '18', 'local')] }),
        doc({ type: 'credit_note', original: { number: 'INV/1', date: '2026-11-01', value: '1180' }, lines: [line('300', '18', 'local')] }),
      ],
      OUR,
      { turnoverAboveFiveCrore: false },
    );
    expect(g.b2cs).toEqual([
      { placeOfSupply: '27', rate: '12.00', taxable: '500.00', igst: '0.00', cgst: '30.00', sgst: '30.00', cess: '0.00' },
      { placeOfSupply: '27', rate: '18.00', taxable: '2700.00', igst: '0.00', cgst: '243.00', sgst: '243.00', cess: '0.00' },
    ]);
  });

  it('reports 0% domestic lines as nil-rated, by registration and State', () => {
    const g = buildGstr1(
      [doc({ counterpartyGstin: '29CCCCC0000C1Z5', treatment: 'registered', placeOfSupply: '29', lines: [line('1000', '18', 'igst'), line('400', '0', 'igst')] })],
      OUR,
      { turnoverAboveFiveCrore: false },
    );
    expect(g.nil).toEqual([{ table: '8A', nil: '400.00' }]);
    expect(g.entries[0]!.amounts.taxable).toBe('1000.00');
  });

  it('splits the HSN summary into B2B and B2C and flags short codes', () => {
    const g = buildGstr1(
      [
        doc({ counterpartyGstin: '27AAAAA0000A1Z5', treatment: 'registered', lines: [line('1000', '18', 'local', '8482', '2', 'NOS')] }),
        doc({ lines: [line('500', '18', 'local', '8482', '1', 'NOS')] }),
      ],
      OUR,
      { turnoverAboveFiveCrore: true },
    );
    expect(g.hsn.map((h) => `${h.part}:${h.hsn}:${h.qty}:${h.taxable}`)).toEqual(['b2b:8482:2.00:1000.00', 'b2c:8482:1.00:500.00']);
    expect(g.attention).toEqual([expect.objectContaining({ blocking: false, reason: expect.stringMatching(/fewer than 6 digits/) })]);
  });

  it('asks for the shipping bill on an export', () => {
    const g = buildGstr1([doc({ supplyType: 'export_under_lut', treatment: 'overseas', placeOfSupply: '96', lines: [line('9000', '0', 'igst')] })], OUR, { turnoverAboveFiveCrore: false });
    expect(g.entries[0]!.subtype).toBe('WOPAY');
    expect(g.attention[0]!.reason).toMatch(/shipping bill/);
  });
});

describe('document summary', () => {
  it('counts each series, its cancelled numbers and its gaps', () => {
    const rows = documentSummary([
      { nature: 'invoice', number: 'AZ/26-27/0001', cancelled: false },
      { nature: 'invoice', number: 'AZ/26-27/0002', cancelled: true },
      { nature: 'invoice', number: 'AZ/26-27/0004', cancelled: false },
      { nature: 'credit_note', number: 'CN/0001', cancelled: false },
    ]);
    expect(rows).toEqual([
      { nature: 'credit_note', series: 'CN/', from: 'CN/0001', to: 'CN/0001', total: 1, cancelled: 0, gaps: [] },
      { nature: 'invoice', series: 'AZ/26-27/', from: 'AZ/26-27/0001', to: 'AZ/26-27/0004', total: 3, cancelled: 1, gaps: ['AZ/26-27/0003'] },
    ]);
    expect(checkDocumentSeries(rows).ok).toBe(false);
  });
});

describe('GSTR-3B', () => {
  const outward = [
    doc({ counterpartyGstin: '27AAAAA0000A1Z5', treatment: 'registered', lines: [line('10000', '18', 'local')] }),
    doc({ placeOfSupply: '29', lines: [line('20000', '18', 'igst')] }),
    doc({ supplyType: 'export_under_lut', treatment: 'overseas', placeOfSupply: '96', portCode: 'INNSA1', shippingBillNo: '1', shippingBillDate: '2026-11-12', lines: [line('5000', '0', 'igst')] }),
    doc({ counterpartyGstin: '27AAAAA0000A1Z5', treatment: 'registered', lines: [line('700', '0', 'local')] }),
  ];
  const inward: InwardDoc[] = [
    { id: 'p1', number: 'S/1', kind: 'purchase_invoice', reverseCharge: false, importOfServices: false, itcEligible: true, supplierState: '27', composition: false, lines: [line('4000', '18', 'local')] },
    { id: 'p2', number: 'S/2', kind: 'purchase_invoice', reverseCharge: true, importOfServices: false, itcEligible: true, supplierState: '27', composition: false, lines: [line('1000', '18', 'local')] },
    { id: 'p3', number: 'S/3', kind: 'purchase_invoice', reverseCharge: false, importOfServices: false, itcEligible: false, supplierState: '29', composition: false, lines: [line('2000', '18', 'igst')] },
    { id: 'b1', number: 'BE/1', kind: 'bill_of_entry', reverseCharge: false, importOfServices: false, itcEligible: true, supplierState: null, composition: false, lines: [line('6000', '18', 'igst')] },
    { id: 'c1', number: 'CN/S1', kind: 'supplier_credit_note', reverseCharge: false, importOfServices: false, itcEligible: true, supplierState: '27', composition: false, lines: [line('500', '18', 'local')] },
    { id: 'p4', number: 'S/4', kind: 'purchase_invoice', reverseCharge: false, importOfServices: false, itcEligible: true, supplierState: '27', composition: true, lines: [line('300', '0', 'local')] },
  ];

  it('fills 3.1 to 6.1 from the documents', () => {
    const g1 = buildGstr1(outward, OUR, { turnoverAboveFiveCrore: false });
    const g3 = buildGstr3b(g1, outward, inward, OUR);
    expect(g3['3.1'].a).toEqual({ taxable: '30000.00', igst: '3600.00', cgst: '900.00', sgst: '900.00', cess: '0.00' });
    expect(g3['3.1'].b.taxable).toBe('5000.00');
    expect(g3['3.1'].c.taxable).toBe('700.00');
    expect(g3['3.1'].d).toEqual({ taxable: '1000.00', igst: '0.00', cgst: '90.00', sgst: '90.00', cess: '0.00' });
    expect(g3['3.2']).toEqual([{ placeOfSupply: '29', unregistered: { taxable: '20000.00', igst: '3600.00' }, composition: { taxable: '0.00', igst: '0.00' } }]);
    expect(g3['4'].a1.igst).toBe('1080.00');
    expect(g3['4'].a3).toEqual({ igst: '0.00', cgst: '90.00', sgst: '90.00', cess: '0.00' });
    // 360 + 360 on the eligible invoice, less 45 + 45 on the supplier's credit note.
    expect(g3['4'].a5).toEqual({ igst: '0.00', cgst: '315.00', sgst: '315.00', cess: '0.00' });
    expect(g3['4'].d1.igst).toBe('360.00');
    expect(g3['4'].c).toEqual({ igst: '1080.00', cgst: '405.00', sgst: '405.00', cess: '0.00' });
    expect(g3['5'].compositionExemptNil.intra).toBe('300.00');
    expect(g3['6.1']).toEqual({ igst: '3600.00', cgst: '990.00', sgst: '990.00', cess: '0.00' });
    expect(checkGstr1Against3b(g1, g3, outward).ok).toBe(true);
  });
});

describe('sheets', () => {
  it('writes one CSV per GSTR-1 section and a 3B sheet', async () => {
    const { gstr1Sheets, gstr3bSheet } = await import('./gst-returns.js');
    const docs = [doc({ counterpartyGstin: '27AAAAA0000A1Z5', treatment: 'registered', lines: [line('1000', '18', 'local')] })];
    const g1 = buildGstr1(docs, OUR, { turnoverAboveFiveCrore: false });
    const sheets = gstr1Sheets(g1);
    expect(sheets.map((s) => s.name)).toEqual(['b2b.csv', 'b2cl.csv', 'b2cs.csv', 'exp.csv', 'cdnr.csv', 'cdnur.csv', 'nil.csv', 'hsn.csv', 'docs.csv']);
    expect(sheets[0]!.csv.split('\n')[1]).toBe(`27AAAAA0000A1Z5,${docs[0]!.number},2026-11-10,1180.00,27,N,R,18.00,1000.00,0.00,90.00,90.00,0.00`);
    expect(gstr3bSheet(buildGstr3b(g1, docs, [], OUR))).toMatch(/^Table,Description/);
  });
});
