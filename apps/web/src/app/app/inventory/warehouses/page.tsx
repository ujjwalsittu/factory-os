'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Warehouse as WarehouseIcon } from 'lucide-react';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { WarehouseDialog } from '@/components/master-dialogs';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { WAREHOUSE_TYPE_LABELS } from '@/lib/format';
import type { Warehouse } from '@/lib/types';

export default function WarehousesPage() {
  return (
    <>
      <PageHeader title="Warehouses & locations" description="Where stock sits. The type decides whether it can be issued and who owns it." />
      <EntityGate>
        <Warehouses />
      </EntityGate>
    </>
  );
}

function Warehouses() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ['warehouses', ws.entityId], queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }) });
  const standard = useMutation({
    mutationFn: () => api('/warehouses/standard', { method: 'POST', scope: ws.scope }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  });
  const toggle = useMutation({
    mutationFn: (w: Warehouse) => api(`/warehouses/${w.id}`, { method: 'PATCH', body: { availableForIssue: !w.availableForIssue }, scope: ws.scope }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  });
  const canCreate = ws.can('inventory.warehouse.create');
  const canUpdate = ws.can('inventory.warehouse.update');
  const byId = new Map(list.data?.map((w) => [w.id, w]));

  if (list.data?.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<WarehouseIcon className="size-5" />}
          title="No warehouses yet"
          description="Start with the standard layout: stores, quarantine, MRB hold, WIP, dry cabinet, finished goods, scrap and customer-owned material."
          action={
            canCreate && (
              <div className="flex gap-2">
                <Button onClick={() => standard.mutate()} loading={standard.isPending}>
                  <Sparkles className="size-4" /> Create standard layout
                </Button>
                <Button variant="secondary" onClick={() => setAdding(true)}>
                  Add one
                </Button>
              </div>
            )
          }
        />
        {adding && <WarehouseDialog onClose={() => setAdding(false)} />}
      </Card>
    );
  }

  return (
    <>
      <Card>
        <div className="flex justify-end border-b border-line px-4 py-3">
          {canCreate && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add warehouse or bin
            </Button>
          )}
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Inside</Th>
              <Th>Issue to production</Th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((w) => (
              <Tr key={w.id}>
                <Td className="font-mono text-[13px] font-medium">{w.code}</Td>
                <Td>{w.name}</Td>
                <Td>
                  <Badge tone={w.type === 'customer_owned' ? 'warning' : w.type === 'quarantine' || w.type === 'mrb' ? 'danger' : 'neutral'}>{WAREHOUSE_TYPE_LABELS[w.type] ?? w.type}</Badge>
                </Td>
                <Td className="text-[13px] text-muted">{w.parentId ? byId.get(w.parentId)?.name : '—'}</Td>
                <Td>
                  <label className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--accent)]"
                      checked={w.availableForIssue}
                      disabled={!canUpdate || toggle.isPending}
                      onChange={() => toggle.mutate(w)}
                      aria-label={`Allow issue from ${w.name}`}
                    />
                    {w.availableForIssue ? 'Allowed' : 'Blocked'}
                  </label>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <p className="mt-3 text-[12px] text-subtle">Customer-owned stock is held in custody: it's counted but never valued, and can't be mixed with company stock.</p>
      {adding && <WarehouseDialog onClose={() => setAdding(false)} />}
    </>
  );
}

