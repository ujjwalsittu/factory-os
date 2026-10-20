import { accountingSettings, purchaseInvoice, salesInvoice, salesNote, supplierNote, tallyBookMonth, type Database } from '@factoryos/db';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { AuditService } from '../../common/audit.service.js';
import type { Db } from '../accounting/accounting-lock.js';

/**
 * Decision 075: each month of an entity is kept in one book, FactoryOS (the default) or Tally. A Tally month's
 * imported vouchers become documents, so FactoryOS documents dated in it are refused, and the other way round.
 */
export type Book = 'tally' | 'factoryos';
const monthOf = (date: string) => date.slice(0, 7);
const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

export async function bookOf(db: Db, entityId: string, date: string): Promise<Book> {
  const [row] = await db.select({ source: tallyBookMonth.source }).from(tallyBookMonth).where(and(eq(tallyBookMonth.entityId, entityId), eq(tallyBookMonth.month, monthOf(date))));
  return (row?.source as Book | undefined) ?? 'factoryos';
}

/** Refuses a FactoryOS document dated in a month kept in Tally. */
export async function assertFactoryOsBook(db: Db, entityId: string, date: string, what: string) {
  if ((await bookOf(db, entityId, date)) === 'tally')
    throw new BadRequestException({
      message: `${monthOf(date)} is kept in Tally, so this ${what} cannot be entered here. Import it from Tally, or set the month to FactoryOS under Tally import → Books by month.`,
      issues: [{ path: 'date', message: 'Month kept in Tally' }],
    });
}

/** The months from the cut-over to the current month, with the book each is kept in. */
export async function listBooks(db: Db, entityId: string, today: string) {
  const [settings] = await db.select({ cutoverDate: accountingSettings.cutoverDate }).from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
  const cutover = settings?.cutoverDate ?? null;
  const set = await db.select().from(tallyBookMonth).where(eq(tallyBookMonth.entityId, entityId)).orderBy(asc(tallyBookMonth.month));
  const byMonth = new Map(set.map((r) => [r.month, r.source as Book]));
  const months: { month: string; book: Book }[] = [];
  if (cutover) for (let m = monthOf(cutover); m <= monthOf(today) && months.length < 120; m = nextMonth(m)) months.push({ month: m, book: byMonth.get(m) ?? 'factoryos' });
  return { cutoverDate: cutover, months };
}

const DOCUMENTS = [
  { table: salesInvoice, date: salesInvoice.invoiceDate, label: 'sales invoices' },
  { table: purchaseInvoice, date: purchaseInvoice.postingDate, label: 'purchase invoices' },
  { table: salesNote, date: salesNote.postingDate, label: 'customer notes' },
  { table: supplierNote, date: supplierNote.postingDate, label: 'supplier notes' },
] as const;

/** Counts live documents of one source in a month, by kind. */
async function documentsIn(db: Db, entityId: string, month: string, source: Book) {
  const out: string[] = [];
  for (const d of DOCUMENTS) {
    const t = d.table as typeof salesInvoice;
    const [r] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(d.table)
      .where(and(eq(t.entityId, entityId), eq(t.source, source), ne(t.status, 'cancelled'), sql`to_char(${d.date}, 'YYYY-MM') = ${month}`))) as [{ n: number }];
    if (r.n) out.push(`${r.n} ${d.label}`);
  }
  return out;
}

export async function setBook(db: Database, ctx: TenantRequestContext, entityId: string, audit: AuditService, month: string, book: Book) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tally-books:${entityId}`}))`);
    const [settings] = await tx.select({ cutoverDate: accountingSettings.cutoverDate }).from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
    if (book === 'tally') {
      if (!settings?.cutoverDate) throw new BadRequestException('Set the cut-over date in Accounting setup first: only months from the cut-over on can be kept in Tally.');
      if (month < monthOf(settings.cutoverDate))
        throw new BadRequestException(`${month} is before the cut-over (${settings.cutoverDate}); its transactions are already in the opening balances, so its vouchers stay history.`);
      const own = await documentsIn(tx, entityId, month, 'factoryos');
      if (own.length) throw new ConflictException(`${month} already has ${own.join(', ')} entered in FactoryOS; cancel them before keeping the month in Tally.`);
    } else {
      const fromTally = await documentsIn(tx, entityId, month, 'tally');
      if (fromTally.length) throw new ConflictException(`${month} has ${fromTally.join(', ')} created from Tally. Moving a month back to FactoryOS comes in the next release.`);
    }
    await tx
      .insert(tallyBookMonth)
      .values({ tenantId: ctx.tenant.tenantId, entityId, month, source: book, setBy: ctx.user.id })
      .onConflictDoUpdate({ target: [tallyBookMonth.entityId, tallyBookMonth.month], set: { source: book, setBy: ctx.user.id, setAt: new Date() } });
    await audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'accounts.tally.book', targetType: 'tally_book_month', targetId: null, after: { month, book } }, tx);
    return { month, book };
  });
}

/**
 * Decision 075a: a note from Tally may have no FactoryOS invoice behind it, and changes only through Tally (reversal of
 * Tally documents comes with switching a month back). Paths that edit, post or cancel a note go through this.
 */
export function originalInvoiceOf(note: { source: string; originalInvoiceId: string | null }) {
  if (note.source === 'tally' || !note.originalInvoiceId)
    throw new ConflictException('This note came from Tally; it changes only through Tally, not here.');
  return note.originalInvoiceId;
}

/** Decision 075: a document created from a Tally voucher is changed only through Tally (reversal comes in PR 2). */
export function assertNotFromTally(doc: { source: string }, what: string) {
  if (doc.source === 'tally') throw new ConflictException(`This ${what} came from Tally; it changes only through Tally, not here.`);
}
