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
  TallyArchiveTooLarge,
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
      'GROUP', 'GROUP', 'GROUP', 'GROUP', 'GROUP', 'GROUP', 'LEDGER',
      'LEDGER', 'LEDGER', 'LEDGER', 'LEDGER', 'LEDGER', 'LEDGER',
      'UNIT', 'UNIT', 'GODOWN', 'GODOWN', 'STOCKGROUP', 'STOCKITEM', 'STOCKITEM', 'VOUCHERTYPE',
    ]);
  });

  it('reads the same file exported as UTF-16, the way Tally usually writes it', () => {
    const [file] = unpackTallyFiles([{ name: 'Master.xml', bytes: utf16(xml) }]);
    expect(readTallyXml(file!.xml).objects).toHaveLength(21);
  });

  it('expands a zip of exports and ignores other files', () => {
    const zip = zipSync({ 'Master.xml': new TextEncoder().encode(xml), 'readme.txt': new TextEncoder().encode('x'), '__MACOSX/._Master.xml': new Uint8Array([0]) });
    const files = unpackTallyFiles([{ name: 'tally.zip', bytes: zip }]);
    expect(files.map((f) => f.name)).toEqual(['tally.zip/Master.xml']);
  });

  it('refuses a zip whose XML would expand past the limit, before decompressing it', () => {
    const zip = zipSync({ 'Master.xml': new TextEncoder().encode(xml) });
    // Claim a 300 MB entry in the central directory, which is what the size check reads.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = zip.length - 22; i >= 0; i--)
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 300 * 1024 * 1024, true);
        break;
      }
    expect(() => unpackTallyFiles([{ name: 'big.zip', bytes: zip }])).toThrow(TallyArchiveTooLarge);
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

  it("reads Tally's Not Applicable unit as no unit", () => {
    const item = readTallyXml(
      '<ENVELOPE><BODY><TALLYMESSAGE><STOCKITEM NAME="Freight"><BASEUNITS>&#4; Not Applicable</BASEUNITS></STOCKITEM></TALLYMESSAGE></BODY></ENVELOPE>',
    ).objects.map(toTallyMaster)[0] as TallyStockItem;
    expect(item.unit).toBeNull();
  });

  it('keeps the sign of negative opening stock', () => {
    const neg = readTallyXml(
      '<ENVELOPE><BODY><TALLYMESSAGE><STOCKITEM NAME="Short Item"><BASEUNITS>Nos</BASEUNITS><OPENINGBALANCE>-5 Nos</OPENINGBALANCE><OPENINGVALUE>500.00</OPENINGVALUE></STOCKITEM></TALLYMESSAGE></BODY></ENVELOPE>',
    ).objects.map(toTallyMaster)[0] as TallyStockItem;
    expect(neg.opening).toEqual({ qty: '-5', value: '-500' });
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
  it("reads a company's own primary group from Tally's flags", () => {
    const groups = Object.fromEntries(
      readTallyXml(xml)
        .objects.map(toTallyMaster)
        .filter((m): m is TallyGroup => m?.kind === 'group')
        .map((g) => [g.name, g]),
    );
    expect(groups['Statutory Receivables']).toMatchObject({ parent: null, nature: 'asset' });
    const parentOf = (n: string) => (n in groups ? groups[n]!.parent : undefined);
    const nature = (n: string) => groups[n]?.nature;
    expect(tallyRoot('GST Receivables', parentOf, nature)).toBe('asset');
    expect(tallyRoot('GST Receivables', parentOf)).toBeNull();
    const flags = (rev: string, debit: string) =>
      (readTallyXml(`<ENVELOPE><BODY><TALLYMESSAGE><GROUP NAME="G"><PARENT/><ISREVENUE>${rev}</ISREVENUE><ISDEEMEDPOSITIVE>${debit}</ISDEEMEDPOSITIVE></GROUP></TALLYMESSAGE></BODY></ENVELOPE>`).objects.map(toTallyMaster)[0] as TallyGroup).nature;
    expect([flags('No', 'Yes'), flags('No', 'No'), flags('Yes', 'Yes'), flags('Yes', 'No')]).toEqual(['asset', 'liability', 'expense', 'income']);
  });
  it('returns null for an unknown chain or a loop', () => {
    expect(tallyRoot('Nowhere', () => null)).toBeNull();
    expect(tallyRoot('Loop', (n) => parents[n])).toBeNull();
  });
});
