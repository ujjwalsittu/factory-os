'use client';
import { Alert, Badge, Button, Card, CardHeader, DateInput, Field, Input, Select, Table, Td, Th } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, formatMoney, formatQty } from '@/lib/format';
import { DOCUMENT_KIND_LABEL, DOCUMENT_PATH, type TallyVoucherDetail, type TallyVoucherSummary } from '@/lib/tally';
import { AccountingPage } from './accounting-shared';
import { useWorkspace } from './workspace';

/**
 * Decision 072: vouchers imported from Tally's Day Book. Read-only history, kept apart from the general ledger: these
 * are never posted and never sent to GST or e-invoicing.
 */
const NOTE = 'Imported from Tally for reference. These vouchers are not in your FactoryOS books and are never sent to GST.';
type Page = { total: number; data: TallyVoucherSummary[]; types: string[] };

function Flags({ v }: { v: Pick<TallyVoucherSummary, 'cancelled' | 'optional'> }) {
  return (
    <>
      {v.cancelled && <Badge tone="neutral">Cancelled</Badge>}
      {v.optional && <Badge tone="neutral">Optional</Badge>}
    </>
  );
}

// ── Day Book ──

export function TallyHistory() {
  return (
    <AccountingPage title="Tally history" permission="accounts.tally.read">
      <Suspense fallback={<p>Loading…</p>}>
        <HistoryContent />
      </Suspense>
    </AccountingPage>
  );
}

function HistoryContent() {
  const ws = useWorkspace(),
    search = useSearchParams();
  const [from, setFrom] = useState(search.get('from') ?? ''),
    [to, setTo] = useState(search.get('to') ?? ''),
    [type, setType] = useState(search.get('type') ?? ''),
    [q, setQ] = useState(''),
    [offset, setOffset] = useState(0);
  const accountId = search.get('accountId'),
    partyId = search.get('partyId');
  const limit = 50;
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
    ...(from && { from }),
    ...(to && { to }),
    ...(type && { type }),
    ...(q.trim() && { q: q.trim() }),
    ...(accountId && { accountId }),
    ...(partyId && { partyId }),
  });
  const page = useQuery({
    queryKey: ['tally-vouchers', ws.tenantId, ws.entityId, params.toString()],
    queryFn: () => api<Page>(`/tally/vouchers?${params}`, { scope: ws.scope }),
  });
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setOffset(0);
  };
  const p = page.data;
  return (
    <div className="space-y-4">
      <Alert tone="info">{NOTE}</Alert>
      {(accountId || partyId) && (
        <p className="text-sm">
          Showing vouchers for one {accountId ? 'ledger' : 'party'}.{' '}
          <Link href="/app/accounts/tally/history" className="text-accent hover:underline">
            Show all
          </Link>
        </p>
      )}
      <Card>
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From date">{(f) => <DateInput {...f} value={from} onChange={(e) => reset(setFrom)(e.target.value)} />}</Field>
          <Field label="To date">{(f) => <DateInput {...f} value={to} onChange={(e) => reset(setTo)(e.target.value)} />}</Field>
          <Field label="Voucher type">
            {(f) => (
              <Select {...f} value={type} onChange={(e) => reset(setType)(e.target.value)}>
                <option value="">All types</option>
                {p?.types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Search number, party or narration">
            {(f) => <Input {...f} type="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} />}
          </Field>
        </div>
        {page.error && (
          <div className="px-4 pb-4">
            <Alert tone="danger">{page.error.message}</Alert>
          </div>
        )}
        {p && p.total === 0 && (
          <p className="px-4 pb-4 text-sm text-muted">
            No Tally vouchers here yet. Export the Day Book from Tally and upload it in{' '}
            <Link href="/app/accounts/tally" className="text-accent hover:underline">
              Tally import
            </Link>
            .
          </p>
        )}
        {p && p.total > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Voucher</Th>
                  <Th>Party</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {p.data.map((v) => (
                  <tr key={v.id}>
                    <Td className="whitespace-nowrap">{formatDate(v.date)}</Td>
                    <Td>
                      <Link href={`/app/accounts/tally/history/${v.id}`} className="text-accent hover:underline">
                        {v.voucherType} {v.number ?? ''}
                      </Link>{' '}
                      <Flags v={v} />
                      {v.narration && <span className="block text-xs text-muted">{v.narration}</span>}
                    </Td>
                    <Td>{v.partyName ?? '—'}</Td>
                    <Td className="text-right whitespace-nowrap">{formatMoney(v.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {p && p.total > limit && (
          <div className="flex items-center gap-3 p-4 text-sm">
            <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
              Previous
            </Button>
            <span>
              {offset + 1}–{Math.min(offset + limit, p.total)} of {p.total}
            </span>
            <Button size="sm" variant="secondary" disabled={offset + limit >= p.total} onClick={() => setOffset(offset + limit)}>
              Next
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── One voucher ──

export function TallyVoucher({ id }: { id: string }) {
  return (
    <AccountingPage title="Tally voucher" permission="accounts.tally.read">
      <VoucherContent id={id} />
    </AccountingPage>
  );
}

function VoucherContent({ id }: { id: string }) {
  const ws = useWorkspace();
  const v = useQuery({
    queryKey: ['tally-voucher', ws.tenantId, ws.entityId, id],
    queryFn: () => api<TallyVoucherDetail>(`/tally/vouchers/${id}`, { scope: ws.scope }),
  });
  if (v.error) return <Alert tone="danger">{v.error.message}</Alert>;
  const d = v.data;
  if (!d) return <p>Loading voucher…</p>;
  return (
    <div className="space-y-4">
      <Link href="/app/accounts/tally/history" className="text-sm text-accent hover:underline">
        Back to Tally history
      </Link>
      <Card>
        <CardHeader title={`${d.voucherType} ${d.number ?? ''}`} description={`${formatDate(d.date)}${d.partyName ? ` · ${d.partyName}` : ''}`} />
        <div className="space-y-2 px-5 pb-5 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">From Tally</Badge>
            <Flags v={d} />
          </div>
          {d.narration && <p>{d.narration}</p>}
          {d.documentKind && d.documentId ? (
            <p>
              This voucher is in a month kept in Tally and became a{' '}
              <Link href={`${DOCUMENT_PATH[d.documentKind]}/${d.documentId}`} className="text-accent hover:underline">
                {DOCUMENT_KIND_LABEL[d.documentKind].toLowerCase()}
              </Link>{' '}
              in your FactoryOS books.
            </p>
          ) : (
            <p className="text-muted">{NOTE}</p>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Ledger lines" />
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Tally ledger</Th>
                <Th>In FactoryOS</Th>
                <Th className="text-right">Debit</Th>
                <Th className="text-right">Credit</Th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.lineNo}>
                  <Td>
                    {l.ledgerName}
                    {l.bills.length > 0 && (
                      <span className="block text-xs text-muted">
                        {l.bills.map((b) => `${b.type ?? 'Bill'} ${b.name} ${formatMoney(b.amount)}`).join(' · ')}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {l.partyId ? (
                      <Link href={`/app/masters/parties/${l.partyId}`} className="text-accent hover:underline">
                        {l.partyName}
                      </Link>
                    ) : l.accountId ? (
                      <Link href={`/app/accounts/ledger?accountId=${l.accountId}`} className="text-accent hover:underline">
                        {l.accountName}
                      </Link>
                    ) : (
                      <span className="text-muted">Not linked</span>
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap">{l.side === 'debit' ? formatMoney(l.amount) : ''}</Td>
                  <Td className="text-right whitespace-nowrap">{l.side === 'credit' ? formatMoney(l.amount) : ''}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
      {d.items.length > 0 && (
        <Card>
          <CardHeader title="Stock" />
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th className="text-right">Quantity</Th>
                  <Th className="text-right">Rate</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((i, n) => (
                  <tr key={n}>
                    <Td>
                      <span className="font-medium">{i.item}</span>
                      {i.direction && <span className="text-xs text-muted"> · {i.direction === 'in' ? 'in' : 'out'}</span>}
                      {i.batches.some((b) => b.godown || b.batch) && (
                        <span className="block text-xs text-muted">
                          {i.batches.map((b) => [b.godown, b.batch && !/^primary batch$/i.test(b.batch) ? b.batch : null].filter(Boolean).join(' / ')).join(' · ')}
                        </span>
                      )}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {i.qty ? formatQty(i.qty) : '—'} {i.unit ?? ''}
                    </Td>
                    <Td className="text-right whitespace-nowrap">{i.rate ? formatMoney(i.rate) : '—'}</Td>
                    <Td className="text-right whitespace-nowrap">{i.amount ? formatMoney(i.amount) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── History from Tally, on ledger and party pages ──

/** The latest Tally vouchers for one ledger or party. Renders nothing without the permission or without history. */
export function TallyHistoryPanel({ accountId, partyId }: { accountId?: string; partyId?: string }) {
  const ws = useWorkspace();
  const filter = accountId ? `accountId=${accountId}` : `partyId=${partyId}`;
  const page = useQuery({
    queryKey: ['tally-vouchers', ws.tenantId, ws.entityId, 'panel', filter],
    queryFn: () => api<Page>(`/tally/vouchers?${filter}&limit=10`, { scope: ws.scope }),
    enabled: ws.can('accounts.tally.read') && !!(accountId || partyId),
  });
  const p = page.data;
  if (!p || p.total === 0) return null;
  return (
    <Card className="mt-4">
      <CardHeader
        title="History from Tally"
        description="Vouchers imported from Tally's Day Book, for reference. They are not in your FactoryOS books."
        actions={
          <Link href={`/app/accounts/tally/history?${filter}`} className="text-[13px] text-accent hover:underline">
            All {p.total}
          </Link>
        }
      />
      <ul className="divide-y divide-line">
        {p.data.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-sm">
            <span className="text-muted">{formatDate(v.date)}</span>
            <Link href={`/app/accounts/tally/history/${v.id}`} className="text-accent hover:underline">
              {v.voucherType} {v.number ?? ''}
            </Link>
            <Flags v={v} />
            <span className="ml-auto whitespace-nowrap">{formatMoney(v.amount)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
