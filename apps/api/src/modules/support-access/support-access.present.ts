// Audited support access (decision 050): explicit, safe projection of panel data. Never spreads a database row.
import type { SupportCell, SupportDetail, SupportPanelResult, SupportTable } from '@factoryos/auth';
import { SupportError } from './support-access.store.js';

export type Columns = SupportTable['columns'];

export function presentTable(columns: Columns, rows: Record<string, SupportCell>[], nextCursor: string | null): SupportTable {
  return { columns, rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, r[c.key] ?? null]))), nextCursor };
}

/** Projects each row to exactly the listed columns, converting values to safe cells. */
export function project<T extends object>(columns: Columns, rows: readonly T[]): Record<string, SupportCell>[] {
  return rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, cell((r as Record<string, unknown>)[c.key])])));
}

export function cell(v: unknown): SupportCell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return null;
}

/** A stable offset cursor over a deterministically ordered result: base64url of `o:<n>`, at most 512 characters. */
export function page<T>(all: readonly T[], query: { limit: number; cursor?: string }): { rows: T[]; nextCursor: string | null } {
  const offset = query.cursor ? decodeOffset(query.cursor) : 0;
  const rows = all.slice(offset, offset + query.limit);
  const next = offset + query.limit;
  return { rows, nextCursor: next < all.length ? Buffer.from(`o:${next}`).toString('base64url') : null };
}
function decodeOffset(cursor: string): number {
  const m = /^o:(\d{1,7})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!m) throw new SupportError('SUPPORT_INVALID_INPUT', 'cursor');
  return Number(m[1]);
}

export const table = (columns: Columns, all: readonly object[], query: { limit: number; cursor?: string }): SupportPanelResult => {
  const p = page(all, query);
  return { kind: 'table', table: presentTable(columns, project(columns, p.rows), p.nextCursor) };
};
export const detail = (fields: SupportDetail['fields'], tables: SupportDetail['tables']): SupportPanelResult => ({ kind: 'detail', detail: { fields, tables } });
