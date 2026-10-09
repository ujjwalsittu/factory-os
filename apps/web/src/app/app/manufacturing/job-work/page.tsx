'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { ItemPicker } from '@/components/item-picker';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatQty } from '@/lib/format';
import { type JobWorkDetail, type JobWorkRow, type JobWorkStatus, JW_STATUS } from '@/lib/job-work';
import type { Item, Party, Warehouse } from '@/lib/types';

export default function JobWorkPage() {
  const ws = useWorkspace();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Job work"
        description="Goods at job workers under Section 143: subcontract orders that send our material out and receive it back processed, and outsourced work-order operations."
        actions={ws.entityId && ws.can('manufacturing.job_work.create') && <Button onClick={() => setCreating(true)}>New subcontract order</Button>}
      />
      <EntityGate what="job work">
        <OrderList />
      </EntityGate>
      {creating && <NewOrderDialog onClose={() => setCreating(false)} />}
    </>
  );
}

const FILTERS: (JobWorkStatus | 'all')[] = ['all', 'open', 'draft', 'closed', 'cancelled'];

function OrderList() {
  const ws = useWorkspace();
  const router = useRouter();
  const [status, setStatus] = useState<JobWorkStatus | 'all'>('all');
  const q = useQuery({
    queryKey: ['job-work', ws.entityId, status],
    queryFn: () => api<JobWorkRow[]>(`/manufacturing/job-work${status === 'all' ? '' : `?status=${status}`}`, { scope: ws.scope }),
  });
  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-line p-2" role="tablist" aria-label="Status">
        {FILTERS.map((f) => (
          <Button key={f} role="tab" aria-selected={status === f} size="sm" variant={status === f ? 'secondary' : 'ghost'} onClick={() => setStatus(f)}>
            {f === 'all' ? 'All' : JW_STATUS[f].label}
          </Button>
        ))}
      </div>
      {q.data?.length === 0 ? (
        <EmptyState
          icon={<Truck className="size-5" />}
          title="No job work"
          description="Create a subcontract order to send material to a job worker, or send pieces from a work order whose routing has an outsourced operation."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Job worker</Th>
                <Th>For</Th>
                <Th className="text-right">At job worker</Th>
                <Th className="hidden md:table-cell">Expected back</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((o) => (
                <Tr key={o.id} className="cursor-pointer" onClick={() => router.push(`/app/manufacturing/job-work/${o.id}`)}>
                  <Td className="font-mono text-[13px] font-medium whitespace-nowrap">
                    <Link href={`/app/manufacturing/job-work/${o.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent">
                      {o.number}
                    </Link>
                  </Td>
                  <Td className="text-[13px]">{o.supplier}</Td>
                  <Td className="text-[13px]">
                    {o.kind === 'operation' ? (
                      <>
                        <span className="font-mono">{o.workOrder}</span> <span className="text-muted">op {o.operation}</span>
                      </>
                    ) : (
                      <span>{o.target}</span>
                    )}
                    {o.natureOfWork && <span className="block text-[12px] text-subtle">{o.natureOfWork}</span>}
                  </Td>
                  <Td className="tabular text-right">{Number(o.atVendor) ? formatQty(o.atVendor) : '—'}</Td>
                  <Td className="tabular hidden text-[13px] md:table-cell">{o.expectedReturnDate ? formatDate(o.expectedReturnDate) : '—'}</Td>
                  <Td>
                    <Badge tone={JW_STATUS[o.status].tone} dot>
                      {JW_STATUS[o.status].label}
                    </Badge>
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

function NewOrderDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const [target, setTarget] = useState<Item | null>(null);
  const [form, setForm] = useState({ supplierId: '', targetQty: '', targetWarehouseId: '', natureOfWork: '', expectedReturnDate: '', remarks: '' });
  const [materials, setMaterials] = useState<{ item: Item | null; qty: string }[]>([]);
  const workers = useQuery({ queryKey: ['parties', 'job_worker'], queryFn: () => api<Party[]>('/parties?role=job_worker&limit=200', { scope: ws.scope }) });
  const warehouses = useQuery({ queryKey: ['warehouses', ws.entityId], queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }) });
  const ours = (warehouses.data ?? []).filter((w) => w.isActive && w.type !== 'customer_owned' && w.type !== 'at_job_worker');
  const m = useMutation({
    mutationFn: () =>
      api<JobWorkDetail>('/manufacturing/job-work', {
        method: 'POST',
        scope: ws.scope,
        body: {
          supplierId: form.supplierId,
          targetItemId: target?.id,
          targetQty: form.targetQty,
          targetWarehouseId: form.targetWarehouseId || null,
          natureOfWork: form.natureOfWork || null,
          expectedReturnDate: form.expectedReturnDate || null,
          remarks: form.remarks || null,
          ...(materials.length ? { materials: materials.filter((x) => x.item).map((x) => ({ itemId: x.item!.id, qty: x.qty })) } : {}),
        },
      }),
    onSuccess: (o) => {
      void qc.invalidateQueries({ queryKey: ['job-work'] });
      router.push(`/app/manufacturing/job-work/${o.id}`);
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <FormDialog title="New subcontract order" description="What comes back from the job worker, and the material sent for it. Leave the material empty to use the item's active BOM." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Create order" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Job worker" error={err.supplierId} hint={workers.data?.length === 0 ? 'Mark a supplier as a job worker in Customers & suppliers' : undefined}>
          {(f) => (
            <Select {...f} value={form.supplierId} onChange={set('supplierId')} required autoFocus>
              <option value="">Choose…</option>
              {workers.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Nature of job work" error={err.natureOfWork}>
          {(f) => <Input {...f} value={form.natureOfWork} onChange={set('natureOfWork')} placeholder="Forging, heat treatment, anodising…" />}
        </Field>
        <Field label="Item that comes back" error={err.targetItemId}>
          {(f) => <ItemPicker value={target} onChange={setTarget} invalid={!!f['aria-invalid']} />}
        </Field>
        <Field label={`Quantity${target?.uomCode ? ` (${target.uomCode})` : ''}`} error={err.targetQty}>
          {(f) => <Input {...f} inputMode="decimal" value={form.targetQty} onChange={set('targetQty')} required />}
        </Field>
        <Field label="Receive into" error={err.targetWarehouseId}>
          {(f) => (
            <Select {...f} value={form.targetWarehouseId} onChange={set('targetWarehouseId')}>
              <option value="">Choose on receipt</option>
              {ours.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Expected back by" error={err.expectedReturnDate}>
          {(f) => <Input {...f} type="date" value={form.expectedReturnDate} onChange={set('expectedReturnDate')} />}
        </Field>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[13px] font-medium">Material to send</p>
          <Button size="sm" variant="ghost" onClick={() => setMaterials([...materials, { item: null, qty: '' }])}>
            <Plus className="size-4" /> Add material
          </Button>
        </div>
        {materials.length === 0 && <p className="text-[13px] text-muted">From the item&apos;s active BOM, scaled to the quantity.</p>}
        <div className="space-y-2">
          {materials.map((x, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
              <Field label={`Material ${i + 1}`} error={err[`materials.${i}.itemId`]}>
                {(f) => <ItemPicker value={x.item} onChange={(it) => setMaterials(materials.map((y, k) => (k === i ? { ...y, item: it } : y)))} invalid={!!f['aria-invalid']} />}
              </Field>
              <Field label="Quantity" error={err[`materials.${i}.qty`]}>
                {(f) => <Input {...f} inputMode="decimal" value={x.qty} onChange={(e) => setMaterials(materials.map((y, k) => (k === i ? { ...y, qty: e.target.value } : y)))} />}
              </Field>
              <Button variant="ghost" aria-label={`Remove material ${i + 1}`} onClick={() => setMaterials(materials.filter((_, k) => k !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </FormDialog>
  );
}
