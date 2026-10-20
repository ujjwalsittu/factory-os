'use client';
import { ApiError, type Scope } from './api';

/** Decision 072: Tally XML import. */
export type TallyKind = 'group' | 'ledger' | 'party' | 'stockgroup' | 'unit' | 'godown' | 'stockitem' | 'opening' | 'stock' | 'voucher';
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
  /** Opening balances and stock as currently decided (decision 073); only on the single-import read. */
  openings?: {
    included: number;
    ledgers: string;
    stock: string;
    /** Debits minus credits; not zero means it must be accepted to commit. */
    difference: string;
    active: boolean;
    worksheet: { lines: number; bills: number };
  } | null;
  /** Records earlier imports linked that this upload lacks: listed for review, never deleted. */
  missing?: {
    masters: { total: number; sample: { kind: TallyKind; name: string }[] };
    vouchers: { total: number; sample: { type: string; number: string | null; date: string }[] };
  };
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
  opening: 'Opening balances',
  stock: 'Opening stock',
  voucher: 'Vouchers',
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

/** Openings are included or left out, not created: their buttons say so. */
export function actionLabel(kind: TallyKind, action: TallyAction) {
  if (kind === 'opening' || kind === 'stock') return action === 'new' ? 'Include' : action === 'link' ? 'To ledger' : ACTION_LABEL[action];
  return ACTION_LABEL[action];
}

/** Mirrors the API: never back to conflict; update and no change only for records linked by an earlier import. */
export function allowedActions(row: Pick<TallyRow, 'kind' | 'proposed' | 'payload'>): TallyAction[] {
  if (row.kind === 'stockgroup') return ['skip'];
  if (row.kind === 'stock') {
    const allocations = (row.payload.allocations ?? []) as { qty: string }[];
    return allocations.some((a) => a.qty.startsWith('-')) ? ['skip'] : ['new', 'skip'];
  }
  if (row.kind === 'voucher') return row.proposed === 'update' || row.proposed === 'unchanged' ? ['update', 'unchanged', 'skip'] : ['new', 'skip'];
  if (row.kind === 'opening') return row.payload.mode === 'party' ? ['new', 'skip'] : row.proposed === 'conflict' ? ['link', 'skip'] : ['new', 'link', 'skip'];
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
  opening: { path: '/accounts/accounts', label: (r) => `${r.name} · ${r.code}` },
  stock: null,
  voucher: null,
};

/** Decision 072: a voucher from Tally's Day Book, read-only history apart from the general ledger. */
export interface TallyVoucherSummary {
  id: string;
  date: string;
  voucherType: string;
  number: string | null;
  partyName: string | null;
  partyId: string | null;
  narration: string | null;
  amount: string;
  cancelled: boolean;
  optional: boolean;
}

export interface TallyVoucherDetail extends TallyVoucherSummary {
  items: { item: string; qty: string | null; unit: string | null; rate: string | null; amount: string | null; direction: 'in' | 'out' | null; batches: { godown: string | null; batch: string | null; qty: string | null }[] }[];
  lines: {
    lineNo: number;
    ledgerName: string;
    accountId: string | null;
    accountName: string | null;
    accountCode: string | null;
    partyId: string | null;
    partyName: string | null;
    side: 'debit' | 'credit';
    amount: string;
    bills: { name: string; type: string | null; side: 'debit' | 'credit'; amount: string }[];
  }[];
}

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
