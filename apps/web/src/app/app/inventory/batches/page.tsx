'use client';
// Inventory → Batches & serials (decision 053): find a lot, serial or remnant by its number, heat or item code.
import { Badge, Card, EmptyState, Field, Input, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { Tags } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatQty } from '@/lib/format';
import { BATCH_KIND as KIND } from '@/lib/stock';
import type { BatchSearchRow } from '@/lib/types';


export default function BatchesPage() {
  return (
    <>
      <PageHeader title="Batches & serials" description="Every lot, heat, serial and remnant: where it is, how it moved, its quality records and certificates." />
      <EntityGate what="inventory">
        <List />
      </EntityGate>
    </>
  );
}

function List() {
  const ws = useWorkspace();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const rows = useQuery({ queryKey: ['batches-search', ws.entityId, q], queryFn: () => api<BatchSearchRow[]>(`/batches/search${q ? `?q=${encodeURIComponent(q)}` : ''}`, { scope: ws.scope }) });
  return (
    <Card>
      <div className="p-4">
        <Field label="Find" hint="Batch or serial number, heat number or item code">
          {(p) => <Input {...p} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. HT-5501" autoFocus />}
        </Field>
      </div>
      {rows.data?.length === 0 ? (
        <EmptyState icon={<Tags className="size-5" />} title="No batches found" description={q ? 'Try part of the number or the item code.' : 'Batches appear when tracked items are received or made.'} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Batch / serial</Th>
              <Th>Item</Th>
              <Th>Heat</Th>
              <Th className="text-right">Here</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {rows.data?.map((b) => (
              <Tr key={b.id}>
                <Td className="whitespace-nowrap">
                  <Link href={`/app/inventory/batches/${b.id}`} className="font-mono text-[13px] font-medium text-accent hover:underline">
                    {b.batchNo}
                  </Link>{' '}
                  {b.kind !== 'lot' && <Badge tone={KIND[b.kind].tone}>{KIND[b.kind].label}</Badge>}
                </Td>
                <Td>
                  <span className="font-mono text-[13px]">{b.itemCode}</span> <span className="text-[13px] text-muted">{b.itemName}</span>
                </Td>
                <Td className="font-mono text-[12px]">{b.heatNo ?? '—'}</Td>
                <Td className="tabular text-right whitespace-nowrap">
                  {Number(b.qty) ? formatQty(b.qty) : '—'} <span className="text-[11px] text-subtle">{b.uomCode}</span>
                </Td>
                <Td className="text-[13px] whitespace-nowrap text-muted">{formatDate(b.createdAt.slice(0, 10))}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
