'use client';
import { Alert, Badge, Button, Card, CardHeader, cn, Field, Input, Select, Table, Td, Th } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { formatAmount, formatDate, formatMoney, today } from '@/lib/format';
import type { Outstanding, TradeReconciliationRow, TradeSide } from '@/lib/settlements';
import { AccountingPage } from './accounting-shared';
import { useWorkspace } from './workspace';

export function OutstandingReports() {
  return (
    <AccountingPage title="Outstanding" permission="accounts.report.read">
      <Report />
    </AccountingPage>
  );
}

function Report() {
  const ws = useWorkspace();
  const [tab, setTab] = useState<TradeSide | 'reconciliation'>('receivable');
  const [f, setF] = useState({ asOf: today(), currency: '', overdue: false, msme: false });
  const qs = new URLSearchParams({ side: tab === 'reconciliation' ? 'receivable' : tab, asOf: f.asOf, ...(f.currency && { currency: f.currency }), ...(f.overdue && { overdue: 'true' }), ...(f.msme && { msme: 'true' }) }).toString();
  const q = useQuery({ queryKey: ['outstanding', ws.entityId, qs], queryFn: () => api<Outstanding>(`/accounts/outstanding?${qs}`, { scope: ws.scope }), enabled: tab !== 'reconciliation', retry: false });
  const rec = useQuery({ queryKey: ['trade-reconciliation', ws.entityId], queryFn: () => api<TradeReconciliationRow[]>('/accounts/trade-reconciliation', { scope: ws.scope }), enabled: tab === 'reconciliation', retry: false });
  const exportCsv = async () => {
    const res = await fetch(`/api/accounts/outstanding/export?${qs}`, { credentials: 'include', headers: { 'x-tenant-id': ws.scope.tenantId ?? '', 'x-entity-id': ws.scope.entityId ?? '' } });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `outstanding-${tab}-${f.asOf}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };
  const r = q.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1" role="tablist">
        {(
          [
            ['receivable', 'Receivables'],
            ['payable', 'Payables'],
            ['reconciliation', 'Reconciliation'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('rounded-lg px-3 py-1.5 text-[13px] font-medium', tab === k ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'reconciliation' ? (
        <Card>
          <CardHeader title="GL vs bill-wise subledger" description="Per control account and party. Any difference blocks new receipts/payments until it is explained." />
          {rec.error && <Alert tone="danger">{(rec.error as Error).message}</Alert>}
          <Table>
            <thead>
              <tr>
                <Th>Party</Th>
                <Th>Side</Th>
                <Th className="text-right">GL</Th>
                <Th className="text-right">Bills</Th>
                <Th className="text-right">Difference</Th>
              </tr>
            </thead>
            <tbody>
              {rec.data?.map((x) => (
                <tr key={`${x.accountId}:${x.partyId}`}>
                  <Td className="text-[13px]">{x.partyName ?? 'No party'}</Td>
                  <Td className="text-[13px] text-muted">{x.side}</Td>
                  <Td className="tabular text-right text-[13px]">{formatMoney(x.glInr)}</Td>
                  <Td className="tabular text-right text-[13px]">{formatMoney(x.subledgerInr)}</Td>
                  <Td className={cn('tabular text-right text-[13px]', Number(x.difference) !== 0 && 'font-semibold text-danger')}>{Number(x.difference) === 0 ? '✓' : formatMoney(x.difference)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <>
          <Card className="p-4 print:hidden">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="As of">{(p) => <Input {...p} type="date" value={f.asOf} onChange={(e) => setF({ ...f, asOf: e.target.value })} />}</Field>
              <Field label="Currency">
                {(p) => (
                  <Select {...p} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                    <option value="">All</option>
                    {['INR', 'USD', 'EUR', 'GBP'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <label className="flex items-center gap-2 pb-2 text-[13px]">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked })} /> Overdue only
              </label>
              {tab === 'payable' && (
                <label className="flex items-center gap-2 pb-2 text-[13px]">
                  <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.msme} onChange={(e) => setF({ ...f, msme: e.target.checked })} /> Micro & small (MSME)
                </label>
              )}
              {ws.can('accounts.report.export') && (
                <Button variant="secondary" className="ml-auto" onClick={() => void exportCsv()}>
                  <Download className="size-4" /> Export CSV
                </Button>
              )}
            </div>
          </Card>
          {q.error && <Alert tone="danger">{(q.error as Error).message}</Alert>}
          {r && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {r.buckets.map((b) => (
                  <Card key={b.key} className="p-4">
                    <p className="text-[12px] text-muted">{b.label}</p>
                    <p className="tabular text-[15px] font-semibold">{formatMoney(b.inr)}</p>
                  </Card>
                ))}
                <Card className="p-4">
                  <p className="text-[12px] text-muted">Net after {r.side === 'receivable' ? 'advances received' : 'advances paid'}</p>
                  <p className="tabular text-[15px] font-semibold">{formatMoney(r.totals.netInr)}</p>
                </Card>
              </div>
              {r.note && <Alert tone="info">{r.note}</Alert>}
              <Card>
                <CardHeader title={r.side === 'receivable' ? 'Unpaid customer bills' : 'Unpaid supplier bills'} description={`As of ${formatDate(r.asOf)} · gross ${formatMoney(r.totals.grossInr)}`} />
                <Table>
                  <thead>
                    <tr>
                      <Th>Party</Th>
                      <Th>Bill</Th>
                      <Th>Due</Th>
                      <Th className="text-right">Days overdue</Th>
                      <Th className="text-right">Open</Th>
                      <Th className="text-right">Carrying ₹</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.bills.map((b) => (
                      <tr key={b.id}>
                        <Td className="text-[13px]">
                          {b.partyName}
                          {b.msmeCategory && ['micro', 'small'].includes(b.msmeCategory) && <Badge tone="warning" className="ml-2">MSME {b.msmeCategory}</Badge>}
                        </Td>
                        <Td className="font-mono text-[13px]">
                          {b.reference}
                          {b.sourceType === 'manual' && <Badge className="ml-2">Journal</Badge>}
                        </Td>
                        <Td className="text-[13px] whitespace-nowrap">{b.dueDate ? formatDate(b.dueDate) : b.msmeUnclassified ? <span className="text-subtle">Unclassified</span> : '—'}</Td>
                        <Td className={cn('tabular text-right text-[13px]', (b.overdueDays ?? 0) > 0 && 'text-danger')}>{b.overdueDays || '—'}</Td>
                        <Td className="tabular text-right text-[13px]">{formatAmount(b.openAmount, b.currency)}</Td>
                        <Td className="tabular text-right text-[13px]">{formatMoney(b.carryingInr)}</Td>
                      </tr>
                    ))}
                    {r.bills.length === 0 && (
                      <tr>
                        <Td className="text-[13px] text-muted">Nothing outstanding.</Td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Card>
              {r.onAccount.length > 0 && (
                <Card>
                  <CardHeader title={r.side === 'receivable' ? 'Money received on account' : 'Advances paid'} description={`${formatMoney(r.totals.onAccountInr)} not yet applied to bills`} />
                  <Table>
                    <tbody>
                      {r.onAccount.map((b) => (
                        <tr key={b.id}>
                          <Td className="text-[13px]">{b.partyName}</Td>
                          <Td className="font-mono text-[13px]">{b.reference}</Td>
                          <Td className="tabular text-right text-[13px]">{formatAmount(b.openAmount, b.currency)}</Td>
                          <Td className="tabular text-right text-[13px]">{formatMoney(b.carryingInr)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
