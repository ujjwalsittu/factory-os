/**
 * Decision 075 PR 2: receipts, payments, journals and stock journals from months kept in Tally. Like
 * tally-documents.ts this only maps a parsed voucher to a draft, or lists why it cannot; posting is the API's job.
 */
import { Dec } from './decimal.js';
import { tallyVoucherImbalance, type TallyVoucher } from './tally.js';

/** A ledger as FactoryOS knows it through the master links: a GL account (cash or bank or not) or a party. */
export type TallyLedgerTarget = { kind: 'account'; id: string; cash: boolean } | { kind: 'party'; id: string };

export interface TallyEntryLinks {
  ledger(name: string): TallyLedgerTarget | null;
  item(name: string): { id: string } | null;
  warehouse(godown: string | null): string | null;
}

/** Tally's bill types that settle an existing bill; the rest (New Ref, Advance, On Account) stay on account. */
const AGAINST = /agst/i;

// ───────────────────────── receipts and payments ─────────────────────────

export interface TallySettlementDraft {
  kind: 'receipt' | 'payment';
  number: string;
  date: string;
  partyId: string;
  /** The cash or bank ledger's account. */
  accountId: string;
  amount: string;
  /** Tally's "Agst Ref" allocations, each settling its own amount of the bill with that reference. */
  bills: { reference: string; amount: string }[];
  /** New Ref, Advance, On Account and any amount not allocated: held on account for the party. */
  onAccount: string;
}

export type TallySettlementResult =
  | { draft: TallySettlementDraft; journal?: undefined; problems?: undefined }
  /** Not the plain shape of one party and one cash or bank ledger: booked as a journal instead. */
  | { journal: true; draft?: undefined; problems?: undefined }
  | { problems: string[]; draft?: undefined; journal?: undefined };

/**
 * A receipt (party credited, cash or bank debited) or payment (the other way round) with exactly one party ledger and
 * one cash or bank ledger becomes a FactoryOS receipt or payment. Anything else (TDS, charges, several parties, a
 * receipt from no party) is a journal, so it still reaches the books.
 */
export function tallySettlement(v: TallyVoucher, kind: 'receipt' | 'payment', links: TallyEntryLinks): TallySettlementResult {
  const problems = basics(v);
  if (problems.length) return { problems };
  const unlinked = v.lines.filter((l) => !links.ledger(l.ledger));
  if (unlinked.length) return { problems: unlinked.map((l) => `The ledger "${l.ledger}" is not linked to FactoryOS.`) };
  if (v.lines.length !== 2) return { journal: true };
  const targets = v.lines.map((l) => ({ line: l, target: links.ledger(l.ledger)! }));
  const partyLine = targets.find((t) => t.target.kind === 'party');
  const cashLine = targets.find((t) => t.target.kind === 'account' && t.target.cash);
  if (!partyLine || !cashLine) return { journal: true };
  // A receipt credits the party; a refund booked as a receipt (party debited) is a journal.
  if (partyLine.line.side !== (kind === 'receipt' ? 'credit' : 'debit')) return { journal: true };
  const amount = Dec.of(partyLine.line.amount);
  const bills: { reference: string; amount: string }[] = [];
  let allocated = Dec.ZERO;
  for (const b of partyLine.line.bills) {
    if (!AGAINST.test(b.type ?? '') || !b.name) continue;
    const a = Dec.of(b.amount);
    if (!a.gt('0')) continue;
    bills.push({ reference: b.name, amount: a.toFixed(2) });
    allocated = allocated.add(a);
  }
  if (allocated.gt(amount)) return { problems: [`Bill allocations (${allocated.toFixed(2)}) exceed the amount (${amount.toFixed(2)}).`] };
  return {
    draft: {
      kind,
      number: v.number!,
      date: v.date!,
      partyId: partyLine.target.id,
      accountId: cashLine.target.id,
      amount: amount.toFixed(2),
      bills,
      onAccount: amount.sub(allocated).toFixed(2),
    },
  };
}

// ───────────────────────── journals and contra ─────────────────────────

export interface TallyJournalLine {
  /** Set for a GL ledger; a party line names the party and the API books it to the party's control account. */
  accountId: string | null;
  partyId: string | null;
  debit: string;
  credit: string;
  /** For a party line: the bill it settles ("Agst Ref") or opens ("New Ref"); null leaves it on account. */
  billReference: string | null;
}

export interface TallyJournalDraft {
  number: string;
  date: string;
  narration: string;
  lines: TallyJournalLine[];
}

export type TallyJournalResult = { draft: TallyJournalDraft; problems?: undefined } | { problems: string[]; draft?: undefined };

/** Every ledger line as booked in Tally; a party line is split by its bill allocations so each carries its reference. */
export function tallyJournal(v: TallyVoucher, links: TallyEntryLinks): TallyJournalResult {
  const problems = basics(v);
  for (const l of v.lines) if (!links.ledger(l.ledger)) problems.push(`The ledger "${l.ledger}" is not linked to FactoryOS.`);
  if (problems.length) return { problems };
  const lines: TallyJournalLine[] = [];
  const add = (side: 'debit' | 'credit', amount: Dec, rest: Omit<TallyJournalLine, 'debit' | 'credit'>) => {
    if (amount.isZero()) return;
    const value = amount.toFixed(2);
    lines.push({ ...rest, debit: side === 'debit' ? value : '0', credit: side === 'credit' ? value : '0' });
  };
  for (const l of v.lines) {
    const t = links.ledger(l.ledger)!;
    if (t.kind === 'account') {
      add(l.side, Dec.of(l.amount), { accountId: t.id, partyId: null, billReference: null });
      continue;
    }
    let left = Dec.of(l.amount);
    for (const b of l.bills) {
      const a = Dec.of(b.amount);
      if (!a.gt('0') || !b.name || /advance|on account/i.test(b.type ?? '')) continue;
      const share = a.gt(left) ? left : a;
      add(l.side, share, { accountId: null, partyId: t.id, billReference: b.name });
      left = left.sub(share);
    }
    add(l.side, left, { accountId: null, partyId: t.id, billReference: null });
  }
  return { draft: { number: v.number!, date: v.date!, narration: (v.narration ?? `Tally ${v.type} ${v.number}`).slice(0, 1000), lines } };
}

// ───────────────────────── stock journals ─────────────────────────

export interface TallyStockLine {
  itemId: string;
  qty: string;
  /** Tally's value of the line; consumption leaves at FIFO cost, production comes in at this value. */
  value: string;
  warehouseId: string;
  batch: string | null;
}

export type TallyStockDraft =
  | { kind: 'transfer'; number: string; date: string; moves: { itemId: string; qty: string; from: string; to: string; batch: string | null }[] }
  | { kind: 'adjustment'; number: string; date: string; out: TallyStockLine[]; in: TallyStockLine[] };

export type TallyStockResult = { draft: TallyStockDraft; problems?: undefined } | { problems: string[]; draft?: undefined };

/**
 * A stock journal that only moves items between godowns (each item out of one godown and into another, same
 * quantity) is a transfer. Anything else (consumption into production, a change of item) is an adjustment out of
 * what was consumed and an adjustment in of what was produced at Tally's value.
 */
export function tallyStockJournal(v: TallyVoucher, links: TallyEntryLinks): TallyStockResult {
  const problems = basics(v, false);
  const out: TallyStockLine[] = [];
  const inn: TallyStockLine[] = [];
  for (const it of v.items) {
    const item = links.item(it.item);
    if (!item) {
      problems.push(`The item "${it.item}" is not linked to a FactoryOS item.`);
      continue;
    }
    if (!it.direction || !it.qty) {
      problems.push(`The item "${it.item}" has no direction or quantity.`);
      continue;
    }
    const parts = it.batches.length ? it.batches : [{ godown: null, batch: null, qty: it.qty }];
    let left = Dec.of(it.amount ?? '0');
    parts.forEach((b, i) => {
      const qty = parts.length === 1 ? it.qty! : (b.qty ?? '0');
      const value = i === parts.length - 1 ? left : Dec.of(Dec.of(it.amount ?? '0').mul(qty).div(it.qty!).toFixed(2));
      left = left.sub(value);
      const warehouseId = links.warehouse(b.godown);
      if (!warehouseId) {
        problems.push(`The godown "${b.godown ?? 'Main Location'}" of "${it.item}" is not linked to a warehouse.`);
        return;
      }
      const batch = b.batch && !/^primary batch$/i.test(b.batch) ? b.batch : null;
      (it.direction === 'out' ? out : inn).push({ itemId: item.id, qty, value: value.toFixed(2), warehouseId, batch });
    });
  }
  if (!out.length && !inn.length && !problems.length) problems.push('The stock journal moves no stock.');
  if (problems.length) return { problems };
  // A pure transfer: one line out and one line in per item, same quantity and batch, different godowns.
  const items = new Set([...out, ...inn].map((l) => l.itemId));
  const transfer =
    out.length === items.size &&
    inn.length === items.size &&
    [...items].every((id) => {
      const o = out.find((l) => l.itemId === id),
        i = inn.find((l) => l.itemId === id);
      return !!o && !!i && Dec.of(o.qty).eq(i.qty) && o.batch === i.batch && o.warehouseId !== i.warehouseId;
    });
  if (transfer)
    return {
      draft: {
        kind: 'transfer',
        number: v.number!,
        date: v.date!,
        moves: out.map((o) => ({ itemId: o.itemId, qty: o.qty, from: o.warehouseId, to: inn.find((i) => i.itemId === o.itemId)!.warehouseId, batch: o.batch })),
      },
    };
  return { draft: { kind: 'adjustment', number: v.number!, date: v.date!, out, in: inn } };
}

function basics(v: TallyVoucher, balanced = true) {
  const problems: string[] = [];
  if (!v.number) problems.push('Tally gives no voucher number.');
  if (!v.date) problems.push('Tally gives no date.');
  if (balanced && tallyVoucherImbalance(v) !== '0') problems.push(`Debits and credits differ by ${tallyVoucherImbalance(v).replace('-', '')}.`);
  return problems;
}
