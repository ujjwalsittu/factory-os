import { Dec } from '@factoryos/core';
import type { TallyBill, TallyLedger, TallyMaster, TallyStockItem } from '@factoryos/core/tally';
import { accountGroup, accountingSettings, glAccount, item, openingWorksheet, stockEntry, stockEntryLine, tallyLink, type OpeningBill, type OpeningLine } from '@factoryos/db';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { AuditService } from '../../common/audit.service.js';
import { businessDate, type Db, type Tx } from '../accounting/accounting-lock.js';
import type { GlPostingService } from '../accounting/gl-posting.service.js';

/**
 * Decisions 072 and 073: Tally opening balances and opening stock. Ledger balances become opening worksheet lines, party
 * balances become outstanding bills, item openings become one draft stock receipt per godown, and whatever does not
 * balance goes to "Opening difference (Tally)" once the user accepts the amount. Only before accounting is active.
 */

export type OpeningMode = 'account' | 'party' | 'pnl';
export interface OpeningPayload {
  ledgerGuid: string | null;
  mode: OpeningMode;
  side: 'debit' | 'credit';
  amount: string;
  bills: TallyBill[];
}
export interface StockAllocation {
  godown: string | null;
  batch: string | null;
  qty: string;
  value: string | null;
}
export interface StockPayload {
  itemGuid: string | null;
  allocations: StockAllocation[];
}

type Staged = {
  kind: 'opening' | 'stock';
  guid: string | null;
  alterId: number | null;
  name: string;
  payload: Record<string, unknown>;
  proposed: 'new' | 'link' | 'conflict' | 'skip';
  targetId: string | null;
  candidates: { id: string; label: string; reason: string }[];
  notes: string[];
};
type MasterRow = { kind: string; guid: string | null; name: string; proposed: string; targetId: string | null };
/** The same Tally object: by GUID, or by name for an object exported without one. */
const sameObject = (r: MasterRow, m: TallyMaster) => (m.guid ? r.guid === m.guid : r.guid === null && r.name === m.name);

const PNL_NAME = 'Profit & Loss A/c';
const DIFFERENCE_NAME = 'Opening difference (Tally)';
/** Tally's default godown, used when an item's opening has no godown allocation. */
export const MAIN_LOCATION = 'Main Location';
/** Tally's batch name for items without batches. */
const NO_BATCH = new Set(['primary batch', 'any', '']);

const signed = (side: 'debit' | 'credit', amount: string) => (side === 'debit' ? Dec.of(amount) : Dec.of(amount).neg());
/** Rate kept to six decimals; the value FactoryOS books is quantity × rate, the same product the cut-over checks. */
export const stockRate = (a: StockAllocation) => (a.value === null || Dec.of(a.qty).isZero() ? Dec.ZERO : Dec.of(a.value).div(a.qty));
const stockValue = (a: StockAllocation) => Dec.of(a.qty).mul(stockRate(a));

/** The tax posting role a Tally tax ledger's balance belongs to, by duty head and side. */
function taxRole(l: TallyLedger, side: 'debit' | 'credit'): string | null {
  const head = (l.gstDutyHead ?? '').toLowerCase();
  // TallyPrime writes CGST, SGST/UTGST, IGST and Cess; older releases write Central Tax, State Tax, Integrated Tax.
  const kind = /^(cgst|central)/.test(head) ? 'cgst' : /^(sgst|utgst|state|ut )/.test(head) ? 'sgst' : /^(igst|integrated)/.test(head) ? 'igst' : head.startsWith('cess') ? 'cess' : null;
  if (kind) return `${side === 'debit' ? 'input' : 'output'}_${kind}`;
  const type = (l.taxType ?? '').toLowerCase();
  if (type === 'tds' || /\btds\b/i.test(l.name)) return side === 'debit' ? 'tds_receivable' : 'tds_payable';
  if (type === 'tcs' || /\btcs\b/i.test(l.name)) return side === 'debit' ? 'tcs_recoverable' : 'tcs_payable';
  return null;
}

/** Role → account id: the entity's mappings first, then the standard chart's own roles. */
async function roleAccounts(tx: Db, entityId: string) {
  const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
  const accounts = await tx.select().from(glAccount).where(eq(glAccount.entityId, entityId));
  const roles = new Map<string, string>(accounts.filter((a) => a.role).map((a) => [a.role!, a.id]));
  for (const [role, id] of Object.entries(settings?.mappings ?? {})) roles.set(role, id);
  return { roles, accounts, active: !!settings?.active };
}

/** Opening-balance and opening-stock rows for an import, proposed from the masters' own proposals. */
export async function stageOpenings(
  tx: Db,
  entityId: string,
  masters: TallyMaster[],
  masterRows: MasterRow[],
  under: (group: string | null, target: string) => boolean,
): Promise<Staged[]> {
  const { roles, accounts, active } = await roleAccounts(tx, entityId);
  const label = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.name} · ${a.code}` : 'Ledger';
  };
  const closed = 'Accounting is active, so opening balances and opening stock are closed (the cut-over is done).';
  const out: Staged[] = [];
  const items = masters.filter((m): m is TallyStockItem => m.kind === 'stockitem');
  const stockRows = items.map((m) => ({ m, allocations: allocationsOf(m) })).filter((x) => x.allocations.length);

  for (const m of masters) {
    if (m.kind !== 'ledger') continue;
    const opening = m.opening && !Dec.of(m.opening.amount).isZero() ? m.opening : null;
    if (!opening && !m.openingBills.length) continue;
    const side = opening?.side ?? 'debit';
    const amount = opening?.amount ?? '0';
    const row = masterRows.find((r) => sameObject(r, m) && (r.kind === 'ledger' || r.kind === 'party'));
    const mode: OpeningMode = row?.kind === 'party' ? 'party' : m.reservedName === PNL_NAME || m.name.toLowerCase() === PNL_NAME.toLowerCase() ? 'pnl' : 'account';
    const payload: OpeningPayload = { ledgerGuid: m.guid, mode, side, amount, bills: m.openingBills };
    const push = (s: Partial<Staged>) =>
      out.push({ kind: 'opening', guid: m.guid, alterId: m.alterId, name: m.name, payload: payload as unknown as Record<string, unknown>, proposed: 'new', targetId: null, candidates: [], notes: [], ...s });
    if (active) {
      push({ proposed: 'skip', notes: [closed] });
      continue;
    }
    if (mode === 'party') {
      const notes = m.openingBills.length ? [`${m.openingBills.length} bill${m.openingBills.length === 1 ? '' : 's'} from Tally become outstanding bills.`] : ['No bill-wise details in Tally; the balance becomes one "On account" bill.'];
      push({ notes: [...notes, row?.proposed === 'skip' ? 'The party is skipped; skip this balance too, or include the party.' : 'Goes to the party this import creates or links.'] });
      continue;
    }
    if (mode === 'pnl') {
      push({ notes: [`Accumulated profit or loss goes to "${PNL_NAME}" under Reserves & Surplus (decision 073).`] });
      continue;
    }
    if (stockRows.length && under(m.parent, 'Stock-in-Hand')) {
      push({ proposed: 'skip', notes: ["Opening stock comes from the items' openings; this stock ledger's balance would count it twice."] });
      continue;
    }
    if (row && ['link', 'update', 'unchanged'].includes(row.proposed) && row.targetId) {
      push({ proposed: 'link', targetId: row.targetId, candidates: [{ id: row.targetId, label: label(row.targetId), reason: 'The ledger it links to' }] });
      continue;
    }
    if (row && (row.proposed === 'new' || row.proposed === 'conflict')) {
      push({ notes: ['Goes to the ledger this import creates or links.'] });
      continue;
    }
    // The master is skipped: tax ledgers go to the posting ledger for their duty head and side.
    const role = taxRole(m, side);
    const target = role ? roles.get(role) : undefined;
    if (target) push({ proposed: 'link', targetId: target, candidates: [{ id: target, label: label(target), reason: 'Posting ledger for this tax and side' }] });
    else push({ proposed: 'conflict', notes: ['The ledger is not imported. Choose the FactoryOS ledger that takes its balance, or skip it.'] });
  }

  const stockLinks = await tx.select().from(tallyLink).where(and(eq(tallyLink.entityId, entityId), eq(tallyLink.kind, 'stock')));
  const entries = stockLinks.length ? await tx.select().from(stockEntry).where(inArray(stockEntry.id, stockLinks.map((l) => l.targetId))) : [];
  // Only a submitted receipt blocks a re-import; a cancelled or deleted one is replaced by a new draft.
  const submittedGodowns = new Set(stockLinks.filter((l) => entries.find((e) => e.id === l.targetId)?.status === 'submitted').map((l) => l.guid));
  for (const { m, allocations } of stockRows) {
    const payload: StockPayload = { itemGuid: m.guid, allocations };
    const push = (s: Partial<Staged>) =>
      out.push({ kind: 'stock', guid: m.guid, alterId: m.alterId, name: m.name, payload: payload as unknown as Record<string, unknown>, proposed: 'new', targetId: null, candidates: [], notes: [], ...s });
    const row = masterRows.find((r) => sameObject(r, m) && r.kind === 'stockitem');
    const negative = allocations.filter((a) => Dec.of(a.qty).isNeg());
    const submitted = allocations.map((a) => a.godown ?? MAIN_LOCATION).filter((g) => submittedGodowns.has(godownKey(g)));
    if (active) push({ proposed: 'skip', notes: [closed] });
    else if (negative.length)
      push({
        proposed: 'conflict',
        notes: [`Tally shows negative opening stock (${negative.map((a) => a.qty).join(', ')}). FactoryOS cannot receive a negative quantity: correct it in Tally and export again, or skip it (decision 073).`],
      });
    else if (submitted.length) push({ proposed: 'skip', notes: [`Opening stock for ${[...new Set(submitted)].join(', ')} was already submitted in FactoryOS; change it there.`] });
    else if (row?.proposed === 'skip') push({ proposed: 'skip', notes: ['The item is skipped.'] });
    else push({ notes: allocations.some((a) => a.value === null) ? ['Tally gives no value for part of this stock; it is valued at zero.'] : [] });
  }
  return out;
}

const godownKey = (name: string) => `godown:${name}`;

function allocationsOf(m: TallyStockItem): StockAllocation[] {
  const fromBatches = m.openingBatches.filter((b) => !Dec.of(b.qty).isZero()).map((b) => ({ godown: b.godown, batch: b.batch, qty: b.qty, value: b.value }));
  if (fromBatches.length) return fromBatches;
  return m.opening && !Dec.of(m.opening.qty).isZero() ? [{ godown: null, batch: null, qty: m.opening.qty, value: m.opening.value }] : [];
}

/** What a row of these kinds may be set to. */
export function openingActions(row: { kind: string; proposed: string; payload: unknown; notes?: string[] | null }): ('new' | 'link' | 'skip')[] {
  if (row.kind === 'stock') {
    const p = row.payload as StockPayload;
    return p.allocations.some((a) => Dec.of(a.qty).isNeg()) ? ['skip'] : ['new', 'skip'];
  }
  const p = row.payload as OpeningPayload;
  if (p.mode === 'party') return ['new', 'skip'];
  return ['new', 'link', 'skip'];
}

/** Ledger balances, stock value and the difference for the rows as currently decided. */
export function openingSummary(rows: { kind: string; action: string; payload: unknown }[]) {
  let ledgers = Dec.ZERO;
  let stock = Dec.ZERO;
  let included = 0;
  for (const r of rows) {
    if (r.action === 'skip' || r.action === 'conflict') continue;
    if (r.kind === 'opening') {
      const p = r.payload as OpeningPayload;
      ledgers = ledgers.add(signed(p.side, p.amount));
      included++;
    } else if (r.kind === 'stock') {
      for (const a of (r.payload as StockPayload).allocations) stock = stock.add(stockValue(a));
      included++;
    }
  }
  // Debits minus credits: zero when Tally's openings balance. The difference line takes the other side.
  const difference = ledgers.add(stock);
  return { included, ledgers: ledgers.toString(), stock: stock.toString(), difference: difference.toString() };
}

/** Writes the worksheet and the draft opening stock receipts at the end of a commit. */
export class OpeningWriter {
  constructor(
    private readonly tx: Tx,
    private readonly ctx: TenantRequestContext,
    private readonly entityId: string,
    private readonly importId: string,
    private readonly gl: GlPostingService,
    private readonly audit: AuditService,
  ) {}

  private get tenantId() {
    return this.ctx.tenant.tenantId;
  }

  /**
   * `resolve` maps a Tally GUID of the given kind to the FactoryOS id this commit created or linked (or an earlier
   * import linked); `godown` does the same for a godown name. Returns the result id of each opening and stock row.
   */
  async write(
    rows: { id: string; kind: string; name: string; action: string; targetId: string | null; payload: unknown }[],
    resolve: (kind: 'ledger' | 'party' | 'stockitem', guid: string | null, name: string) => Promise<string | null>,
    godown: (name: string) => Promise<string | null>,
    acceptDifference: string | undefined,
  ): Promise<Map<string, string>> {
    const tx = this.tx;
    const results = new Map<string, string>();
    const included = rows.filter((r) => (r.kind === 'opening' || r.kind === 'stock') && r.action !== 'skip');
    if (!included.length) return results;
    const { roles, active } = await roleAccounts(tx, this.entityId);
    if (active) throw new ConflictException('Accounting is active, so opening balances and opening stock can no longer be imported. Skip those rows.');
    const role = (r: string) => {
      const id = roles.get(r);
      if (!id) throw new BadRequestException(`The posting ledger for "${r}" is not set up; open Accounting setup first`);
      return id;
    };

    const net = new Map<string, Dec>();
    const addTo = (accountId: string, amount: Dec) => net.set(accountId, (net.get(accountId) ?? Dec.ZERO).add(amount));
    const bills = new Map<string, OpeningBill>();
    for (const r of included.filter((x) => x.kind === 'opening')) {
      const p = r.payload as OpeningPayload;
      const total = signed(p.side, p.amount);
      if (p.mode === 'party') {
        const partyId = await resolve('party', p.ledgerGuid, r.name);
        if (!partyId) throw new BadRequestException(`The party "${r.name}" is skipped, so its opening balance cannot be saved. Include the party, or skip its balance.`);
        let covered = Dec.ZERO;
        const addBill = (reference: string, amount: Dec) => {
          if (amount.isZero()) return;
          const side = amount.isNeg() ? 'credit' : 'debit';
          const ref = reference.trim().slice(0, 120) || 'On account';
          const key = `${partyId}:${ref}:${side}`;
          const prior = bills.get(key);
          bills.set(key, { partyId, reference: ref, side, amount: (prior ? Dec.of(prior.amount) : Dec.ZERO).add(amount.abs()).toString() });
        };
        for (const b of p.bills) {
          const amount = signed(b.side, b.amount);
          covered = covered.add(amount);
          addBill(b.name, amount);
        }
        addBill('On account', total.sub(covered));
        results.set(r.id, partyId);
        continue;
      }
      const accountId =
        r.action === 'link'
          ? r.targetId
          : p.mode === 'pnl'
            ? await this.ensureLedger(PNL_NAME, 'PL-RESERVES', 'Reserves & Surplus')
            : await resolve('ledger', p.ledgerGuid, r.name);
      if (!accountId) throw new BadRequestException(`The ledger "${r.name}" is skipped, so its opening balance has nowhere to go. Choose a ledger for the balance, or skip it.`);
      addTo(accountId, total);
      results.set(r.id, accountId);
    }

    // Stock: one draft receipt per godown; the Inventory line is the same quantity × rate products.
    const byGodown = new Map<string, { itemId: string; batch: string | null; qty: string; rate: string; rowId: string; tracking: string }[]>();
    let inventory = Dec.ZERO;
    const stockRows = included.filter((x) => x.kind === 'stock');
    const itemIds = new Map<string, string>();
    for (const r of stockRows) {
      const id = await resolve('stockitem', (r.payload as StockPayload).itemGuid, r.name);
      if (!id) throw new BadRequestException(`The item "${r.name}" is skipped, so its opening stock cannot be saved. Include the item, or skip its stock.`);
      itemIds.set(r.id, id);
    }
    const tracking = new Map(
      itemIds.size ? (await tx.select({ id: item.id, tracking: item.tracking }).from(item).where(inArray(item.id, [...new Set(itemIds.values())]))).map((i) => [i.id, i.tracking]) : [],
    );
    for (const r of stockRows) {
      const itemId = itemIds.get(r.id)!;
      for (const a of (r.payload as StockPayload).allocations) {
        if (Dec.of(a.qty).isNeg()) throw new BadRequestException(`"${r.name}" has negative opening stock; skip it`);
        const rate = stockRate(a);
        inventory = inventory.add(Dec.of(a.qty).mul(rate));
        const g = a.godown ?? MAIN_LOCATION;
        const list = byGodown.get(g) ?? [];
        list.push({ itemId, batch: a.batch, qty: a.qty, rate: rate.toString(), rowId: r.id, tracking: tracking.get(itemId) ?? 'none' });
        byGodown.set(g, list);
      }
    }
    if (!inventory.isZero()) addTo(role('inventory'), inventory);

    // Balance: whatever Tally's openings leave unbalanced goes to the difference ledger, once the user accepts it.
    let difference = [...net.values()].reduce((s, v) => s.add(v), Dec.ZERO);
    for (const b of bills.values()) difference = difference.add(signed(b.side, b.amount));
    if (!difference.isZero()) {
      if (acceptDifference === undefined || !Dec.of(acceptDifference).eq(difference))
        throw new BadRequestException({ message: `Tally's opening balances differ by ${difference.toString()}. Accept the difference to book it to "${DIFFERENCE_NAME}", or correct it in Tally.`, difference: difference.toString() });
      addTo(await this.ensureLedger(DIFFERENCE_NAME, 'TALLY-DIFF', 'Suspense A/c'), difference.neg());
    }

    const lines: OpeningLine[] = [];
    for (const [accountId, v] of net) if (!v.isZero()) lines.push({ accountId, debit: v.isNeg() ? '0' : v.toString(), credit: v.isNeg() ? v.abs().toString() : '0' });
    for (const b of bills.values())
      lines.push({ accountId: role(b.side === 'debit' ? 'debtors' : 'creditors'), debit: b.side === 'debit' ? b.amount : '0', credit: b.side === 'credit' ? b.amount : '0', partyId: b.partyId, billReference: b.reference });
    if (lines.length) await this.gl.validateLines(tx, this.ctx, this.entityId, lines);

    // Tally replaces the worksheet's lines and bills (decision 073); settlements and receipt baselines stay.
    const [w] = await tx
      .insert(openingWorksheet)
      .values({ tenantId: this.tenantId, entityId: this.entityId, lines, bills: [...bills.values()], createdBy: this.ctx.user.id })
      .onConflictDoUpdate({ target: openingWorksheet.entityId, set: { lines, bills: [...bills.values()], updatedAt: new Date() } })
      .returning();
    await this.audit.record(this.ctx, { tenantId: this.tenantId, entityId: this.entityId, action: 'opening.save', targetType: 'opening_worksheet', targetId: w!.id, after: { source: 'tally_import', importId: this.importId, lines: lines.length, bills: bills.size } }, tx);

    for (const [name, list] of byGodown) {
      const warehouseId = await godown(name);
      if (!warehouseId) throw new BadRequestException(`The godown "${name}" is skipped or missing, so its opening stock cannot be saved. Include the godown, or skip the stock there.`);
      const entryId = await this.draftFor(name, warehouseId, list);
      for (const l of list) if (!results.has(l.rowId)) results.set(l.rowId, entryId);
    }
    await this.dropStaleDrafts(new Set([...byGodown.keys()].map(godownKey)));
    return results;
  }

  /**
   * Drafts an earlier import made for godowns this import writes no stock to are deleted: the worksheet's Inventory line
   * now leaves them out, so submitting them would break the cut-over. Submitted receipts are never touched.
   */
  private async dropStaleDrafts(written: Set<string>) {
    const tx = this.tx;
    const links = await tx.select().from(tallyLink).where(and(eq(tallyLink.entityId, this.entityId), eq(tallyLink.kind, 'stock')));
    for (const l of links.filter((x) => !written.has(x.guid))) {
      const [gone] = await tx
        .delete(stockEntry)
        .where(and(eq(stockEntry.id, l.targetId), eq(stockEntry.entityId, this.entityId), eq(stockEntry.status, 'draft')))
        .returning({ id: stockEntry.id });
      if (!gone) continue;
      await tx.delete(tallyLink).where(eq(tallyLink.id, l.id));
      await this.audit.record(this.ctx, { tenantId: this.tenantId, entityId: this.entityId, action: 'stock_entry.delete_draft', targetType: 'stock_entry', targetId: gone.id, after: { source: 'tally_import', importId: this.importId } }, tx);
    }
  }

  /** A ledger by name in a standard group, created when missing. */
  private async ensureLedger(name: string, code: string, groupName: string) {
    const tx = this.tx;
    const [existing] = await tx.select().from(glAccount).where(and(eq(glAccount.entityId, this.entityId), eq(glAccount.name, name)));
    if (existing) return existing.id;
    const [group] = await tx.select().from(accountGroup).where(and(eq(accountGroup.entityId, this.entityId), eq(accountGroup.name, groupName)));
    if (!group) throw new BadRequestException(`The group "${groupName}" is missing; open Accounting setup first`);
    const codes = new Set((await tx.select({ c: glAccount.code }).from(glAccount).where(eq(glAccount.entityId, this.entityId))).map((x) => x.c));
    let unique = code;
    for (let n = 2; codes.has(unique); n++) unique = `${code}-${n}`;
    const [row] = await tx.insert(glAccount).values({ tenantId: this.tenantId, entityId: this.entityId, code: unique, name, groupId: group.id }).returning();
    return row!.id;
  }

  /** The draft receipt for a godown: the one an earlier import made, rewritten while it is a draft, or a new one. */
  private async draftFor(name: string, warehouseId: string, list: { itemId: string; batch: string | null; qty: string; rate: string; tracking: string }[]) {
    const tx = this.tx;
    const guid = godownKey(name);
    const [link] = await tx.select().from(tallyLink).where(and(eq(tallyLink.entityId, this.entityId), eq(tallyLink.kind, 'stock'), eq(tallyLink.guid, guid)));
    const [found] = link ? await tx.select().from(stockEntry).where(and(eq(stockEntry.id, link.targetId), eq(stockEntry.entityId, this.entityId))) : [];
    if (found?.status === 'submitted') throw new ConflictException(`Opening stock for "${name}" was already submitted in FactoryOS; skip its stock rows`);
    const prior = found?.status === 'draft' ? found : undefined;
    const header = { purpose: 'receipt' as const, postingDate: businessDate(), reference: 'Tally opening stock', remarks: `Opening stock for ${name} from Tally import. Review and submit before activating accounting.` };
    let entryId: string;
    if (prior) {
      entryId = prior.id;
      await tx.update(stockEntry).set({ ...header, updatedAt: new Date() }).where(eq(stockEntry.id, entryId));
      await tx.delete(stockEntryLine).where(eq(stockEntryLine.entryId, entryId));
    } else {
      const [e] = await tx.insert(stockEntry).values({ ...header, tenantId: this.tenantId, entityId: this.entityId, createdBy: this.ctx.user.id }).returning();
      entryId = e!.id;
    }
    await tx.insert(stockEntryLine).values(
      list.map((l, i) => ({
        entryId,
        lineNo: i + 1,
        itemId: l.itemId,
        qty: l.qty,
        toWarehouseId: warehouseId,
        rate: l.rate,
        // Batch-tracked items need a batch; Tally's "Primary Batch" means the item has none.
        newBatchNo: l.tracking === 'batch' ? (l.batch && !NO_BATCH.has(l.batch.toLowerCase()) ? l.batch.slice(0, 60) : 'TALLY-OPENING') : null,
      })),
    );
    await tx
      .insert(tallyLink)
      .values({ tenantId: this.tenantId, entityId: this.entityId, kind: 'stock', guid, targetId: entryId, alterId: null, name, importId: this.importId })
      .onConflictDoUpdate({ target: [tallyLink.entityId, tallyLink.kind, tallyLink.guid], set: { targetId: entryId, importId: this.importId, updatedAt: new Date() } });
    await this.audit.record(this.ctx, { tenantId: this.tenantId, entityId: this.entityId, action: prior ? 'stock_entry.update' : 'stock_entry.create', targetType: 'stock_entry', targetId: entryId, after: { source: 'tally_import', importId: this.importId, lines: list.length } }, tx);
    return entryId;
  }
}
