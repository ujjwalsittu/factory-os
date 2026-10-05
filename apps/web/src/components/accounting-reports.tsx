'use client';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
} from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type {
  AccountingStatus,
  Journal,
  Ledger,
  TrialBalance,
} from '@/lib/accounting';
import { AccountingPage } from './accounting-shared';
import { useWorkspace } from './workspace';
const titles = {
  'trial-balance': 'Trial balance',
  ledger: 'Account ledger',
  'day-book': 'Day book',
};
export default function Reports({ kind }: { kind: keyof typeof titles }) {
  return (
    <AccountingPage title={titles[kind]} permission="accounts.report.read">
      <Suspense fallback={<p>Loading report…</p>}>
        <Content kind={kind} />
      </Suspense>
    </AccountingPage>
  );
}
function Content({ kind }: { kind: keyof typeof titles }) {
  const ws = useWorkspace(),
    search = useSearchParams(),
    [from, setFrom] = useState(search.get('from') ?? ''),
    [to, setTo] = useState(search.get('to') ?? ''),
    [accountId, setAccount] = useState(search.get('accountId') ?? ''),
    [exportError, setExportError] = useState('');
  const range = new URLSearchParams();
  if (from) range.set('from', from);
  if (to) range.set('to', to);
  const params = new URLSearchParams(range);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (kind === 'ledger' && accountId) params.set('accountId', accountId);
  const query = params.toString(),
    q = useQuery({
      queryKey: ['accounting-report', kind, ws.tenantId, ws.entityId, query],
      queryFn: () =>
        api<TrialBalance | Ledger | Journal[]>(
          `/accounts/reports/${kind}?${query}`,
          { scope: ws.scope },
        ),
      enabled: kind !== 'ledger' || !!accountId,
      retry: false,
    });
  const status = useQuery({
    queryKey: ['accounting-report-status', ws.tenantId, ws.entityId],
    queryFn: () =>
      api<AccountingStatus>('/accounts/reports/status', { scope: ws.scope }),
  });
  const choices = useQuery({
    queryKey: ['accounting-report', 'choices', ws.tenantId, ws.entityId],
    queryFn: () =>
      api<TrialBalance>('/accounts/reports/trial-balance', { scope: ws.scope }),
    enabled: kind === 'ledger',
  });
  const exportJson = async () => {
    try {
      setExportError('');
      const data = await api(`/accounts/reports/${kind}/export?${query}`, {
        scope: ws.scope,
      });
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              {
                entity: ws.entityId,
                accounting: status.data,
                report: kind,
                from: from || null,
                to: to || null,
                currency: 'INR',
                precision: 6,
                data,
              },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError((e as Error).message);
    }
  };
  const trial =
      kind === 'trial-balance'
        ? (q.data as TrialBalance | undefined)
        : undefined,
    ledger = kind === 'ledger' ? (q.data as Ledger | undefined) : undefined,
    day = kind === 'day-book' ? (q.data as Journal[] | undefined) : undefined;
  const drcr = (s: string) =>
    `${formatMoney(s.startsWith('-') ? s.slice(1) : s)} ${s.startsWith('-') ? 'Cr' : 'Dr'}`;
  return (
    <div className="space-y-4">
      {status.data && !status.data.active && (
        <Alert tone="info">
          Accounting inactive. These books exclude operational transactions and
          have no reconciled opening balances.
        </Alert>
      )}
      {status.error && <Alert tone="danger">{status.error.message}</Alert>}
      {status.data?.active && (
        <p className="text-sm text-muted">
          Accounting active from {formatDate(status.data.cutoverDate!)}.
        </p>
      )}
      <Card>
        <div className="grid gap-4 p-4 sm:grid-cols-3 print:hidden">
          <Field label="From date">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            )}
          </Field>
          <Field label="To date">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            )}
          </Field>
          {kind === 'ledger' && (
            <Field label="Ledger account">
              {(p) => (
                <Select
                  {...p}
                  value={accountId}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">Choose ledger</option>
                  {choices.data?.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <p className="px-4 pb-4 text-sm text-muted">
          Entity{' '}
          {ws.tenantCtx.entities.find((e) => e.id === ws.entityId)?.shortName ??
            ws.entityId}{' '}
          · {from || 'Beginning of books'} to {to || 'Latest'} · INR · Export
          retains six decimal places.
        </p>
      </Card>
      {(q.error || choices.error || exportError) && (
        <Alert tone="danger">
          {q.error?.message ?? choices.error?.message ?? exportError}
        </Alert>
      )}
      {q.isLoading && <p>Loading report…</p>}
      {ws.can('accounts.report.export') && q.data && (
        <div className="flex gap-3 print:hidden">
          <Button variant="secondary" onClick={() => void exportJson()}>
            Export JSON
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            Print / PDF
          </Button>
        </div>
      )}
      {trial && (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Ledger</Th>
                <Th>Opening</Th>
                <Th>Period Dr</Th>
                <Th>Period Cr</Th>
                <Th>Closing</Th>
              </tr>
            </thead>
            <tbody>
              {trial.accounts.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link
                      className="text-accent"
                      href={`/app/accounts/ledger?accountId=${a.id}&${range}`}
                    >
                      {a.name}
                    </Link>
                  </Td>
                  <Td>{drcr(a.opening)}</Td>
                  <Td>{formatMoney(a.debit)}</Td>
                  <Td>{formatMoney(a.credit)}</Td>
                  <Td>{drcr(a.balance)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td>Trial balance totals</Td>
                <Td />
                <Td>{formatMoney(trial.debit)} Dr</Td>
                <Td>{formatMoney(trial.credit)} Cr</Td>
                <Td>
                  {trial.debit === trial.credit
                    ? status.data?.active
                      ? 'Balanced'
                      : 'Accounting inactive'
                    : 'Difference — investigate'}
                </Td>
              </tr>
            </tfoot>
          </Table>
        </Card>
      )}
      {ledger && (
        <Card>
          <div className="p-4 text-sm">
            {ledger.account.name} · Opening {drcr(ledger.opening)} · Closing{' '}
            {drcr(ledger.closing)}
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Voucher</Th>
                <Th>Narration</Th>
                <Th>Debit</Th>
                <Th>Credit</Th>
                <Th>Balance</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.entries.map((e) => (
                <tr key={e.id}>
                  <Td>{formatDate(e.postingDate)}</Td>
                  <Td>
                    <Link
                      className="text-accent"
                      href={`/app/accounts/journals/${e.voucherId}${range.size ? `?${range}` : ''}`}
                    >
                      {e.number}
                    </Link>
                  </Td>
                  <Td>{e.narration}</Td>
                  <Td>{formatMoney(e.debit)}</Td>
                  <Td>{formatMoney(e.credit)}</Td>
                  <Td>{drcr(e.balance!)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {day && (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Voucher</Th>
                <Th>Source</Th>
                <Th>Narration</Th>
                <Th>Debit</Th>
                <Th>Credit</Th>
              </tr>
            </thead>
            <tbody>
              {day.map((v) => (
                <tr key={v.id}>
                  <Td>{formatDate(v.postingDate)}</Td>
                  <Td>
                    <Link
                      className="text-accent"
                      href={`/app/accounts/journals/${v.id}${range.size ? `?${range}` : ''}`}
                    >
                      {v.number}
                    </Link>
                  </Td>
                  <Td>{v.sourceType.replaceAll('_', ' ')}</Td>
                  <Td>{v.narration}</Td>
                  <Td>{formatMoney(v.debit)}</Td>
                  <Td>{formatMoney(v.credit)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {!day.length && (
            <p className="p-5 text-sm text-muted">
              No posted vouchers in this period.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
