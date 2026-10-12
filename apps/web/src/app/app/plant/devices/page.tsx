'use client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Router } from 'lucide-react';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { type Device, type Edge, MACHINE_STATE, signal, type TapConfig } from '@/lib/iot';
import { JOB_TONE, type LabelPrinter, type PrintJobRow } from '@/lib/smt';
import type { WorkCentre } from '@/lib/manufacturing';

/** Plant → Devices (decision 063): edge agents with their keys, and the machine taps behind them. */
export default function DevicesPage() {
  const ws = useWorkspace();
  const [dialog, setDialog] = useState<'edge' | 'device' | null>(null);
  const [key, setKey] = useState<{ code: string; key: string } | null>(null);
  return (
    <>
      <PageHeader
        title="Devices"
        description="Each plant's edge PC forwards its machine taps' states to FactoryOS with its own key. A tap meters one machine; booking usage on that machine comes from the meter."
        actions={
          ws.entityId && (
            <div className="flex gap-2">
              {ws.can('plant.device.manage') && (
                <Button variant="secondary" onClick={() => setDialog('edge')}>
                  Add edge
                </Button>
              )}
              {ws.can('plant.device.create') && <Button onClick={() => setDialog('device')}>Add tap</Button>}
            </div>
          )
        }
      />
      <EntityGate what="plant">
        <div className="space-y-4">
          {key && (
            <Alert tone="warning" title={`Key for edge ${key.code}: copy it now, it won't be shown again`}>
              <code className="mt-1 block break-all font-mono text-[12px] text-fg" aria-label="Edge key">
                {key.key}
              </code>
              <p className="mt-1">Set it as FACTORYOS_EDGE_KEY on the edge PC. Rotating issues a new key and stops this one.</p>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setKey(null)}>
                I've saved it
              </Button>
            </Alert>
          )}
          <Edges onKey={setKey} />
          <Taps />
          {ws.can('manufacturing.smt.read') && <Printers />}
        </div>
      </EntityGate>
      {dialog === 'edge' && <EdgeForm onClose={() => setDialog(null)} onKey={setKey} />}
      {dialog === 'device' && <TapForm onClose={() => setDialog(null)} />}
    </>
  );
}

function Edges({ onKey }: { onKey: (k: { code: string; key: string }) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['edges', ws.entityId], queryFn: () => api<Edge[]>('/plant/edges', { scope: ws.scope }) });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'rotate' | 'revoke' }) => api<{ code: string; key: string }>(`/plant/edges/${id}/${action}`, { method: 'POST', scope: ws.scope, body: {} }),
    onSuccess: (r, v) => {
      void qc.invalidateQueries({ queryKey: ['edges'] });
      if (v.action === 'rotate') onKey(r);
    },
  });
  return (
    <Card>
      <CardHeader title="Edge agents" description="Only a hash of each key is stored; the prefix helps you tell keys apart." />
      {act.error && <Alert tone="danger" className="m-4">{act.error.message}</Alert>}
      {q.data?.length === 0 ? (
        <EmptyState icon={<Router className="size-5" />} title="No edge yet" description="Add one per plant edge PC, then install the edge agent with its key." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Edge</Th>
                <Th>Key</Th>
                <Th>Last seen</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data?.map((e) => (
                <Tr key={e.id}>
                  <Td className="text-[13px]">
                    <span className="font-mono font-medium">{e.code}</span> {e.name} {e.status === 'revoked' && <Badge tone="danger">Revoked</Badge>}
                  </Td>
                  <Td className="font-mono text-[12px] whitespace-nowrap">
                    {e.keyPrefix}… <span className="font-sans text-subtle">since {formatDateTime(e.rotatedAt)}</span>
                  </Td>
                  <Td className="text-[13px] whitespace-nowrap">{e.lastSeenAt ? formatDateTime(e.lastSeenAt) : <span className="text-subtle">Never</span>}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {e.status === 'active' && ws.can('plant.device.manage') && (
                      <>
                        <Button size="sm" variant="ghost" loading={act.isPending && act.variables?.id === e.id && act.variables.action === 'rotate'} onClick={() => act.mutate({ id: e.id, action: 'rotate' })}>
                          Rotate key
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => window.confirm(`Revoke ${e.code}? Its key stops working at once.`) && act.mutate({ id: e.id, action: 'revoke' })}>
                          Revoke
                        </Button>
                      </>
                    )}
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

function Taps() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['devices', ws.entityId], queryFn: () => api<Device[]>('/plant/devices', { scope: ws.scope }) });
  const [editing, setEditing] = useState<Device | null>(null);
  const retire = useMutation({
    mutationFn: (id: string) => api(`/plant/devices/${id}/retire`, { method: 'POST', scope: ws.scope, body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['devices'] }),
  });
  return (
    <Card>
      <CardHeader title="Machine taps" description="Each tap publishes its machine's state every heartbeat. One active tap per machine." />
      {q.data?.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-muted">No taps yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Tap</Th>
                <Th>Machine</Th>
                <Th>Edge</Th>
                <Th>Last state</Th>
                <Th>Tap status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data?.map((d) => (
                <Tr key={d.id}>
                  <Td className="text-[13px]">
                    <span className="font-mono font-medium">{d.code}</span> {d.name} {d.status === 'retired' && <Badge tone="neutral">Retired</Badge>}
                    <span className="block text-subtle">heartbeat {d.heartbeatSeconds} s</span>
                  </Td>
                  <Td className="text-[13px]">
                    <span className="font-mono">{d.machineCode}</span> {d.machineName}
                  </Td>
                  <Td className="font-mono text-[13px]">{d.edgeCode}</Td>
                  <Td className="text-[13px] whitespace-nowrap">
                    {d.lastState ? <Badge tone={MACHINE_STATE[d.lastState].tone}>{MACHINE_STATE[d.lastState].label}</Badge> : <span className="text-subtle">—</span>}
                    {d.lastSeenAt && <span className="block text-subtle">{formatDateTime(d.lastSeenAt)}</span>}
                  </Td>
                  <Td className="text-[13px]">
                    <TapStatus d={d} />
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {d.status === 'active' && ws.can('plant.device.update') && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>
                        Settings
                      </Button>
                    )}
                    {d.status === 'active' && ws.can('plant.device.update') && (
                      <Button size="sm" variant="ghost" onClick={() => window.confirm(`Retire ${d.code}? Its machine stops being metered.`) && retire.mutate(d.id)}>
                        Retire
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {editing && <TapSettings d={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

/** What the tap last reported (decision 064): whether it runs the current settings, firmware, signal, outbox, error. */
function TapStatus({ d }: { d: Device }) {
  if (!d.statusAt) return <span className="text-subtle">Not reported</span>;
  const applied = d.appliedConfigVersion === d.configVersion;
  return (
    <div className="space-y-0.5">
      <Badge tone={applied ? 'success' : 'warning'}>{applied ? `Config v${d.configVersion} applied` : `v${d.configVersion} pending (runs ${d.appliedConfigVersion ? `v${d.appliedConfigVersion}` : 'none'})`}</Badge>
      <span className="block text-subtle">
        fw {d.fwVersion}
        {d.rssi !== null && ` · signal ${signal(d.rssi)} (${d.rssi} dBm)`}
        {d.outbox ? ` · ${d.outbox} queued` : ''} · {formatDateTime(d.statusAt)}
      </span>
      {d.lastError && <span className="block text-danger">{d.lastError}</span>}
    </div>
  );
}

const LIGHT_MEANING: Record<string, string> = { alarm: 'Alarm', idle: 'Idle', setup: 'Setup', running: 'Running', none: 'Ignore' };

/** The tap's thresholds, stack-light meanings, debounce and heartbeat; saving raises the version the edge publishes. */
function TapSettings({ d, onClose }: { d: Device; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({
    offAmps: String(d.config.offAmps),
    runAmps: String(d.config.runAmps),
    ctAmpsPerVolt: String(d.config.ctAmpsPerVolt),
    debounceSeconds: String(d.config.debounceSeconds),
    heartbeatSeconds: String(d.heartbeatSeconds),
    lights: d.config.lights,
  });
  const m = useMutation({
    mutationFn: async () => {
      const config: TapConfig = { offAmps: Number(f.offAmps), runAmps: Number(f.runAmps), ctAmpsPerVolt: Number(f.ctAmpsPerVolt), debounceSeconds: Number(f.debounceSeconds), lights: f.lights };
      if (Number(f.heartbeatSeconds) !== d.heartbeatSeconds) await api(`/plant/devices/${d.id}`, { method: 'PUT', scope: ws.scope, body: { name: d.name, machineId: d.machineId, heartbeatSeconds: Number(f.heartbeatSeconds) } });
      return api(`/plant/devices/${d.id}/config`, { method: 'PUT', scope: ws.scope, body: config });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devices'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: 'offAmps' | 'runAmps' | 'ctAmpsPerVolt' | 'debounceSeconds' | 'heartbeatSeconds') => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const light = (k: keyof TapConfig['lights'], options: string[]) => (
    <Field label={`${k[0]!.toUpperCase()}${k.slice(1)} light`}>
      {(p) => (
        <Select {...p} value={f.lights[k]} onChange={(e) => setF({ ...f, lights: { ...f.lights, [k]: e.target.value } })}>
          {options.map((o) => (
            <option key={o} value={o}>
              {LIGHT_MEANING[o]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
  return (
    <FormDialog
      title={`Settings for ${d.code}`}
      description={`Now at version ${d.configVersion}. The edge publishes the new version to the tap, which reports when it has applied it.`}
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel="Save settings"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Off below (A)" error={err.offAmps} hint="Current under this means the machine is off.">
          {(p) => <Input {...p} type="number" step="0.1" min={0} value={f.offAmps} onChange={set('offAmps')} required />}
        </Field>
        <Field label="Running from (A)" error={err.runAmps} hint="Current at or over this means it is cutting.">
          {(p) => <Input {...p} type="number" step="0.1" min={0.1} value={f.runAmps} onChange={set('runAmps')} required />}
        </Field>
        <Field label="CT calibration (A per V)" error={err.ctAmpsPerVolt} hint="Set when the tap is calibrated on its machine.">
          {(p) => <Input {...p} type="number" step="0.1" min={1} value={f.ctAmpsPerVolt} onChange={set('ctAmpsPerVolt')} required />}
        </Field>
        <Field label="Debounce (seconds)" error={err.debounceSeconds} hint="A state must hold this long before it changes.">
          {(p) => <Input {...p} type="number" min={1} max={120} value={f.debounceSeconds} onChange={set('debounceSeconds')} required />}
        </Field>
        <Field label="Heartbeat (seconds)" error={err.heartbeatSeconds} hint="Gaps over 3 heartbeats count as no data.">
          {(p) => <Input {...p} type="number" min={10} max={600} value={f.heartbeatSeconds} onChange={set('heartbeatSeconds')} required />}
        </Field>
        <div />
        {light('red', ['alarm', 'none'])}
        {light('amber', ['idle', 'setup', 'alarm', 'none'])}
        {light('green', ['running', 'none'])}
      </div>
    </FormDialog>
  );
}

function EdgeForm({ onClose, onKey }: { onClose: () => void; onKey: (k: { code: string; key: string }) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ code: '', name: '' });
  const m = useMutation({
    mutationFn: () => api<{ code: string; key: string }>('/plant/edges', { method: 'POST', scope: ws.scope, body: f }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['edges'] });
      onKey(r);
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Add edge" description="The key is shown once after saving." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Add edge">
      <Field label="Code" error={err.code} hint="The plant code used in the taps' MQTT topics, e.g. NM1.">
        {(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required autoFocus />}
      </Field>
      <Field label="Name" error={err.name}>
        {(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="Navi Mumbai edge PC" />}
      </Field>
    </FormDialog>
  );
}

function TapForm({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const edges = useQuery({ queryKey: ['edges', ws.entityId], queryFn: () => api<Edge[]>('/plant/edges', { scope: ws.scope }) });
  const centres = useQuery({ queryKey: ['work-centres', ws.entityId], queryFn: () => api<WorkCentre[]>('/manufacturing/work-centres', { scope: ws.scope }) });
  const active = edges.data?.filter((e) => e.status === 'active') ?? [];
  const [f, setF] = useState({ edgeId: '', code: '', name: '', machineId: '', heartbeatSeconds: '60' });
  const m = useMutation({
    mutationFn: () => api('/plant/devices', { method: 'POST', scope: ws.scope, body: { ...f, edgeId: f.edgeId || active[0]?.id, heartbeatSeconds: Number(f.heartbeatSeconds) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devices'] });
      void qc.invalidateQueries({ queryKey: ['plant-machines'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="Add tap" description="The code is the device id in the tap's MQTT topic." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Add tap">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" error={err.code}>
          {(p) => <Input {...p} value={f.code} onChange={set('code')} required autoFocus placeholder="MT1-01" />}
        </Field>
        <Field label="Name" error={err.name}>
          {(p) => <Input {...p} value={f.name} onChange={set('name')} required />}
        </Field>
        <Field label="Machine" error={err.machineId}>
          {(p) => (
            <Select {...p} value={f.machineId} onChange={set('machineId')} required>
              <option value="">Choose…</option>
              {centres.data?.flatMap((c) =>
                c.machines
                  .filter((mc) => mc.isActive)
                  .map((mc) => (
                    <option key={mc.id} value={mc.id}>
                      {mc.code} · {mc.name} ({c.code})
                    </option>
                  )),
              )}
            </Select>
          )}
        </Field>
        <Field label="Edge" error={err.edgeId}>
          {(p) => (
            <Select {...p} value={f.edgeId || active[0]?.id || ''} onChange={set('edgeId')} required>
              {active.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} · {e.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Heartbeat (seconds)" error={err.heartbeatSeconds} hint="Gaps over 3 heartbeats count as no data.">
          {(p) => <Input {...p} type="number" min={10} max={600} value={f.heartbeatSeconds} onChange={set('heartbeatSeconds')} required />}
        </Field>
      </div>
    </FormDialog>
  );
}

/** Decision 065: label printers on the plant network, printed to through their edge, and the recent jobs. */
function Printers() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const printers = useQuery({ queryKey: ['printers', ws.entityId], queryFn: () => api<LabelPrinter[]>('/plant/printers', { scope: ws.scope }) });
  const jobs = useQuery({ queryKey: ['print-jobs', ws.entityId], queryFn: () => api<PrintJobRow[]>('/plant/print-jobs', { scope: ws.scope }), refetchInterval: 5000 });
  const act = useMutation({
    mutationFn: ({ path }: { path: string }) => api(path, { method: 'POST', scope: ws.scope, body: {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['printers'] });
      void qc.invalidateQueries({ queryKey: ['print-jobs'] });
    },
  });
  return (
    <Card>
      <CardHeader
        title="Label printers"
        description="Zebra-compatible printers on the plant network. FactoryOS sends the labels; the plant's edge agent prints them (port 9100)."
        actions={ws.can('plant.device.manage') && <Button variant="secondary" onClick={() => setAdding(true)}>Add printer</Button>}
      />
      {act.error && <Alert tone="danger" className="m-4">{act.error.message}</Alert>}
      {printers.data?.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-muted">No printers yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Printer</Th>
                <Th>Address</Th>
                <Th>Labels</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {printers.data?.map((p) => (
                <Tr key={p.id}>
                  <Td className="text-[13px]">
                    <span className="font-mono font-medium">{p.code}</span> {p.name} {p.status === 'retired' && <Badge tone="neutral">Retired</Badge>}
                    <span className="block text-subtle">via edge {p.edgeCode}</span>
                  </Td>
                  <Td className="font-mono text-[13px]">
                    {p.host}:{p.port}
                  </Td>
                  <Td className="text-[13px] whitespace-nowrap">
                    {p.widthMm} × {p.heightMm} mm, {p.dpi} dpi
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {p.status === 'active' && ws.can('manufacturing.smt.update') && (
                      <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/plant/printers/${p.id}/test` })}>
                        Test
                      </Button>
                    )}
                    {p.status === 'active' && ws.can('plant.device.manage') && (
                      <Button size="sm" variant="ghost" onClick={() => window.confirm(`Retire ${p.code}? Its waiting labels are dropped.`) && act.mutate({ path: `/plant/printers/${p.id}/retire` })}>
                        Retire
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {!!jobs.data?.length && (
        <div className="border-t border-border">
          <p className="px-5 pt-4 text-[13px] font-medium">Recent labels</p>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Label</Th>
                  <Th>Printer</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {jobs.data.slice(0, 15).map((j) => (
                  <Tr key={j.id}>
                    <Td className="text-[13px]">
                      {j.label}
                      <span className="block text-subtle">{formatDateTime(j.createdAt)}</span>
                    </Td>
                    <Td className="font-mono text-[13px]">{j.printer}</Td>
                    <Td className="text-[13px]">
                      <Badge tone={JOB_TONE[j.status]}>{j.status === 'printed' ? 'Printed' : j.status === 'failed' ? 'Failed' : j.status === 'sent' ? 'Sent' : 'Queued'}</Badge>
                      {j.error && <span className="block text-danger">{j.error}</span>}
                    </Td>
                    <Td className="text-right">
                      {(j.status === 'failed' || j.status === 'printed') && ws.can('manufacturing.smt.update') && (
                        <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/plant/print-jobs/${j.id}/reprint` })}>
                          Reprint
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      )}
      {adding && <PrinterForm onClose={() => setAdding(false)} />}
    </Card>
  );
}

function PrinterForm({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const edges = useQuery({ queryKey: ['edges', ws.entityId], queryFn: () => api<Edge[]>('/plant/edges', { scope: ws.scope }) });
  const active = edges.data?.filter((e) => e.status === 'active') ?? [];
  const [f, setF] = useState({ edgeId: '', code: '', name: '', host: '', port: '9100', dpi: '203', widthMm: '50', heightMm: '25' });
  const m = useMutation({
    mutationFn: () =>
      api('/plant/printers', {
        method: 'POST',
        scope: ws.scope,
        body: { edgeId: f.edgeId || active[0]?.id, code: f.code, name: f.name, host: f.host, port: Number(f.port), dpi: Number(f.dpi), widthMm: Number(f.widthMm), heightMm: Number(f.heightMm) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['printers'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="Add label printer" description="Add its address to PRINTER_HOSTS on the edge PC too." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Add printer">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" error={err.code}>{(p) => <Input {...p} value={f.code} onChange={set('code')} required autoFocus placeholder="ZT-1" />}</Field>
        <Field label="Name" error={err.name}>{(p) => <Input {...p} value={f.name} onChange={set('name')} required placeholder="SMT line printer" />}</Field>
        <Field label="Edge" error={err.edgeId}>
          {(p) => (
            <Select {...p} value={f.edgeId || active[0]?.id || ''} onChange={set('edgeId')} required>
              {active.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} · {e.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Host" error={err.host} hint="Its address on the plant network">{(p) => <Input {...p} value={f.host} onChange={set('host')} required placeholder="10.20.0.50" className="font-mono" />}</Field>
        <Field label="Port" error={err.port}>{(p) => <Input {...p} type="number" value={f.port} onChange={set('port')} required />}</Field>
        <Field label="Resolution" error={err.dpi}>
          {(p) => (
            <Select {...p} value={f.dpi} onChange={set('dpi')}>
              {['203', '300', '600'].map((d) => (
                <option key={d} value={d}>
                  {d} dpi
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Label width (mm)" error={err.widthMm}>{(p) => <Input {...p} type="number" value={f.widthMm} onChange={set('widthMm')} required />}</Field>
        <Field label="Label height (mm)" error={err.heightMm}>{(p) => <Input {...p} type="number" value={f.heightMm} onChange={set('heightMm')} required />}</Field>
      </div>
    </FormDialog>
  );
}
