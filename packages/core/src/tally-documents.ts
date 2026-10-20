/**
 * Decision 075: a Tally voucher in a month kept in Tally becomes a FactoryOS document. This module only maps: it turns
 * one parsed voucher into a document draft with Tally's number, date and amounts, or lists why it cannot. Posting is
 * the API's job and goes through the same code as a document entered in FactoryOS.
 */
import { Dec } from './decimal.js';
import { tallyVoucherImbalance, type TallyVoucher } from './tally.js';

export type TallyDocumentKind = 'sales_invoice' | 'purchase_invoice' | 'sales_credit_note' | 'supplier_debit_note';
export const TALLY_DOCUMENT_KINDS: readonly TallyDocumentKind[] = ['sales_invoice', 'purchase_invoice', 'sales_credit_note', 'supplier_debit_note'];

/** Tally's base voucher types; custom types (e.g. "Sales GST") are mapped once by a person. */
export const TALLY_BASE_TYPES: Readonly<Record<string, TallyDocumentKind>> = {
  Sales: 'sales_invoice',
  Purchase: 'purchase_invoice',
  'Credit Note': 'sales_credit_note',
  'Debit Note': 'supplier_debit_note',
};

export type TaxHead = 'cgst' | 'sgst' | 'igst' | 'cess';

/** What the API resolved through the master links of decision 072. Null means not linked. */
export interface TallyDocumentLinks {
  party(ledger: string): { id: string; stateCode: string | null } | null;
  item(name: string): { id: string; gstRate: string | null } | null;
  /** A ledger booked as a service line: freight, services, or the income/expense of an accounting-mode voucher. */
  serviceItem(ledger: string): { id: string; gstRate: string | null } | null;
  taxHead(ledger: string): TaxHead | null;
  warehouse(godown: string | null): string | null;
  /** The state code of the GSTIN the document belongs to. */
  ourStateCode: string;
}

export interface TallyDocumentLine {
  itemId: string;
  qty: string;
  rate: string;
  taxableValue: string;
  gstRate: string | null;
  warehouseId: string | null;
  batch: string | null;
  /** The Tally ledger the line came from (for service lines) or was booked to (for items). */
  ledger: string | null;
}

export type TaxSplit = Record<TaxHead, string>;

export interface TallyDocumentDraft {
  kind: TallyDocumentKind;
  number: string;
  date: string;
  partyId: string;
  placeOfSupplyStateCode: string | null;
  interState: boolean;
  lines: TallyDocumentLine[];
  taxableValue: string;
  tax: TaxSplit;
  /** Rounding booked in Tally to a round-off ledger; positive raises the total. */
  roundOff: string;
  grandTotal: string;
  /** For notes: the invoice the note is against, from Tally's bill reference. */
  billReference: string | null;
  /** Set when FactoryOS's GST calculation differs from Tally's by more than a rupee on a head; Tally's figures stand. */
  taxDifference: { expected: TaxSplit; tally: TaxSplit } | null;
}

export type TallyDocumentResult = { draft: TallyDocumentDraft; problems?: undefined } | { draft?: undefined; problems: string[] };

/** Sales and customer credit notes are outward: the party is debited on a sale and credited on a credit note. */
const partySide = (kind: TallyDocumentKind): 'debit' | 'credit' => (kind === 'sales_invoice' || kind === 'supplier_debit_note' ? 'debit' : 'credit');
const ROUND_OFF = /round(ing)?[\s-]*off/i;
const TOLERANCE = Dec.of('1');
const zero = (): TaxSplit => ({ cgst: '0.00', sgst: '0.00', igst: '0.00', cess: '0.00' });

export function tallyDocument(v: TallyVoucher, kind: TallyDocumentKind, links: TallyDocumentLinks): TallyDocumentResult {
  const problems: string[] = [];
  if (!v.number) problems.push('Tally gives no voucher number.');
  if (!v.date) problems.push('Tally gives no date.');
  if (tallyVoucherImbalance(v) !== '0') problems.push(`Debits and credits differ by ${tallyVoucherImbalance(v).replace('-', '')}.`);
  const partyName = v.party;
  const party = partyName ? links.party(partyName) : null;
  if (!partyName) problems.push('The voucher has no party.');
  else if (!party) problems.push(`The party "${partyName}" is not linked to a FactoryOS party.`);

  const pSide = partySide(kind);
  // An amount on the party's own side reduces the document (e.g. a discount); on the other side it adds.
  const signed = (l: { side: 'debit' | 'credit'; amount: string }) => (l.side === pSide ? Dec.of(l.amount).neg() : Dec.of(l.amount));

  let grand = Dec.ZERO;
  const tax: Record<TaxHead, Dec> = { cgst: Dec.ZERO, sgst: Dec.ZERO, igst: Dec.ZERO, cess: Dec.ZERO };
  let roundOff = Dec.ZERO;
  // Non-party, non-tax ledger amounts by ledger; item amounts are taken out below, what is left is service lines.
  const rest = new Map<string, Dec>();
  for (const l of v.lines) {
    if (partyName && l.ledger === partyName) {
      grand = grand.add(l.side === pSide ? l.amount : Dec.of(l.amount).neg());
      continue;
    }
    const head = links.taxHead(l.ledger);
    if (head) tax[head] = tax[head].add(signed(l));
    else if (ROUND_OFF.test(l.ledger)) roundOff = roundOff.add(signed(l));
    else rest.set(l.ledger, (rest.get(l.ledger) ?? Dec.ZERO).add(signed(l)));
  }

  const lines: TallyDocumentLine[] = [];
  const known = problems.length;
  for (const it of v.items) {
    const linked = links.item(it.item);
    if (!linked) {
      problems.push(`The item "${it.item}" is not linked to a FactoryOS item.`);
      continue;
    }
    if (!it.qty || !it.amount) {
      problems.push(`The item "${it.item}" has no quantity or amount.`);
      continue;
    }
    if (it.ledger) rest.set(it.ledger, (rest.get(it.ledger) ?? Dec.ZERO).sub(it.amount));
    // One line per godown and batch; the amount is shared by quantity, the last line taking the rounding.
    const parts = it.batches.length > 1 ? it.batches : [it.batches[0] ?? { godown: null, batch: null, qty: it.qty }];
    let left = Dec.of(it.amount);
    parts.forEach((b, i) => {
      const qty = parts.length === 1 ? it.qty! : (b.qty ?? '0');
      const value = i === parts.length - 1 ? left : Dec.of(it.amount!).mul(qty).div(it.qty!);
      const taxable = Dec.of(value.toFixed(2));
      left = left.sub(taxable);
      const batch = b.batch && !/^primary batch$/i.test(b.batch) ? b.batch : null;
      const warehouseId = links.warehouse(b.godown);
      if (!warehouseId) problems.push(`The godown "${b.godown ?? 'Main Location'}" of "${it.item}" is not linked to a warehouse.`);
      lines.push({
        itemId: linked.id,
        qty,
        rate: it.rate ?? taxable.div(qty).toString(),
        taxableValue: taxable.toFixed(2),
        gstRate: linked.gstRate,
        warehouseId,
        batch,
        ledger: it.ledger ?? null,
      });
    });
  }
  for (const [ledger, amount] of rest) {
    if (amount.isZero()) continue;
    const service = links.serviceItem(ledger);
    if (!service) {
      problems.push(`The ledger "${ledger}" (${amount.abs().toFixed(2)}) needs a service item to be booked as a line.`);
      continue;
    }
    lines.push({ itemId: service.id, qty: '1', rate: amount.toString(), taxableValue: amount.toFixed(2), gstRate: service.gstRate, warehouseId: null, batch: null, ledger });
  }
  if (!lines.length && problems.length === known) problems.push('The voucher has no item or ledger to book as a line.');

  const taxable = lines.reduce((s, l) => s.add(l.taxableValue), Dec.ZERO);
  const totalTax = tax.cgst.add(tax.sgst).add(tax.igst).add(tax.cess);
  if (!problems.length && !taxable.add(totalTax).add(roundOff).eq(grand))
    problems.push(`Lines and tax (${taxable.add(totalTax).add(roundOff).toFixed(2)}) do not add up to the party's ${grand.toFixed(2)}.`);
  if (problems.length) return { problems };

  const interState = tax.igst.isZero() ? (tax.cgst.isZero() && tax.sgst.isZero() ? party!.stateCode !== links.ourStateCode : false) : true;
  const actual: TaxSplit = { cgst: tax.cgst.toFixed(2), sgst: tax.sgst.toFixed(2), igst: tax.igst.toFixed(2), cess: tax.cess.toFixed(2) };
  const expected = expectedTax(lines, interState);
  const differs = (['cgst', 'sgst', 'igst'] as const).some((h) => Dec.of(expected[h]).sub(actual[h]).abs().gt(TOLERANCE));
  const bill = v.lines.find((l) => l.ledger === partyName)?.bills.find((b) => /agst/i.test(b.type ?? '')) ?? null;
  return {
    draft: {
      kind,
      number: v.number!,
      date: v.date!,
      partyId: party!.id,
      placeOfSupplyStateCode: party!.stateCode,
      interState,
      lines,
      taxableValue: taxable.toFixed(2),
      tax: actual,
      roundOff: roundOff.toFixed(2),
      grandTotal: grand.toFixed(2),
      billReference: kind === 'sales_credit_note' || kind === 'supplier_debit_note' ? (bill?.name ?? null) : null,
      taxDifference: differs ? { expected, tally: actual } : null,
    },
  };
}

/** GST as FactoryOS would charge it on the same lines: rate × taxable value, split by the supply's state. */
function expectedTax(lines: TallyDocumentLine[], interState: boolean): TaxSplit {
  const out = zero();
  let igst = Dec.ZERO;
  let half = Dec.ZERO;
  for (const l of lines) {
    if (!l.gstRate) continue;
    const t = Dec.of(l.taxableValue).mul(l.gstRate).div('100');
    if (interState) igst = igst.add(t.toFixed(2));
    else half = half.add(t.div('2').toFixed(2));
  }
  out.igst = igst.toFixed(2);
  out.cgst = half.toFixed(2);
  out.sgst = half.toFixed(2);
  return out;
}
