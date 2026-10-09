'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OctagonAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { ItemPicker } from '@/components/item-picker';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatQty } from '@/lib/format';
import { NCR_STATUS, type NcrDetail, type NcrRow } from '@/lib/quality';
import type { Batch, Item, Warehouse } from '@/lib/types';

export default function NcrsPage() {
  const ws = useWorkspace();
  const [raising, setRaising] = useState(false);
  return (
    <>
      <PageHeader
        title="Nonconformance (NCR / MRB)"
        description="Nonconforming stock waits in MRB until the review board decides: use as is, rework, repair, scrap or return to vendor. Each decision posts its own transaction."
        actions={ws.entityId && ws.can('quality.ncr.create') && <Button onClick={() => setRaising(true)}>Raise NCR</Button>}
      />
      <EntityGate what="quality">
        <List />
      </EntityGate>
      {raising && <Raise onClose={() => setRaising(false)} />}
    </>
  );
}

const FILTERS = ['open', 'dispositioned', 'closed', 'cancelled'] as const;

function List() {
  const ws = useWorkspace();
  const router = useRouter();
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('open');
  const q = useQuery({ queryKey: ['ncrs', ws.entityId, status], queryFn: () => api<NcrRow[]>(`/quality/ncrs?status=${status}`, { scope: ws.scope }) });
  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-line p-2" role="tablist" aria-label="Status">
        {FILTERS.map((f) => (
          <Button key={f} role="tab" aria-selected={status === f} size="sm" variant={status === f ? 'secondary' : 'ghost'} onClick={() => setStatus(f)}>
            {NCR_STATUS[f].label}
          </Button>
        ))}
      </div>
      {q.data?.length === 0 ? (
        <EmptyState icon={<OctagonAlert className="size-5" />} title="Nothing here" description="Failed inspections raise NCRs automatically; raise one by hand for anything found later." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>NCR</Th>
                <Th>Item</Th>
                <Th className="text-right">Qty</Th>
                <Th>Nonconformance</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((n) => (
                <Tr key={n.id} className="cursor-pointer" onClick={() => router.push(`/app/quality/ncrs/${n.id}`)}>
                  <Td className="text-[13px] whitespace-nowrap">
                    <Link className="font-mono font-medium hover:text-accent" href={`/app/quality/ncrs/${n.id}`} onClick={(e) => e.stopPropagation()}>
                      {n.number}
                    </Link>
                    <span className="block text-subtle">{formatDate(n.createdAt)}</span>
                  </Td>
                  <Td className="text-[13px]">
                    <span className="font-mono">{n.itemCode}</span> {n.itemName}
                    {n.batchNo && <span className="block font-mono text-subtle">{n.batchNo}</span>}
                  </Td>
                  <Td className="tabular text-right">{formatQty(n.qty)}</Td>
                  <Td className="max-w-80 truncate text-[13px]">{n.description}</Td>
                  <Td>
                    <Badge tone={NCR_STATUS[n.status].tone}>{NCR_STATUS[n.status].label}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function Raise({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [f, setF] = useState({ fromWarehouseId: '', batchId: '', qty: '', description: '' });
  const warehouses = useQuery({ queryKey: ['warehouses', ws.entityId], queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }) });
  const ours = (warehouses.data ?? []).filter((w) => w.isActive && !['mrb', 'at_job_worker', 'customer_owned'].includes(w.type));
  const batches = useQuery({
    queryKey: ['batches', ws.entityId, item?.id, f.fromWarehouseId],
    queryFn: () => api<(Batch & { qty: string })[]>(`/batches?itemId=${item!.id}&inStock=true&owner=company&warehouseId=${f.fromWarehouseId}`, { scope: ws.scope }),
    enabled: !!item && item.tracking !== 'none' && !!f.fromWarehouseId,
  });
  const m = useMutation({
    mutationFn: () => api<NcrDetail>('/quality/ncrs', { method: 'POST', scope: ws.scope, body: { itemId: item?.id, batchId: f.batchId || null, qty: f.qty, fromWarehouseId: f.fromWarehouseId || null, description: f.description } }),
    onSuccess: (n) => {
      void qc.invalidateQueries({ queryKey: ['ncrs'] });
      router.push(`/app/quality/ncrs/${n.id}`);
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="Raise NCR" description="The quantity moves to MRB and can't be used until it is dispositioned." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Raise NCR" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Item" error={err.itemId}>
          {(p) => <ItemPicker value={item} onChange={setItem} invalid={!!p['aria-invalid']} autoFocus />}
        </Field>
        <Field label="Where it is" error={err.fromWarehouseId}>
          {(p) => (
            <Select {...p} value={f.fromWarehouseId} onChange={set('fromWarehouseId')} required>
              <option value="">Choose…</option>
              {ours.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {item && item.tracking !== 'none' && (
          <Field label="Batch / heat / serial" error={err.batchId}>
            {(p) => (
              <Select {...p} value={f.batchId} onChange={set('batchId')} required>
                <option value="">Choose…</option>
                {batches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNo} ({formatQty(b.qty)})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={`Quantity${item?.uomCode ? ` (${item.uomCode})` : ''}`} error={err.qty}>
          {(p) => <Input {...p} inputMode="decimal" value={f.qty} onChange={set('qty')} required />}
        </Field>
      </div>
      <Field label="Nonconformance" error={err.description}>
        {(p) => <Input {...p} value={f.description} onChange={set('description')} required placeholder="What is wrong, against which requirement" />}
      </Field>
    </FormDialog>
  );
}
