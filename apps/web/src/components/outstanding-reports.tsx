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
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { today } from '@/lib/format';
import type { OutstandingReport } from '@/lib/settlements';
import { AccountingPage } from './accounting-shared';
import { downloadExact } from './settlement-shared';
import { useWorkspace } from './workspace';
export default function OutstandingReports() {
  return (
    <AccountingPage
      title="Outstanding & ageing"
      permission="accounts.report.read"
    >
      <Report />
    </AccountingPage>
  );
}
function Report() {
  const ws = useWorkspace(),
    [asOf, setAsOf] = useState(today),
    [side, setSide] = useState(''),
    [partyId, setParty] = useState(''),
    [currency, setCurrency] = useState(''),
    [show, setShow] = useState('all'),
    [parties, setParties] = useState<{ id: string; name: string }[]>([]);
  const filters = new URLSearchParams({
    ...(asOf && { asOf }),
    ...(side && { side }),
    ...(partyId && { partyId }),
    ...(currency && { currency }),
    ...(show === 'overdue' && { overdue: 'true' }),
    ...(show === 'msme' && { msme: 'true' }),
  });
  const query = filters.toString();
  const q = useQuery({
    queryKey: ['outstanding', ws.tenantId, ws.entityId, query],
    queryFn: () =>
      api<OutstandingReport>(`/accounts/outstanding?${query}`, {
        scope: ws.scope,
      }),
    retry: false,
  });
  useEffect(() => {
    if (q.data)
      setParties((old) => {
        const byId = new Map(old.map((p) => [p.id, p]));
        for (const p of q.data.positions)
          byId.set(p.partyId, { id: p.partyId, name: p.partyName });
        return [...byId.values()];
      });
  }, [q.data]);
  const exportData = useMutation({
    mutationFn: () =>
      api(`/accounts/outstanding/export?${query}`, { scope: ws.scope }),
    onSuccess: (data) => downloadExact(data, `outstanding-${asOf}.json`),
  });
  return (
    <div className="space-y-5 min-w-0">
      <Card className="p-4 print:hidden">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="As of date">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            )}
          </Field>
          <Field label="Trade side">
            {(p) => (
              <Select
                {...p}
                value={side}
                onChange={(e) => setSide(e.target.value)}
              >
                <option value="">Receivables & payables</option>
                <option value="receivable">Customer receivables</option>
                <option value="payable">Supplier payables</option>
              </Select>
            )}
          </Field>
          <Field label="Party filter">
            {(p) => (
              <Select
                {...p}
                value={partyId}
                onChange={(e) => setParty(e.target.value)}
              >
                <option value="">All parties</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Currency filter">
            {(p) => (
              <Input
                {...p}
                maxLength={3}
                value={currency}
                placeholder="All currencies"
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            )}
          </Field>
          <Field label="Show balances">
            {(p) => (
              <Select
                {...p}
                value={show}
                onChange={(e) => setShow(e.target.value)}
              >
                <option value="all">All balances</option>
                <option value="overdue">Overdue bills</option>
                <option value="msme">MSME supplier bills</option>
              </Select>
            )}
          </Field>
        </div>
      </Card>
      {(q.error || exportData.error) && (
        <Alert tone="danger">
          {q.error?.message ?? exportData.error?.message}
        </Alert>
      )}
      {q.isFetching && (
        <p className="text-sm text-muted">Loading exact balances…</p>
      )}
      {q.data && !q.data.active && (
        <Alert>
          Accounting inactive. These balances exclude operational transactions
          and have no reconciled openings.
        </Alert>
      )}
      <p className="text-sm text-muted">
        As of {q.data?.asOf ?? asOf}. Gross open bills, unapplied credits and
        net INR positions are shown separately. Allocate on-account money to
        clear an overdue bill.
      </p>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Party</Th>
              <Th>Side</Th>
              <Th>Gross bills INR</Th>
              <Th>On account / credits INR</Th>
              <Th>Net INR</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.positions.map((p) => (
              <tr key={`${p.partyId}:${p.side}`}>
                <Td>{p.partyName}</Td>
                <Td>{p.side}</Td>
                <Td className="font-mono">{p.grossOpenInr}</Td>
                <Td className="font-mono">{p.onAccountInr}</Td>
                <Td className="font-mono">{p.netInr}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Party / bill</Th>
              <Th>Type</Th>
              <Th>Currency</Th>
              <Th>Open amount</Th>
              <Th>Carrying INR</Th>
              <Th>Due</Th>
              <Th>Overdue days / bucket</Th>
              <Th>MSME</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.rows.map((b) => (
              <tr key={b.id}>
                <Td>
                  <p className="text-xs text-muted">{b.partyName}</p>
                  {b.sourceType === 'sales_invoice' &&
                  ws.can('selling.sales_invoice.read') ? (
                    <Link
                      className="text-accent"
                      href={`/app/selling/invoices/${b.sourceId}`}
                    >
                      {b.reference}
                    </Link>
                  ) : b.sourceType === 'purchase_invoice' &&
                    ws.can('buying.purchase_invoice.read') ? (
                    <Link
                      className="text-accent"
                      href={`/app/buying/invoices/${b.sourceId}`}
                    >
                      {b.reference}
                    </Link>
                  ) : (
                    b.reference
                  )}
                </Td>
                <Td>{b.kind}</Td>
                <Td>{b.currency}</Td>
                <Td className="font-mono">{b.openAmount}</Td>
                <Td className="font-mono">{b.carryingInr}</Td>
                <Td>{b.dueDate ?? 'Unclassified'}</Td>
                <Td>
                  {b.ageDays ?? '—'} · {b.ageingBucket}
                </Td>
                <Td>{b.msmeCategory ?? 'Unclassified'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {q.data?.rows.length === 0 && (
          <p className="p-4 text-sm text-muted">
            No open balances match these filters.
          </p>
        )}
      </Card>
      {q.data && <Alert>{q.data.msmeBasis}</Alert>}
      {ws.can('accounts.report.export') && (
        <div className="flex gap-3 print:hidden">
          <Button
            variant="secondary"
            disabled={!q.data}
            loading={exportData.isPending}
            onClick={() => exportData.mutate()}
          >
            Export exact balances
          </Button>
          <Button
            variant="secondary"
            disabled={!q.data}
            onClick={() => window.print()}
          >
            Print
          </Button>
        </div>
      )}
    </div>
  );
}
