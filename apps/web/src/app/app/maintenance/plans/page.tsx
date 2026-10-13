'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { MachineRow } from '@/lib/iot';
import { DUE_LABEL, intervalLabel, type Plan, trimNum } from '@/lib/maintenance';
import { formatMinutes } from '@/lib/services';
import type { Item } from '@/lib/types';

/** Preventive maintenance plans (decision 066): an interval by calendar and/or running hours, and a checklist. */
export default function MaintenancePlansPage() {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const q = useQuery({ queryKey: ['maintenance', 'plans', ws.entityId, 'all'], queryFn: () => api<Plan[]>('/maintenance/plans?all=1', { scope: ws.scope }), enabled: !!ws.entityId });
  const byMachine = [...(q.data ?? [])].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.machineCode.localeCompare(b.machineCode) || a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader
        title="Maintenance plans"
        description="A plan falls due every so many days or running hours, whichever comes first, counted from when it was last done. Running hours come from the machine's tap, or from job cards where it has none."
        actions={ws.entityId && ws.can('maintenance.plan.create') && <Button onClick={() => setEditing('new')}>New plan</Button>}
      />
      <EntityGate what="maintenance">
        <Card>
          {q.data?.length === 0 ? (
            <EmptyState icon={<Wrench className="size-5" />} title="No plans yet" description="For example: quarterly service on the VMC every 90 days or 500 running hours, with a spindle runout check." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Machine</Th>
                    <Th>Plan</Th>
                    <Th>Last done</Th>
                    <Th>Since then</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {byMachine.map((p) => (
                    <Tr key={p.id} className={ws.can('maintenance.plan.update') ? 'cursor-pointer' : undefined} onClick={() => ws.can('maintenance.plan.update') && setEditing(p)}>
                      <Td className="text-[13px]">
                        <Link className="font-mono font-medium hover:text-accent" href={`/app/machines/${p.machineId}`} onClick={(e) => e.stopPropagation()}>
                          {p.machineCode}
                        </Link>{' '}
                        {p.machineName}
                      </Td>
                      <Td className="text-[13px]">
                        {p.name}
                        <span className="block text-subtle">
                          {intervalLabel(p)} · blocks {formatMinutes(p.plannedMinutes)}
                        </span>
                      </Td>
                      <Td className="text-[13px] whitespace-nowrap">{formatDate(p.lastDoneAt)}</Td>
                      <Td className="text-[13px] whitespace-nowrap">
                        {p.due.runHoursSince} h<span className="block text-subtle">{p.due.runHoursSource === 'tap' ? 'from the tap' : 'from job cards'}</span>
                      </Td>
                      <Td>
                        {p.isActive ? <Badge tone={DUE_LABEL[p.due.status][1]}>{DUE_LABEL[p.due.status][0]}</Badge> : <Badge>Inactive</Badge>}
                        {p.due.dueAt && <span className="block text-[12px] text-subtle">{formatDate(p.due.dueAt)}</span>}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      </EntityGate>
      {editing && <PlanDialog plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

type Line = { text: string; unit: string; min: string; max: string; spareItemId: string; spareQty: string };
const blank: Line = { text: '', unit: '', min: '', max: '', spareItemId: '', spareQty: '' };

function PlanDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const machines = useQuery({ queryKey: ['plant-machines', ws.entityId], queryFn: () => api<MachineRow[]>('/plant/machines', { scope: ws.scope }), enabled: !plan });
  const items = useQuery({ queryKey: ['items', ws.tenantId, 'all'], queryFn: () => api<Item[]>('/items', { scope: ws.scope }) });
  const full = useQuery({ queryKey: ['maintenance', 'plan', ws.entityId, plan?.id], queryFn: () => api<Plan>(`/maintenance/plans/${plan!.id}`, { scope: ws.scope }), enabled: !!plan });
  const [f, setF] = useState({
    machineId: plan?.machineId ?? '',
    name: plan?.name ?? '',
    instructions: plan?.instructions ?? '',
    everyDays: plan?.everyDays?.toString() ?? '',
    everyRunHours: plan?.everyRunHours?.toString() ?? '',
    leadDays: plan?.leadDays.toString() ?? '7',
    plannedMinutes: plan?.plannedMinutes.toString() ?? '60',
    lastDoneAt: plan ? '' : new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10),
    isActive: plan?.isActive ?? true,
  });
  const [lines, setLines] = useState<Line[] | null>(plan ? null : [{ ...blank }]);
  const shown: Line[] = lines ?? full.data?.items?.map((i) => ({ text: i.text, unit: i.unit ?? '', min: trimNum(i.min) ?? '', max: trimNum(i.max) ?? '', spareItemId: i.spareItemId ?? '', spareQty: trimNum(i.spareQty) ?? '' })) ?? [];
  const setLine = (n: number, patch: Partial<Line>) => setLines(shown.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  const m = useMutation({
    mutationFn: () => {
      if (plan && !lines && !full.data) throw new Error('The checklist is still loading');
      const nul = (v: string) => (v.trim() ? v.trim() : null);
      const body = {
        name: f.name,
        instructions: nul(f.instructions),
        everyDays: f.everyDays ? Number(f.everyDays) : null,
        everyRunHours: f.everyRunHours ? Number(f.everyRunHours) : null,
        leadDays: Number(f.leadDays || 0),
        plannedMinutes: Number(f.plannedMinutes || 60),
        ...(f.lastDoneAt ? { lastDoneAt: new Date(`${f.lastDoneAt}T00:00:00+05:30`).toISOString() } : {}),
        items: shown.filter((l) => l.text.trim()).map((l) => ({ text: l.text, unit: nul(l.unit), min: nul(l.min), max: nul(l.max), spareItemId: nul(l.spareItemId), spareQty: l.spareItemId ? nul(l.spareQty) ?? '1' : null })),
      };
      return plan ? api(`/maintenance/plans/${plan.id}`, { method: 'PUT', scope: ws.scope, body: { ...body, isActive: f.isActive } }) : api('/maintenance/plans', { method: 'POST', scope: ws.scope, body: { ...body, machineId: f.machineId } });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['maintenance'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title={plan ? `${plan.machineCode} · ${plan.name}` : 'New maintenance plan'} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel={plan ? 'Save' : 'Add plan'} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        {!plan && (
          <Field label="Machine" error={err.machineId}>
            {(p) => (
              <Select {...p} value={f.machineId} onChange={set('machineId')} required>
                <option value="">Choose…</option>
                {machines.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} · {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Name" error={err.name}>
          {(p) => <Input {...p} value={f.name} onChange={set('name')} placeholder="Quarterly service" required autoFocus={!!plan} />}
        </Field>
        <Field label="Every (days)" error={err.everyDays} hint="Calendar interval">
          {(p) => <Input {...p} inputMode="numeric" value={f.everyDays} onChange={set('everyDays')} />}
        </Field>
        <Field label="Every (running hours)" error={err.everyRunHours} hint="Whichever comes first">
          {(p) => <Input {...p} inputMode="numeric" value={f.everyRunHours} onChange={set('everyRunHours')} />}
        </Field>
        <Field label="Due soon (days ahead)" error={err.leadDays}>
          {(p) => <Input {...p} inputMode="numeric" value={f.leadDays} onChange={set('leadDays')} />}
        </Field>
        <Field label="Machine down for (minutes)" error={err.plannedMinutes} hint="Reserved on the schedule">
          {(p) => <Input {...p} inputMode="numeric" value={f.plannedMinutes} onChange={set('plannedMinutes')} />}
        </Field>
        <Field label="Last done" error={err.lastDoneAt} hint={plan ? `Now ${formatDate(plan.lastDoneAt)}; set only to correct it` : 'Counts the first interval from here'}>
          {(p) => <Input {...p} type="date" value={f.lastDoneAt} onChange={set('lastDoneAt')} />}
        </Field>
        {plan && (
          <label className="flex items-center gap-2 self-end pb-2 text-[13px]">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active
          </label>
        )}
        <div className="sm:col-span-2">
          <Field label="Instructions" error={err.instructions}>
            {(p) => <Input {...p} value={f.instructions} onChange={set('instructions')} placeholder="Lock out, isolate air…" />}
          </Field>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-[13px] font-medium">Checklist</p>
        <p className="text-[12px] text-subtle">A unit makes it a reading; limits flag one outside them, which then needs a note. The checklist is fixed once the plan has an order.</p>
        {err.items && <p className="text-[12px] text-danger">{err.items}</p>}
        {shown.map((l, n) => (
          <div key={n} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_5rem_5rem_5rem_10rem_4rem]">
            <Input aria-label={`Task ${n + 1}`} className="col-span-2 sm:col-span-1" value={l.text} onChange={(e) => setLine(n, { text: e.target.value })} placeholder="Check spindle runout" />
            <Input aria-label={`Unit ${n + 1}`} value={l.unit} onChange={(e) => setLine(n, { unit: e.target.value })} placeholder="Unit" />
            <Input aria-label={`Min ${n + 1}`} inputMode="decimal" value={l.min} onChange={(e) => setLine(n, { min: e.target.value })} placeholder="Min" />
            <Input aria-label={`Max ${n + 1}`} inputMode="decimal" value={l.max} onChange={(e) => setLine(n, { max: e.target.value })} placeholder="Max" />
            <Select aria-label={`Spare ${n + 1}`} value={l.spareItemId} onChange={(e) => setLine(n, { spareItemId: e.target.value })}>
              <option value="">No spare</option>
              {items.data?.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.code}
                </option>
              ))}
            </Select>
            <Input aria-label={`Spare qty ${n + 1}`} inputMode="decimal" value={l.spareQty} onChange={(e) => setLine(n, { spareQty: e.target.value })} placeholder="Qty" disabled={!l.spareItemId} />
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setLines([...shown, { ...blank }])}>
          Add a task
        </Button>
      </div>
    </FormDialog>
  );
}
