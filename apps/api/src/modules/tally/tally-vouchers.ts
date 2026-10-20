import { Dec } from '@factoryos/core';
import { tallyVoucherImbalance, type TallyVoucher } from '@factoryos/core/tally';
import { glAccount, party, tallyImport, tallyLink, tallyStaged, tallyVoucher, tallyVoucherLine } from '@factoryos/db';
import { NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { AuditService } from '../../common/audit.service.js';
import type { Db, Tx } from '../accounting/accounting-lock.js';

/**
 * Decision 072, part 3: Tally vouchers from Day Book exports become read-only history. They are kept apart from the
 * general ledger, never posted and never sent to GST or e-invoicing. A voucher is matched by its GUID: unchanged when
 * the ALTERID is the same, updated (lines replaced) when it is newer, and never deleted when a later export lacks it.
 */

type Staged = {
  kind: 'voucher';
  guid: string | null;
  alterId: number | null;
  name: string;
  payload: Record<string, unknown>;
  proposed: 'new' | 'update' | 'unchanged' | 'conflict' | 'skip';
  targetId: string | null;
  candidates: { id: string; label: string; reason: string }[];
  notes: string[];
};

export const voucherLabel = (v: Pick<TallyVoucher, 'type' | 'number'>) => `${v.type}${v.number ? ` ${v.number}` : ''}`;

/** One staged row per voucher, proposed from what earlier imports stored. */
export async function stageVouchers(tx: Db, entityId: string, vouchers: TallyVoucher[]): Promise<Staged[]> {
  const guids = vouchers.map((v) => v.guid).filter((g): g is string => !!g);
  const existing = new Map<string, { id: string; alterId: number | null }>();
  for (let i = 0; i < guids.length; i += 1000) {
    const rows = await tx
      .select({ id: tallyVoucher.id, guid: tallyVoucher.guid, alterId: tallyVoucher.alterId })
      .from(tallyVoucher)
      .where(and(eq(tallyVoucher.entityId, entityId), inArray(tallyVoucher.guid, guids.slice(i, i + 1000))));
    for (const r of rows) existing.set(r.guid, r);
  }
  return vouchers.map((v) => {
    const row = (s: Partial<Staged>): Staged => ({
      kind: 'voucher',
      guid: v.guid,
      alterId: v.alterId,
      name: voucherLabel(v),
      // The debit total travels with the row so the preview shows it without adding money in the browser.
      payload: { ...v, total: v.lines.filter((l) => l.side === 'debit').reduce((sum, l) => sum.add(l.amount), Dec.ZERO).toString() } as unknown as Record<string, unknown>,
      proposed: 'new',
      targetId: null,
      candidates: [],
      notes: [],
      ...s,
    });
    const notes = [v.cancelled ? 'Cancelled in Tally; kept for the record.' : null, v.optional ? 'An optional voucher in Tally (not in its books).' : null].filter(
      (n): n is string => !!n,
    );
    if (v.deleted) return row({ proposed: 'skip', notes: ['Deleted in Tally.'] });
    if (!v.guid || !v.date) return row({ proposed: 'skip', notes: ['Tally gives no ID or date for this voucher, so it cannot be kept in step.'] });
    const prior = existing.get(v.guid);
    if (prior) {
      const newer = (v.alterId ?? 0) > (prior.alterId ?? 0);
      return row({ proposed: newer ? 'update' : 'unchanged', targetId: prior.id, notes: newer ? ['Edited in Tally since the last import; its lines are replaced.', ...notes] : notes });
    }
    const imbalance = tallyVoucherImbalance(v);
    if (imbalance !== '0') return row({ proposed: 'conflict', notes: [`Debits and credits differ by ${imbalance.replace('-', '')} in Tally. Keep it as it is, or skip it.`, ...notes] });
    return row({ notes });
  });
}

/** Writes the vouchers of a commit. Returns each staged row's voucher id. */
export async function writeVouchers(
  tx: Tx,
  ctx: TenantRequestContext,
  entityId: string,
  importId: string,
  audit: AuditService,
  rows: { id: string; kind: string; action: string; targetId: string | null; payload: unknown }[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const tenantId = ctx.tenant.tenantId;
  const todo = rows.filter((r) => r.kind === 'voucher' && r.action !== 'skip');
  if (!todo.length) return results;

  // Tally names → FactoryOS records, through the links the masters import made (including this commit's).
  const links = await tx
    .select({ kind: tallyLink.kind, name: tallyLink.name, targetId: tallyLink.targetId })
    .from(tallyLink)
    .where(and(eq(tallyLink.entityId, entityId), inArray(tallyLink.kind, ['ledger', 'party'])));
  // Names a ledger had in earlier committed imports still resolve, so a Day Book exported before a rename links too.
  const earlier = await tx
    .select({ kind: tallyStaged.kind, name: tallyStaged.name, resultId: tallyStaged.resultId })
    .from(tallyStaged)
    .innerJoin(tallyImport, eq(tallyImport.id, tallyStaged.importId))
    .where(and(eq(tallyStaged.entityId, entityId), inArray(tallyStaged.kind, ['ledger', 'party']), eq(tallyImport.status, 'committed'), isNotNull(tallyStaged.resultId)))
    .orderBy(asc(tallyImport.committedAt));
  const byName = (kind: string) =>
    new Map([...earlier.filter((r) => r.kind === kind).map((r) => [r.name, r.resultId!] as const), ...links.filter((l) => l.kind === kind).map((l) => [l.name, l.targetId] as const)]);
  const accountByName = byName('ledger');
  const partyByName = byName('party');

  let created = 0;
  let updated = 0;
  const lineRows: (typeof tallyVoucherLine.$inferInsert)[] = [];
  const header = (v: TallyVoucher) => ({
    alterId: v.alterId,
    voucherType: v.type.slice(0, 120),
    number: v.number?.slice(0, 120) ?? null,
    date: v.date!,
    narration: v.narration?.slice(0, 2000) ?? null,
    partyName: v.party,
    partyId: v.party ? (partyByName.get(v.party) ?? null) : null,
    cancelled: v.cancelled,
    optional: v.optional,
    amount: v.lines.filter((l) => l.side === 'debit').reduce((s, l) => s.add(l.amount), Dec.ZERO).toString(),
    items: v.items,
    importId,
  });
  const linesOf = (voucherId: string, v: TallyVoucher) =>
    v.lines.forEach((l, i) =>
      lineRows.push({
        tenantId,
        entityId,
        voucherId,
        lineNo: i + 1,
        ledgerName: l.ledger.slice(0, 200),
        accountId: accountByName.get(l.ledger) ?? null,
        partyId: partyByName.get(l.ledger) ?? null,
        side: l.side,
        amount: l.amount,
        bills: l.bills,
      }),
    );

  const fresh = todo.filter((r) => r.action === 'new');
  for (let i = 0; i < fresh.length; i += 500) {
    const chunk = fresh.slice(i, i + 500);
    const inserted = await tx
      .insert(tallyVoucher)
      .values(chunk.map((r) => ({ tenantId, entityId, guid: (r.payload as TallyVoucher).guid!, ...header(r.payload as TallyVoucher) })))
      // A voucher imported meanwhile by another import is refreshed instead of duplicated.
      .onConflictDoUpdate({ target: [tallyVoucher.entityId, tallyVoucher.guid], set: { updatedAt: new Date() } })
      .returning({ id: tallyVoucher.id, guid: tallyVoucher.guid });
    const byGuid = new Map(inserted.map((x) => [x.guid, x.id]));
    for (const r of chunk) {
      const v = r.payload as TallyVoucher;
      const id = byGuid.get(v.guid!)!;
      results.set(r.id, id);
      await tx.delete(tallyVoucherLine).where(eq(tallyVoucherLine.voucherId, id));
      linesOf(id, v);
      created++;
    }
  }
  for (const r of todo.filter((x) => x.action === 'update' || x.action === 'unchanged')) {
    const id = r.targetId!;
    results.set(r.id, id);
    if (r.action === 'unchanged') continue;
    const v = r.payload as TallyVoucher;
    await tx
      .update(tallyVoucher)
      .set({ ...header(v), updatedAt: new Date() })
      .where(and(eq(tallyVoucher.id, id), eq(tallyVoucher.entityId, entityId)));
    await tx.delete(tallyVoucherLine).where(eq(tallyVoucherLine.voucherId, id));
    linesOf(id, v);
    updated++;
  }
  for (let i = 0; i < lineRows.length; i += 1000) await tx.insert(tallyVoucherLine).values(lineRows.slice(i, i + 1000));
  await audit.record(ctx, { tenantId, entityId, action: 'accounts.tally.history', targetType: 'tally_import', targetId: importId, after: { created, updated, lines: lineRows.length } }, tx);
  return results;
}

/**
 * Records earlier imports linked that this upload does not contain, for review. Masters: only the kinds present in
 * the upload. Vouchers: only within the upload's date range. Nothing is deleted.
 */
export async function notInExport(db: Db, entityId: string, importId: string) {
  const kinds = (
    await db.selectDistinct({ kind: tallyStaged.kind }).from(tallyStaged).where(eq(tallyStaged.importId, importId))
  ).map((r) => r.kind);
  const masterKinds = kinds.filter((k) => ['group', 'ledger', 'party', 'unit', 'godown', 'stockitem'].includes(k));
  let masters = { total: 0, sample: [] as { kind: string; name: string }[] };
  if (masterKinds.length) {
    const where = sql`${tallyLink.entityId} = ${entityId} and ${tallyLink.kind} in ${masterKinds} and not exists (
      select 1 from ${tallyStaged} s where s.import_id = ${importId} and s.kind = ${tallyLink.kind} and s.guid = ${tallyLink.guid})`;
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(tallyLink).where(where)) as [{ n: number }];
    const sample = n ? await db.select({ kind: tallyLink.kind, name: tallyLink.name }).from(tallyLink).where(where).orderBy(asc(tallyLink.kind), asc(tallyLink.name)).limit(20) : [];
    masters = { total: n, sample };
  }
  let vouchers = { total: 0, sample: [] as { type: string; number: string | null; date: string }[] };
  if (kinds.includes('voucher')) {
    const [range] = await db
      .select({ from: sql<string | null>`min(${tallyStaged.payload}->>'date')`, to: sql<string | null>`max(${tallyStaged.payload}->>'date')` })
      .from(tallyStaged)
      .where(and(eq(tallyStaged.importId, importId), eq(tallyStaged.kind, 'voucher')));
    if (range?.from && range.to) {
      const where = sql`${tallyVoucher.entityId} = ${entityId} and ${tallyVoucher.date} between ${range.from} and ${range.to} and not exists (
        select 1 from ${tallyStaged} s where s.import_id = ${importId} and s.kind = 'voucher' and s.guid = ${tallyVoucher.guid})`;
      const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(tallyVoucher).where(where)) as [{ n: number }];
      const sample = n
        ? await db.select({ type: tallyVoucher.voucherType, number: tallyVoucher.number, date: tallyVoucher.date }).from(tallyVoucher).where(where).orderBy(asc(tallyVoucher.date)).limit(20)
        : [];
      vouchers = { total: n, sample };
    }
  }
  return { masters, vouchers };
}

// ── History reads ──

export interface HistoryFilter {
  from?: string;
  to?: string;
  type?: string;
  q?: string;
  accountId?: string;
  partyId?: string;
  offset: number;
  limit: number;
}

export async function listVouchers(db: Db, entityId: string, f: HistoryFilter) {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => '\\' + c)}%` : null;
  const where = and(
    eq(tallyVoucher.entityId, entityId),
    f.from ? sql`${tallyVoucher.date} >= ${f.from}` : undefined,
    f.to ? sql`${tallyVoucher.date} <= ${f.to}` : undefined,
    f.type ? eq(tallyVoucher.voucherType, f.type) : undefined,
    like ? sql`(${tallyVoucher.number} ilike ${like} or ${tallyVoucher.partyName} ilike ${like} or ${tallyVoucher.narration} ilike ${like})` : undefined,
    f.accountId ? sql`exists (select 1 from ${tallyVoucherLine} l where l.voucher_id = ${tallyVoucher.id} and l.account_id = ${f.accountId})` : undefined,
    f.partyId
      ? sql`(${tallyVoucher.partyId} = ${f.partyId} or exists (select 1 from ${tallyVoucherLine} l where l.voucher_id = ${tallyVoucher.id} and l.party_id = ${f.partyId}))`
      : undefined,
  );
  const [{ total }] = (await db.select({ total: sql<number>`count(*)::int` }).from(tallyVoucher).where(where)) as [{ total: number }];
  const data = await db
    .select({
      id: tallyVoucher.id,
      date: tallyVoucher.date,
      voucherType: tallyVoucher.voucherType,
      number: tallyVoucher.number,
      partyName: tallyVoucher.partyName,
      partyId: tallyVoucher.partyId,
      narration: tallyVoucher.narration,
      amount: tallyVoucher.amount,
      cancelled: tallyVoucher.cancelled,
      optional: tallyVoucher.optional,
    })
    .from(tallyVoucher)
    .where(where)
    .orderBy(desc(tallyVoucher.date), desc(tallyVoucher.createdAt), asc(tallyVoucher.number))
    .offset(f.offset)
    .limit(f.limit);
  const types = (
    await db.selectDistinct({ t: tallyVoucher.voucherType }).from(tallyVoucher).where(eq(tallyVoucher.entityId, entityId)).orderBy(asc(tallyVoucher.voucherType))
  ).map((r) => r.t);
  return { total, data, types };
}

export async function getVoucher(db: Db, entityId: string, id: string) {
  const [v] = await db.select().from(tallyVoucher).where(and(eq(tallyVoucher.id, id), eq(tallyVoucher.entityId, entityId)));
  if (!v) throw new NotFoundException('Tally voucher not found');
  const lines = await db
    .select({
      lineNo: tallyVoucherLine.lineNo,
      ledgerName: tallyVoucherLine.ledgerName,
      accountId: tallyVoucherLine.accountId,
      accountName: glAccount.name,
      accountCode: glAccount.code,
      partyId: tallyVoucherLine.partyId,
      partyName: party.name,
      side: tallyVoucherLine.side,
      amount: tallyVoucherLine.amount,
      bills: tallyVoucherLine.bills,
    })
    .from(tallyVoucherLine)
    .leftJoin(glAccount, eq(glAccount.id, tallyVoucherLine.accountId))
    .leftJoin(party, eq(party.id, tallyVoucherLine.partyId))
    .where(and(eq(tallyVoucherLine.voucherId, v.id), eq(tallyVoucherLine.entityId, entityId)))
    .orderBy(asc(tallyVoucherLine.lineNo));
  return { ...v, lines };
}
