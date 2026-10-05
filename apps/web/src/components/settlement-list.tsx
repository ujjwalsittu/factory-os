'use client';
import { Badge, buttonClass, Card, cn, EmptyState, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { Banknote } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/format';
import { type Direction, type Settlement } from '@/lib/settlements';
import { STATUS_TONE } from '@/lib/stock';
import { AccountingPage } from './accounting-shared';
import { useWorkspace } from './workspace';

export function SettlementList() {
  return (
    <AccountingPage title="Receipts & payments" permission="accounts.settlement.read">
      <Rows />
    </AccountingPage>
  );
}

function Rows() {
  const ws = useWorkspace();
  const router = useRouter();
  const [direction, setDirection] = useState<Direction>('receipt');
  const q = useQuery({ queryKey: ['settlements', ws.entityId, direction], queryFn: () => api<Settlement[]>(`/accounts/settlements?direction=${direction}`, { scope: ws.scope }) });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2" role="tablist">
        {(['receipt', 'payment'] as const).map((d) => (
          <button key={d} role="tab" aria-selected={direction === d} onClick={() => setDirection(d)} className={cn('rounded-lg px-3 py-1.5 text-[13px] font-medium', direction === d ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2')}>
            {d === 'receipt' ? 'Customer receipts' : 'Supplier payments'}
          </button>
        ))}
        {ws.can('accounts.settlement.create') && (
          <Link href={`/app/accounts/settlements/new?direction=${direction}`} className={cn(buttonClass('primary', 'sm'), 'ml-auto')}>
            New {direction === 'receipt' ? 'receipt' : 'payment'}
          </Link>
        )}
      </div>
      {q.data?.length === 0 ? (
        <EmptyState icon={<Banknote className="size-5" />} title={direction === 'receipt' ? 'No receipts yet' : 'No payments yet'} description="Record money received or paid and settle it against invoices; anything left over is held on account." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Date</Th>
              <Th>{direction === 'receipt' ? 'Customer' : 'Supplier'}</Th>
              <Th>Account</Th>
              <Th>Reference</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">Allocated</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((s) => (
              <Tr key={s.id} className="cursor-pointer" onClick={() => router.push(`/app/accounts/settlements/${s.id}`)}>
                <Td className="font-mono text-[13px] font-medium whitespace-nowrap">
                  <Link href={`/app/accounts/settlements/${s.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent">
                    {s.number ?? <span className="text-subtle">Draft</span>}
                  </Link>
                </Td>
                <Td className="text-[13px] whitespace-nowrap">{formatDate(s.postingDate)}</Td>
                <Td className="text-[13px]">{s.partyName}</Td>
                <Td className="text-[13px] text-muted">{s.accountName}</Td>
                <Td className="text-[13px] text-muted">{s.bankReference ?? '—'}</Td>
                <Td className="tabular text-right">{formatAmount(s.amount, s.currency)}</Td>
                <Td className="tabular text-right text-[13px]">{formatAmount(s.allocated ?? '0', s.currency)}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[s.status]} dot>
                    {s.status[0]!.toUpperCase() + s.status.slice(1)}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
