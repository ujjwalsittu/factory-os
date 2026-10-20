import { describe, expect, it } from 'vitest';
import type { TallyVoucher, TallyVoucherLine } from './tally.js';
import { tallyJournal, tallySettlement, tallyStockJournal, type TallyEntryLinks, type TallyLedgerTarget } from './tally-entries.js';

const LEDGERS: Record<string, TallyLedgerTarget> = {
  'HDFC Bank': { kind: 'account', id: 'bank', cash: true },
  Cash: { kind: 'account', id: 'cash', cash: true },
  'TDS Receivable': { kind: 'account', id: 'tds', cash: false },
  Rent: { kind: 'account', id: 'rent', cash: false },
  'Acme Castings': { kind: 'party', id: 'acme' },
  'Steel Supplier': { kind: 'party', id: 'steel' },
};
const links: TallyEntryLinks = {
  ledger: (n) => LEDGERS[n] ?? null,
  item: (n) => ({ 'MS Bar': { id: 'bar' }, 'Machined Part': { id: 'part' } })[n] ?? null,
  warehouse: (g) => ({ Stores: 'wh-stores', 'Shop Floor': 'wh-shop' })[g ?? 'Stores'] ?? null,
};
const line = (ledger: string, side: 'debit' | 'credit', amount: string, bills: TallyVoucherLine['bills'] = []): TallyVoucherLine => ({ ledger, side, amount, bills, party: !!LEDGERS[ledger] && LEDGERS[ledger]!.kind === 'party' });
const bill = (name: string, type: string, side: 'debit' | 'credit', amount: string) => ({ name, type, side, amount });
const voucher = (over: Partial<TallyVoucher>): TallyVoucher => ({
  kind: 'voucher',
  guid: 'g',
  alterId: 1,
  type: 'Receipt',
  number: 'R/1',
  date: '2026-11-05',
  narration: null,
  party: null,
  cancelled: false,
  optional: false,
  deleted: false,
  invoice: false,
  lines: [],
  items: [],
  ...over,
});

describe('Tally receipts and payments (decision 075b)', () => {
  it('settles each Agst Ref by its own amount and keeps the rest on account', () => {
    const v = voucher({
      lines: [
        line('Acme Castings', 'credit', '1500.00', [bill('S/1', 'Agst Ref', 'credit', '1000.00'), bill('S/2', 'Agst Ref', 'credit', '300.00'), bill('ADV', 'Advance', 'credit', '200.00')]),
        line('HDFC Bank', 'debit', '1500.00'),
      ],
    });
    expect(tallySettlement(v, 'receipt', links).draft).toEqual({
      kind: 'receipt',
      number: 'R/1',
      date: '2026-11-05',
      partyId: 'acme',
      accountId: 'bank',
      amount: '1500.00',
      bills: [
        { reference: 'S/1', amount: '1000.00' },
        { reference: 'S/2', amount: '300.00' },
      ],
      onAccount: '200.00',
    });
  });

  it('a payment debits the supplier', () => {
    const v = voucher({ type: 'Payment', lines: [line('Steel Supplier', 'debit', '590.00', [bill('BST/771', 'Agst Ref', 'debit', '590.00')]), line('Cash', 'credit', '590.00')] });
    expect(tallySettlement(v, 'payment', links).draft).toMatchObject({ partyId: 'steel', accountId: 'cash', bills: [{ reference: 'BST/771', amount: '590.00' }], onAccount: '0.00' });
  });

  it('anything but one party and one cash or bank ledger is a journal', () => {
    const tds = voucher({ lines: [line('Acme Castings', 'credit', '1000.00'), line('HDFC Bank', 'debit', '900.00'), line('TDS Receivable', 'debit', '100.00')] });
    expect(tallySettlement(tds, 'receipt', links).journal).toBe(true);
    const refund = voucher({ lines: [line('Acme Castings', 'debit', '100.00'), line('HDFC Bank', 'credit', '100.00')] });
    expect(tallySettlement(refund, 'receipt', links).journal).toBe(true);
  });

  it('names unlinked ledgers', () => {
    const v = voucher({ lines: [line('Unknown Co', 'credit', '10.00'), line('HDFC Bank', 'debit', '10.00')] });
    expect(tallySettlement(v, 'receipt', links).problems).toEqual(['The ledger "Unknown Co" is not linked to FactoryOS.']);
  });
});

describe('Tally journals', () => {
  it('books ledgers as Tally did and splits party lines by bill', () => {
    const v = voucher({
      type: 'Journal',
      number: 'J/1',
      lines: [line('Rent', 'debit', '1000.00'), line('Steel Supplier', 'credit', '1000.00', [bill('RENT-NOV', 'New Ref', 'credit', '600.00')])],
    });
    expect(tallyJournal(v, links).draft!.lines).toEqual([
      { accountId: 'rent', partyId: null, debit: '1000.00', credit: '0', billReference: null },
      { accountId: null, partyId: 'steel', debit: '0', credit: '600.00', billReference: 'RENT-NOV' },
      { accountId: null, partyId: 'steel', debit: '0', credit: '400.00', billReference: null },
    ]);
  });

  it('refuses an unbalanced journal', () => {
    const v = voucher({ lines: [line('Rent', 'debit', '10.00'), line('Cash', 'credit', '9.00')] });
    expect(tallyJournal(v, links).problems).toEqual(['Debits and credits differ by 1.']);
  });
});

describe('Tally stock journals', () => {
  const item = (name: string, direction: 'in' | 'out', qty: string, amount: string, godown: string) => ({ item: name, qty, unit: 'Nos', rate: null, amount, direction, batches: [{ godown, batch: 'Primary Batch', qty }] });

  it('a move between godowns is a transfer', () => {
    const v = voucher({ type: 'Stock Journal', items: [item('MS Bar', 'out', '10', '1000', 'Stores'), item('MS Bar', 'in', '10', '1000', 'Shop Floor')] });
    expect(tallyStockJournal(v, links).draft).toEqual({ kind: 'transfer', number: 'R/1', date: '2026-11-05', moves: [{ itemId: 'bar', qty: '10', from: 'wh-stores', to: 'wh-shop', batch: null }] });
  });

  it('consumption into production is an adjustment out and in at Tally’s value', () => {
    const v = voucher({ type: 'Stock Journal', items: [item('MS Bar', 'out', '10', '1000', 'Stores'), item('Machined Part', 'in', '5', '1500', 'Stores')] });
    const d = tallyStockJournal(v, links).draft!;
    expect(d.kind).toBe('adjustment');
    if (d.kind === 'adjustment') {
      expect(d.out).toEqual([{ itemId: 'bar', qty: '10', value: '1000.00', warehouseId: 'wh-stores', batch: null }]);
      expect(d.in).toEqual([{ itemId: 'part', qty: '5', value: '1500.00', warehouseId: 'wh-stores', batch: null }]);
    }
  });

  it('names unlinked items and godowns', () => {
    const v = voucher({ items: [item('Nut', 'out', '1', '5', 'Stores'), item('MS Bar', 'in', '1', '5', 'Yard')] });
    expect(tallyStockJournal(v, links).problems).toEqual(['The item "Nut" is not linked to a FactoryOS item.', 'The godown "Yard" of "MS Bar" is not linked to a warehouse.']);
  });
});
