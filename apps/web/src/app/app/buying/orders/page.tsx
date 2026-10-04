'use client';
import { Badge, buttonClass, Card, cn, EmptyState, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { poState } from '@/lib/buying';
import { formatDate, formatMoney, formatQty } from '@/lib/format';
import type { PurchaseOrderRow } from '@/lib/types';

const TABS = [
  { key: 'open', label: 'Open', query: 'open=true' },
  { key: 'draft', label: 'Drafts', query: 'status=draft' },
  { key: 'all', label: 'All', query: '' },
  { key: 'cancelled', label: 'Cancelled', query: 'status=cancelled' },
] as const;

export default function PurchaseOrdersPage() {
  const ws = useWorkspace();
  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Order from suppliers, receive against the order into quarantine, then match the supplier's invoice."
        actions={
          ws.entityId &&
          ws.can('buying.purchase_order.create') && (
            <Link href="/app/buying/orders/new" className={buttonClass('primary', 'md')}>
              New purchase order
            </Link>
          )
        }
      />
      <EntityGate what="buying">
        <OrderList />
      </EntityGate>
    </>
  );
}

function OrderList() {
  const ws = useWorkspace();
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('open');
  const query = TABS.find((t) => t.key === tab)!.query;
  const q = useQuery({ queryKey: ['purchase-orders', ws.entityId, tab], queryFn: () => api<PurchaseOrderRow[]>(`/purchase-orders?${query}`, { scope: ws.scope }) });
  return (
    <Card>
      <div className="flex gap-1 border-b border-line px-4 py-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn('rounded-lg px-3 py-1.5 text-[13px] font-medium', tab === t.key ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {q.data?.length === 0 ? (
        <EmptyState icon={<ShoppingCart className="size-5" />} title={tab === 'open' ? 'No open purchase orders' : 'Nothing here'} description="Raise a PO to a supplier; GST is worked out from each item's HSN code." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Date</Th>
              <Th>Supplier</Th>
              <Th>Expected</Th>
              <Th className="text-right">Received</Th>
              <Th className="text-right">Billed</Th>
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((o) => {
              const s = poState(o);
              const pct = (v: string) => (Number(o.orderedQty) ? `${Math.round((Number(v) / Number(o.orderedQty)) * 100)}%` : '—');
              return (
                <Tr key={o.id} className="cursor-pointer" onClick={() => router.push(`/app/buying/orders/${o.id}`)}>
                  <Td className="font-mono text-[13px] font-medium">
                    <Link href={`/app/buying/orders/${o.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent">
                      {o.number ?? <span className="text-subtle">Draft</span>}
                    </Link>
                  </Td>
                  <Td className="tabular text-[13px] whitespace-nowrap">{formatDate(o.orderDate)}</Td>
                  <Td className="text-[13px]">{o.supplierName}</Td>
                  <Td className="tabular text-[13px] whitespace-nowrap">{o.expectedDate ? formatDate(o.expectedDate) : '—'}</Td>
                  <Td className="tabular text-right text-[13px]" title={`${formatQty(o.receivedQty)} of ${formatQty(o.orderedQty)}`}>
                    {o.status === 'submitted' ? pct(o.receivedQty) : '—'}
                  </Td>
                  <Td className="tabular text-right text-[13px]">{o.status === 'submitted' ? pct(o.billedQty) : '—'}</Td>
                  <Td className="tabular text-right">{formatMoney(o.grandTotal)}</Td>
                  <Td>
                    <Badge tone={s.tone} dot>
                      {s.label}
                    </Badge>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
