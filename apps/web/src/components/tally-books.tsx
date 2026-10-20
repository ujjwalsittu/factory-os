'use client';
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, Select } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { DOCUMENT_KIND_LABEL, DOCUMENT_PATH, type TallyBook, type TallyBooks, type TallyDocumentKind, type TallyMappings, type TallySwitchBack } from '@/lib/tally';
import { AccountingPage } from './accounting-shared';
import { LookupSelect } from './lookup-select';
import { useWorkspace } from './workspace';

/** Decision 075: which book each month is kept in, and how Tally's voucher types and ledgers become documents. */
export function TallyBooksPage() {
  return (
    <AccountingPage title="Books by month" permission="accounts.tally.read">
      <BooksContent />
    </AccountingPage>
  );
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function BooksContent() {
  const ws = useWorkspace(),
    qc = useQueryClient();
  const editable = ws.can('accounts.tally.import');
  const books = useQuery({ queryKey: ['tally-books', ws.tenantId, ws.entityId], queryFn: () => api<TallyBooks>('/tally/books', { scope: ws.scope }) });
  const mappings = useQuery({ queryKey: ['tally-mappings', ws.tenantId, ws.entityId], queryFn: () => api<TallyMappings>('/tally/mappings', { scope: ws.scope }) });
  const refresh = () => {
    for (const k of ['tally-books', 'tally-mappings', 'tally-import', 'tally-rows', 'tally-imports']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const setBook = useMutation({
    mutationFn: (b: { month: string; book: TallyBook; confirm?: boolean }) => api('/tally/books', { method: 'PUT', body: b, scope: ws.scope }),
    onSuccess: () => {
      setSwitching(null);
      refresh();
    },
  });
  // Decision 075b: going back to FactoryOS reverses the month's documents from Tally, so it is previewed first.
  const [switching, setSwitching] = useState<string | null>(null);
  const setType = useMutation({
    mutationFn: (b: { voucherType: string; documentKind: TallyDocumentKind | 'none' | null }) => api('/tally/mappings/voucher-types', { method: 'PUT', body: b, scope: ws.scope }),
    onSuccess: refresh,
  });
  const setLedger = useMutation({
    mutationFn: (b: { ledger: string; itemId: string | null }) => api('/tally/mappings/ledgers', { method: 'PUT', body: b, scope: ws.scope }),
    onSuccess: refresh,
  });
  const error = setBook.error ?? setType.error ?? setLedger.error;
  return (
    <div className="space-y-5">
      <p className="text-sm">
        <Link href="/app/accounts/tally" className="text-accent hover:underline">
          ← Tally import
        </Link>
      </p>
      {error && <Alert tone="danger">{error.message}</Alert>}
      <Card>
        <CardHeader
          title="Books by month"
          description="A month kept in Tally turns its imported vouchers (sales, purchases, notes, receipts, payments, journals and stock journals) into FactoryOS documents with Tally's numbers and amounts, and entry here is refused for it. Other months keep Tally vouchers as history."
        />
        {books.error && <Alert tone="danger">{books.error.message}</Alert>}
        {books.data && !books.data.cutoverDate && (
          <p className="px-5 pb-5 text-sm text-muted">
            Set the cut-over date in <Link href="/app/accounts/setup" className="text-accent hover:underline">Accounting setup</Link> first. Months before it are inside the opening balances.
          </p>
        )}
        {books.data?.cutoverDate && <p className="px-5 pb-3 text-sm text-muted">From the cut-over on {formatDate(books.data.cutoverDate)}.</p>}
        <ul className="divide-y divide-line border-t border-line">
          {books.data?.months.map((m) => (
            <li key={m.month} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="min-w-0 flex-1 font-medium">{monthLabel(m.month)}</span>
              <Badge tone={m.book === 'tally' ? 'warning' : 'neutral'}>{m.book === 'tally' ? 'Kept in Tally' : 'FactoryOS'}</Badge>
              {editable && (
                <div className="flex gap-1" role="group" aria-label={`Book for ${monthLabel(m.month)}`}>
                  {(['factoryos', 'tally'] as TallyBook[]).map((b) => (
                    <Button
                      key={b}
                      size="sm"
                      variant={m.book === b ? 'secondary' : 'ghost'}
                      aria-pressed={m.book === b}
                      disabled={setBook.isPending}
                      onClick={() => m.book !== b && (b === 'factoryos' ? setSwitching(m.month) : setBook.mutate({ month: m.month, book: b }))}
                    >
                      {b === 'tally' ? 'Tally' : 'FactoryOS'}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {switching && <SwitchBack month={switching} pending={setBook.isPending} onClose={() => setSwitching(null)} onConfirm={() => setBook.mutate({ month: switching, book: 'factoryos', confirm: true })} />}

      <Card>
        <CardHeader
          title="Voucher types"
          description="What each Tally voucher type becomes in a month kept in Tally. Tally's own types are set; a custom type is chosen once."
        />
        {mappings.data?.voucherTypes.length === 0 && <p className="px-5 pb-5 text-sm text-muted">No Tally vouchers imported yet.</p>}
        <ul className="divide-y divide-line border-t border-line">
          {mappings.data?.voucherTypes.map((t) => (
            <li key={t.voucherType} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{t.voucherType}</span>
                <span className="ml-2 text-xs text-muted">
                  {t.vouchers} voucher{t.vouchers === 1 ? '' : 's'}
                  {t.preset ? " · Tally's own type" : ''}
                </span>
              </span>
              {editable ? (
                <Select
                  aria-label={`${t.voucherType} becomes`}
                  value={t.documentKind ?? ''}
                  disabled={setType.isPending}
                  onChange={(e) => setType.mutate({ voucherType: t.voucherType, documentKind: (e.target.value || null) as TallyDocumentKind | 'none' | null })}
                >
                  <option value="">{t.preset ? 'As Tally’s type' : 'Not mapped (stays history)'}</option>
                  {(Object.keys(DOCUMENT_KIND_LABEL) as (TallyDocumentKind | 'none')[]).map((k) => (
                    <option key={k} value={k}>
                      {DOCUMENT_KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="text-sm">{t.documentKind ? DOCUMENT_KIND_LABEL[t.documentKind] : 'Not mapped'}</span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <LedgerItems mappings={mappings.data} editable={editable} pending={setLedger.isPending} onSet={(b) => setLedger.mutate(b)} />
    </div>
  );
}

/** Income and expense ledgers of accounting-mode vouchers become lines of a chosen service item. */
function LedgerItems({
  mappings,
  editable,
  pending,
  onSet,
}: {
  mappings: TallyMappings | undefined;
  editable: boolean;
  pending: boolean;
  onSet: (b: { ledger: string; itemId: string | null }) => void;
}) {
  const ws = useWorkspace();
  const [ledger, setLedger] = useState(''),
    [itemId, setItemId] = useState('');
  const services = useQuery({
    queryKey: ['items', ws.tenantId, 'services'],
    queryFn: async () => {
      const v = await api<{ id: string; code: string; name: string; isStockItem: boolean }[] | { data: { id: string; code: string; name: string; isStockItem: boolean }[] }>('/items?limit=500', { scope: ws.scope });
      return (Array.isArray(v) ? v : v.data).filter((i) => !i.isStockItem);
    },
    enabled: editable,
  });
  return (
    <Card>
      <CardHeader
        title="Ledgers booked as lines"
        description="A voucher without items (services, freight, charges) is booked line by line: each income or expense ledger needs the service item it stands for."
      />
      {mappings?.ledgers.length === 0 && <p className="px-5 pb-3 text-sm text-muted">None yet. An import names the ledgers that need one.</p>}
      <ul className="divide-y divide-line border-t border-line">
        {mappings?.ledgers.map((l) => (
          <li key={l.ledger} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="min-w-0 flex-1 font-medium">{l.ledger}</span>
            <span className="text-sm">
              {l.itemCode} · {l.itemName}
            </span>
            {editable && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => onSet({ ledger: l.ledger, itemId: null })}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-line p-5"
          onSubmit={(e) => {
            e.preventDefault();
            onSet({ ledger: ledger.trim(), itemId });
            setLedger('');
            setItemId('');
          }}
        >
          <Field label="Tally ledger" className="min-w-0 flex-1 basis-56">
            {(p) => <Input {...p} value={ledger} onChange={(e) => setLedger(e.target.value)} placeholder="e.g. Machining Charges" />}
          </Field>
          <Field label="Service item" className="min-w-0 flex-1 basis-56">
            {(p) => (
              <LookupSelect kind="item" noun="service item" prefill={{ type: 'service', name: ledger.trim() || undefined }} {...p} value={itemId} onValue={(id) => setItemId(id)}>
                <option value="">{services.isLoading ? 'Loading…' : 'Choose a service item'}</option>
                {services.data?.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} · {i.name}
                  </option>
                ))}
              </LookupSelect>
            )}
          </Field>
          <Button type="submit" disabled={!ledger.trim() || !itemId || pending}>
            Save
          </Button>
        </form>
      )}
    </Card>
  );
}

/** Lists what switching a month back reverses; refused while a later document depends on it. */
function SwitchBack({ month, pending, onClose, onConfirm }: { month: string; pending: boolean; onClose: () => void; onConfirm: () => void }) {
  const ws = useWorkspace();
  const preview = useQuery({
    queryKey: ['tally-switch-back', ws.tenantId, ws.entityId, month],
    queryFn: () => api<TallySwitchBack>(`/tally/books/${month}/switch-back`, { scope: ws.scope }),
  });
  const p = preview.data;
  const blocked = !p || p.dependents.length > 0;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Keep ${monthLabel(month)} in FactoryOS`}
      description="Its documents from Tally are reversed: their entries in the books, bills and stock are undone and they show as cancelled. The vouchers stay in Tally history."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={blocked || pending} onClick={onConfirm}>
            {p?.documents.length ? `Reverse ${p.documents.length} document${p.documents.length === 1 ? '' : 's'}` : 'Switch to FactoryOS'}
          </Button>
        </>
      }
    >
      {preview.error && <Alert tone="danger">{preview.error.message}</Alert>}
      {preview.isLoading && <p className="text-sm text-muted">Checking the month…</p>}
      {p && p.dependents.length > 0 && (
        <Alert tone="danger">
          Later documents depend on this month&apos;s Tally documents. Cancel them first: {p.dependents.join(', ')}.
        </Alert>
      )}
      {p && p.documents.length === 0 && <p className="text-sm text-muted">No documents from Tally in this month.</p>}
      {p && p.documents.length > 0 && (
        <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line text-sm">
          {p.documents.map((d) => (
            <li key={d.documentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <Link href={`${DOCUMENT_PATH[d.kind]}/${d.documentId}`} className="text-accent hover:underline">
                {d.label}
              </Link>
              <span className="text-xs text-muted">{formatDate(d.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
