'use client';
import { Field, Input, Select, DateInput } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { Project } from '@/lib/services';
import type { Item, Party } from '@/lib/types';

/** New project, or change one: commercial terms are fixed once active. */
export function ProjectDialog({ project, onClose, onSaved, prefill }: { project: Project | null; onClose: () => void; onSaved: (id: string) => void; prefill?: Partial<{ title: string; customerId: string }> }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const parties = useQuery({ queryKey: ['parties', ws.tenantId, 'all'], queryFn: () => api<Party[]>('/parties', { scope: ws.scope }) });
  const items = useQuery({ queryKey: ['items', ws.tenantId, 'all'], queryFn: () => api<Item[]>('/items', { scope: ws.scope }) });
  const people = useQuery({ queryKey: ['project-people', ws.tenantId], queryFn: () => api<{ id: string; name: string }[]>('/services/projects-people', { scope: ws.scope }) });
  const [f, setF] = useState({
    customerId: project?.customerId ?? prefill?.customerId ?? '',
    title: project?.title ?? prefill?.title ?? '',
    description: project?.description ?? '',
    customerRef: project?.customerRef ?? '',
    managerUserId: project?.managerUserId ?? '',
    serviceItemId: project?.serviceItemId ?? '',
    contractValue: project ? String(Number(project.contractValue)) : '',
    retentionPct: project ? String(Number(project.retentionPct)) : '0',
    dlpMonths: project ? String(project.dlpMonths) : '0',
    startDate: project?.startDate ?? '',
    endDate: project?.endDate ?? '',
  });
  const fixed = project?.status === 'active';
  const m = useMutation({
    mutationFn: () =>
      api<{ id?: string }>(project ? `/services/projects/${project.id}` : '/services/projects', {
        method: project ? 'PUT' : 'POST',
        scope: ws.scope,
        body: {
          ...f,
          description: f.description || null,
          customerRef: f.customerRef || null,
          managerUserId: f.managerUserId || null,
          dlpMonths: Number(f.dlpMonths || 0),
          startDate: f.startDate || null,
          endDate: f.endDate || null,
        },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['project'] });
      onClose();
      onSaved(r.id ?? project!.id);
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog
      title={project ? `Change ${project.number}` : 'New project'}
      description={fixed ? 'The customer and commercial terms are fixed while the project is active.' : 'Starts as a draft; add milestones that add up to the contract value, then activate it.'}
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel={project ? 'Save' : 'Create project'}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" error={err.customerId}>
          {(p) => (
            <Select {...p} value={f.customerId} onChange={set('customerId')} required autoFocus disabled={fixed}>
              <option value="">Choose…</option>
              {parties.data?.filter((c) => c.isCustomer && c.isActive).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Customer reference" hint="Their PO, work order or letter of award" error={err.customerRef}>{(p) => <Input {...p} value={f.customerRef} onChange={set('customerRef')} />}</Field>
        <Field label="Title" error={err.title} className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={set('title')} required placeholder="Hyperspectral payload structure" />}</Field>
        <Field label="Description" error={err.description} className="sm:col-span-2">{(p) => <Input {...p} value={f.description} onChange={set('description')} />}</Field>
        <Field label="Service item" hint="The SAC the milestones are invoiced on" error={err.serviceItemId}>
          {(p) => (
            <Select {...p} value={f.serviceItemId} onChange={set('serviceItemId')} required disabled={fixed}>
              <option value="">Choose…</option>
              {items.data?.filter((i) => i.type === 'service' && i.isActive).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code} · {i.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Contract value (₹)" hint="Before GST" error={err.contractValue}>{(p) => <Input {...p} value={f.contractValue} onChange={set('contractValue')} inputMode="decimal" required disabled={fixed} />}</Field>
        <Field label="Retention (%)" hint="Withheld by the customer from each invoice" error={err.retentionPct}>{(p) => <Input {...p} value={f.retentionPct} onChange={set('retentionPct')} inputMode="decimal" disabled={fixed} />}</Field>
        <Field label="Defect liability (months)" hint="Retention falls due this long after completion" error={err.dlpMonths}>{(p) => <Input {...p} type="number" min={0} max={60} value={f.dlpMonths} onChange={set('dlpMonths')} disabled={fixed} />}</Field>
        <Field label="Project manager" error={err.managerUserId}>
          {(p) => (
            <Select {...p} value={f.managerUserId} onChange={set('managerUserId')}>
              <option value="">{project ? 'Unchanged' : 'Me'}</option>
              {people.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start" error={err.startDate}>{(p) => <DateInput {...p} value={f.startDate} onChange={set('startDate')} />}</Field>
          <Field label="End" error={err.endDate}>{(p) => <DateInput {...p} value={f.endDate} onChange={set('endDate')} />}</Field>
        </div>
      </div>
    </FormDialog>
  );
}
