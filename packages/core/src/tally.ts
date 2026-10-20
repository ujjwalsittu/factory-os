/**
 * Decision 072: read TallyPrime XML exports (Data Interchange format) into plain objects.
 *
 * Tally writes an ENVELOPE of TALLYMESSAGE elements; each child of a TALLYMESSAGE is one master (GROUP, LEDGER,
 * STOCKGROUP, STOCKITEM, UNIT, GODOWN, ...) or one VOUCHER. The reader streams the file and only builds a small tree
 * per object, so large exports fit in memory. Amounts stay exact decimal strings.
 */
import { unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';

export interface TallyNode {
  tag: string;
  attrs: Record<string, string>;
  text: string;
  children: TallyNode[];
}

export interface TallyObject {
  /** The element name, e.g. LEDGER or VOUCHER. */
  tag: string;
  node: TallyNode;
}

export interface TallyRead {
  company: string | null;
  objects: TallyObject[];
  warnings: string[];
}

/** Tally exports are UTF-16 (with or without a byte-order mark) or UTF-8. */
export function decodeTallyBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  // No mark: UTF-16 text has a zero byte in every other position for ASCII.
  if (bytes.length > 3 && bytes[1] === 0 && bytes[3] === 0) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length > 3 && bytes[0] === 0 && bytes[2] === 0) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Tally writes control characters that XML 1.0 forbids, both raw and as references such as `&#4;` (its marker for
 * "Not Applicable"). They carry no data here, so they are removed before parsing.
 */
export function sanitizeTallyXml(xml: string): string {
  return xml
    .replace(/&#(x[0-9a-fA-F]+|[0-9]+);/g, (ref, code: string) => {
      const n = code.startsWith('x') ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return n < 0x20 && n !== 0x9 && n !== 0xa && n !== 0xd ? '' : ref;
    })
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** Limits on what a zip may expand to, so a small archive cannot exhaust memory. */
export const TALLY_MAX_XML_BYTES = 200 * 1024 * 1024;
export const TALLY_MAX_ZIP_TOTAL_BYTES = 400 * 1024 * 1024;

export class TallyArchiveTooLarge extends Error {}

/** A .zip upload is expanded into its .xml files; plain .xml files pass through. */
export function unpackTallyFiles(files: { name: string; bytes: Uint8Array }[]): { name: string; xml: string }[] {
  const out: { name: string; xml: string }[] = [];
  for (const f of files) {
    if (f.name.toLowerCase().endsWith('.zip') || (f.bytes[0] === 0x50 && f.bytes[1] === 0x4b)) {
      let total = 0;
      // The filter runs before anything is decompressed: only .xml entries, within the size limits.
      const entries = unzipSync(f.bytes, {
        filter: (e) => {
          if (!e.name.toLowerCase().endsWith('.xml') || e.name.startsWith('__MACOSX/')) return false;
          total += e.originalSize;
          if (e.originalSize > TALLY_MAX_XML_BYTES || total > TALLY_MAX_ZIP_TOTAL_BYTES)
            throw new TallyArchiveTooLarge(`${f.name} expands to more than ${TALLY_MAX_ZIP_TOTAL_BYTES / 1024 / 1024} MB of XML; export a smaller period or upload the XML files directly.`);
          return true;
        },
      });
      for (const [name, bytes] of Object.entries(entries)) out.push({ name: `${f.name}/${name}`, xml: decodeTallyBytes(bytes) });
    } else out.push({ name: f.name, xml: decodeTallyBytes(f.bytes) });
  }
  return out;
}

/** Streams one export and returns every object found inside TALLYMESSAGE elements. */
export function readTallyXml(xml: string): TallyRead {
  const parser = new SaxesParser({ xmlns: false });
  const objects: TallyObject[] = [];
  const warnings: string[] = [];
  const path: string[] = [];
  let company: string | null = null;
  let stack: TallyNode[] = [];
  let companyText: string | null = null;
  parser.on('opentag', (t) => {
    const tag = t.name.toUpperCase();
    const parent = path[path.length - 1];
    path.push(tag);
    if (tag === 'SVCURRENTCOMPANY') companyText = '';
    if (stack.length === 0 && parent !== 'TALLYMESSAGE') return;
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(t.attributes)) attrs[k.toUpperCase()] = String(v);
    const node: TallyNode = { tag, attrs, text: '', children: [] };
    if (stack.length) stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  });
  parser.on('text', (text) => {
    if (companyText !== null) companyText += text;
    if (stack.length) stack[stack.length - 1]!.text += text;
  });
  parser.on('closetag', () => {
    const tag = path.pop();
    if (tag === 'SVCURRENTCOMPANY' && companyText !== null) {
      company = company ?? (companyText.trim() || null);
      companyText = null;
    }
    if (!stack.length) return;
    const node = stack.pop()!;
    node.text = node.text.trim();
    if (!stack.length) objects.push({ tag: node.tag, node });
  });
  try {
    parser.write(sanitizeTallyXml(xml)).close();
  } catch (e) {
    warnings.push(`The file is not valid Tally XML: ${(e as Error).message}`);
  }
  if (!objects.length && !warnings.length) warnings.push('No Tally objects were found. Export in XML (Data Interchange) format.');
  return { company, objects, warnings };
}

// ── Reading values ──

const kids = (n: TallyNode, tag: string) => n.children.filter((c) => c.tag === tag);
const kid = (n: TallyNode, tag: string) => n.children.find((c) => c.tag === tag);
/** The trimmed text of a direct child, or null when absent or empty. */
export const field = (n: TallyNode, tag: string): string | null => kid(n, tag)?.text || null;
const yes = (n: TallyNode, tag: string) => field(n, tag)?.toLowerCase() === 'yes';
/** All text under `LIST.LIST/ITEM` style repeats, e.g. ADDRESS.LIST/ADDRESS. */
const listTexts = (n: TallyNode, list: string, item: string) =>
  kids(n, list).flatMap((l) => kids(l, item).map((i) => i.text).filter(Boolean));

/** Tally dates are YYYYMMDD. */
export function tallyDate(s: string | null): string | null {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** A plain decimal string from Tally text such as "-1,23,456.50", "1234.5 Dr" or "₹ 10". */
export function tallyNumber(s: string | null): string | null {
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let v = m[0];
  if (/\bDr\b/i.test(s) && !v.startsWith('-')) v = `-${v}`;
  return normalizeDecimal(v);
}

function normalizeDecimal(v: string): string {
  const neg = v.startsWith('-');
  let [i, f = ''] = v.replace('-', '').split('.');
  i = i!.replace(/^0+(?=\d)/, '');
  f = f.replace(/0+$/, '');
  const out = f ? `${i}.${f}` : i;
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}

/**
 * Tally amounts are negative for debit. Returns the side and the absolute amount, or null for zero or missing.
 * (For ledgers, Tally's own sign already accounts for ISDEEMEDPOSITIVE.)
 */
export function tallyAmount(s: string | null): { side: 'debit' | 'credit'; amount: string } | null {
  const v = tallyNumber(s);
  if (!v || !/[1-9]/.test(v)) return null;
  return v.startsWith('-') ? { side: 'debit', amount: v.slice(1) } : { side: 'credit', amount: v };
}

/** A quantity such as "10.500 Nos" or "-3 kg": the number and the unit, if any. */
export function tallyQuantity(s: string | null): { qty: string; unit: string | null } | null {
  if (!s) return null;
  const m = s.replace(/,/g, '').trim().match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return null;
  return { qty: normalizeDecimal(m[1]!), unit: m[2]!.trim() || null };
}

/** "30 Days", "45" → 45; anything else → null. */
function creditDays(s: string | null): number | null {
  const m = s?.match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

// ── Masters ──

interface Common {
  guid: string | null;
  alterId: number | null;
  name: string;
  aliases: string[];
}

function common(n: TallyNode): Common {
  // LANGUAGENAME.LIST/NAME.LIST/NAME holds the name first, then any aliases.
  const names: string[] = [];
  for (const l of kids(n, 'LANGUAGENAME.LIST')) for (const nl of kids(l, 'NAME.LIST')) for (const x of kids(nl, 'NAME')) if (x.text) names.push(x.text);
  const name = (n.attrs.NAME ?? names[0] ?? field(n, 'NAME') ?? '').trim();
  const alter = field(n, 'ALTERID');
  return {
    guid: field(n, 'GUID'),
    alterId: alter && /^\d+$/.test(alter) ? Number(alter) : null,
    name,
    aliases: [...new Set(names.filter((x) => x !== name))],
  };
}

export interface TallyGroup extends Common {
  kind: 'group';
  /** Null for a primary group. */
  parent: string | null;
  reservedName: string | null;
  /**
   * A primary group the company created itself carries its classification in Tally's flags: a revenue group is income
   * or expense, any other is asset or liability, and "deemed positive" (debit) picks expense or asset.
   */
  nature: 'asset' | 'liability' | 'income' | 'expense';
}

export interface TallyBill {
  name: string;
  date: string | null;
  side: 'debit' | 'credit';
  amount: string;
  creditDays: number | null;
}

export interface TallyLedger extends Common {
  kind: 'ledger';
  parent: string | null;
  reservedName: string | null;
  gstin: string | null;
  pan: string | null;
  stateName: string | null;
  pincode: string | null;
  address: string[];
  email: string | null;
  creditDays: number | null;
  billwise: boolean;
  opening: { side: 'debit' | 'credit'; amount: string } | null;
  openingBills: TallyBill[];
  taxType: string | null;
  /** For GST ledgers: Central Tax, State Tax, Integrated Tax or Cess. */
  gstDutyHead: string | null;
}

export interface TallyStockGroup extends Common {
  kind: 'stockgroup';
  parent: string | null;
}

export interface TallyUnit extends Common {
  kind: 'unit';
  formalName: string | null;
  decimals: number;
  simple: boolean;
}

export interface TallyGodown extends Common {
  kind: 'godown';
  parent: string | null;
}

export interface TallyBatchOpening {
  godown: string | null;
  batch: string | null;
  /** Negative when Tally carried negative stock. */
  qty: string;
  value: string | null;
}

export interface TallyStockItem extends Common {
  kind: 'stockitem';
  parent: string | null;
  unit: string | null;
  hsn: string | null;
  gstRate: string | null;
  batchwise: boolean;
  opening: { qty: string; value: string | null } | null;
  openingBatches: TallyBatchOpening[];
}

export type TallyMaster = TallyGroup | TallyLedger | TallyStockGroup | TallyUnit | TallyGodown | TallyStockItem;

const parentOf = (n: TallyNode) => {
  const p = field(n, 'PARENT');
  return p && p !== '\u0004 Primary' && p.toLowerCase() !== 'primary' ? p : null;
};

/** The latest GST detail block's value (Tally keeps one per applicable-from date). */
function latestDetail(n: TallyNode, list: string, tag: string): string | null {
  const blocks = kids(n, list).sort((a, b) => (field(b, 'APPLICABLEFROM') ?? '').localeCompare(field(a, 'APPLICABLEFROM') ?? ''));
  for (const b of blocks) {
    const direct = field(b, tag);
    if (direct) return direct;
    for (const inner of b.children) {
      const v = field(inner, tag);
      if (v) return v;
    }
  }
  return null;
}

function gstRate(n: TallyNode): string | null {
  for (const d of kids(n, 'GSTDETAILS.LIST').sort((a, b) => (field(b, 'APPLICABLEFROM') ?? '').localeCompare(field(a, 'APPLICABLEFROM') ?? ''))) {
    for (const s of kids(d, 'STATEWISEDETAILS.LIST'))
      for (const r of kids(s, 'RATEDETAILS.LIST'))
        if (field(r, 'GSTRATEDUTYHEAD') === 'IGST' || field(r, 'GSTRATEDUTYHEAD') === 'Integrated Tax') {
          const v = tallyNumber(field(r, 'GSTRATE'));
          if (v) return v;
        }
  }
  return null;
}

/**
 * Opening stock value in FactoryOS's sign: Tally writes stock (a debit) as negative, so the value is negated. Negative
 * stock (Tally allows it) keeps its negative quantity and comes out with a negative value, so the opening-stock import
 * can refuse it instead of posting it the wrong way.
 */
function stockValue(value: string | null) {
  if (value === null || /^-?0*\.?0*$/.test(value)) return value === null ? null : '0';
  return value.startsWith('-') ? value.slice(1) : `-${value}`;
}

/** Turns one exported object into a typed master, or null when it is not a master this import reads. */
export function toTallyMaster(o: TallyObject): TallyMaster | null {
  const n = o.node;
  const c = common(n);
  switch (o.tag) {
    case 'GROUP':
      return {
        ...c,
        kind: 'group',
        parent: parentOf(n),
        reservedName: n.attrs.RESERVEDNAME || null,
        nature: yes(n, 'ISREVENUE') ? (yes(n, 'ISDEEMEDPOSITIVE') ? 'expense' : 'income') : yes(n, 'ISDEEMEDPOSITIVE') ? 'asset' : 'liability',
      };
    case 'LEDGER': {
      const gstin =
        field(n, 'PARTYGSTIN') ??
        latestDetail(n, 'LEDGSTREGDETAILS.LIST', 'GSTIN') ??
        null;
      const bills: TallyBill[] = [];
      for (const b of kids(n, 'BILLALLOCATIONS.LIST')) {
        const amt = tallyAmount(field(b, 'OPENINGBALANCE'));
        if (!amt) continue;
        bills.push({ name: field(b, 'NAME') ?? '', date: tallyDate(field(b, 'BILLDATE')), ...amt, creditDays: creditDays(field(b, 'BILLCREDITPERIOD')) });
      }
      return {
        ...c,
        kind: 'ledger',
        parent: parentOf(n),
        reservedName: n.attrs.RESERVEDNAME || null,
        gstin: gstin?.toUpperCase() ?? null,
        pan: (field(n, 'INCOMETAXNUMBER') ?? field(n, 'PANNUMBER'))?.toUpperCase() ?? null,
        stateName: field(n, 'LEDSTATENAME') ?? field(n, 'STATENAME') ?? latestDetail(n, 'LEDMAILINGDETAILS.LIST', 'STATE'),
        pincode: field(n, 'PINCODE') ?? latestDetail(n, 'LEDMAILINGDETAILS.LIST', 'PINCODE'),
        address: listTexts(n, 'ADDRESS.LIST', 'ADDRESS').length
          ? listTexts(n, 'ADDRESS.LIST', 'ADDRESS')
          : kids(n, 'LEDMAILINGDETAILS.LIST').flatMap((m) => listTexts(m, 'ADDRESS.LIST', 'ADDRESS')),
        email: field(n, 'EMAIL'),
        creditDays: creditDays(field(n, 'BILLCREDITPERIOD')),
        billwise: yes(n, 'ISBILLWISEON'),
        opening: tallyAmount(field(n, 'OPENINGBALANCE')),
        openingBills: bills,
        taxType: field(n, 'TAXTYPE'),
        gstDutyHead: field(n, 'GSTDUTYHEAD'),
      };
    }
    case 'STOCKGROUP':
      return { ...c, kind: 'stockgroup', parent: parentOf(n) };
    case 'UNIT':
      return {
        ...c,
        kind: 'unit',
        formalName: field(n, 'ORIGINALNAME'),
        decimals: Number(field(n, 'DECIMALPLACES') ?? 0) || 0,
        simple: field(n, 'ISSIMPLEUNIT') ? yes(n, 'ISSIMPLEUNIT') : true,
      };
    case 'GODOWN':
      return { ...c, kind: 'godown', parent: parentOf(n) };
    case 'STOCKITEM': {
      const q = tallyQuantity(field(n, 'OPENINGBALANCE'));
      const value = tallyNumber(field(n, 'OPENINGVALUE'));
      const batches: TallyBatchOpening[] = [];
      for (const b of kids(n, 'BATCHALLOCATIONS.LIST')) {
        const bq = tallyQuantity(field(b, 'OPENINGBALANCE'));
        if (!bq || !/[1-9]/.test(bq.qty)) continue;
        const bv = tallyNumber(field(b, 'OPENINGVALUE'));
        batches.push({ godown: field(b, 'GODOWNNAME'), batch: field(b, 'BATCHNAME'), qty: bq.qty, value: stockValue(bv) });
      }
      return {
        ...c,
        kind: 'stockitem',
        parent: parentOf(n),
        // Tally's reserved "Not Applicable" means the item has no unit.
        unit: /^\s*not applicable\s*$/i.test(field(n, 'BASEUNITS') ?? '') ? null : field(n, 'BASEUNITS'),
        hsn: latestDetail(n, 'GSTDETAILS.LIST', 'HSNCODE') ?? latestDetail(n, 'HSNDETAILS.LIST', 'HSNCODE'),
        gstRate: gstRate(n),
        batchwise: yes(n, 'ISBATCHWISEON'),
        opening: q && /[1-9]/.test(q.qty) ? { qty: q.qty, value: stockValue(value) } : null,
        openingBatches: batches,
      };
    }
    default:
      return null;
  }
}

/** Tally's reserved primary groups and the classification each carries (decision 071's roots). */
export const TALLY_PRIMARY_ROOTS: Record<string, 'asset' | 'liability' | 'equity' | 'income' | 'expense'> = {
  'Capital Account': 'equity',
  'Loans (Liability)': 'liability',
  'Current Liabilities': 'liability',
  'Suspense A/c': 'liability',
  'Branch / Divisions': 'liability',
  'Fixed Assets': 'asset',
  Investments: 'asset',
  'Current Assets': 'asset',
  'Misc. Expenses (ASSET)': 'asset',
  'Sales Accounts': 'income',
  'Direct Incomes': 'income',
  'Indirect Incomes': 'income',
  'Purchase Accounts': 'expense',
  'Direct Expenses': 'expense',
  'Indirect Expenses': 'expense',
};

/**
 * The classification of a group or ledger, found by walking parents up to a reserved primary group, or to a primary
 * group the company created, whose classification `primaryNature` gives. Returns null when the chain does not reach
 * either (an unknown parent or a loop).
 */
export function tallyRoot(
  name: string,
  parentOf: (name: string) => string | null | undefined,
  primaryNature?: (name: string) => string | undefined,
) {
  const seen = new Set<string>();
  let cursor: string | null | undefined = name;
  while (cursor && !seen.has(cursor)) {
    if (TALLY_PRIMARY_ROOTS[cursor]) return TALLY_PRIMARY_ROOTS[cursor]!;
    seen.add(cursor);
    const parent = parentOf(cursor);
    if (parent === null) return primaryNature?.(cursor) ?? null;
    cursor = parent;
  }
  return null;
}

// ── Vouchers (decision 072, history) ──

export interface TallyVoucherBill {
  name: string;
  /** Tally's bill type: New Ref, Agst Ref, Advance, On Account. */
  type: string | null;
  side: 'debit' | 'credit';
  amount: string;
}

export interface TallyVoucherLine {
  ledger: string;
  side: 'debit' | 'credit';
  amount: string;
  bills: TallyVoucherBill[];
  /** True for the party's line (Tally's ISPARTYLEDGER). */
  party: boolean;
}

export interface TallyVoucherItem {
  item: string;
  qty: string | null;
  unit: string | null;
  rate: string | null;
  amount: string | null;
  /** In for a receipt of stock, out for an issue; null when Tally does not say. */
  direction: 'in' | 'out' | null;
  batches: { godown: string | null; batch: string | null; qty: string | null }[];
}

export interface TallyVoucher {
  kind: 'voucher';
  guid: string | null;
  alterId: number | null;
  type: string;
  number: string | null;
  date: string | null;
  narration: string | null;
  /** The party ledger: Tally's PARTYLEDGERNAME, else the line marked as the party's. */
  party: string | null;
  cancelled: boolean;
  optional: boolean;
  deleted: boolean;
  invoice: boolean;
  /** Every ledger amount, including those held inside inventory lines (ACCOUNTINGALLOCATIONS). */
  lines: TallyVoucherLine[];
  items: TallyVoucherItem[];
}

function voucherLine(n: TallyNode): TallyVoucherLine | null {
  const ledger = field(n, 'LEDGERNAME');
  const amt = tallyAmount(field(n, 'AMOUNT'));
  if (!ledger || !amt) return null;
  const bills: TallyVoucherBill[] = [];
  for (const b of kids(n, 'BILLALLOCATIONS.LIST')) {
    const a = tallyAmount(field(b, 'AMOUNT'));
    if (a) bills.push({ name: field(b, 'NAME') ?? '', type: field(b, 'BILLTYPE'), ...a });
  }
  return { ledger, ...amt, bills, party: yes(n, 'ISPARTYLEDGER') };
}

/** Turns an exported VOUCHER into a typed voucher, or null for anything else. */
export function toTallyVoucher(o: TallyObject): TallyVoucher | null {
  if (o.tag !== 'VOUCHER') return null;
  const n = o.node;
  const lines: TallyVoucherLine[] = [];
  const items: TallyVoucherItem[] = [];
  for (const le of [...kids(n, 'ALLLEDGERENTRIES.LIST'), ...kids(n, 'LEDGERENTRIES.LIST')]) {
    const l = voucherLine(le);
    if (l) lines.push(l);
  }
  const inventory: [string, 'in' | 'out' | null][] = [
    ['ALLINVENTORYENTRIES.LIST', null],
    ['INVENTORYENTRIES.LIST', null],
    ['INVENTORYENTRIESIN.LIST', 'in'],
    ['INVENTORYENTRIESOUT.LIST', 'out'],
  ];
  for (const [tag, direction] of inventory)
    for (const ie of kids(n, tag)) {
      // Tally writes empty inventory lists on vouchers without stock; only their accounting allocations count.
      if (!field(ie, 'STOCKITEMNAME')) {
        for (const aa of kids(ie, 'ACCOUNTINGALLOCATIONS.LIST')) {
          const l = voucherLine(aa);
          if (l) lines.push(l);
        }
        continue;
      }
      const q = tallyQuantity(field(ie, 'ACTUALQTY') ?? field(ie, 'BILLEDQTY'));
      const rate = field(ie, 'RATE');
      items.push({
        item: field(ie, 'STOCKITEMNAME') ?? '',
        qty: q ? q.qty.replace('-', '') : null,
        unit: q?.unit ?? null,
        rate: rate ? tallyNumber(rate.split('/')[0] ?? null)?.replace('-', '') ?? null : null,
        amount: tallyNumber(field(ie, 'AMOUNT'))?.replace('-', '') ?? null,
        // Tally's own flag says whether stock comes in (deemed positive) where the list name does not.
        direction: direction ?? (field(ie, 'ISDEEMEDPOSITIVE') ? (yes(ie, 'ISDEEMEDPOSITIVE') ? 'in' : 'out') : null),
        batches: kids(ie, 'BATCHALLOCATIONS.LIST').map((b) => ({
          godown: field(b, 'GODOWNNAME'),
          batch: field(b, 'BATCHNAME'),
          qty: tallyQuantity(field(b, 'ACTUALQTY'))?.qty.replace('-', '') ?? null,
        })),
      });
      for (const aa of kids(ie, 'ACCOUNTINGALLOCATIONS.LIST')) {
        const l = voucherLine(aa);
        if (l) lines.push(l);
      }
    }
  const alter = field(n, 'ALTERID');
  return {
    kind: 'voucher',
    guid: field(n, 'GUID'),
    alterId: alter ? Number(alter.trim()) : null,
    type: field(n, 'VOUCHERTYPENAME') ?? n.attrs.VCHTYPE ?? 'Voucher',
    number: field(n, 'VOUCHERNUMBER'),
    date: tallyDate(field(n, 'DATE')),
    narration: field(n, 'NARRATION'),
    party: field(n, 'PARTYLEDGERNAME') ?? lines.find((l) => l.party)?.ledger ?? null,
    cancelled: yes(n, 'ISCANCELLED'),
    optional: yes(n, 'ISOPTIONAL'),
    deleted: yes(n, 'ISDELETED') || (n.attrs.ACTION ?? '').toLowerCase() === 'delete',
    invoice: yes(n, 'ISINVOICE'),
    lines,
    items,
  };
}

/** Debits minus credits of a voucher's lines; zero for a balanced voucher. */
export function tallyVoucherImbalance(v: Pick<TallyVoucher, 'lines'>): string {
  let paise = 0n;
  for (const l of v.lines) {
    const [i, f = ''] = l.amount.split('.');
    const value = BigInt(i!) * 1_000_000n + BigInt((f + '000000').slice(0, 6));
    paise += l.side === 'debit' ? value : -value;
  }
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  return normalizeDecimal(`${neg ? '-' : ''}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, '0')}`);
}
