'use client';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { ItemPicker } from '@/components/item-picker';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney, formatQty } from '@/lib/format';
import { PURPOSE_LABELS } from '@/lib/stock';
import type { Item, LedgerRow } from '@/lib/types';

function Ledger() {
  const ws = useWorkspace();
  const router = useRouter();
  const itemId = useSearchParams().get('itemId');
  const item = useQuery({ queryKey: ['item', itemId], queryFn: () => api<Item>(`/items/${itemId}`, { scope: ws.scope }), enabled: !!itemId });
  const rows = useQuery({ queryKey: ['ledger', ws.entityId, itemId], queryFn: () => api<LedgerRow[]>(`/stock/ledger?itemId=${itemId}`, { scope: ws.scope }), enabled: !!itemId });

  return (
    <>
      <div className="mb-4 max-w-md">
        <ItemPicker value={item.data ?? null} onChange={(it) => router.replace(`/app/inventory/ledger?itemId=${it.id}`)} />
      </div>
      <Card>
        {!itemId ? (
          <EmptyState icon={<ScrollText className="size-5" />} title="Pick an item" description="See every movement with its running balance and FIFO value." />
        ) : rows.data?.length === 0 ? (
          <EmptyState title="No movements yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Voucher</Th>
                <Th>Warehouse</Th>
                <Th>Batch</Th>
                <Th className="text-right">In / out</Th>
                <Th className="text-right">Rate</Th>
                <Th className="text-right">Value</Th>
                <Th className="text-right">Balance qty</Th>
                <Th className="text-right">Balance value</Th>
              </tr>
            </thead>
            <tbody>
              {rows.data?.map((r) => {
                const q = Number(r.qty);
                return (
                  <Tr key={r.seq}>
                    <Td className="text-[13px] whitespace-nowrap">{formatDate(r.postingDate)}</Td>
                    <Td className="text-[13px]">
                      <Link href={`/app/inventory/entries/${r.voucherId}`} className="font-mono hover:text-accent">
                        {r.voucherNumber}
                      </Link>{' '}
                      <span className="text-muted">{r.purpose ? PURPOSE_LABELS[r.purpose] : ''}</span>
                      {r.isReversal && (
                        <Badge tone="danger" className="ml-2">
                          Reversal
                        </Badge>
                      )}
                    </Td>
                    <Td className="font-mono text-[12px] whitespace-nowrap">{r.warehouseCode}</Td>
                    <Td className="font-mono text-[12px] whitespace-nowrap">{r.batchNo ?? '—'}</Td>
                    <Td className={`tabular text-right text-[13px] font-medium ${q < 0 ? 'text-danger' : 'text-success'}`}>
                      {q > 0 ? '+' : ''}
                      {formatQty(r.qty)}
                    </Td>
                    <Td className="tabular whitespace-nowrap text-right text-[13px] text-muted">{Number(r.rate) ? formatMoney(r.rate) : '—'}</Td>
                    <Td className="tabular whitespace-nowrap text-right text-[13px]">{Number(r.value) ? formatMoney(r.value) : '—'}</Td>
                    <Td className="tabular whitespace-nowrap text-right text-[13px] font-medium">{formatQty(r.balanceQty)}</Td>
                    <Td className="tabular whitespace-nowrap text-right text-[13px]">{formatMoney(r.balanceValue)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-[12px] text-subtle">Transfers move quantity between warehouses without changing value: FIFO cost is kept per entity and batch.</p>
    </>
  );
}

export default function LedgerPage() {
  return (
    <>
      <PageHeader title="Stock ledger" description="Append-only: corrections appear as reversals, never edits." />
      <EntityGate>
        <Suspense>
          <Ledger />
        </Suspense>
      </EntityGate>
    </>
  );
}
