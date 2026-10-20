'use client';
import { ApiError, type Scope } from './api';

/** Decision 072: Tally XML import. */
export type TallyKind = 'group' | 'ledger' | 'party' | 'stockgroup' | 'unit' | 'godown' | 'stockitem';
export type TallyAction = 'new' | 'link' | 'update' | 'unchanged' | 'conflict' | 'skip';

export interface TallyImport {
  id: string;
  status: 'read' | 'committed' | 'discarded';
  files: { name: string; sha256: string; bytes: number }[];
  company: string | null;
  counts: Record<string, number>;
  /** Counts by kind.action with the current choices; only on the single-import read. */
  current?: Record<string, number>;
  warnings: string[];
  createdAt: string;
  committedAt: string | null;
}

export interface TallyRow {
  id: string;
  kind: TallyKind;
  guid: string | null;
  name: string;
  payload: Record<string, unknown>;
  proposed: TallyAction;
  action: TallyAction;
  targetId: string | null;
  candidates: { id: string; label: string; reason: string }[];
  notes: string[];
  resultId: string | null;
}

export const KIND_LABEL: Record<TallyKind, string> = {
  group: 'Groups',
  ledger: 'Ledgers',
  party: 'Customers & suppliers',
  unit: 'Units',
  godown: 'Godowns',
  stockgroup: 'Stock groups',
  stockitem: 'Stock items',
};
export const KINDS = Object.keys(KIND_LABEL) as TallyKind[];

export const ACTION_LABEL: Record<TallyAction, string> = {
  new: 'Create',
  link: 'Link',
  update: 'Update',
  unchanged: 'No change',
  conflict: 'Needs a decision',
  skip: 'Skip',
};

/** Mirrors the API: never back to conflict; update and no change only for records linked by an earlier import. */
export function allowedActions(row: Pick<TallyRow, 'kind' | 'proposed'>): TallyAction[] {
  if (row.kind === 'stockgroup') return ['skip'];
  if (row.proposed === 'update' || row.proposed === 'unchanged') return ['update', 'unchanged', 'skip'];
  return ['new', 'link', 'skip'];
}

/** The FactoryOS list to pick a link target from, by kind. */
export const TARGET_SOURCE: Record<TallyKind, { path: string; label: (r: Record<string, string>) => string } | null> = {
  group: { path: '/accounts/groups', label: (r) => `${r.name} (${r.root})` },
  ledger: { path: '/accounts/accounts', label: (r) => `${r.name} · ${r.code}` },
  party: { path: '/parties?limit=500', label: (r) => `${r.code} · ${r.name}${r.gstin ? ` · ${r.gstin}` : ''}` },
  unit: { path: '/uoms', label: (r) => `${r.code} · ${r.name}` },
  godown: { path: '/warehouses', label: (r) => `${r.code} · ${r.name}` },
  stockitem: { path: '/items?limit=500', label: (r) => `${r.code} · ${r.name}` },
  stockgroup: null,
};

export async function uploadTally(files: File[], scope: Scope): Promise<TallyImport> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const response = await fetch('/api/tally/imports', {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-tenant-id': scope.tenantId ?? '', 'x-entity-id': scope.entityId ?? '' },
    body: form,
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(response.status, typeof value.message === 'string' ? value.message : 'The upload could not be read', Array.isArray(value.issues) ? value.issues : []);
  return value as TallyImport;
}
