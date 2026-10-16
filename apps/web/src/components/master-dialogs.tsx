'use client';
import { DateInput, Field, Input, Select } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Scope } from '@/lib/api';
import type { Account, AccountGroup } from '@/lib/accounting';
import { ITEM_TYPE_LABELS } from '@/lib/format';
import type { Calendar } from '@/lib/scheduling';
import type { WorkCentre } from '@/lib/manufacturing';
import type { HsnCode, Item, ItemType, Party, Uom, Warehouse } from '@/lib/types';
import { WAREHOUSE_TYPE_LABELS } from '@/lib/format';
import { fieldErrors, FormDialog } from './form-dialog';
import { HsnAdd, LookupSelect } from './lookup-select';
import { useWorkspace } from './workspace';

// One form per master record. The master pages and the "Add new" dialogs on every other screen use these.

const TREATMENTS: [string, string][] = [
  ['registered', 'Registered (GSTIN)'],
  ['unregistered', 'Unregistered'],
  ['composition', 'Composition dealer'],
  ['sez', 'SEZ unit / developer'],
  ['overseas', 'Overseas (import / export)'],
  ['deemed_export', 'Deemed export'],
];
const NEEDS_GSTIN = new Set(['registered', 'composition', 'sez']);

const GST_RATES = ['0', '0.1', '0.25', '1.5', '3', '5', '6', '7.5', '12', '18', '28', '40'];

/** Finds the saved item with the list shape the item search returns (unit code and decimals included). */
async function findItem(scope: Scope, id: string, code: string): Promise<Item> {
  const rows = await api<Item[]>(`/items?limit=5&q=${encodeURIComponent(code)}`, { scope });
  const hit = rows.find((r) => (id ? r.id === id : r.code.toLowerCase() === code.toLowerCase()));
  if (!hit) throw new Error('Saved, but the item could not be found again. Reload the list.');
  return hit;
}

export function ItemDialog({ item, onClose, onSaved, prefill }: { item: Item | null; onClose: () => void; onSaved?: (item: Item) => void; prefill?: Partial<{ code: string; name: string; type: ItemType }> }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const uoms = useQuery({ queryKey: ['uoms', ws.tenantId], queryFn: () => api<Uom[]>('/uoms', { scope: ws.scope }) });
  const [f, setF] = useState({
    code: item?.code ?? prefill?.code ?? '',
    name: item?.name ?? prefill?.name ?? '',
    description: item?.description ?? '',
    type: (item?.type ?? prefill?.type ?? 'raw_material') as ItemType,
    tracking: item?.tracking ?? 'none',
    stockUomId: item?.stockUomId ?? '',
    hsnCode: item?.hsnCode ?? '',
    revision: item?.revision ?? '',
    serialPrefix: item?.serialPrefix ?? '',
    drawingNo: item?.drawingNo ?? '',
    shelfLifeDays: item?.shelfLifeDays?.toString() ?? '',
    mslLevel: item?.mslLevel ?? '',
    pasteThawMinutes: item?.pasteThawMinutes?.toString() ?? '',
    pasteOpenHours: item?.pasteOpenHours?.toString() ?? '',
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
        pasteThawMinutes: f.pasteThawMinutes ? Number(f.pasteThawMinutes) : null,
        pasteOpenHours: f.pasteOpenHours ? Number(f.pasteOpenHours) : null,
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
    onSuccess: async (r) => {
      const saved = r as { id: string };
      void qc.invalidateQueries({ queryKey: ['items'] });
      if (onSaved) onSaved(await findItem(ws.scope, saved.id, f.code));
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
      duplicate={!item && onSaved ? { label: 'Use the existing item', onUse: async () => { onSaved(await findItem(ws.scope, '', f.code)); onClose(); } } : undefined}
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
              <LookupSelect {...p} kind="uom" noun="unit" value={f.stockUomId} onValue={(v) => setF((x) => ({ ...x, stockUomId: v }))} disabled={!!item} required empty={uoms.data?.length === 0}>
                <option value="">Choose…</option>
                {uoms.data?.map((u) => (
                  <option key={u.id} value={u.id}>{u.code} · {u.name}</option>
                ))}
              </LookupSelect>
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
          <Field label={isService ? 'SAC' : 'HSN'} error={e.hsnCode} hint={<HsnAdd code={f.hsnCode} />}>{(p) => <Input {...p} value={f.hsnCode} onChange={set('hsnCode')} inputMode="numeric" className="font-mono" placeholder="81089090" />}</Field>
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
            <Field label="Paste thaw (min)" hint="Solder paste only" error={e.pasteThawMinutes}>{(p) => <Input {...p} value={f.pasteThawMinutes} onChange={set('pasteThawMinutes')} inputMode="numeric" placeholder="240" />}</Field>
            <Field label="Paste open life (h)" hint="Usable once opened" error={e.pasteOpenHours}>{(p) => <Input {...p} value={f.pasteOpenHours} onChange={set('pasteOpenHours')} inputMode="numeric" placeholder="24" />}</Field>
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

export function PartyDialog({ party, onClose, onSaved, prefill }: { party: Party | null; onClose: () => void; onSaved?: (party: Party) => void; prefill?: Partial<{ name: string; isCustomer: boolean; isSupplier: boolean; isJobWorker: boolean }> }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: party?.code ?? '',
    name: party?.name ?? prefill?.name ?? '',
    isCustomer: party?.isCustomer ?? prefill?.isCustomer ?? false,
    isSupplier: party?.isSupplier ?? prefill?.isSupplier ?? !(prefill?.isCustomer || prefill?.isJobWorker),
    isJobWorker: party?.isJobWorker ?? prefill?.isJobWorker ?? false,
    gstTreatment: party?.gstTreatment ?? 'registered',
    gstin: party?.gstin ?? '',
    pan: party?.pan ?? '',
    stateCode: party?.stateCode ?? '',
    msmeUdyam: party?.msmeUdyam ?? '',
    msmeCategory: party?.msmeCategory ?? '',
    creditDays: party?.creditDays?.toString() ?? '',
    creditLimit: party?.creditLimit ?? '',
    email: party?.email ?? '',
    phone: party?.phone ?? '',
    isActive: party?.isActive ?? true,
    maasMember: party?.maasMember ?? false,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const canEdit = party ? ws.can('masters.party.update') : ws.can('masters.party.create');
  const needsGstin = NEEDS_GSTIN.has(f.gstTreatment);
  const m = useMutation({
    mutationFn: (): Promise<unknown> => {
      const body = {
        name: f.name,
        isCustomer: f.isCustomer,
        isSupplier: f.isSupplier,
        isJobWorker: f.isJobWorker,
        gstTreatment: f.gstTreatment,
        gstin: f.gstin || null,
        pan: needsGstin ? null : f.pan || null,
        stateCode: needsGstin ? null : f.stateCode || null,
        msmeUdyam: f.msmeUdyam || null,
        msmeCategory: f.msmeCategory || null,
        creditDays: f.creditDays ? Number(f.creditDays) : null,
        creditLimit: f.creditLimit || null,
        email: f.email || null,
        phone: f.phone || null,
        isActive: f.isActive,
        maasMember: f.isCustomer && f.maasMember,
      };
      return party ? api(`/parties/${party.id}`, { method: 'PATCH', body, scope: ws.scope }) : api('/parties', { method: 'POST', body: { ...body, code: f.code }, scope: ws.scope });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['parties'] });
      onSaved?.(r as Party);
      onClose();
    },
  });
  const e = fieldErrors(m.error);
  const msmeLate = f.isSupplier && f.msmeCategory && Number(f.creditDays) > 45;

  return (
    <FormDialog title={party ? party.name : 'New customer or supplier'} onClose={onClose} onSubmit={() => (canEdit ? m.mutate() : onClose())} pending={m.isPending} error={m.error} submitLabel={canEdit ? 'Save' : 'Close'} duplicate={!party && onSaved ? { label: 'Use the existing party', onUse: async () => { const rows = await api<Party[]>(`/parties?limit=5&q=${encodeURIComponent(f.code)}`, { scope: ws.scope }); const hit = rows.find((x) => x.code.toLowerCase() === f.code.toLowerCase()); if (hit) { onSaved(hit); onClose(); } } } : undefined} wide>
      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code" error={e.code}>{(p) => <Input {...p} value={f.code} onChange={set('code')} className="font-mono uppercase" disabled={!!party} required placeholder="TIMET" />}</Field>
          <Field label="Legal name" error={e.name} className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={set('name')} required />}</Field>
        </div>
        <div className="flex gap-6 text-[13px]">
          {(
            [
              ['isSupplier', 'Supplier'],
              ['isJobWorker', 'Job worker'],
              ['isCustomer', 'Customer'],
              ['isActive', 'Active'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.checked })} />
              {label}
            </label>
          ))}
          {e.isCustomer && <span className="text-danger">{e.isCustomer}</span>}
          {e.isJobWorker && <span className="text-danger">{e.isJobWorker}</span>}
        </div>
        {f.isCustomer && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.maasMember} onChange={(ev) => setF({ ...f, maasMember: ev.target.checked })} />
            Studio member (member rates on machine-hour bookings)
          </label>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="GST treatment" error={e.gstTreatment}>
            {(p) => (
              <Select {...p} value={f.gstTreatment} onChange={set('gstTreatment')}>
                {TREATMENTS.map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            )}
          </Field>
          {needsGstin ? (
            <Field label="GSTIN" hint="State and PAN are taken from it" error={e.gstin} className="sm:col-span-2">
              {(p) => <Input {...p} value={f.gstin} onChange={set('gstin')} maxLength={15} className="font-mono uppercase" required />}
            </Field>
          ) : (
            <>
              <Field label="PAN" error={e.pan}>{(p) => <Input {...p} value={f.pan} onChange={set('pan')} className="font-mono uppercase" />}</Field>
              <Field label="State code" hint="Place of supply, e.g. 27" error={e.stateCode}>{(p) => <Input {...p} value={f.stateCode} onChange={set('stateCode')} maxLength={2} className="font-mono" />}</Field>
            </>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Credit days" error={e.creditDays}>{(p) => <Input {...p} value={f.creditDays} onChange={set('creditDays')} inputMode="numeric" />}</Field>
          {f.isCustomer && <Field label="Credit limit (₹)" hint="Leave blank for no limit. Submitting above the limit requires an approver." error={e.creditLimit}>{(p) => <Input {...p} value={f.creditLimit} onChange={set('creditLimit')} inputMode="decimal" />}</Field>}
          <Field label="Email" error={e.email}>{(p) => <Input {...p} type="email" value={f.email} onChange={set('email')} />}</Field>
          <Field label="Phone" error={e.phone}>{(p) => <Input {...p} value={f.phone} onChange={set('phone')} />}</Field>
        </div>
        {f.isSupplier && (
          <div className="rounded-lg border border-line p-4">
            <p className="text-[13px] font-medium">MSME (Udyam)</p>
            <p className="mb-3 text-[12px] text-muted">Payments to micro and small enterprises are due within 45 days (Sec 43B(h)).</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Udyam number" error={e.msmeUdyam} className="sm:col-span-2">{(p) => <Input {...p} value={f.msmeUdyam} onChange={set('msmeUdyam')} className="font-mono uppercase" placeholder="UDYAM-MH-12-0001234" />}</Field>
              <Field label="Category" error={e.msmeCategory}>
                {(p) => (
                  <Select {...p} value={f.msmeCategory} onChange={set('msmeCategory')}>
                    <option value="">Not MSME</option>
                    <option value="micro">Micro</option>
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                  </Select>
                )}
              </Field>
            </div>
            {msmeLate && <p className="mt-2 text-[12px] text-warning">Credit days above 45 aren't allowed for micro and small suppliers: late payments are disallowed as expense.</p>}
          </div>
        )}
      </fieldset>
    </FormDialog>
  );
}

export function UomDialog({ onClose, onSaved, prefill }: { onClose: () => void; onSaved?: (u: Uom) => void; prefill?: Partial<{ code: string }> }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ code: prefill?.code?.toUpperCase().slice(0, 12) ?? '', name: '', decimals: '0' });
  const m = useMutation({
    mutationFn: () => api<Uom>('/uoms', { method: 'POST', body: { ...f, decimals: Number(f.decimals) }, scope: ws.scope }),
    onSuccess: (r) => (void qc.invalidateQueries({ queryKey: ['uoms'] }), onSaved?.(r), onClose()),
  });
  const e = fieldErrors(m.error);
  return (
    <FormDialog title="Add unit" onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} duplicate={onSaved ? { label: 'Use the existing unit', onUse: async () => { const rows = await api<Uom[]>('/uoms', { scope: ws.scope }); const hit = rows.find((x) => x.code.toLowerCase() === f.code.toLowerCase()); if (hit) { onSaved(hit); onClose(); } } } : undefined}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" error={e.code}>{(p) => <Input {...p} value={f.code} onChange={(ev) => setF({ ...f, code: ev.target.value })} className="font-mono uppercase" required />}</Field>
        <Field label="Name" error={e.name}>{(p) => <Input {...p} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} required />}</Field>
        <Field label="Decimals" error={e.decimals}>
          {(p) => (
            <Select {...p} value={f.decimals} onChange={(ev) => setF({ ...f, decimals: ev.target.value })}>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

export function HsnDialog({ onClose, onSaved, prefill }: { onClose: () => void; onSaved?: (h: HsnCode) => void; prefill?: Partial<{ code: string; kind: 'hsn' | 'sac' }> }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ code: prefill?.code ?? '', kind: prefill?.kind ?? 'hsn', description: '', gstRate: '18', effectiveFrom: '2017-07-01' });
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });
  const m = useMutation({
    mutationFn: () => api<HsnCode>('/hsn-codes', { method: 'POST', body: f, scope: ws.scope }),
    onSuccess: (r) => (void qc.invalidateQueries({ queryKey: ['hsn'] }), onSaved?.(r), onClose()),
  });
  const e = fieldErrors(m.error);
  return (
    <FormDialog title="Add HSN / SAC code" description="Confirm the rate against the current CBIC rate notification." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} duplicate={onSaved ? { label: 'Use the existing code', onUse: async () => { const rows = await api<HsnCode[]>('/hsn-codes', { scope: ws.scope }); const hit = rows.find((x) => x.code === f.code); if (hit) { onSaved(hit); onClose(); } } } : undefined}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" error={e.code}>{(p) => <Input {...p} value={f.code} onChange={set('code')} inputMode="numeric" className="font-mono" required />}</Field>
        <Field label="Kind" error={e.kind}>
          {(p) => (
            <Select {...p} value={f.kind} onChange={set('kind')}>
              <option value="hsn">HSN (goods)</option>
              <option value="sac">SAC (services)</option>
            </Select>
          )}
        </Field>
        <Field label="GST rate %" error={e.gstRate}>
          {(p) => (
            <Select {...p} value={f.gstRate} onChange={set('gstRate')}>
              {GST_RATES.map((r) => (
                <option key={r} value={r}>{r}%</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Description" error={e.description}>{(p) => <Input {...p} value={f.description} onChange={set('description')} required />}</Field>
      <Field label="Effective from" error={e.effectiveFrom}>{(p) => <DateInput {...p} value={f.effectiveFrom} onChange={set('effectiveFrom')} required />}</Field>
    </FormDialog>
  );
}

export function WarehouseDialog({ onClose, onSaved, prefill }: { onClose: () => void; onSaved?: (w: Warehouse) => void; prefill?: Partial<{ name: string; type: string }> }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const warehouses = useQuery({ queryKey: ['warehouses', ws.tenantId, ws.entityId], queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }) });
  const [f, setF] = useState({ code: '', name: prefill?.name ?? '', type: prefill?.type ?? 'stores', parentId: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => api<Warehouse>('/warehouses', { method: 'POST', body: { ...f, parentId: f.parentId || null }, scope: ws.scope }),
    onSuccess: (r) => (void qc.invalidateQueries({ queryKey: ['warehouses'] }), onSaved?.(r), onClose()),
  });
  const e = fieldErrors(m.error);
  return (
    <FormDialog title="Add warehouse or bin" description="A bin is a warehouse inside another one, e.g. rack R2 in Main stores." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} duplicate={onSaved ? { label: 'Use the existing warehouse', onUse: async () => { const rows = await api<Warehouse[]>('/warehouses', { scope: ws.scope }); const hit = rows.find((x) => x.code.toLowerCase() === f.code.toLowerCase()); if (hit) { onSaved(hit); onClose(); } } } : undefined}>
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
              {(warehouses.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

export function CentreDialog({ centre, onClose, onSaved, prefill }: { centre: WorkCentre | null; onClose: () => void; onSaved?: (c: WorkCentre) => void; prefill?: Partial<{ name: string }> }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: centre?.code ?? '', name: centre?.name ?? prefill?.name ?? '', hourlyRate: centre ? String(Number(centre.hourlyRate)) : '', calendarId: centre?.calendarId ?? '', isActive: centre?.isActive ?? true });
  const calendars = useQuery({ queryKey: ['calendars', ws.entityId], queryFn: () => api<Calendar[]>('/manufacturing/calendars', { scope: ws.scope }), enabled: ws.can('manufacturing.calendar.read') });
  const m = useMutation({
    mutationFn: (): Promise<unknown> =>
      centre
        ? api(`/manufacturing/work-centres/${centre.id}`, { method: 'PUT', body: { name: form.name, hourlyRate: form.hourlyRate, calendarId: form.calendarId || null, isActive: form.isActive }, scope: ws.scope })
        : api('/manufacturing/work-centres', { method: 'POST', body: { ...form, calendarId: form.calendarId || null }, scope: ws.scope }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['work-centres'] });
      onSaved?.(r as WorkCentre);
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={centre ? `Edit ${centre.code}` : 'New work centre'} description={centre ? 'A new rate applies to job cards completed from now on.' : undefined} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} duplicate={!centre && onSaved ? { label: 'Use the existing work centre', onUse: async () => { const rows = await api<WorkCentre[]>('/manufacturing/work-centres', { scope: ws.scope }); const hit = rows.find((x) => x.code.toLowerCase() === form.code.toLowerCase()); if (hit) { onSaved(hit); onClose(); } } } : undefined}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" error={err.code}>
          {(f) => <Input {...f} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!centre} required autoFocus={!centre} />}
        </Field>
        <Field label="Hourly rate (₹)" error={err.hourlyRate} hint="Machine + operator cost per hour">
          {(f) => <Input {...f} inputMode="decimal" value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} required />}
        </Field>
      </div>
      <Field label="Name" error={err.name}>
        {(f) => <Input {...f} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />}
      </Field>
      {calendars.data && calendars.data.length > 0 && (
        <Field label="Working calendar" error={err.calendarId} hint="For scheduling">
          {(f) => (
            <Select {...f} value={form.calendarId} onChange={(e) => setForm({ ...form, calendarId: e.target.value })}>
              <option value="">Default ({calendars.data.find((c) => c.isDefault)?.name ?? 'none'})</option>
              {calendars.data
                .filter((c) => c.isActive && !c.isDefault)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      )}
      {centre && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
        </label>
      )}
    </FormDialog>
  );
}

/** New ledger account (the chart's own page uses this too). */
export function AccountDialog({ onClose, onSaved, prefill }: { onClose: () => void; onSaved?: (a: Account) => void; prefill?: Partial<{ name: string; groupId: string; root: string }> }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['account-groups', ws.tenantId, ws.entityId], queryFn: () => api<AccountGroup[]>('/accounts/groups', { scope: ws.scope }) });
  const [f, setF] = useState({ code: '', name: prefill?.name ?? '', groupId: prefill?.groupId ?? '' });
  const m = useMutation({
    mutationFn: () => api<Account>('/accounts/accounts', { method: 'POST', body: f, scope: ws.scope }),
    onSuccess: (r) => (void qc.invalidateQueries({ queryKey: ['accounts'] }), onSaved?.(r), onClose()),
  });
  const e = fieldErrors(m.error);
  const choices = (groups.data ?? []).filter((g) => !prefill?.root || g.root === prefill.root);
  return (
    <FormDialog
      title="New ledger"
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      duplicate={onSaved ? { label: 'Use the existing ledger', onUse: async () => { const rows = await api<Account[]>('/accounts/accounts', { scope: ws.scope }); const hit = rows.find((x) => x.code.toLowerCase() === f.code.toLowerCase()); if (hit) { onSaved(hit); onClose(); } } } : undefined}
    >
      <Field label="Ledger code" error={e.code}>{(p) => <Input {...p} value={f.code} onChange={(ev) => setF({ ...f, code: ev.target.value })} required />}</Field>
      <Field label="Ledger name" error={e.name}>{(p) => <Input {...p} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} required />}</Field>
      <Field label="Account group" error={e.groupId}>
        {(p) => (
          <Select {...p} value={f.groupId} onChange={(ev) => setF({ ...f, groupId: ev.target.value })} required>
            <option value="">Choose group</option>
            {choices.map((g) => (
              <option key={g.id} value={g.id}>{g.name} · {g.root}</option>
            ))}
          </Select>
        )}
      </Field>
    </FormDialog>
  );
}
