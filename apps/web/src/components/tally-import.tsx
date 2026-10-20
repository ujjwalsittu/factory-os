'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, type BadgeTone } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatQty } from '@/lib/format';
import {
  ACTION_LABEL,
  actionLabel,
  allowedActions,
  DOCUMENT_PATH,
  KIND_LABEL,
  KINDS,
  TARGET_SOURCE,
  uploadTally,
  type TallyAction,
  type TallyDocumentKind,
  type TallyImport,
  type TallyKind,
  type TallyRow,
} from '@/lib/tally';
import { AccountingPage } from './accounting-shared';
import { FormDialog } from './form-dialog';
import { useWorkspace } from './workspace';

const ACTION_TONE: Record<TallyAction, BadgeTone> = {
  new: 'accent',
  link: 'info',
  update: 'warning',
  unchanged: 'neutral',
  conflict: 'danger',
  skip: 'neutral',
};
const STATUS: Record<TallyImport['status'], { label: string; tone: BadgeTone }> = {
  read: { label: 'Waiting for review', tone: 'warning' },
  committed: { label: 'Imported', tone: 'success' },
  discarded: { label: 'Discarded', tone: 'neutral' },
};
const total = (counts: Record<string, number>, test: (kind: string, action: string) => boolean) =>
  Object.entries(counts).reduce((n, [k, v]) => {
    const [kind, action] = k.split('.');
    return test(kind!, action!) ? n + v : n;
  }, 0);

// ── List and upload ──

export function TallyImports() {
  return (
    <AccountingPage title="Tally import" permission="accounts.tally.read">
      <ImportsContent />
    </AccountingPage>
  );
}

function ImportsContent() {
  const ws = useWorkspace(),
    router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const imports = useQuery({
    queryKey: ['tally-imports', ws.tenantId, ws.entityId],
    queryFn: () => api<TallyImport[]>('/tally/imports', { scope: ws.scope }),
  });
  const upload = useMutation({
    mutationFn: () => uploadTally(files, ws.scope),
    onSuccess: (imp) => router.push(`/app/accounts/tally/${imp.id}`),
  });
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Export from TallyPrime" description="FactoryOS reads Tally's XML export. A Tally backup file cannot be read." />
        <ol className="list-decimal space-y-1 px-9 pb-5 text-sm">
          <li>
            In TallyPrime, open the company and choose <strong>Export → Masters</strong> (All Masters). Opening balances and
            opening stock come with the masters.
          </li>
          <li>
            For past vouchers, also choose <strong>Export → Transactions → Day Book</strong> for the period you want. They are
            kept as read-only Tally history, apart from your FactoryOS books.
          </li>
          <li>
            Set the format to <strong>XML (Data Interchange)</strong> and export.
          </li>
          <li>Upload the file here. Several files, or a .zip of them, are fine.</li>
        </ol>
        <p className="px-5 pb-3 text-sm">
          Still invoicing in Tally for some months? Set those months under{' '}
          <Link href="/app/accounts/tally/books" className="text-accent hover:underline">
            Books by month
          </Link>
          : their sales, purchases and notes then come in as FactoryOS documents.
        </p>
        <p className="px-5 pb-5 text-sm text-muted">
          Nothing is saved when you upload. You see what will be created, linked to existing records, or skipped, and you
          confirm before anything is written. Importing a newer export later updates what changed and never duplicates.
        </p>
      </Card>
      {ws.can('accounts.tally.import') && (
        <Card>
          <CardHeader title="Upload an export" />
          <div className="flex flex-wrap items-end gap-3 px-5 pb-5">
            <Field label="Tally XML or zip files" className="min-w-0 flex-1 basis-64">
              {(p) => (
                <Input
                  {...p}
                  type="file"
                  multiple
                  accept=".xml,.zip,text/xml,application/xml,application/zip"
                  onChange={(e) => setFiles([...(e.target.files ?? [])])}
                />
              )}
            </Field>
            <Button disabled={!files.length} loading={upload.isPending} onClick={() => upload.mutate()}>
              Read files
            </Button>
          </div>
          {upload.error && (
            <div className="px-5 pb-5">
              <Alert tone="danger">
                {upload.error.message}
                {upload.error instanceof ApiError && upload.error.issues.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {upload.error.issues.map((i, n) => (
                      <li key={n}>{i.message}</li>
                    ))}
                  </ul>
                )}
              </Alert>
            </div>
          )}
        </Card>
      )}
      <Card>
        <CardHeader title="Imports" />
        {imports.error && <Alert tone="danger">{imports.error.message}</Alert>}
        {imports.data?.length === 0 && <p className="px-5 pb-5 text-sm text-muted">No imports yet.</p>}
        <ul className="divide-y divide-line">
          {imports.data?.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
              <Link href={`/app/accounts/tally/${i.id}`} className="min-w-0 font-medium text-accent hover:underline">
                {i.company ?? i.files.map((f) => f.name).join(', ')}
              </Link>
              <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
              <span className="text-sm text-muted">{formatDateTime(i.createdAt)}</span>
              <span className="ml-auto text-sm text-muted">
                {total(i.counts, (_, a) => a === 'new')} new · {total(i.counts, (_, a) => a === 'link' || a === 'update')} linked ·{' '}
                {total(i.counts, (_, a) => a === 'conflict')} to decide
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ── One import: preview, decisions, commit ──

export function TallyImportDetail({ id }: { id: string }) {
  return (
    <AccountingPage title="Tally import" permission="accounts.tally.read">
      <DetailContent id={id} />
    </AccountingPage>
  );
}

function DetailContent({ id }: { id: string }) {
  const ws = useWorkspace(),
    qc = useQueryClient(),
    router = useRouter();
  const [kind, setKind] = useState<TallyKind | null>(null),
    [action, setAction] = useState<TallyAction | null>(null),
    [q, setQ] = useState(''),
    [offset, setOffset] = useState(0),
    [confirm, setConfirm] = useState(false),
    [acceptDifference, setAcceptDifference] = useState(false);
  const limit = 50;
  const imp = useQuery({
    queryKey: ['tally-import', ws.tenantId, ws.entityId, id],
    queryFn: () => api<TallyImport>(`/tally/imports/${id}`, { scope: ws.scope }),
  });
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit), ...(kind && { kind }), ...(action && { action }), ...(q.trim() && { q: q.trim() }) });
  const rows = useQuery({
    queryKey: ['tally-rows', ws.tenantId, ws.entityId, id, params.toString()],
    queryFn: () => api<{ total: number; data: TallyRow[] }>(`/tally/imports/${id}/rows?${params}`, { scope: ws.scope }),
  });
  // A decision can move the last rows of a page out of the filter; step back to a page that still has rows.
  const rowTotal = rows.data?.total;
  useEffect(() => {
    if (rowTotal !== undefined && offset > 0 && offset >= rowTotal) setOffset(Math.max(0, Math.floor((rowTotal - 1) / limit) * limit));
  }, [rowTotal, offset]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['tally-import'] });
    void qc.invalidateQueries({ queryKey: ['tally-rows'] });
    void qc.invalidateQueries({ queryKey: ['tally-imports'] });
  };
  const decide = useMutation({
    mutationFn: (decisions: { id: string; action: TallyAction; targetId?: string | null }[]) =>
      api(`/tally/imports/${id}/rows`, { method: 'PUT', body: { decisions }, scope: ws.scope }),
    onSuccess: refresh,
  });
  const commit = useMutation({
    mutationFn: () =>
      api<TallyImport>(`/tally/imports/${id}/commit`, {
        method: 'POST',
        body: unbalanced && acceptDifference ? { acceptDifference: imp.data!.openings!.difference } : {},
        scope: ws.scope,
      }),
    onSuccess: () => {
      setConfirm(false);
      refresh();
      for (const k of ['accounts', 'account-groups', 'parties', 'items', 'warehouses', 'uoms', 'opening', 'stock-entries', 'sales-invoices', 'purchase-invoices', 'sales-notes', 'supplier-notes'])
        void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const recheck = useMutation({
    mutationFn: () => api(`/tally/imports/${id}/recheck`, { method: 'POST', body: {}, scope: ws.scope }),
    onSuccess: refresh,
  });
  const discard = useMutation({
    mutationFn: () => api(`/tally/imports/${id}/discard`, { method: 'POST', body: {}, scope: ws.scope }),
    onSuccess: () => {
      refresh();
      router.push('/app/accounts/tally');
    },
  });
  const i = imp.data;
  const openings = i?.openings ?? null;
  const unbalanced = !!openings && Number(openings.difference) !== 0;
  if (imp.error) return <Alert tone="danger">{imp.error.message}</Alert>;
  if (!i) return <p>Loading import…</p>;
  const current = i.current ?? i.counts;
  const open = i.status === 'read';
  const editable = open && ws.can('accounts.tally.import');
  const conflicts = total(current, (_, a) => a === 'conflict');
  const filter = (k: TallyKind | null, a: TallyAction | null) => {
    setKind(k);
    setAction(a);
    setOffset(0);
  };
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={i.company ?? 'Tally export'}
          description={`${i.files.map((f) => f.name).join(', ')} · read ${formatDateTime(i.createdAt)}${i.committedAt ? ` · imported ${formatDateTime(i.committedAt)}` : ''}`}
        />
        <div className="flex flex-wrap items-center gap-3 px-5 pb-5">
          <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
          {editable && (
            <>
              <Button className="ml-auto" variant="ghost" loading={recheck.isPending} onClick={() => recheck.mutate()}>
                Check again
              </Button>
              <Button variant="secondary" loading={discard.isPending} onClick={() => discard.mutate()}>
                Discard
              </Button>
              <Button
                disabled={conflicts > 0}
                onClick={() => {
                  // Each opening of the dialog asks again: the difference may have changed since it was last accepted.
                  setAcceptDifference(false);
                  setConfirm(true);
                }}
              >
                {conflicts > 0 ? `${conflicts} to decide before import` : 'Import'}
              </Button>
            </>
          )}
        </div>
        {i.warnings.length > 0 && (
          <div className="px-5 pb-5">
            <Alert tone="warning">
              <ul className="list-disc pl-5">
                {i.warnings.map((w, n) => (
                  <li key={n}>{w}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
        {(discard.error || commit.error || recheck.error) && (
          <div className="px-5 pb-5">
            <Alert tone="danger">
              {(discard.error ?? commit.error ?? recheck.error)!.message}
              {commit.error instanceof ApiError && commit.error.issues.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {commit.error.issues.map((x, n) => (
                    <li key={n}>{x.message}</li>
                  ))}
                </ul>
              )}
            </Alert>
          </div>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {KINDS.filter((k) => total(current, (kk) => kk === k) > 0).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => filter(kind === k ? null : k, null)}
            className={`rounded-lg border p-3 text-left ${kind === k ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
          >
            <span className="block text-sm font-semibold">{KIND_LABEL[k]}</span>
            <span className="mt-1 flex flex-wrap gap-1">
              {(['conflict', 'new', 'link', 'update', 'unchanged', 'skip'] as TallyAction[]).map((a) => {
                const n = current[`${k}.${a}`] ?? 0;
                return n ? (
                  <Badge key={a} tone={ACTION_TONE[a]}>
                    {n} {actionLabel(k, a).toLowerCase()}
                  </Badge>
                ) : null;
              })}
            </span>
          </button>
        ))}
      </div>

      {openings && <OpeningsCard openings={openings} status={i.status} />}
      {i.missing && (i.missing.masters.total > 0 || i.missing.vouchers.total > 0) && <MissingCard missing={i.missing} />}
      {i.status === 'committed' && total(current, (k, a) => k === 'voucher' && a !== 'skip') > 0 && (
        <p className="text-sm">
          The vouchers are in <Link href="/app/accounts/tally/history" className="text-accent hover:underline">Tally history</Link>, apart from your
          FactoryOS books.
        </p>
      )}

      {total(current, (k) => k === 'document') > 0 && <DocumentsNote counts={current} status={i.status} />}

      <Card>
        <div className="flex flex-wrap items-end gap-3 p-5">
          <div className="min-w-0 flex-1 basis-56">
            <Field label="Search names">
              {(p) => (
                <Input
                  {...p}
                  type="search"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setOffset(0);
                  }}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
            {([null, 'conflict', 'new', 'link', 'update', 'unchanged', 'skip'] as (TallyAction | null)[]).map((a) => (
              <Button key={a ?? 'all'} size="sm" variant={action === a ? 'secondary' : 'ghost'} aria-pressed={action === a} onClick={() => filter(kind, a)}>
                {a ? ACTION_LABEL[a] : 'All'}
              </Button>
            ))}
          </div>
        </div>
        {decide.error && (
          <div className="px-5 pb-3">
            <Alert tone="danger">{decide.error.message}</Alert>
          </div>
        )}
        {rows.isLoading && <p className="px-5 pb-5">Loading…</p>}
        {rows.data?.data.length === 0 && <p className="px-5 pb-5 text-sm text-muted">Nothing matches these filters.</p>}
        <ul className="divide-y divide-line border-t border-line">
          {rows.data?.data.map((r) => (
            <RowView key={r.id} row={r} editable={editable} pending={decide.isPending} onDecide={(d) => decide.mutate([{ id: r.id, ...d }])} />
          ))}
        </ul>
        {rows.data && rows.data.total > limit && (
          <div className="flex items-center gap-3 p-5 text-sm">
            <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
              Previous
            </Button>
            <span>
              {offset + 1}–{Math.min(offset + limit, rows.data.total)} of {rows.data.total}
            </span>
            <Button size="sm" variant="secondary" disabled={offset + limit >= rows.data.total} onClick={() => setOffset(offset + limit)}>
              Next
            </Button>
          </div>
        )}
      </Card>

      {confirm && (
        <FormDialog
          title="Import into FactoryOS"
          submitLabel="Import"
          onClose={() => setConfirm(false)}
          onSubmit={() => commit.mutate()}
          pending={commit.isPending}
          error={commit.error}
          submitDisabled={unbalanced && !acceptDifference}
        >
          <p className="text-sm">
            {total(current, (k, a) => a === 'new' && !OPENING_KINDS.has(k))} records will be created,{' '}
            {total(current, (k, a) => (a === 'link' || a === 'update') && !OPENING_KINDS.has(k))} linked or updated, and{' '}
            {total(current, (k, a) => a === 'skip' && !OPENING_KINDS.has(k))} skipped. Everything is saved together, or nothing is.
          </p>
          {total(current, (k, a) => k === 'voucher' && (a === 'new' || a === 'update')) > 0 && (
            <p className="text-sm">
              {total(current, (k, a) => k === 'voucher' && (a === 'new' || a === 'update'))} vouchers are saved as Tally history, apart from your
              FactoryOS books.
            </p>
          )}
          {total(current, (k, a) => k === 'document' && a === 'new') > 0 && (
            <p className="text-sm">
              {total(current, (k, a) => k === 'document' && a === 'new')} vouchers in months kept in Tally become submitted FactoryOS documents, with
              stock and books, at Tally&apos;s numbers and amounts.
            </p>
          )}
          {openings && openings.included > 0 && (
            <p className="text-sm">
              Opening balances replace the opening worksheet&apos;s lines and bills, and opening stock is saved as draft receipts to
              review and submit.
            </p>
          )}
          {unbalanced && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={acceptDifference} onChange={(e) => setAcceptDifference(e.target.checked)} />
              <span>
                Book the difference of {formatMoney(String(Math.abs(Number(openings!.difference))))} to &ldquo;Opening difference (Tally)&rdquo; under
                Suspense A/c. Clear it before activating accounting.
              </span>
            </label>
          )}
        </FormDialog>
      )}
    </div>
  );
}

const OPENING_KINDS = new Set(['opening', 'stock', 'voucher', 'document']);

/** Decision 075: vouchers in months kept in Tally, and how to clear the ones that cannot come in yet. */
function DocumentsNote({ counts, status }: { counts: Record<string, number>; status: TallyImport['status'] }) {
  const n = (a: string) => counts[`document.${a}`] ?? 0;
  return (
    <Alert tone={n('conflict') ? 'warning' : 'info'}>
      {status === 'committed'
        ? `${n('new')} vouchers in months kept in Tally became FactoryOS documents.`
        : `${n('new')} vouchers in months kept in Tally will become FactoryOS documents; ${n('unchanged')} already are.`}{' '}
      {n('conflict') > 0 && `${n('conflict')} need a link or mapping first: fix the masters or `}
      {n('conflict') > 0 && (
        <Link href="/app/accounts/tally/books" className="text-accent hover:underline">
          map voucher types and ledgers
        </Link>
      )}
      {n('conflict') > 0 && ', then choose Check again, or skip them to keep them as history.'}
    </Alert>
  );
}

/** Records earlier imports linked that this upload lacks (decision 072). Listed for review; nothing is deleted. */
function MissingCard({ missing: m }: { missing: NonNullable<TallyImport['missing']> }) {
  return (
    <Card>
      <CardHeader
        title="Not in this export"
        description="Linked by an earlier import but missing from this upload. Nothing is deleted; check whether they were deleted or renamed in Tally."
      />
      <div className="space-y-3 px-5 pb-5 text-sm">
        {m.masters.total > 0 && (
          <div>
            <p className="font-medium">
              {m.masters.total} master{m.masters.total === 1 ? '' : 's'}
            </p>
            <ul className="mt-1 list-disc pl-5 text-muted">
              {m.masters.sample.map((x, n) => (
                <li key={n}>
                  {x.name} <span className="text-xs">({KIND_LABEL[x.kind] ?? x.kind})</span>
                </li>
              ))}
              {m.masters.total > m.masters.sample.length && <li>and {m.masters.total - m.masters.sample.length} more</li>}
            </ul>
          </div>
        )}
        {m.vouchers.total > 0 && (
          <div>
            <p className="font-medium">
              {m.vouchers.total} voucher{m.vouchers.total === 1 ? '' : 's'} in this period
            </p>
            <ul className="mt-1 list-disc pl-5 text-muted">
              {m.vouchers.sample.map((v, n) => (
                <li key={n}>
                  {v.type} {v.number ?? ''} · {formatDate(v.date)}
                </li>
              ))}
              {m.vouchers.total > m.vouchers.sample.length && <li>and {m.vouchers.total - m.vouchers.sample.length} more</li>}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Ledger balances, stock value and the difference, with what the import replaces (decision 073). */
function OpeningsCard({ openings: o, status }: { openings: NonNullable<TallyImport['openings']>; status: TallyImport['status'] }) {
  const difference = Number(o.difference);
  const side = (v: string) => `${formatMoney(String(Math.abs(Number(v))))} ${Number(v) < 0 ? 'Cr' : 'Dr'}`;
  return (
    <Card>
      <CardHeader title="Opening balances and stock" description="Written to the opening worksheet and draft stock receipts, before accounting is activated." />
      <dl className="grid gap-3 px-5 pb-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">Ledger balances</dt>
          <dd className="font-medium">{side(o.ledgers)}</dd>
        </div>
        <div>
          <dt className="text-muted">Opening stock value</dt>
          <dd className="font-medium">{formatMoney(o.stock)}</dd>
        </div>
        <div>
          <dt className="text-muted">Difference</dt>
          <dd className={`font-medium ${difference ? 'text-danger' : ''}`}>{difference ? side(o.difference) : 'None, the openings balance'}</dd>
        </div>
      </dl>
      <div className="space-y-3 px-5 pb-5">
        {o.active && <Alert tone="info">Accounting is active, so the cut-over is closed. Opening balances and stock from this import are left out.</Alert>}
        {status === 'read' && !o.active && o.worksheet.lines > 0 && (
          <Alert tone="warning">
            The opening worksheet already has {o.worksheet.lines} line{o.worksheet.lines === 1 ? '' : 's'} and {o.worksheet.bills} bill
            {o.worksheet.bills === 1 ? '' : 's'}. Importing replaces them with Tally&apos;s balances. Invoice settlements and receipt baselines are kept.
          </Alert>
        )}
        {status === 'read' && difference !== 0 && (
          <Alert tone="warning">
            Tally&apos;s openings do not balance. To import, accept the difference: it is booked to &ldquo;Opening difference (Tally)&rdquo; under
            Suspense A/c. Or correct it in Tally and export again.
          </Alert>
        )}
        {status === 'committed' && o.included > 0 && (
          <p className="text-sm">
            Next: review and submit the <Link href="/app/inventory/entries" className="text-accent hover:underline">opening stock drafts</Link>,
            then reconcile and activate in <Link href="/app/accounts/setup" className="text-accent hover:underline">Accounting setup</Link>.
          </p>
        )}
      </div>
    </Card>
  );
}

/** Short Tally details shown under each name. */
function details(r: TallyRow) {
  const p = r.payload as Record<string, unknown>;
  if (r.kind === 'opening') {
    const bills = (p.bills as unknown[] | undefined)?.length ?? 0;
    return [`${formatMoney(p.amount as string)} ${p.side === 'debit' ? 'Dr' : 'Cr'}`, bills ? `${bills} bill${bills === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
  }
  if (r.kind === 'document') return [p.date ? formatDate(p.date as string) : null, (p.party as string | null) ?? null, p.voucherType ? `Tally ${p.voucherType as string}` : null].filter(Boolean).join(' · ');
  if (r.kind === 'voucher')
    return [
      p.date ? formatDate(p.date as string) : null,
      (p.party as string | null) ?? null,
      p.total ? formatMoney(p.total as string) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  if (r.kind === 'stock')
    return ((p.allocations ?? []) as { godown: string | null; batch: string | null; qty: string; value: string | null }[])
      .map((a) => `${formatQty(a.qty)} at ${a.godown ?? 'Main Location'}${a.batch && !/^primary batch$/i.test(a.batch) ? ` (${a.batch})` : ''}${a.value ? `, ${formatMoney(a.value)}` : ''}`)
      .join(' · ');
  const bits = [
    p.parent ? `Under ${p.parent as string}` : null,
    p.gstin ? `GSTIN ${p.gstin as string}` : null,
    p.unit ? `Unit ${p.unit as string}` : null,
    p.hsn ? `HSN ${p.hsn as string}` : null,
    (p.aliases as string[] | undefined)?.length ? `Alias ${(p.aliases as string[]).join(', ')}` : null,
  ];
  return bits.filter(Boolean).join(' · ');
}

function RowView({
  row: r,
  editable,
  pending,
  onDecide,
}: {
  row: TallyRow;
  editable: boolean;
  pending: boolean;
  onDecide: (d: { action: TallyAction; targetId?: string | null }) => void;
}) {
  const ws = useWorkspace();
  const [choosing, setChoosing] = useState(false);
  const source = TARGET_SOURCE[r.kind];
  const others = useQuery({
    queryKey: ['tally-targets', ws.tenantId, ws.entityId, r.kind],
    queryFn: async () => {
      const v = await api<Record<string, string>[] | { data: Record<string, string>[] }>(source!.path, { scope: ws.scope });
      return Array.isArray(v) ? v : v.data;
    },
    enabled: choosing && !!source,
  });
  const allowed = allowedActions(r);
  const target = r.candidates.find((c) => c.id === r.targetId);
  return (
    <li className="space-y-2 px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 font-medium">{r.name}</span>
        <span className="text-xs text-muted">{KIND_LABEL[r.kind]}</span>
        <Badge tone={ACTION_TONE[r.action]}>{actionLabel(r.kind, r.action)}</Badge>
        {r.action !== r.proposed && <span className="text-xs text-muted">(proposed: {actionLabel(r.kind, r.proposed).toLowerCase()})</span>}
      </div>
      {details(r) && <p className="text-sm text-muted">{details(r)}</p>}
      {r.kind === 'document' && (r.resultId ?? r.targetId) && typeof r.payload.documentKind === 'string' && (
        <p className="text-sm">
          <Link href={`${DOCUMENT_PATH[r.payload.documentKind as TallyDocumentKind]}/${r.resultId ?? r.targetId}`} className="text-accent hover:underline">
            Open the document
          </Link>
        </p>
      )}
      {(r.action === 'link' || r.action === 'update' || r.action === 'unchanged') && (target || r.targetId) && (
        <p className="text-sm">
          → {target ? `${target.label} (${target.reason})` : 'Chosen record'}
        </p>
      )}
      {r.notes.map((n, i) => (
        <p key={i} className="text-sm text-muted">
          {n}
        </p>
      ))}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          {allowed
            .filter((a) => a !== 'link')
            .map((a) => (
              <Button key={a} size="sm" variant={r.action === a ? 'secondary' : 'ghost'} aria-pressed={r.action === a} disabled={pending} onClick={() => onDecide({ action: a })}>
                {actionLabel(r.kind, a)}
              </Button>
            ))}
          {allowed.includes('link') &&
            r.candidates.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={r.action === 'link' && r.targetId === c.id ? 'secondary' : 'ghost'}
                aria-pressed={r.action === 'link' && r.targetId === c.id}
                disabled={pending}
                onClick={() => onDecide({ action: 'link', targetId: c.id })}
              >
                {r.kind === 'opening' ? 'To' : 'Link to'} {c.label}
              </Button>
            ))}
          {allowed.includes('link') && source && !choosing && (
            <Button size="sm" variant="ghost" onClick={() => setChoosing(true)}>
              {r.kind === 'opening' ? 'To another ledger…' : 'Link to another…'}
            </Button>
          )}
          {choosing && (
            <Select
              aria-label={`Link ${r.name} to`}
              value=""
              disabled={pending || others.isLoading}
              onChange={(e) => {
                if (e.target.value) onDecide({ action: 'link', targetId: e.target.value });
                setChoosing(false);
              }}
            >
              <option value="">{others.isLoading ? 'Loading…' : 'Choose a record'}</option>
              {others.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {source!.label(o)}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
    </li>
  );
}
