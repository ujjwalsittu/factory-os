import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  decodeTallyBytes,
  readTallyXml,
  sanitizeTallyXml,
  tallyAmount,
  tallyDate,
  tallyNumber,
  tallyQuantity,
  tallyRoot,
  toTallyMaster,
  unpackTallyFiles,
  type TallyGroup,
  type TallyLedger,
  type TallyStockItem,
  type TallyUnit,
} from './tally';

const xml = readFileSync(new URL('../fixtures/tally/masters.xml', import.meta.url), 'utf8');
const utf16 = (s: string) => {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    out[2 + i * 2] = s.charCodeAt(i) & 0xff;
    out[3 + i * 2] = s.charCodeAt(i) >> 8;
  }
  return out;
};

describe('reading Tally XML exports', () => {
  it('decodes UTF-16 with and without a byte-order mark, and UTF-8', () => {
    const marked = utf16('<A>₹ 10</A>');
    expect(decodeTallyBytes(marked)).toBe('<A>₹ 10</A>');
    expect(decodeTallyBytes(marked.subarray(2))).toBe('<A>₹ 10</A>');
    expect(decodeTallyBytes(new TextEncoder().encode('<A>x</A>'))).toBe('<A>x</A>');
  });

  it("removes the control characters XML forbids, including Tally's &#4; marker", () => {
    expect(sanitizeTallyXml('<P>&#4; Primary</P>\u0004<Q>&#38;&#x9;</Q>')).toBe('<P> Primary</P><Q>&#38;&#x9;</Q>');
  });

  it('reads every object inside TALLYMESSAGE and the company name', () => {
    const r = readTallyXml(xml);
    expect(r.warnings).toEqual([]);
    expect(r.company).toBe('Fixture Engineering Private Limited');
    expect(r.objects.map((o) => o.tag)).toEqual([
      'GROUP', 'GROUP', 'GROUP', 'GROUP',
      'LEDGER', 'LEDGER', 'LEDGER', 'LEDGER', 'LEDGER',
      'UNIT', 'UNIT', 'GODOWN', 'GODOWN', 'STOCKGROUP', 'STOCKITEM', 'STOCKITEM', 'VOUCHERTYPE',
    ]);
  });

  it('reads the same file exported as UTF-16, the way Tally usually writes it', () => {
    const [file] = unpackTallyFiles([{ name: 'Master.xml', bytes: utf16(xml) }]);
    expect(readTallyXml(file!.xml).objects).toHaveLength(17);
  });

  it('expands a zip of exports and ignores other files', () => {
    const zip = zipSync({ 'Master.xml': new TextEncoder().encode(xml), 'readme.txt': new TextEncoder().encode('x'), '__MACOSX/._Master.xml': new Uint8Array([0]) });
    const files = unpackTallyFiles([{ name: 'tally.zip', bytes: zip }]);
    expect(files.map((f) => f.name)).toEqual(['tally.zip/Master.xml']);
  });

  it('reports a broken file instead of throwing', () => {
    const r = readTallyXml('<ENVELOPE><BODY><TALLYMESSAGE><LEDGER NAME="x"></TALLYMESSAGE>');
    expect(r.warnings[0]).toMatch(/not valid Tally XML/);
    expect(readTallyXml('<ENVELOPE/>').warnings[0]).toMatch(/No Tally objects/);
  });
});

describe('values', () => {
  it('keeps amounts exact, with Tally’s negative-is-debit sign', () => {
    expect(tallyNumber('-1,25,000.50')).toBe('-125000.5');
    expect(tallyNumber(' 0012.300')).toBe('12.3');
    expect(tallyNumber('1234.5 Dr')).toBe('-1234.5');
    expect(tallyAmount('-1,25,000.50')).toEqual({ side: 'debit', amount: '125000.5' });
    expect(tallyAmount('48,000.00')).toEqual({ side: 'credit', amount: '48000' });
    expect(tallyAmount('0.00')).toBeNull();
    expect(tallyAmount(null)).toBeNull();
  });

  it('reads dates and quantities', () => {
    expect(tallyDate('20260310')).toBe('2026-03-10');
    expect(tallyDate('10-03-2026')).toBeNull();
    expect(tallyQuantity(' 1250.500 Kgs')).toEqual({ qty: '1250.5', unit: 'Kgs' });
    expect(tallyQuantity('3')).toEqual({ qty: '3', unit: null });
  });
});

describe('masters', () => {
  const masters = readTallyXml(xml).objects.map(toTallyMaster);
  const byName = (name: string) => masters.find((m) => m?.name === name)!;

  it('reads groups with their parent, treating Primary as no parent', () => {
    const debtors = byName('Sundry Debtors') as TallyGroup;
    expect(debtors).toMatchObject({ kind: 'group', parent: 'Current Assets', reservedName: 'Sundry Debtors', alterId: 1 });
    expect(debtors.guid).toBe('a1b2c3d4-0000-0000-0000-000000000001-00000001');
    expect(byName('Current Assets')).toMatchObject({ parent: null });
    expect(byName('Domestic Debtors')).toMatchObject({ parent: 'Sundry Debtors', reservedName: null, alterId: 40 });
  });

  it('reads a party ledger with GSTIN, PAN, address, credit days and opening bills', () => {
    const acme = byName('Acme Castings Pvt Ltd') as TallyLedger;
    expect(acme).toMatchObject({
      kind: 'ledger',
      parent: 'Domestic Debtors',
      gstin: '27AAACA1234B1ZI',
      pan: 'AAACA1234B',
      stateName: 'Maharashtra',
      pincode: '411026',
      address: ['Plot 12, MIDC', 'Bhosari, Pune'],
      email: 'accounts@acme.example',
      creditDays: 30,
      billwise: true,
      opening: { side: 'debit', amount: '125000.5' },
      aliases: ['ACME'],
    });
    expect(acme.openingBills).toEqual([
      { name: 'AC/25-26/0451', date: '2026-03-10', side: 'debit', amount: '100000.5', creditDays: 30 },
      { name: 'AC/25-26/0480', date: '2026-03-25', side: 'debit', amount: '25000', creditDays: null },
    ]);
  });

  it('reads the GSTIN and address from the newer TallyPrime detail blocks', () => {
    expect(byName('Bharat Steel Traders')).toMatchObject({
      gstin: '27AABCB5678C1ZQ',
      stateName: 'Maharashtra',
      pincode: '410218',
      address: ['Steel Market, Kalamboli'],
      opening: { side: 'credit', amount: '48000' },
    });
  });

  it('reads a GST ledger’s duty head', () => {
    expect(byName('CGST')).toMatchObject({ parent: 'Duties & Taxes', taxType: 'GST', gstDutyHead: 'Central Tax' });
  });

  it('reads units, godowns and stock groups', () => {
    expect(byName('Kgs') as TallyUnit).toMatchObject({ kind: 'unit', formalName: 'Kilograms', decimals: 3, simple: true });
    expect(byName('Main Location')).toMatchObject({ kind: 'godown', parent: null });
    expect(byName('Raw Materials')).toMatchObject({ kind: 'stockgroup', parent: null });
  });

  it('reads a stock item with HSN, GST rate, batches and opening stock', () => {
    const bar = byName('MS Round Bar 25mm') as TallyStockItem;
    expect(bar).toMatchObject({
      kind: 'stockitem',
      parent: 'Raw Materials',
      unit: 'Kgs',
      hsn: '7214',
      gstRate: '18',
      batchwise: true,
      aliases: ['MSRB25'],
      opening: { qty: '1250.5', value: '87535' },
    });
    expect(bar.openingBatches).toEqual([
      { godown: 'Main Location', batch: 'HEAT-2231', qty: '1000.5', value: '70035' },
      { godown: 'Bhosari Stores', batch: 'HEAT-2240', qty: '250', value: '17500' },
    ]);
    expect(byName('Flange Assembly FA-40')).toMatchObject({ hsn: '84819090', gstRate: null, batchwise: false, opening: null });
  });

  it('skips objects this import does not read', () => {
    expect(masters.at(-1)).toBeNull();
  });
});

describe('classification', () => {
  const parents: Record<string, string | null> = {
    'Domestic Debtors': 'Sundry Debtors',
    'Sundry Debtors': 'Current Assets',
    'Factory Overheads': 'Indirect Expenses',
    Loop: 'Loop2',
    Loop2: 'Loop',
  };
  it('walks parents up to a reserved primary group', () => {
    expect(tallyRoot('Domestic Debtors', (n) => parents[n])).toBe('asset');
    expect(tallyRoot('Factory Overheads', (n) => parents[n])).toBe('expense');
    expect(tallyRoot('Capital Account', () => null)).toBe('equity');
  });
  it('returns null for an unknown chain or a loop', () => {
    expect(tallyRoot('Nowhere', () => null)).toBeNull();
    expect(tallyRoot('Loop', (n) => parents[n])).toBeNull();
  });
});
