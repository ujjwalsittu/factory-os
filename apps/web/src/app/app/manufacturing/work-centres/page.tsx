'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Factory } from 'lucide-react';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { WorkCentre } from '@/lib/manufacturing';

export default function WorkCentresPage() {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<WorkCentre | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Work centres"
        description="Machine groups and their hourly rate (machine plus labour). Job cards absorb time into work in progress at this rate."
        actions={ws.entityId && ws.can('manufacturing.work_centre.create') && <Button onClick={() => setEditing('new')}>New work centre</Button>}
      />
      <EntityGate what="manufacturing">
        <CentreList onEdit={setEditing} />
      </EntityGate>
      {editing && <CentreDialog centre={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CentreList({ onEdit }: { onEdit: (c: WorkCentre) => void }) {
  const ws = useWorkspace();
  const [adding, setAdding] = useState<WorkCentre | null>(null);
  const q = useQuery({ queryKey: ['work-centres', ws.entityId], queryFn: () => api<WorkCentre[]>('/manufacturing/work-centres', { scope: ws.scope }) });
  const canEdit = ws.can('manufacturing.work_centre.update');
  return (
    <Card>
      {q.data?.length === 0 ? (
        <EmptyState icon={<Factory className="size-5" />} title="No work centres yet" description="Add one per machine group, e.g. 5-axis milling, CNC turning, CMM, assembly." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th className="text-right">Hourly rate</Th>
              <Th>Machines</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((c) => (
              <Tr key={c.id}>
                <Td className="font-mono text-[13px] font-medium">{c.code}</Td>
                <Td>
                  {c.name} {!c.isActive && <Badge tone="warning">Inactive</Badge>}
                </Td>
                <Td className="tabular text-right">{formatMoney(c.hourlyRate)}</Td>
                <Td className="text-[13px]">
                  {c.machines.length ? c.machines.map((m) => <span key={m.id} className="mr-2 font-mono">{m.code}</span>) : <span className="text-subtle">—</span>}
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {canEdit && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setAdding(c)}>
                        Add machine
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onEdit(c)}>
                        Edit
                      </Button>
                    </>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding && <MachineDialog centre={adding} onClose={() => setAdding(null)} />}
    </Card>
  );
}

function CentreDialog({ centre, onClose }: { centre: WorkCentre | null; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: centre?.code ?? '', name: centre?.name ?? '', hourlyRate: centre ? String(Number(centre.hourlyRate)) : '', isActive: centre?.isActive ?? true });
  const m = useMutation({
    mutationFn: () =>
      centre
        ? api(`/manufacturing/work-centres/${centre.id}`, { method: 'PUT', body: { name: form.name, hourlyRate: form.hourlyRate, isActive: form.isActive }, scope: ws.scope })
        : api('/manufacturing/work-centres', { method: 'POST', body: form, scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['work-centres'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={centre ? `Edit ${centre.code}` : 'New work centre'} description={centre ? 'A new rate applies to job cards completed from now on.' : undefined} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error}>
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
      {centre && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
        </label>
      )}
    </FormDialog>
  );
}

function MachineDialog({ centre, onClose }: { centre: WorkCentre; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: '', name: '' });
  const m = useMutation({
    mutationFn: () => api(`/manufacturing/work-centres/${centre.id}/machines`, { method: 'POST', body: form, scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['work-centres'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Add a machine to ${centre.code}`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Machine code" error={err.code}>
          {(f) => <Input {...f} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="M-03" required autoFocus />}
        </Field>
        <Field label="Machine name" error={err.name}>
          {(f) => <Input {...f} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="DMG Mori DMU 50" required />}
        </Field>
      </div>
    </FormDialog>
  );
}
