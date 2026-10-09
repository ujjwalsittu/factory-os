'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Search } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
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

function ItemDialog({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const uoms = useQuery({ queryKey: ['uoms', ws.tenantId], queryFn: () => api<Uom[]>('/uoms', { scope: ws.scope }) });
  const [f, setF] = useState({
    code: item?.code ?? '',
    name: item?.name ?? '',
    description: item?.description ?? '',
    type: (item?.type ?? 'raw_material') as ItemType,
    tracking: item?.tracking ?? 'none',
    stockUomId: item?.stockUomId ?? '',
    hsnCode: item?.hsnCode ?? '',
    revision: item?.revision ?? '',
    serialPrefix: item?.serialPrefix ?? '',
    drawingNo: item?.drawingNo ?? '',
    shelfLifeDays: item?.shelfLifeDays?.toString() ?? '',
    mslLevel: item?.mslLevel ?? '',
    reorderLevel: item?.reorderLevel ? String(Number(item.reorderLevel)) : '',
    requiresIncomingInspection: item?.requiresIncomingInspection ?? false,
    exportControlled: item?.exportControlled ?? false,
    jobWorkExemptTool: item?.jobWorkExemptTool ?? false,
    requiresFinalInspection: item?.requiresFinalInspection ?? false,
    requiresFai: item?.requiresFai ?? false,
    faiProcessChange: item?.faiProcessChange ?? false,
    isActive: item?.isActive ?? true,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const canEdit = item ? ws.can('masters.item.update') : ws.can('masters.item.create');
  const m = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        description: f.description || undefined,
        type: f.type,
        hsnCode: f.hsnCode || null,
        revision: f.revision || null,
        serialPrefix: f.tracking === 'serial' ? f.serialPrefix || null : null,
        drawingNo: f.drawingNo || null,
        shelfLifeDays: f.shelfLifeDays ? Number(f.shelfLifeDays) : null,
        mslLevel: f.mslLevel || null,
        reorderLevel: f.reorderLevel || null,
        requiresIncomingInspection: f.requiresIncomingInspection,
        exportControlled: f.exportControlled,
        jobWorkExemptTool: f.jobWorkExemptTool,
        requiresFinalInspection: f.requiresFinalInspection,
        requiresFai: f.requiresFai,
        faiProcessChange: f.faiProcessChange,
        isActive: f.isActive,
      };
      return item
        ? api(`/items/${item.id}`, { method: 'PATCH', body, scope: ws.scope })
        : api('/items', { method: 'POST', body: { ...body, code: f.code, tracking: f.tracking, stockUomId: f.stockUomId }, scope: ws.scope });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['items'] });
      onClose();
    },
  });
  const e = fieldErrors(m.error);
  const isService = f.type === 'service';

  return (
    <FormDialog
      title={item ? `${item.code} · ${item.name}` : 'New item'}
      description={item ? 'Code, unit and tracking are fixed once an item exists.' : undefined}
      onClose={onClose}
      onSubmit={() => (canEdit ? m.mutate() : onClose())}
      pending={m.isPending}
      error={m.error}
      submitLabel={canEdit ? 'Save' : 'Close'}
      wide
    >
      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code" error={e.code}>{(p) => <Input {...p} value={f.code} onChange={set('code')} className="font-mono uppercase" disabled={!!item} required placeholder="TI64-BAR-50" />}</Field>
          <Field label="Name" error={e.name} className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={set('name')} required placeholder="Ti-6Al-4V bar Ø50 mm" />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type" error={e.type}>
            {(p) => (
              <Select {...p} value={f.type} onChange={set('type')}>
                {Object.entries(ITEM_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Stock unit" error={e.stockUomId}>
            {(p) => (
              <Select {...p} value={f.stockUomId} onChange={set('stockUomId')} disabled={!!item} required>
                <option value="">Choose…</option>
                {uoms.data?.map((u) => (
                  <option key={u.id} value={u.id}>{u.code} · {u.name}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tracking" hint={f.tracking === 'batch' ? 'Heat numbers, powder lots, reels' : f.tracking === 'serial' ? 'One unit per serial; numbers generated on production output' : undefined} error={e.tracking}>
            {(p) => (
              <Select {...p} value={isService ? 'none' : f.tracking} onChange={set('tracking')} disabled={!!item || isService}>
                <option value="none">Not tracked</option>
                <option value="batch">Batch / heat number</option>
                <option value="serial">Serial number</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label={isService ? 'SAC' : 'HSN'} error={e.hsnCode}>{(p) => <Input {...p} value={f.hsnCode} onChange={set('hsnCode')} inputMode="numeric" className="font-mono" placeholder="81089090" />}</Field>
          <Field label="Drawing no." error={e.drawingNo}>{(p) => <Input {...p} value={f.drawingNo} onChange={set('drawingNo')} className="font-mono" />}</Field>
          <Field label="Revision" error={e.revision}>{(p) => <Input {...p} value={f.revision} onChange={set('revision')} className="font-mono uppercase" placeholder="A" />}</Field>
          {f.tracking === 'serial' && (
            <Field label="Serial prefix" hint="Generated serials: PREFIX-000001; empty = item code" error={e.serialPrefix}>{(p) => <Input {...p} value={f.serialPrefix} onChange={set('serialPrefix')} className="font-mono uppercase" placeholder="BRK" />}</Field>
          )}
          <Field label="Reorder level" error={e.reorderLevel}>{(p) => <Input {...p} value={f.reorderLevel} onChange={set('reorderLevel')} inputMode="decimal" className="tabular" />}</Field>
        </div>
        {!isService && (
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Shelf life (days)" hint="Sets batch expiry on receipt" error={e.shelfLifeDays}>{(p) => <Input {...p} value={f.shelfLifeDays} onChange={set('shelfLifeDays')} inputMode="numeric" />}</Field>
            <Field label="MSL level" hint="Moisture-sensitive SMT parts" error={e.mslLevel}>
              {(p) => (
                <Select {...p} value={f.mslLevel} onChange={set('mslLevel')}>
                  <option value="">Not applicable</option>
                  {['1', '2', '2a', '3', '4', '5', '5a', '6'].map((l) => (
                    <option key={l} value={l}>MSL {l}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
        <Field label="Description" error={e.description}>{(p) => <Input {...p} value={f.description} onChange={set('description')} />}</Field>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
          {(
            [
              ['requiresIncomingInspection', 'Incoming inspection required'],
              ['exportControlled', 'Export-controlled (SCOMET / restricted)'],
              ['jobWorkExemptTool', 'Mould, die, jig, fixture or tool (no job-work return limit)'],
              ['requiresFinalInspection', 'Final inspection before release (output held in Quarantine)'],
              ['requiresFai', 'First article inspection before invoicing'],
              ['faiProcessChange', 'Process changed: needs a new FAI'],
              ['isActive', 'Active'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </FormDialog>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ItemsPage />
    </Suspense>
  );
}
