'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, type BadgeTone } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  ACTION_LABEL,
  allowedActions,
  KIND_LABEL,
  KINDS,
  TARGET_SOURCE,
  uploadTally,
  type TallyAction,
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
            In TallyPrime, open the company and choose <strong>Export → Masters</strong> (All Masters).
          </li>
          <li>
            Set the format to <strong>XML (Data Interchange)</strong> and export.
          </li>
          <li>Upload the file here. Several files, or a .zip of them, are fine.</li>
        </ol>
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
    [confirm, setConfirm] = useState(false);
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
    mutationFn: () => api<TallyImport>(`/tally/imports/${id}/commit`, { method: 'POST', body: {}, scope: ws.scope }),
    onSuccess: () => {
      setConfirm(false);
      refresh();
      for (const k of ['accounts', 'account-groups', 'parties', 'items', 'warehouses', 'uoms']) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const discard = useMutation({
    mutationFn: () => api(`/tally/imports/${id}/discard`, { method: 'POST', body: {}, scope: ws.scope }),
    onSuccess: () => {
      refresh();
      router.push('/app/accounts/tally');
    },
  });
  const i = imp.data;
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
              <Button className="ml-auto" variant="secondary" loading={discard.isPending} onClick={() => discard.mutate()}>
                Discard
              </Button>
              <Button disabled={conflicts > 0} onClick={() => setConfirm(true)}>
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
        {(discard.error || commit.error) && (
          <div className="px-5 pb-5">
            <Alert tone="danger">{(discard.error ?? commit.error)!.message}</Alert>
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
                    {n} {ACTION_LABEL[a].toLowerCase()}
                  </Badge>
                ) : null;
              })}
            </span>
          </button>
        ))}
      </div>

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
        >
          <p className="text-sm">
            {total(current, (_, a) => a === 'new')} records will be created, {total(current, (_, a) => a === 'link' || a === 'update')} linked or
            updated, and {total(current, (_, a) => a === 'skip')} skipped. Everything is saved together, or nothing is.
          </p>
        </FormDialog>
      )}
    </div>
  );
}

/** Short Tally details shown under each name. */
function details(r: TallyRow) {
  const p = r.payload as Record<string, unknown>;
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
        <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>
        {r.action !== r.proposed && <span className="text-xs text-muted">(proposed: {ACTION_LABEL[r.proposed].toLowerCase()})</span>}
      </div>
      {details(r) && <p className="text-sm text-muted">{details(r)}</p>}
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
                {ACTION_LABEL[a]}
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
                Link to {c.label}
              </Button>
            ))}
          {allowed.includes('link') && source && !choosing && (
            <Button size="sm" variant="ghost" onClick={() => setChoosing(true)}>
              Link to another…
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
