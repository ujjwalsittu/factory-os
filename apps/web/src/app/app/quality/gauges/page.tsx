'use client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge as GaugeIcon } from 'lucide-react';
import { useState } from 'react';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Gauge, GaugeDetail } from '@/lib/quality';

const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export default function GaugesPage() {
  const ws = useWorkspace();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Gauges and calibration"
        description="Instruments with their calibration interval and due date. An overdue, failed or out-of-service gauge can't be used on an inspection."
        actions={ws.entityId && ws.can('quality.gauge.create') && <Button onClick={() => setCreating(true)}>New gauge</Button>}
      />
      <EntityGate what="quality">
        <Register />
      </EntityGate>
      {creating && <NewGauge onClose={() => setCreating(false)} />}
    </>
  );
}

function Register() {
  const ws = useWorkspace();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['gauges', ws.entityId], queryFn: () => api<Gauge[]>('/quality/gauges', { scope: ws.scope }) });
  return (
    <div className="space-y-4">
      <Card>
        {q.data?.length === 0 ? (
          <EmptyState icon={<GaugeIcon className="size-5" />} title="No gauges" description="Register micrometers, verniers, CMM probes and test rigs with their calibration interval." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Gauge</Th>
                  <Th>Location</Th>
                  <Th>Last calibrated</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((g) => (
                  <tr key={g.id} className={`cursor-pointer border-t border-line text-[13px] ${open === g.id ? 'bg-surface-2' : ''}`} onClick={() => setOpen(open === g.id ? null : g.id)}>
                    <Td>
                      <span className="font-mono font-medium">{g.code}</span> {g.description}
                      {g.type && <span className="block text-subtle">{g.type}</span>}
                    </Td>
                    <Td>{g.location ?? '—'}</Td>
                    <Td>{g.lastCalibrated ? formatDate(g.lastCalibrated) : '—'}</Td>
                    <Td>{g.dueDate ? formatDate(g.dueDate) : '—'}</Td>
                    <Td>{g.usable ? <Badge tone="success">In calibration</Badge> : <Badge tone="danger">{g.block?.replace(`Gauge ${g.code} `, '')}</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      {open && <GaugePanel id={open} />}
    </div>
  );
}

function GaugePanel({ id }: { id: string }) {
  const ws = useWorkspace();
  const [calibrating, setCalibrating] = useState(false);
  const q = useQuery({ queryKey: ['gauge', ws.entityId, id], queryFn: () => api<GaugeDetail>(`/quality/gauges/${id}`, { scope: ws.scope }) });
  const g = q.data;
  if (!g) return null;
  return (
    <>
      <Card>
        <CardHeader
          title={`${g.code} · calibration history`}
          description={`Every ${g.intervalDays} days`}
          actions={ws.can('quality.gauge.update') && <Button size="sm" onClick={() => setCalibrating(true)}>Record calibration</Button>}
        />
        {g.events.length === 0 ? (
          <p className="p-4 text-[13px] text-muted">No calibration recorded in FactoryOS yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {g.events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-2 px-4 py-2 text-[13px]">
                <span>{formatDate(e.calibratedOn)}</span>
                <Badge tone={e.result === 'fail' ? 'danger' : 'success'}>{e.result === 'adjusted' ? 'Adjusted' : e.result === 'pass' ? 'Pass' : 'Fail'}</Badge>
                {e.agency && <span className="text-muted">{e.agency}</span>}
                {e.certificateNo && <span className="text-muted">cert {e.certificateNo}</span>}
                {e.nextDue && <span className="text-subtle">next due {formatDate(e.nextDue)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <AttachmentsPanel ownerType="gauge" ownerId={g.id} defaultKind="calibration" title="Calibration certificates" />
      {calibrating && <Calibrate g={g} onClose={() => setCalibrating(false)} />}
    </>
  );
}

function NewGauge({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ code: '', description: '', type: '', location: '', intervalDays: '365', lastCalibrated: '' });
  const m = useMutation({
    mutationFn: () => api('/quality/gauges', { method: 'POST', scope: ws.scope, body: { ...f, type: f.type || null, location: f.location || null, intervalDays: Number(f.intervalDays), lastCalibrated: f.lastCalibrated || null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gauges'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="New gauge" onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Add gauge">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" error={err.code}>
          {(p) => <Input {...p} value={f.code} onChange={set('code')} className="font-mono uppercase" required autoFocus />}
        </Field>
        <Field label="Description" error={err.description}>
          {(p) => <Input {...p} value={f.description} onChange={set('description')} required />}
        </Field>
        <Field label="Type" error={err.type}>
          {(p) => <Input {...p} value={f.type} onChange={set('type')} placeholder="Micrometer, CMM probe…" />}
        </Field>
        <Field label="Location" error={err.location}>
          {(p) => <Input {...p} value={f.location} onChange={set('location')} />}
        </Field>
        <Field label="Calibration interval (days)" error={err.intervalDays}>
          {(p) => <Input {...p} inputMode="numeric" value={f.intervalDays} onChange={set('intervalDays')} required />}
        </Field>
        <Field label="Last calibrated" error={err.lastCalibrated} hint="Sets the first due date">
          {(p) => <Input {...p} type="date" value={f.lastCalibrated} onChange={set('lastCalibrated')} />}
        </Field>
      </div>
    </FormDialog>
  );
}

function Calibrate({ g, onClose }: { g: GaugeDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ calibratedOn: today(), result: 'pass', agency: '', certificateNo: '' });
  const [suspect, setSuspect] = useState<{ number: string | null }[] | null>(null);
  const m = useMutation({
    mutationFn: () => api<{ suspect: { number: string | null }[] }>(`/quality/gauges/${g.id}/calibrations`, { method: 'POST', scope: ws.scope, body: { ...f, agency: f.agency || null, certificateNo: f.certificateNo || null } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['gauges'] });
      void qc.invalidateQueries({ queryKey: ['gauge'] });
      if (r.suspect.length) setSuspect(r.suspect);
      else onClose();
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title={`Calibration of ${g.code}`} description="A pass or adjustment sets the next due date; a fail blocks the gauge and lists the inspections that used it." onClose={onClose} onSubmit={() => (suspect ? onClose() : m.mutate())} pending={m.isPending} error={m.error} submitLabel={suspect ? 'Done' : 'Record'}>
      {suspect ? (
        <Alert tone="warning">
          Review these inspections, measured with {g.code} since its last good calibration: {suspect.map((s) => s.number ?? 'draft').join(', ')}. Raise an NCR where results may be wrong.
        </Alert>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date">{(p) => <Input {...p} type="date" value={f.calibratedOn} onChange={set('calibratedOn')} required autoFocus />}</Field>
          <Field label="Result">
            {(p) => (
              <Select {...p} value={f.result} onChange={set('result')}>
                <option value="pass">Pass</option>
                <option value="adjusted">Adjusted, now in tolerance</option>
                <option value="fail">Fail</option>
              </Select>
            )}
          </Field>
          <Field label="Agency">{(p) => <Input {...p} value={f.agency} onChange={set('agency')} placeholder="NABL lab" />}</Field>
          <Field label="Certificate no.">{(p) => <Input {...p} value={f.certificateNo} onChange={set('certificateNo')} />}</Field>
        </div>
      )}
    </FormDialog>
  );
}
