'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Search } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ItemDialog } from '@/components/master-dialogs';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatQty, ITEM_TYPE_LABELS } from '@/lib/format';
import type { Item, ItemType, Uom } from '@/lib/types';

const TRACKING_LABELS = { none: 'Not tracked', batch: 'Batch / heat no.', serial: 'Serial no.' };

function ItemsPage() {
  const ws = useWorkspace();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState<Item | 'new' | null>(params.get('new') ? 'new' : null);
  const items = useQuery({
    queryKey: ['items', ws.tenantId, q, type],
    queryFn: () => api<Item[]>(`/items?limit=500${q ? `&q=${encodeURIComponent(q)}` : ''}${type ? `&type=${type}` : ''}`, { scope: ws.scope }),
  });
  const canCreate = ws.can('masters.item.create');

  return (
    <>
      <PageHeader
        title="Items"
        description="Raw materials, powders, components, finished goods and services. Shared by all legal entities."
        actions={
          canCreate && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> New item
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-subtle" />
            <Input className="pl-9" placeholder="Search code, name or drawing no." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
          </div>
          <Select className="w-52" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
            <option value="">All types</option>
            {Object.entries(ITEM_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        {items.data?.length === 0 ? (
          <EmptyState
            icon={<Package className="size-5" />}
            title={q || type ? 'No matching items' : 'No items yet'}
            description="Add your first raw material or component. Batch tracking captures heat numbers and lots."
            action={canCreate && !q && <Button onClick={() => setEditing('new')}>New item</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Tracking</Th>
                <Th>Unit</Th>
                <Th>HSN</Th>
                <Th>Rev.</Th>
                <Th className="text-right">Reorder at</Th>
              </tr>
            </thead>
            <tbody>
              {items.data?.map((it) => (
                <Tr key={it.id} className="cursor-pointer" onClick={() => setEditing(it)}>
                  <Td className="font-mono text-[13px] font-medium">{it.code}</Td>
                  <Td>
                    <span className={it.isActive ? '' : 'text-subtle line-through'}>{it.name}</span>
                    {it.exportControlled && (
                      <Badge tone="danger" className="ml-2">
                        Export-controlled
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-[13px]">{ITEM_TYPE_LABELS[it.type]}</Td>
                  <Td>{it.tracking === 'none' ? <span className="text-[13px] text-subtle">—</span> : <Badge tone="info">{TRACKING_LABELS[it.tracking]}</Badge>}</Td>
                  <Td className="font-mono text-[12px]">{it.uomCode}</Td>
                  <Td className="font-mono text-[12px] text-muted">{it.hsnCode ?? '—'}</Td>
                  <Td className="font-mono text-[12px]">{it.revision ?? '—'}</Td>
                  <Td className="tabular text-right text-[13px]">{formatQty(it.reorderLevel, it.uomDecimals)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <ItemDialog item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ItemsPage />
    </Suspense>
  );
}
