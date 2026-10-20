/**
 * Decision 074 PR 1: GSTR-1 sections and GSTR-3B tables from documents, per GSTIN per month. Pure: the API gathers
 * submitted documents in INR and the GL movements; this module classifies, sums and checks. Rules follow
 * docs/compliance/gst-returns-evidence.md; those marked "not verified" there are named where they are used.
 */
import { Dec } from './decimal.js';

export type Head = 'igst' | 'cgst' | 'sgst' | 'cess';
export const HEADS: readonly Head[] = ['igst', 'cgst', 'sgst', 'cess'];
export type Taxes = Record<Head, string>;
export type Amounts = { taxable: string } & Taxes;

export interface GstLine {
  hsn: string | null;
  /** The unit's GST UQC (NOS, KGS, …), when set. */
  uqc: string | null;
  qty: string;
  gstRate: string;
  taxable: string;
  igst: string;
  cgst: string;
  sgst: string;
  cess: string;
}

export type Treatment = 'registered' | 'unregistered' | 'composition' | 'sez' | 'overseas' | 'deemed_export';

/** An outward invoice or note in INR, as the API reads it. */
export interface OutwardDoc {
  type: 'invoice' | 'credit_note' | 'debit_note';
  id: string;
  number: string;
  date: string;
  counterpartyGstin: string | null;
  treatment: Treatment;
  /** regular | sez_with_payment | sez_without_payment | export_with_payment | export_under_lut */
  supplyType: string;
  placeOfSupply: string | null;
  reverseCharge: boolean;
  portCode: string | null;
  shippingBillNo: string | null;
  shippingBillDate: string | null;
  /** The document's total in INR. */
  value: string;
  /** For a note: the original invoice's number, date and total, when known. */
  original?: { number: string; date: string; value: string } | null;
  lines: GstLine[];
}

export type Gstr1Section = 'b2b' | 'b2cl' | 'b2cs' | 'exp' | 'cdnr' | 'cdnur' | 'nil';
export type Attention = { documentId: string; number: string; reason: string; blocking: boolean };

/**
 * Inter-State invoices to unregistered persons above this value are listed one by one (B2CL). Rule 59(2) in the
 * pinned 2017 rules says ₹2.5 lakh; the lowering to ₹1 lakh from 2024-08-01 (Notification 12/2024-Central Tax) is
 * NOT VERIFIED in docs/compliance/gst-returns-evidence.md.
 */
export const b2clThreshold = (date: string) => (date >= '2024-08-01' ? '100000' : '250000');

/** HSN digits for B2B lines by aggregate turnover (Notification 78/2020-Central Tax, NOT VERIFIED). */
export const hsnDigitsRequired = (turnoverAboveFiveCrore: boolean) => (turnoverAboveFiveCrore ? 6 : 4);

const zero = (): Amounts => ({ taxable: '0.00', igst: '0.00', cgst: '0.00', sgst: '0.00', cess: '0.00' });
const plus = (a: Amounts, l: Pick<GstLine, 'taxable' | Head>, sign = 1): Amounts => {
  const s = (x: string, y: string) => (sign > 0 ? Dec.of(x).add(y) : Dec.of(x).sub(y)).toFixed(2);
  return { taxable: s(a.taxable, l.taxable), igst: s(a.igst, l.igst), cgst: s(a.cgst, l.cgst), sgst: s(a.sgst, l.sgst), cess: s(a.cess, l.cess) };
};
const sum = (lines: Pick<GstLine, 'taxable' | Head>[], sign = 1) => lines.reduce((a, l) => plus(a, l, sign), zero());
const taxOf = (a: Taxes) => HEADS.reduce((s, h) => s.add(a[h]), Dec.ZERO);

const isExport = (t: string) => t === 'export_with_payment' || t === 'export_under_lut';
const isSez = (t: string) => t === 'sez_with_payment' || t === 'sez_without_payment';
const zeroRatedLine = (l: GstLine) => Dec.of(l.gstRate).isZero();

/** What a document's taxable lines report as in GSTR-1, or why it cannot be placed. */
export function sectionOf(doc: OutwardDoc, ourState: string): { section: Exclude<Gstr1Section, 'nil'> | null; reason?: string } {
  const note = doc.type !== 'invoice';
  if (isExport(doc.supplyType)) return { section: note ? 'cdnur' : 'exp' };
  const registered = !!doc.counterpartyGstin;
  if (isSez(doc.supplyType) || doc.treatment === 'sez' || doc.treatment === 'deemed_export' || doc.treatment === 'registered' || doc.treatment === 'composition') {
    if (!registered) return { section: null, reason: 'A registered customer without a GSTIN: add it to the customer and the document, or treat the customer as unregistered.' };
    return { section: note ? 'cdnr' : 'b2b' };
  }
  if (registered) return { section: note ? 'cdnr' : 'b2b' };
  // Unregistered: invoice-wise when inter-State above the threshold; a note follows its original's section.
  const pos = doc.placeOfSupply ?? ourState;
  const value = note ? (doc.original?.value ?? doc.value) : doc.value;
  const date = note ? (doc.original?.date ?? doc.date) : doc.date;
  const large = pos !== ourState && Dec.of(value).gt(b2clThreshold(date));
  if (note) return { section: large ? 'cdnur' : 'b2cs' };
  return { section: large ? 'b2cl' : 'b2cs' };
}

export interface Gstr1Entry {
  section: Gstr1Section;
  documentId: string;
  documentType: OutwardDoc['type'];
  number: string;
  date: string;
  counterpartyGstin: string | null;
  placeOfSupply: string | null;
  /** b2b: R (regular), SEWP/SEWOP (SEZ), DE (deemed export); exp: WPAY/WOPAY; cdnur: B2CL/EXPWP/EXPWOP. */
  subtype: string | null;
  reverseCharge: boolean;
  value: string;
  /** Signed for notes: a credit note is negative. */
  amounts: Amounts;
  byRate: ({ rate: string } & Amounts)[];
  portCode: string | null;
  shippingBillNo: string | null;
  shippingBillDate: string | null;
}

export interface B2csRow extends Amounts {
  placeOfSupply: string;
  rate: string;
}
export interface NilRow {
  /** 8A inter-State registered, 8B intra-State registered, 8C inter-State unregistered, 8D intra-State unregistered. */
  table: '8A' | '8B' | '8C' | '8D';
  nil: string;
}
export interface HsnRow extends Amounts {
  part: 'b2b' | 'b2c';
  hsn: string;
  uqc: string;
  rate: string;
  qty: string;
}

export interface Gstr1 {
  entries: Gstr1Entry[];
  b2cs: B2csRow[];
  nil: NilRow[];
  hsn: HsnRow[];
  attention: Attention[];
  totals: Record<Exclude<Gstr1Section, 'nil'>, Amounts>;
}

const byRate = (lines: GstLine[], sign: number) => {
  const m = new Map<string, Amounts>();
  for (const l of lines) {
    const rate = Dec.of(l.gstRate).toFixed(2);
    m.set(rate, plus(m.get(rate) ?? zero(), l, sign));
  }
  return [...m].sort(([a], [b]) => Dec.of(a).cmp(b)).map(([rate, a]) => ({ rate, ...a }));
};

/**
 * GSTR-1 from the month's outward documents. A note reduces (credit) or adds to (debit) what it reports in; B2CS is
 * net of its notes by place of supply and rate, as Form GSTR-1 table 7 is "net of debit notes and credit notes".
 */
export function buildGstr1(docs: OutwardDoc[], ourState: string, opts: { turnoverAboveFiveCrore: boolean }): Gstr1 {
  const entries: Gstr1Entry[] = [];
  const attention: Attention[] = [];
  const b2cs = new Map<string, B2csRow>();
  const nil = new Map<NilRow['table'], Dec>();
  const hsn = new Map<string, HsnRow>();
  const totals = { b2b: zero(), b2cl: zero(), b2cs: zero(), exp: zero(), cdnr: zero(), cdnur: zero() };
  const digits = hsnDigitsRequired(opts.turnoverAboveFiveCrore);
  for (const doc of docs) {
    const sign = doc.type === 'credit_note' ? -1 : 1;
    const placed = sectionOf(doc, ourState);
    if (!placed.section) {
      attention.push({ documentId: doc.id, number: doc.number, reason: placed.reason!, blocking: true });
      continue;
    }
    const section = placed.section;
    const exportLike = section === 'exp' || (section === 'cdnur' && isExport(doc.supplyType)) || isSez(doc.supplyType);
    // 0% lines on a domestic document are nil-rated (table 8); on exports and SEZ they are zero rated.
    const taxed = exportLike ? doc.lines : doc.lines.filter((l) => !zeroRatedLine(l));
    const nilLines = exportLike ? [] : doc.lines.filter(zeroRatedLine);
    if (nilLines.length) {
      const inter = (doc.placeOfSupply ?? ourState) !== ourState;
      const table: NilRow['table'] = doc.counterpartyGstin ? (inter ? '8A' : '8B') : inter ? '8C' : '8D';
      nil.set(table, (nil.get(table) ?? Dec.ZERO).add(nilLines.reduce((s, l) => s.add(l.taxable), Dec.ZERO).mul(String(sign))));
    }
    if (isExport(doc.supplyType) && doc.type === 'invoice' && (!doc.portCode || !doc.shippingBillNo || !doc.shippingBillDate))
      attention.push({ documentId: doc.id, number: doc.number, reason: 'An export without its port code, shipping bill number and date: add them before filing.', blocking: false });
    const part: HsnRow['part'] = section === 'b2b' || section === 'cdnr' ? 'b2b' : 'b2c';
    for (const l of doc.lines) {
      const code = (l.hsn ?? '').trim();
      if (part === 'b2b' && (!/^\d+$/.test(code) || code.length < digits))
        attention.push({ documentId: doc.id, number: doc.number, reason: `HSN "${code || 'missing'}" has fewer than ${digits} digits for a B2B supply.`, blocking: false });
      const uqc = l.uqc ?? 'OTH';
      const key = `${part}|${code}|${uqc}|${Dec.of(l.gstRate).toFixed(2)}`;
      const row = hsn.get(key) ?? { part, hsn: code, uqc, rate: Dec.of(l.gstRate).toFixed(2), qty: '0.00', ...zero() };
      hsn.set(key, { ...row, ...plus(row, l, sign), qty: Dec.of(row.qty).add(Dec.of(l.qty).mul(String(sign))).toFixed(2) });
    }
    if (!taxed.length) continue;
    if (section === 'b2cs') {
      for (const l of taxed) {
        const pos = doc.placeOfSupply ?? ourState;
        const rate = Dec.of(l.gstRate).toFixed(2);
        const key = `${pos}|${rate}`;
        const row = b2cs.get(key) ?? { placeOfSupply: pos, rate, ...zero() };
        b2cs.set(key, { ...row, ...plus(row, l, sign) });
      }
      totals.b2cs = plus(totals.b2cs, sum(taxed), sign);
      continue;
    }
    const amounts = sum(taxed, sign);
    totals[section] = plus(totals[section], amounts);
    const subtype =
      section === 'b2b'
        ? doc.supplyType === 'sez_with_payment'
          ? 'SEWP'
          : doc.supplyType === 'sez_without_payment'
            ? 'SEWOP'
            : doc.treatment === 'deemed_export'
              ? 'DE'
              : 'R'
        : section === 'exp'
          ? doc.supplyType === 'export_with_payment'
            ? 'WPAY'
            : 'WOPAY'
          : section === 'cdnur'
            ? isExport(doc.supplyType)
              ? doc.supplyType === 'export_with_payment'
                ? 'EXPWP'
                : 'EXPWOP'
              : 'B2CL'
            : null;
    entries.push({
      section,
      documentId: doc.id,
      documentType: doc.type,
      number: doc.number,
      date: doc.date,
      counterpartyGstin: doc.counterpartyGstin,
      placeOfSupply: doc.placeOfSupply,
      subtype,
      reverseCharge: doc.reverseCharge,
      value: doc.value,
      amounts,
      byRate: byRate(taxed, sign),
      portCode: doc.portCode,
      shippingBillNo: doc.shippingBillNo,
      shippingBillDate: doc.shippingBillDate,
    });
  }
  const order = (a: string, b: string) => a.localeCompare(b);
  return {
    entries: entries.sort((a, b) => order(a.section, b.section) || order(a.date, b.date) || order(a.number, b.number)),
    b2cs: [...b2cs.values()].sort((a, b) => order(a.placeOfSupply, b.placeOfSupply) || Dec.of(a.rate).cmp(b.rate)),
    nil: (['8A', '8B', '8C', '8D'] as const).filter((t) => nil.has(t)).map((table) => ({ table, nil: nil.get(table)!.toFixed(2) })),
    hsn: [...hsn.values()].sort((a, b) => order(a.part, b.part) || order(a.hsn, b.hsn) || Dec.of(a.rate).cmp(b.rate)),
    attention,
    totals,
  };
}

// ───────────────────────── document summary (GSTR-1 table 13) ─────────────────────────

export interface IssuedDocument {
  nature: 'invoice' | 'credit_note' | 'debit_note';
  number: string;
  cancelled: boolean;
}
export interface DocSummaryRow {
  nature: IssuedDocument['nature'];
  series: string;
  from: string;
  to: string;
  total: number;
  cancelled: number;
  /** Numbers missing between from and to that are neither issued nor cancelled. */
  gaps: string[];
}

/** Series are the number without its trailing counter; the counter keeps its width. */
export function documentSummary(docs: IssuedDocument[]): DocSummaryRow[] {
  const groups = new Map<string, { nature: IssuedDocument['nature']; series: string; width: number; seen: Map<bigint, IssuedDocument> }>();
  for (const d of docs) {
    const m = /^(.*?)(\d+)$/.exec(d.number);
    const series = m ? m[1]! : d.number;
    const key = `${d.nature}|${series}`;
    const g = groups.get(key) ?? { nature: d.nature, series, width: m ? m[2]!.length : 0, seen: new Map() };
    g.seen.set(m ? BigInt(m[2]!) : BigInt(g.seen.size), d);
    groups.set(key, g);
  }
  const out: DocSummaryRow[] = [];
  for (const g of groups.values()) {
    const nums = [...g.seen.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const lo = nums[0]!,
      hi = nums.at(-1)!;
    const gaps: string[] = [];
    if (g.width && hi - lo < 10000n)
      for (let n = lo; n <= hi; n++) if (!g.seen.has(n)) gaps.push(`${g.series}${n.toString().padStart(g.width, '0')}`);
    out.push({
      nature: g.nature,
      series: g.series,
      from: g.seen.get(lo)!.number,
      to: g.seen.get(hi)!.number,
      total: g.seen.size,
      cancelled: [...g.seen.values()].filter((d) => d.cancelled).length,
      gaps,
    });
  }
  return out.sort((a, b) => a.nature.localeCompare(b.nature) || a.series.localeCompare(b.series));
}

// ───────────────────────── GSTR-3B ─────────────────────────

/** An inward document's tax as 3B table 4 sees it. */
export interface InwardDoc {
  id: string;
  number: string;
  /** purchase invoice, supplier credit or debit note, bank charge, Bill of Entry IGST (landed cost). */
  kind: 'purchase_invoice' | 'supplier_credit_note' | 'supplier_debit_note' | 'bank_charge' | 'bill_of_entry';
  reverseCharge: boolean;
  /** Import of services, booked on a purchase invoice under reverse charge. */
  importOfServices: boolean;
  itcEligible: boolean;
  supplierState: string | null;
  /** The supplier is under composition, so its supply is reported in table 5. */
  composition: boolean;
  lines: Pick<GstLine, 'gstRate' | 'taxable' | Head>[];
}

export interface Gstr3b {
  '3.1': { a: Amounts; b: Amounts; c: Amounts; d: Amounts; e: Amounts };
  '3.2': { placeOfSupply: string; unregistered: { taxable: string; igst: string }; composition: { taxable: string; igst: string } }[];
  '4': { a1: Taxes; a2: Taxes; a3: Taxes; a4: Taxes; a5: Taxes; b1: Taxes; b2: Taxes; c: Taxes; d1: Taxes; d2: Taxes };
  '5': { compositionExemptNil: { inter: string; intra: string }; nonGst: { inter: string; intra: string } };
  '6.1': Taxes;
}

const taxes = (a: Amounts): Taxes => ({ igst: a.igst, cgst: a.cgst, sgst: a.sgst, cess: a.cess });
const zt = (): Taxes => ({ igst: '0.00', cgst: '0.00', sgst: '0.00', cess: '0.00' });
const addT = (a: Taxes, b: Taxes, sign = 1): Taxes =>
  Object.fromEntries(HEADS.map((h) => [h, (sign > 0 ? Dec.of(a[h]).add(b[h]) : Dec.of(a[h]).sub(b[h])).toFixed(2)])) as Taxes;

/**
 * GSTR-3B from the same outward documents (through their GSTR-1) and the month's inward documents. Outward supplies
 * under reverse charge carry no tax for us; their value is in 3.1(a) with nil tax, a placement to confirm on the
 * portal (named in the evidence file). Table 4(B) reversals are not booked in FactoryOS yet and stay zero.
 */
export function buildGstr3b(g1: Gstr1, docs: OutwardDoc[], inward: InwardDoc[], ourState: string): Gstr3b {
  let a31 = zero(),
    b31 = zero(),
    c31 = zero();
  const byId = new Map(docs.map((d) => [d.id, d]));
  for (const e of g1.entries) {
    const doc = byId.get(e.documentId)!;
    const zeroRated = e.section === 'exp' || (e.section === 'cdnur' && isExport(doc.supplyType)) || isSez(doc.supplyType);
    const amounts = doc.reverseCharge ? { ...e.amounts, igst: '0.00', cgst: '0.00', sgst: '0.00', cess: '0.00' } : e.amounts;
    if (zeroRated) b31 = plus(b31, amounts);
    else a31 = plus(a31, amounts);
  }
  for (const r of g1.b2cs) a31 = plus(a31, r);
  for (const n of g1.nil) c31 = plus(c31, { taxable: n.nil, igst: '0', cgst: '0', sgst: '0', cess: '0' });
  // 3.2: inter-State supplies to unregistered and composition persons, by place of supply.
  const s32 = new Map<string, Gstr3b['3.2'][number]>();
  const add32 = (pos: string, who: 'unregistered' | 'composition', taxable: string, igst: string) => {
    const row = s32.get(pos) ?? { placeOfSupply: pos, unregistered: { taxable: '0.00', igst: '0.00' }, composition: { taxable: '0.00', igst: '0.00' } };
    row[who] = { taxable: Dec.of(row[who].taxable).add(taxable).toFixed(2), igst: Dec.of(row[who].igst).add(igst).toFixed(2) };
    s32.set(pos, row);
  };
  for (const r of g1.b2cs) if (r.placeOfSupply !== ourState) add32(r.placeOfSupply, 'unregistered', r.taxable, r.igst);
  for (const e of g1.entries) {
    const doc = byId.get(e.documentId)!;
    if ((e.section === 'b2cl' || (e.section === 'cdnur' && e.subtype === 'B2CL')) && (doc.placeOfSupply ?? ourState) !== ourState)
      add32(doc.placeOfSupply!, 'unregistered', e.amounts.taxable, e.amounts.igst);
    if (doc.treatment === 'composition' && (e.section === 'b2b' || e.section === 'cdnr') && (doc.placeOfSupply ?? ourState) !== ourState)
      add32(doc.placeOfSupply!, 'composition', e.amounts.taxable, e.amounts.igst);
  }
  // Inward.
  let d31 = zero();
  const t4 = { a1: zt(), a2: zt(), a3: zt(), a4: zt(), a5: zt(), b1: zt(), b2: zt(), c: zt(), d1: zt(), d2: zt() };
  const t5 = { compositionExemptNil: { inter: Dec.ZERO, intra: Dec.ZERO }, nonGst: { inter: Dec.ZERO, intra: Dec.ZERO } };
  for (const d of inward) {
    const sign = d.kind === 'supplier_credit_note' ? -1 : 1;
    const taxedLines = d.lines.filter((l) => !Dec.of(l.gstRate).isZero() || taxOf(l).gt('0'));
    const exemptLines = d.composition ? d.lines : d.lines.filter((l) => Dec.of(l.gstRate).isZero() && taxOf(l).isZero());
    const inter = (d.supplierState ?? ourState) !== ourState;
    const exemptValue = exemptLines.reduce((s, l) => s.add(l.taxable), Dec.ZERO).mul(String(sign));
    if (inter) t5.compositionExemptNil.inter = t5.compositionExemptNil.inter.add(exemptValue);
    else t5.compositionExemptNil.intra = t5.compositionExemptNil.intra.add(exemptValue);
    if (d.composition) continue;
    const amounts = sum(taxedLines, sign);
    if (d.reverseCharge) d31 = plus(d31, amounts);
    const t = taxes(amounts);
    if (!d.itcEligible) t4.d1 = addT(t4.d1, t);
    else if (d.kind === 'bill_of_entry') t4.a1 = addT(t4.a1, t);
    else if (d.importOfServices) t4.a2 = addT(t4.a2, t);
    else if (d.reverseCharge) t4.a3 = addT(t4.a3, t);
    else t4.a5 = addT(t4.a5, t);
  }
  const available = [t4.a1, t4.a2, t4.a3, t4.a4, t4.a5].reduce((s, x) => addT(s, x), zt());
  t4.c = addT(addT(available, t4.b1, -1), t4.b2, -1);
  const payable = addT(addT(taxes(a31), taxes(b31)), taxes(d31));
  return {
    '3.1': { a: a31, b: b31, c: c31, d: d31, e: zero() },
    '3.2': [...s32.values()].sort((x, y) => x.placeOfSupply.localeCompare(y.placeOfSupply)),
    '4': t4,
    '5': {
      compositionExemptNil: { inter: t5.compositionExemptNil.inter.toFixed(2), intra: t5.compositionExemptNil.intra.toFixed(2) },
      nonGst: { inter: t5.nonGst.inter.toFixed(2), intra: t5.nonGst.intra.toFixed(2) },
    },
    '6.1': payable,
  };
}

// ───────────────────────── checks ─────────────────────────

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** GSTR-1 output tax (excluding reverse charge) against 3B 3.1(a) and (b). */
export function checkGstr1Against3b(g1: Gstr1, g3: Gstr3b, docs: OutwardDoc[]): Check {
  const rc = new Set(docs.filter((d) => d.reverseCharge).map((d) => d.id));
  let tax = g1.b2cs.reduce((s, r) => s.add(taxOf(r)), Dec.ZERO);
  for (const e of g1.entries) if (!rc.has(e.documentId)) tax = tax.add(taxOf(e.amounts));
  const b3 = taxOf(g3['3.1'].a).add(taxOf(g3['3.1'].b));
  return { name: 'GSTR-1 tax equals 3B 3.1 output tax', ok: tax.eq(b3), detail: `GSTR-1 ${tax.toFixed(2)}, 3B ${b3.toFixed(2)}` };
}

/**
 * Return tax against the GST ledgers' movements in the month, per head. `ledger` is what the GL holds; a difference
 * names the vouchers whose GST lines no document in the return explains.
 */
export function checkAgainstLedger(label: string, expected: Taxes, ledger: Taxes, unexplained: string[]): Check {
  const diff = HEADS.map((h) => ({ h, d: Dec.of(ledger[h]).sub(expected[h]) })).filter((x) => !x.d.isZero());
  return {
    name: label,
    ok: !diff.length,
    detail: diff.length ? `${diff.map((x) => `${x.h.toUpperCase()} ${x.d.toFixed(2)}`).join(', ')}${unexplained.length ? `; vouchers: ${unexplained.slice(0, 20).join(', ')}` : ''}` : 'Matches the general ledger',
  };
}

/** The document summary has no numbers missing that are not shown as cancelled. */
export function checkDocumentSeries(rows: DocSummaryRow[]): Check {
  const gaps = rows.flatMap((r) => r.gaps);
  return { name: 'Document series have no unexplained gaps', ok: !gaps.length, detail: gaps.length ? `Missing: ${gaps.slice(0, 20).join(', ')}` : 'No gaps' };
}
