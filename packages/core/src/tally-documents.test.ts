import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readTallyXml, toTallyVoucher, type TallyVoucher, type TallyVoucherLine } from './tally.js';
import { tallyDocument, TALLY_BASE_TYPES, type TallyDocumentLinks } from './tally-documents.js';

const fixture = readFileSync(new URL('../fixtures/tally/daybook.xml', import.meta.url), 'utf8');
const vouchers = readTallyXml(fixture).objects.map(toTallyVoucher).filter((v): v is TallyVoucher => !!v);
const sale = vouchers.find((v) => v.type === 'Sales')!;

const links = (over: Partial<TallyDocumentLinks> = {}): TallyDocumentLinks => ({
  party: (n) => ({ 'Acme Castings Pvt Ltd': { id: 'acme', stateCode: '27' }, 'Delhi Tools': { id: 'delhi', stateCode: '07' }, 'Steel Supplier': { id: 'steel', stateCode: '27' } })[n] ?? null,
  item: (n) => ({ 'MS Round Bar 25mm': { id: 'bar', gstRate: '18' } })[n] ?? null,
  serviceItem: (l) => ({ 'Machining Charges': { id: 'svc-machining', gstRate: '18' }, Freight: { id: 'svc-freight', gstRate: '18' } })[l] ?? null,
  taxHead: (l) => ({ CGST: 'cgst', 'Output SGST': 'sgst', 'Output IGST': 'igst', 'Input CGST': 'cgst', 'Input SGST': 'sgst' }) [l] as never ?? null,
  warehouse: (g) => (g === 'Main Location' || g === null ? 'wh-main' : g === 'Shop Floor' ? 'wh-shop' : null),
  ourStateCode: '27',
  ...over,
});
const line = (ledger: string, side: 'debit' | 'credit', amount: string, extra: Partial<TallyVoucherLine> = {}): TallyVoucherLine => ({ ledger, side, amount, bills: [], party: false, ...extra });
const voucher = (over: Partial<TallyVoucher>): TallyVoucher => ({
  kind: 'voucher',
  guid: 'g-1',
  alterId: 1,
  type: 'Sales',
  number: 'S/1',
  date: '2026-11-03',
  narration: null,
  party: 'Acme Castings Pvt Ltd',
  cancelled: false,
  optional: false,
  deleted: false,
  invoice: true,
  lines: [],
  items: [],
  ...over,
});

describe('Tally vouchers as documents (decision 075)', () => {
  it('maps the base voucher types', () => {
    expect(TALLY_BASE_TYPES).toEqual({ Sales: 'sales_invoice', Purchase: 'purchase_invoice', 'Credit Note': 'sales_credit_note', 'Debit Note': 'supplier_debit_note' });
  });

  it('turns an invoice-mode sale into a sales invoice with Tally’s number, amounts, godown and batch', () => {
    const r = tallyDocument(sale, 'sales_invoice', links());
    expect(r.problems).toBeUndefined();
    expect(r.draft).toMatchObject({
      kind: 'sales_invoice',
      number: 'FE/26-27/0001',
      date: '2026-04-15',
      partyId: 'acme',
      placeOfSupplyStateCode: '27',
      interState: false,
      taxableValue: '8000.00',
      tax: { cgst: '720.00', sgst: '720.00', igst: '0.00', cess: '0.00' },
      grandTotal: '9440.00',
      roundOff: '0.00',
      taxDifference: null,
      billReference: null,
    });
    expect(r.draft!.lines).toEqual([{ itemId: 'bar', qty: '100', rate: '80', taxableValue: '8000.00', gstRate: '18', warehouseId: 'wh-main', batch: 'HEAT-2231', ledger: 'Sales - Local' }]);
  });

  it('books ledgers left over after the items as service lines, and round-off apart', () => {
    const v = voucher({
      invoice: false,
      party: 'Delhi Tools',
      lines: [
        line('Delhi Tools', 'debit', '1300.30', { party: true }),
        line('Machining Charges', 'credit', '1000.00'),
        line('Freight', 'credit', '100.00'),
        line('Output IGST', 'credit', '198.00'),
        line('Round Off', 'credit', '2.30'),
      ],
    });
    const r = tallyDocument(v, 'sales_invoice', links());
    expect(r.problems).toBeUndefined();
    expect(r.draft!.interState).toBe(true);
    expect(r.draft!.lines.map((l) => [l.itemId, l.taxableValue])).toEqual([
      ['svc-machining', '1000.00'],
      ['svc-freight', '100.00'],
    ]);
    expect(r.draft!.tax.igst).toBe('198.00');
    expect(r.draft!.roundOff).toBe('2.30');
    expect(r.draft!.grandTotal).toBe('1300.30');
    expect(r.draft!.taxDifference).toBeNull();
  });

  it("keeps Tally's tax when it differs from FactoryOS's and flags both", () => {
    const v = voucher({
      invoice: false,
      lines: [line('Acme Castings Pvt Ltd', 'debit', '1100.00', { party: true }), line('Machining Charges', 'credit', '1000.00'), line('CGST', 'credit', '50.00'), line('Output SGST', 'credit', '50.00')],
    });
    const r = tallyDocument(v, 'sales_invoice', links());
    expect(r.draft!.tax).toMatchObject({ cgst: '50.00', sgst: '50.00' });
    expect(r.draft!.taxDifference).toEqual({ expected: { cgst: '90.00', sgst: '90.00', igst: '0.00', cess: '0.00' }, tally: { cgst: '50.00', sgst: '50.00', igst: '0.00', cess: '0.00' } });
    const unknownRate = tallyDocument(v, 'sales_invoice', links({ serviceItem: () => ({ id: 'svc', gstRate: null }) }));
    expect(unknownRate.draft!.taxDifference).toBeNull();
  });

  it('turns a purchase into a purchase invoice, the party credited and input tax debited', () => {
    const v = voucher({
      type: 'Purchase',
      party: 'Steel Supplier',
      lines: [
        line('Steel Supplier', 'credit', '5900.00', { party: true }),
        line('Input CGST', 'debit', '450.00'),
        line('Input SGST', 'debit', '450.00'),
        line('Purchase - Local', 'debit', '5000.00', { allocation: true }),
      ],
      items: [{ item: 'MS Round Bar 25mm', qty: '50', unit: 'Kgs', rate: '100', amount: '5000', direction: 'in', batches: [{ godown: 'Main Location', batch: 'Primary Batch', qty: '50' }], ledger: 'Purchase - Local' }],
    });
    const r = tallyDocument(v, 'purchase_invoice', links());
    expect(r.problems).toBeUndefined();
    expect(r.draft).toMatchObject({ partyId: 'steel', taxableValue: '5000.00', grandTotal: '5900.00', tax: { cgst: '450.00', sgst: '450.00' } });
    expect(r.draft!.lines[0]).toMatchObject({ qty: '50', batch: null, warehouseId: 'wh-main' });
  });

  it('shares an item across its godowns by quantity, the last line taking the rounding', () => {
    const v = voucher({
      lines: [line('Acme Castings Pvt Ltd', 'debit', '118.00', { party: true }), line('CGST', 'credit', '9.00'), line('Output SGST', 'credit', '9.00'), line('Sales - Local', 'credit', '100.00', { allocation: true })],
      items: [
        {
          item: 'MS Round Bar 25mm',
          qty: '3',
          unit: 'Kgs',
          rate: '33.333333',
          amount: '100',
          direction: 'out',
          batches: [
            { godown: 'Main Location', batch: 'H-1', qty: '1' },
            { godown: 'Shop Floor', batch: 'H-2', qty: '2' },
          ],
          ledger: 'Sales - Local',
        },
      ],
    });
    const r = tallyDocument(v, 'sales_invoice', links());
    expect(r.draft!.lines.map((l) => [l.warehouseId, l.batch, l.qty, l.taxableValue])).toEqual([
      ['wh-main', 'H-1', '1', '33.33'],
      ['wh-shop', 'H-2', '2', '66.67'],
    ]);
  });

  it('takes the invoice a credit note is against from its Agst Ref bill', () => {
    const v = voucher({
      type: 'Credit Note',
      number: 'CN/4',
      invoice: false,
      lines: [
        line('Acme Castings Pvt Ltd', 'credit', '1180.00', { party: true, bills: [{ name: 'FE/26-27/0001', type: 'Agst Ref', side: 'credit', amount: '1180.00' }] }),
        line('Machining Charges', 'debit', '1000.00'),
        line('CGST', 'debit', '90.00'),
        line('Output SGST', 'debit', '90.00'),
      ],
    });
    const r = tallyDocument(v, 'sales_credit_note', links());
    expect(r.problems).toBeUndefined();
    expect(r.draft).toMatchObject({ kind: 'sales_credit_note', billReference: 'FE/26-27/0001', grandTotal: '1180.00', taxableValue: '1000.00' });
  });

  it('lists every reason a voucher cannot be made a document', () => {
    const r = tallyDocument(sale, 'sales_invoice', links({ party: () => null, item: () => null, warehouse: () => null }));
    expect(r.problems).toEqual([
      'The party "Acme Castings Pvt Ltd" is not linked to a FactoryOS party.',
      'The item "MS Round Bar 25mm" is not linked to a FactoryOS item.',
      'The ledger "Sales - Local" (8000.00) needs a service item to be booked as a line.',
    ]);
    const unbalanced = voucher({ lines: [line('Acme Castings Pvt Ltd', 'debit', '100.00', { party: true }), line('Machining Charges', 'credit', '90.00')] });
    expect(tallyDocument(unbalanced, 'sales_invoice', links()).problems![0]).toBe('Debits and credits differ by 10.');
  });
});
