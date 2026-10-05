'use client';
import {
  Alert,
  Badge,
  Card,
  Select,
  Table,
  Td,
  Th,
  buttonClass,
} from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { SettlementDocument } from '@/lib/settlements';
import { AccountingPage } from './accounting-shared';
import { AccountingInactive, useSettlementChoices } from './settlement-shared';
import { useWorkspace } from './workspace';
export default function Settlements() {
  return (
    <AccountingPage
      title="Receipts & payments"
      permission="accounts.settlement.read"
    >
      <List />
    </AccountingPage>
  );
}
function List() {
  const ws = useWorkspace(),
    choices = useSettlementChoices(),
    [direction, setDirection] = useState('');
  const q = useQuery({
    queryKey: ['settlements', ws.tenantId, ws.entityId],
    queryFn: () =>
      api<SettlementDocument[]>('/accounts/settlements', { scope: ws.scope }),
  });
  return (
    <div className="space-y-4">
      {(q.error || choices.error) && (
        <Alert tone="danger">
          {q.error?.message ?? choices.error?.message}
        </Alert>
      )}
      {choices.data && !choices.data.active && <AccountingInactive />}
      <div className="flex flex-wrap justify-between gap-3">
        <Select
          aria-label="Direction filter"
          className="max-w-xs"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          <option value="">Receipts and payments</option>
          <option value="receipt">Customer receipts</option>
          <option value="payment">Supplier payments</option>
        </Select>
        {ws.can('accounts.settlement.create') && (
          <Link className={buttonClass()} href="/app/accounts/settlements/new">
            New receipt / payment
          </Link>
        )}
      </div>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Document</Th>
              <Th>Date</Th>
              <Th>Direction</Th>
              <Th>Party</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {q.data
              ?.filter((d) => !direction || d.draft.direction === direction)
              .map((d) => (
                <tr key={d.id}>
                  <Td>
                    <Link
                      className="text-accent"
                      href={`/app/accounts/settlements/${d.id}`}
                    >
                      {d.number ?? 'Draft settlement'}
                    </Link>
                  </Td>
                  <Td>{d.draft.postingDate}</Td>
                  <Td>
                    {d.draft.direction === 'receipt' ? 'Receipt' : 'Payment'}
                  </Td>
                  <Td>
                    {choices.data?.parties.find((p) => p.id === d.draft.partyId)
                      ?.name ?? d.draft.partyId}
                  </Td>
                  <Td className="font-mono">
                    {d.draft.currency} {d.draft.amount}
                  </Td>
                  <Td>
                    <Badge>{d.status}</Badge>
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>
        {q.isLoading && <p className="p-4">Loading settlements…</p>}
        {q.data?.length === 0 && (
          <p className="p-4 text-sm text-muted">No receipts or payments yet.</p>
        )}
      </Card>
    </div>
  );
}
