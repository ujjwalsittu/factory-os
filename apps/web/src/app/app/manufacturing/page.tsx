'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Factory } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { ItemPicker } from '@/components/item-picker';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney, formatQty } from '@/lib/format';
import { type BomRow, WO_STATUS, type WorkOrderDetail, type WorkOrderRow, type WorkOrderStatus } from '@/lib/manufacturing';
import type { Item, Warehouse } from '@/lib/types';

export default function WorkOrdersPage() {
  const ws = useWorkspace();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Work orders"
        description="Make items to their BOM: issue material by heat, record time on job cards, receive output at actual cost and close."
        actions={ws.entityId && ws.can('manufacturing.work_order.create') && <Button onClick={() => setCreating(true)}>New work order</Button>}
      />
      <EntityGate what="manufacturing">
        <OrderList />
      </EntityGate>
      {creating && <NewOrderDialog onClose={() => setCreating(false)} />}
    </>
  );
}

const FILTERS: (WorkOrderStatus | 'all')[] = ['all', 'draft', 'released', 'completed', 'cancelled'];

function OrderList() {
  const ws = useWorkspace();
  const router = useRouter();
  const [status, setStatus] = useState<WorkOrderStatus | 'all'>('all');
  const q = useQuery({
    queryKey: ['work-orders', ws.entityId, status],
    queryFn: () => api<WorkOrderRow[]>(`/manufacturing/work-orders${status === 'all' ? '' : `?status=${status}`}`, { scope: ws.scope }),
  });
  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-line p-2" role="tablist" aria-label="Status">
        {FILTERS.map((f) => (
          <Button key={f} role="tab" aria-selected={status === f} size="sm" variant={status === f ? 'secondary' : 'ghost'} onClick={() => setStatus(f)}>
            {f === 'all' ? 'All' : WO_STATUS[f].label}
          </Button>
        ))}
      </div>
      {q.data?.length === 0 ? (
        <EmptyState icon={<Factory className="size-5" />} title="No work orders" description="Plan one against an item's active BOM. Releasing it freezes the BOM revision and opens it to the shop floor." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Item</Th>
                <Th className="hidden sm:table-cell">Rev</Th>
                <Th className="text-right">Made</Th>
                <Th className="hidden md:table-cell">Due</Th>
                <Th className="hidden md:table-cell text-right">In WIP</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((w) => (
                <Tr key={w.id} className="cursor-pointer" onClick={() => router.push(`/app/manufacturing/work-orders/${w.id}`)}>
                  <Td className="font-mono text-[13px] font-medium whitespace-nowrap">
                    <Link href={`/app/manufacturing/work-orders/${w.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent">
                      {w.number ?? <span className="text-subtle">Draft</span>}
                    </Link>
                  </Td>
                  <Td>
                    <span className="font-mono text-[13px] whitespace-nowrap">{w.itemCode}</span> <span className="text-muted">{w.itemName}</span>
                    {w.salesOrder && <span className="block text-[12px] text-subtle">for {w.salesOrder}</span>}
                  </Td>
                  <Td className="hidden font-mono text-[13px] sm:table-cell">{w.revision}</Td>
                  <Td className="tabular text-right whitespace-nowrap">
                    {formatQty(w.producedQty)} / {formatQty(w.plannedQty)}
                  </Td>
                  <Td className="tabular hidden text-[13px] whitespace-nowrap md:table-cell">{w.plannedEnd ? formatDate(w.plannedEnd) : '—'}</Td>
                  <Td className="tabular hidden text-right text-[13px] md:table-cell">{Number(w.wip) ? formatMoney(w.wip) : '—'}</Td>
                  <Td>
                    <Badge tone={WO_STATUS[w.status].tone} dot>
                      {WO_STATUS[w.status].label}
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
  const [item, setItem] = useState<Item | null>(null);
  const [form, setForm] = useState({ bomId: '', plannedQty: '', sourceWarehouseId: '', targetWarehouseId: '', plannedStart: '', plannedEnd: '', remarks: '' });
  const boms = useQuery({
    queryKey: ['boms', ws.entityId, item?.id, 'active'],
    queryFn: () => api<BomRow[]>(`/manufacturing/boms?itemId=${item!.id}&status=active`, { scope: ws.scope }),
    enabled: !!item,
  });
  const warehouses = useQuery({ queryKey: ['warehouses', ws.entityId], queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }) });
  const active = (warehouses.data ?? []).filter((w) => w.isActive && w.type !== 'customer_owned');
  const m = useMutation({
    mutationFn: () =>
      api<WorkOrderDetail>('/manufacturing/work-orders', {
        method: 'POST',
        scope: ws.scope,
        body: {
          itemId: item?.id,
          bomId: form.bomId || boms.data?.find((b) => b.isDefault)?.id,
          plannedQty: form.plannedQty,
          sourceWarehouseId: form.sourceWarehouseId,
          targetWarehouseId: form.targetWarehouseId,
          plannedStart: form.plannedStart || null,
          plannedEnd: form.plannedEnd || null,
          remarks: form.remarks || null,
        },
      }),
    onSuccess: (wo) => {
      void qc.invalidateQueries({ queryKey: ['work-orders'] });
      router.push(`/app/manufacturing/work-orders/${wo.id}`);
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <FormDialog title="New work order" description="Saved as a draft. Release it to freeze the BOM revision and start work." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Create draft" wide>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Item to make" error={err.itemId} className="sm:col-span-2">
          {(f) => <ItemPicker value={item} onChange={(it) => { setItem(it); setForm({ ...form, bomId: '' }); }} invalid={!!f['aria-invalid']} autoFocus />}
        </Field>
        <Field label={`Quantity${item?.uomCode ? ` (${item.uomCode})` : ''}`} error={err.plannedQty}>
          {(f) => <Input {...f} inputMode="decimal" value={form.plannedQty} onChange={set('plannedQty')} required />}
        </Field>
      </div>
      <Field label="BOM revision" error={err.bomId} hint={item && boms.data?.length === 0 ? 'This item has no active BOM yet' : undefined}>
        {(f) => (
          <Select {...f} value={form.bomId || boms.data?.find((b) => b.isDefault)?.id || ''} onChange={set('bomId')} disabled={!item}>
            {!boms.data?.some((b) => b.isDefault) && <option value="">{boms.data?.length ? 'Choose…' : '—'}</option>}
            {boms.data?.map((b) => (
              <option key={b.id} value={b.id}>
                Revision {b.revision}
                {b.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Issue material from" error={err.sourceWarehouseId}>
          {(f) => (
            <Select {...f} value={form.sourceWarehouseId} onChange={set('sourceWarehouseId')} required>
              <option value="">Choose…</option>
              {active.filter((w) => w.availableForIssue).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Receive output into" error={err.targetWarehouseId}>
          {(f) => (
            <Select {...f} value={form.targetWarehouseId} onChange={set('targetWarehouseId')} required>
              <option value="">Choose…</option>
              {active.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Planned start" error={err.plannedStart}>
          {(f) => <Input {...f} type="date" value={form.plannedStart} onChange={set('plannedStart')} />}
        </Field>
        <Field label="Due" error={err.plannedEnd}>
          {(f) => <Input {...f} type="date" value={form.plannedEnd} onChange={set('plannedEnd')} />}
        </Field>
      </div>
      <Field label="Remarks">
        {(f) => <Input {...f} value={form.remarks} onChange={set('remarks')} placeholder="Customer, drawing, special instructions…" />}
      </Field>
    </FormDialog>
  );
}
