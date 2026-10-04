'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Warehouse as WarehouseIcon } from 'lucide-react';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
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
        {adding && <WarehouseDialog warehouses={[]} onClose={() => setAdding(false)} />}
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
      {adding && <WarehouseDialog warehouses={list.data ?? []} onClose={() => setAdding(false)} />}
    </>
  );
}

function WarehouseDialog({ warehouses, onClose }: { warehouses: Warehouse[]; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ code: '', name: '', type: 'stores', parentId: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => api('/warehouses', { method: 'POST', body: { ...f, parentId: f.parentId || null }, scope: ws.scope }),
    onSuccess: () => (void qc.invalidateQueries({ queryKey: ['warehouses'] }), onClose()),
  });
  const e = fieldErrors(m.error);
  return (
    <FormDialog title="Add warehouse or bin" description="A bin is a warehouse inside another one, e.g. rack R2 in Main stores." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" error={e.code}>{(p) => <Input {...p} value={f.code} onChange={set('code')} className="font-mono uppercase" required placeholder="R2-B3" />}</Field>
        <Field label="Name" error={e.name} className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={set('name')} required />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" error={e.type}>
          {(p) => (
            <Select {...p} value={f.type} onChange={set('type')}>
              {Object.entries(WAREHOUSE_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Inside" error={e.parentId}>
          {(p) => (
            <Select {...p} value={f.parentId} onChange={set('parentId')}>
              <option value="">— (top level)</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </FormDialog>
  );
}
