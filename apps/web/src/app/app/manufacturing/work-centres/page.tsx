'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Factory } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { WorkCentre } from '@/lib/manufacturing';
import type { Skill } from '@/lib/quality';
import type { Calendar } from '@/lib/scheduling';

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
  // Required skills (decision 062).
  const [skilling, setSkilling] = useState<WorkCentre | null>(null);
  const seeSkills = ws.can('quality.skill.read');
  const skills = useQuery({ queryKey: ['skills', ws.entityId], queryFn: () => api<Skill[]>('/quality/skills', { scope: ws.scope }), enabled: seeSkills });
  const reqs = useQuery({ queryKey: ['skill-requirements', ws.entityId], queryFn: () => api<Requirements>('/quality/skill-requirements', { scope: ws.scope }), enabled: seeSkills });
  const code = (id: string) => skills.data?.find((s) => s.id === id)?.code ?? '?';
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
              {seeSkills && <Th>Required skills</Th>}
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
                  {c.machines.length ? c.machines.map((m) => (
                        <Link key={m.id} href={`/app/machines/${m.id}`} className="mr-2 font-mono hover:text-accent" title={m.critical ? 'Critical: maintenance is verified by a supervisor' : undefined}>
                          {m.code}
                          {m.critical && '*'}
                        </Link>
                      )) : <span className="text-subtle">—</span>}
                </Td>
                {seeSkills && (
                  <Td className="text-[13px]">
                    {reqs.data?.workCentres.filter((r) => r.workCentreId === c.id).map((r) => <Badge key={r.skillId} tone="info" className="mr-1">{code(r.skillId)}</Badge>)}
                    {c.machines.map((m) => {
                      const mine = reqs.data?.machines.filter((r) => r.machineId === m.id) ?? [];
                      return mine.length ? (
                        <span key={m.id} className="mr-2 inline-block">
                          <span className="font-mono">{m.code}</span>: {mine.map((r) => code(r.skillId)).join(', ')}
                        </span>
                      ) : null;
                    })}
                    {ws.can('quality.skill.update') && (skills.data?.some((x) => x.isActive) ?? false) && (
                      <Button size="sm" variant="ghost" aria-label={`Skills for ${c.code}`} onClick={() => setSkilling(c)}>
                        Skills
                      </Button>
                    )}
                  </Td>
                )}
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
      {skilling && reqs.data && skills.data && <SkillsDialog centre={skilling} skills={skills.data.filter((x) => x.isActive)} reqs={reqs.data} onClose={() => setSkilling(null)} />}
    </Card>
  );
}

function CentreDialog({ centre, onClose }: { centre: WorkCentre | null; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: centre?.code ?? '', name: centre?.name ?? '', hourlyRate: centre ? String(Number(centre.hourlyRate)) : '', calendarId: centre?.calendarId ?? '', isActive: centre?.isActive ?? true });
  const calendars = useQuery({ queryKey: ['calendars', ws.entityId], queryFn: () => api<Calendar[]>('/manufacturing/calendars', { scope: ws.scope }), enabled: ws.can('manufacturing.calendar.read') });
  const m = useMutation({
    mutationFn: () =>
      centre
        ? api(`/manufacturing/work-centres/${centre.id}`, { method: 'PUT', body: { name: form.name, hourlyRate: form.hourlyRate, calendarId: form.calendarId || null, isActive: form.isActive }, scope: ws.scope })
        : api('/manufacturing/work-centres', { method: 'POST', body: { ...form, calendarId: form.calendarId || null }, scope: ws.scope }),
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

function MachineDialog({ centre, onClose }: { centre: WorkCentre; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: '', name: '', critical: false });
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
        <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
          <input type="checkbox" checked={form.critical} onChange={(e) => setForm({ ...form, critical: e.target.checked })} /> Critical machine: a supervisor verifies its maintenance
        </label>
      </div>
    </FormDialog>
  );
}

type Requirements = { machines: { machineId: string; skillId: string }[]; workCentres: { workCentreId: string; skillId: string }[] };

/** The skills a job card needs here: the work centre's, plus each machine's own (decision 062). */
function SkillsDialog({ centre, skills, reqs, onClose }: { centre: WorkCentre; skills: Skill[]; reqs: Requirements; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const initial = (): Record<string, string[]> => ({
    centre: reqs.workCentres.filter((r) => r.workCentreId === centre.id).map((r) => r.skillId),
    ...Object.fromEntries(centre.machines.map((m) => [m.id, reqs.machines.filter((r) => r.machineId === m.id).map((r) => r.skillId)])),
  });
  const [sel, setSel] = useState(initial);
  const before = initial();
  const m = useMutation({
    mutationFn: async () => {
      for (const [key, ids] of Object.entries(sel)) {
        if ([...ids].sort().join() === [...(before[key] ?? [])].sort().join()) continue;
        await api('/quality/skill-requirements', { method: 'PUT', scope: ws.scope, body: key === 'centre' ? { workCentreId: centre.id, skillIds: ids } : { machineId: key, skillIds: ids } });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skill-requirements'] });
      void qc.invalidateQueries({ queryKey: ['skills'] });
      void qc.invalidateQueries({ queryKey: ['skill-coverage'] });
      onClose();
    },
  });
  const toggle = (key: string, id: string) => setSel({ ...sel, [key]: sel[key]!.includes(id) ? sel[key]!.filter((x) => x !== id) : [...sel[key]!, id] });
  const rows = [{ key: 'centre', label: `${centre.code} (every machine)` }, ...centre.machines.map((mc) => ({ key: mc.id, label: mc.code }))];
  return (
    <FormDialog title={`Required skills · ${centre.code}`} description="A job card here needs the work centre's skills plus its machine's. Starting without them needs a co-signer (trainees) or a supervisor's allowance." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} wide>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.key}>
            <p className="mb-1 font-mono text-[13px] font-medium">{r.label}</p>
            <div className="flex flex-wrap gap-1">
              {skills.map((sk) => {
                const on = sel[r.key]!.includes(sk.id);
                return (
                  <Button key={sk.id} size="sm" variant={on ? 'secondary' : 'ghost'} aria-pressed={on} aria-label={`${r.label}: ${sk.name}`} onClick={() => toggle(r.key, sk.id)}>
                    {sk.code}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </FormDialog>
  );
}
