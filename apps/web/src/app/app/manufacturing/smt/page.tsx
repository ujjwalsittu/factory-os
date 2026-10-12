'use client';
// Manufacturing → SMT line (decision 065): a tablet page for barcode scanners in keyboard mode. Choose the work order,
// placement machine and printer once; then scan reels onto slots, panels along the line, and manage reels and paste.
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircuitBoard } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { ItemPicker } from '@/components/item-picker';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDateTime, formatQty } from '@/lib/format';
import type { WorkCentre, WorkOrderRow } from '@/lib/manufacturing';
import { type ContainerRow, EVENT_LABEL, type LabelPrinter, nearlyOut, PHASE, type SmtSetup, timeLeft } from '@/lib/smt';
import type { Item } from '@/lib/types';

type Tab = 'setup' | 'panels' | 'containers';
const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(`smt.${k}`, v);
  } catch {}
};
const recall = (k: string) => {
  try {
    return localStorage.getItem(`smt.${k}`) ?? '';
  } catch {
    return '';
  }
};

export default function SmtLinePage() {
  const ws = useWorkspace();
  const [tab, setTab] = useState<Tab>('setup');
  const [woId, setWoId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [printerId, setPrinterId] = useState('');
  useEffect(() => {
    setWoId(recall('wo'));
    setMachineId(recall('machine'));
    setPrinterId(recall('printer'));
  }, []);
  const on = !!ws.entityId;
  const orders = useQuery({ queryKey: ['work-orders', ws.entityId, 'released'], queryFn: () => api<WorkOrderRow[]>('/manufacturing/work-orders?status=released', { scope: ws.scope }), enabled: on });
  const centres = useQuery({ queryKey: ['work-centres', ws.entityId], queryFn: () => api<WorkCentre[]>('/manufacturing/work-centres', { scope: ws.scope }), enabled: on });
  const printers = useQuery({ queryKey: ['printers', ws.entityId], queryFn: () => api<LabelPrinter[]>('/plant/printers', { scope: ws.scope }), enabled: on });
  // A remembered order that is no longer released here (or belongs to another entity) is not opened.
  const current = orders.data?.some((o) => o.id === woId) ? woId : '';
  const setup = useQuery({ queryKey: ['smt-setup', ws.entityId, current], queryFn: () => api<SmtSetup>(`/manufacturing/smt/work-orders/${current}`, { scope: ws.scope }), enabled: on && !!current, refetchInterval: 30_000 });
  const machines = centres.data?.flatMap((c) => c.machines.filter((m) => m.isActive).map((m) => ({ ...m, centre: c.code }))) ?? [];
  const pick = (k: 'wo' | 'machine' | 'printer', set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    remember(k, e.target.value);
  };
  return (
    <>
      <PageHeader title="SMT line" description="Scan reels onto feeder slots, panels along the line, and keep moisture-sensitive parts and paste in date. Board serials are reserved on the panel labels." />
      <EntityGate what="manufacturing">
        <Card className="mb-4 p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Work order">
              {(p) => (
                <Select {...p} value={current} onChange={pick('wo', setWoId)}>
                  <option value="">Choose…</option>
                  {orders.data?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.number} · {o.itemCode} ({formatQty(o.producedQty, 0)}/{formatQty(o.plannedQty, 0)})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Machine" hint="The placer or paste printer you scan at">
              {(p) => (
                <Select {...p} value={machineId} onChange={pick('machine', setMachineId)}>
                  <option value="">Choose…</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} · {m.name} ({m.centre})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Label printer">
              {(p) => (
                <Select {...p} value={printerId} onChange={pick('printer', setPrinterId)}>
                  <option value="">No printing</option>
                  {printers.data
                    ?.filter((x) => x.status === 'active')
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.code} · {x.widthMm}×{x.heightMm} mm
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          </div>
        </Card>
        <div className="mb-4 flex gap-1" role="tablist" aria-label="View">
          {(
            [
              ['setup', 'Feeder setup'],
              ['panels', 'Panels'],
              ['containers', 'Reels and paste'],
            ] as const
          ).map(([k, label]) => (
            <Button key={k} role="tab" aria-selected={tab === k} size="sm" variant={tab === k ? 'secondary' : 'ghost'} onClick={() => setTab(k)}>
              {label}
            </Button>
          ))}
        </div>
        {tab === 'containers' ? (
          <Containers printerId={printerId} />
        ) : !current ? (
          <EmptyState icon={<CircuitBoard className="size-5" />} title="Choose a work order" description="Released orders of a serial-tracked board with boards per panel on its BOM." />
        ) : setup.error ? (
          <Alert tone="danger">{setup.error.message}</Alert>
        ) : !setup.data ? (
          <p className="text-muted">Loading…</p>
        ) : tab === 'setup' ? (
          <Setup s={setup.data} machineId={machineId} />
        ) : (
          <Panels s={setup.data} machineId={machineId} printerId={printerId} />
        )}
      </EntityGate>
    </>
  );
}

/** One scan field that keeps focus for the next scan. */
function ScanInput({ label, onScan, pending, disabled, hint }: { label: string; onScan: (code: string) => void; pending?: boolean; disabled?: boolean; hint?: string }) {
  const [v, setV] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.trim()) return;
        onScan(v.trim());
        setV('');
        e.currentTarget.querySelector('input')?.focus();
      }}
    >
      <Field label={label} {...(hint ? { hint } : {})}>
        {(p) => <Input {...p} value={v} onChange={(e) => setV(e.target.value)} disabled={disabled} aria-busy={pending} autoComplete="off" className="font-mono" placeholder="Scan or type, then Enter" />}
      </Field>
    </form>
  );
}

function StatusBadge({ s }: { s: ContainerRow['status'] }) {
  const ph = PHASE[s.phase] ?? { label: s.phase, tone: 'neutral' as const };
  const left = timeLeft(s);
  return (
    <span className="whitespace-nowrap">
      <Badge tone={s.blocked ? 'danger' : nearlyOut(s) ? 'warning' : ph.tone}>{ph.label}</Badge>
      {left && <span className={`ml-2 text-[12px] ${s.blocked ? 'text-danger' : nearlyOut(s) ? 'text-warning' : 'text-subtle'}`}>{left}</span>}
    </span>
  );
}

function Setup({ s, machineId }: { s: SmtSetup; machineId: string }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [slot, setSlot] = useState('');
  const [splice, setSplice] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ['smt-setup'] });
  const load = useMutation({
    mutationFn: (v: { code: string; slot: string; splice: boolean }) => api<SmtSetup>('/manufacturing/smt/feeder/load', { method: 'POST', scope: ws.scope, body: { workOrderId: s.workOrder.id, machineId, ...v } }),
    // The submitted values, not the fields as they are now: the operator may already be typing the next slot.
    onSuccess: (_r, v) => {
      setNote(`${v.code} ${v.splice ? 'spliced onto' : 'loaded on'} ${v.slot}`);
      setSplice(false);
      done();
    },
  });
  const unload = useMutation({
    mutationFn: (l: SmtSetup['loads'][number]) => api('/manufacturing/smt/feeder/unload', { method: 'POST', scope: ws.scope, body: { workOrderId: s.workOrder.id, machineId: l.machineId, slot: l.slot } }),
    onSuccess: done,
  });
  const canOperate = ws.can('manufacturing.smt.update');
  return (
    <div className="space-y-4">
      {canOperate && (
        <Card className="p-4">
          {!machineId && <Alert className="mb-3">Choose the machine you are loading.</Alert>}
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            <Field label="Slot">{(p) => <Input {...p} value={slot} onChange={(e) => setSlot(e.target.value.toUpperCase())} placeholder="F12-L" className="font-mono" />}</Field>
            <ScanInput label="Reel or paste jar" onScan={(c) => load.mutate({ code: c, slot, splice })} pending={load.isPending} disabled={!machineId || !slot} />
            <label className="flex items-center gap-2 pb-2 text-[13px]">
              <input type="checkbox" checked={splice} onChange={(e) => setSplice(e.target.checked)} /> Splice
            </label>
          </div>
          {load.error && <Alert tone="danger" className="mt-3">{load.error.message}</Alert>}
          {note && !load.error && <p className="mt-2 text-[13px] text-success">{note}</p>}
        </Card>
      )}
      <Card>
        <CardHeader title={`${s.workOrder.number} · ${s.workOrder.itemCode} rev ${s.workOrder.revision ?? '—'}`} description={s.workOrder.boardsPerPanel ? `${s.workOrder.boardsPerPanel} boards per panel` : 'Not panelized: set boards per panel on the BOM'} />
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th>Loaded</Th>
              </tr>
            </thead>
            <tbody>
              {s.materials.map((m) => (
                <Tr key={m.itemId}>
                  <Td className="text-[13px]">
                    <span className="font-mono font-medium">{m.code}</span> {m.name} {m.mslLevel && <Badge tone="neutral">MSL {m.mslLevel}</Badge>}
                  </Td>
                  <Td className="text-[13px]">{m.loaded.length ? m.loaded.join(', ') : <span className="text-subtle">Not on a feeder</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
      <Card>
        <CardHeader title="On the feeders" description="A panel placed now is traced to these reels and paste." />
        {s.loads.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-muted">Nothing loaded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Slot</Th>
                  <Th>Reel or jar</Th>
                  <Th>State</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {s.loads.map((l) => (
                  <Tr key={l.id}>
                    <Td className="font-mono text-[13px] whitespace-nowrap">
                      {l.machine} {l.slot}
                    </Td>
                    <Td className="text-[13px]">
                      <span className="font-mono font-medium">{l.container.code}</span>
                      <span className="block text-subtle">
                        {l.container.itemCode} · lot {l.container.batchNo} · since {formatDateTime(l.loadedAt)}
                      </span>
                    </Td>
                    <Td className="text-[13px]">
                      <StatusBadge s={l.container.status} />
                    </Td>
                    <Td className="text-right">
                      {canOperate && (
                        <Button size="sm" variant="ghost" onClick={() => unload.mutate(l)}>
                          Unload
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Panels({ s, machineId, printerId }: { s: SmtSetup; machineId: string; printerId: string }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [step, setStep] = useState<'placed' | 'depaneled'>('placed');
  const [count, setCount] = useState('1');
  const [result, setResult] = useState<string | null>(null);
  const [scrapping, setScrapping] = useState<string | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ['smt-setup'] });
  const create = useMutation({
    mutationFn: () => api<{ panels: { code: string }[]; job: { printer: string } | null }>(`/manufacturing/smt/work-orders/${s.workOrder.id}/panels`, { method: 'POST', scope: ws.scope, body: { count: Number(count), printerId: printerId || null } }),
    onSuccess: (r) => {
      setResult(`${r.panels.length} panel${r.panels.length === 1 ? '' : 's'} ${r.panels.map((p) => p.code).join(', ')}${r.job ? ` sent to ${r.job.printer}` : ''}`);
      done();
    },
  });
  const scan = useMutation({
    mutationFn: (code: string) => api<{ panel: string; step: string; notLoaded: string[]; job: { printer: string } | null }>('/manufacturing/smt/panels/scan', { method: 'POST', scope: ws.scope, body: { code, step, machineId: machineId || null, printerId: printerId || null } }),
    onSuccess: (r) => {
      setResult(`${r.panel} ${r.step}${r.notLoaded.length ? `; not on this machine's feeders: ${r.notLoaded.join(', ')}` : ''}${r.job ? `; board labels sent to ${r.job.printer}` : ''}`);
      done();
    },
  });
  const canOperate = ws.can('manufacturing.smt.update');
  const zpl = (kind: string, id: string) => `/api/manufacturing/smt/labels/${kind}/${id}${printerId ? `?printerId=${printerId}` : ''}`;
  return (
    <div className="space-y-4">
      {canOperate && (
        <Card className="p-4">
          <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-end">
            <div className="flex gap-1" role="radiogroup" aria-label="Scan step">
              {(['placed', 'depaneled'] as const).map((k) => (
                <Button key={k} role="radio" aria-checked={step === k} size="sm" variant={step === k ? 'secondary' : 'ghost'} onClick={() => setStep(k)}>
                  {k === 'placed' ? 'Into placement' : 'Depaneled'}
                </Button>
              ))}
            </div>
            <ScanInput label="Panel" onScan={(c) => scan.mutate(c)} pending={scan.isPending} disabled={step === 'placed' && !machineId} {...(step === 'placed' && !machineId ? { hint: 'Choose the placement machine first' } : {})} />
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <Field label="New panels">{(p) => <Input {...p} type="number" min={1} max={200} value={count} onChange={(e) => setCount(e.target.value)} className="w-24" />}</Field>
            <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!s.workOrder.boardsPerPanel}>
              Print panel labels
            </Button>
            <Button variant="ghost" onClick={() => setScrapping('')}>
              Scrap a board
            </Button>
          </div>
          {(scan.error ?? create.error) && <Alert tone="danger" className="mt-3">{(scan.error ?? create.error)!.message}</Alert>}
          {result && !scan.error && !create.error && <p className="mt-2 text-[13px] text-success">{result}</p>}
        </Card>
      )}
      <Card>
        <CardHeader title="Panels" description={`${s.counts.boards} boards: ${s.counts.waiting} waiting for output, ${s.counts.output} in stock, ${s.counts.scrapped} scrapped`} />
        {s.panels.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-muted">No panels yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Panel</Th>
                  <Th>Placed</Th>
                  <Th>Depaneled</Th>
                  <Th>Boards</Th>
                </tr>
              </thead>
              <tbody>
                {s.panels.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-mono text-[13px] whitespace-nowrap">
                      {p.code}
                      <a className="ml-2 font-sans text-[12px] text-accent" href={zpl('panel', p.id)} download={`${p.code}.zpl`}>
                        ZPL
                      </a>
                    </Td>
                    <Td className="text-[13px] whitespace-nowrap">{p.placedAt ? formatDateTime(p.placedAt) : <span className="text-subtle">—</span>}</Td>
                    <Td className="text-[13px] whitespace-nowrap">{p.depaneledAt ? formatDateTime(p.depaneledAt) : <span className="text-subtle">—</span>}</Td>
                    <Td className="text-[12px]">
                      <div className="flex flex-wrap gap-1">
                        {p.boards.map((b) =>
                          b.batchId ? (
                            <Link key={b.id} href={`/app/inventory/batches/${b.batchId}`} className="rounded border border-border px-1.5 py-0.5 font-mono text-accent">
                              {b.serialNo}
                            </Link>
                          ) : (
                            <span key={b.id} title={b.scrapReason ?? undefined} className={`rounded border border-border px-1.5 py-0.5 font-mono ${b.scrappedAt ? 'text-danger line-through' : ''}`}>
                              {b.serialNo}
                            </span>
                          ),
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      {scrapping !== null && <ScrapBoard workOrderId={s.workOrder.id} onClose={() => setScrapping(null)} />}
    </div>
  );
}

function ScrapBoard({ workOrderId, onClose }: { workOrderId: string; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ serial: '', reason: '' });
  const m = useMutation({
    mutationFn: () => api('/manufacturing/smt/boards/scrap', { method: 'POST', scope: ws.scope, body: { ...f, workOrderId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['smt-setup'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Scrap a board" description="A board scrapped on the line keeps its serial as scrapped; it is never output." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Scrap board">
      <Field label="Board serial" error={err.serial}>{(p) => <Input {...p} value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} required autoFocus className="font-mono" />}</Field>
      <Field label="Reason" error={err.reason}>{(p) => <Input {...p} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required placeholder="AOI: bridged pins, not repairable" />}</Field>
    </FormDialog>
  );
}

function Containers({ printerId }: { printerId: string }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ['smt-containers', ws.entityId, q], queryFn: () => api<ContainerRow[]>(`/manufacturing/smt/containers${q ? `?q=${encodeURIComponent(q)}` : ''}`, { scope: ws.scope }), refetchInterval: 60_000 });
  const event = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: string }) => api(`/manufacturing/smt/containers/${id}/events`, { method: 'POST', scope: ws.scope, body: { kind } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['smt-containers'] }),
  });
  const print = useMutation({ mutationFn: (id: string) => api(`/manufacturing/smt/containers/${id}/print`, { method: 'POST', scope: ws.scope, body: { printerId } }) });
  return (
    <Card>
      <CardHeader
        title="Reels and paste"
        description="Least floor life or open time first. A reel past its floor life must be baked; paste must thaw before use."
        actions={ws.can('manufacturing.smt.create') && <Button onClick={() => setAdding(true)}>New reel or jar</Button>}
      />
      <div className="px-5 pb-3">
        <Input aria-label="Search reels" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Code, part or lot" className="max-w-xs" />
      </div>
      {(event.error ?? print.error) && <Alert tone="danger" className="mx-5 mb-3">{(event.error ?? print.error)!.message}</Alert>}
      {list.data?.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-muted">No reels or paste jars.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Reel or jar</Th>
                <Th>State</Th>
                <Th>Where</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.data?.map((c) => (
                <Tr key={c.id}>
                  <Td className="text-[13px]">
                    <span className="font-mono font-medium">{c.code}</span> {c.kind === 'paste' ? <Badge tone="neutral">Paste</Badge> : c.mslLevel && <Badge tone="neutral">MSL {c.mslLevel}</Badge>}
                    <span className="block text-subtle">
                      {c.itemCode} · lot {c.batchNo} · {formatQty(c.qty, 0)}
                    </span>
                  </Td>
                  <Td className="text-[13px]">
                    <StatusBadge s={c.status} />
                  </Td>
                  <Td className="text-[13px] whitespace-nowrap">{c.load ? `${c.load.machine} ${c.load.slot} · ${c.load.workOrder}` : <span className="text-subtle">—</span>}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {ws.can('manufacturing.smt.update') &&
                      c.status.allowed
                        .filter((k) => !(c.load && k !== 'empty'))
                        .map((k) => (
                          <Button key={k} size="sm" variant="ghost" onClick={() => (k !== 'empty' || window.confirm(`Mark ${c.code} empty?`)) && event.mutate({ id: c.id, kind: k })}>
                            {EVENT_LABEL[k] ?? k}
                          </Button>
                        ))}
                    {printerId && ws.can('manufacturing.smt.update') && (
                      <Button size="sm" variant="ghost" onClick={() => print.mutate(c.id)}>
                        Label
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {adding && <NewContainer printerId={printerId} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function NewContainer({ printerId, onClose }: { printerId: string; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [it, setIt] = useState<Item | null>(null);
  const [f, setF] = useState({ batchId: '', qty: '', code: '', labelHours: '' });
  const lots = useQuery({ queryKey: ['batches', ws.entityId, it?.id, 'in-stock'], queryFn: () => api<{ id: string; batchNo: string; qty: string; expiryDate: string | null }[]>(`/batches?itemId=${it!.id}&inStock=true`, { scope: ws.scope }), enabled: !!it });
  const paste = it?.pasteThawMinutes != null;
  const m = useMutation({
    mutationFn: () =>
      api('/manufacturing/smt/containers', {
        method: 'POST',
        scope: ws.scope,
        body: { kind: paste ? 'paste' : 'reel', batchId: f.batchId, qty: f.qty, code: f.code || null, labelHours: f.labelHours ? Number(f.labelHours) : null, printerId: printerId || null },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['smt-containers'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={paste ? 'New paste jar' : 'New reel'} description={`From a lot in stock. ${printerId ? 'Its label prints on the chosen printer.' : 'Choose a printer above to print its label.'}`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Add">
      <Field label="Part">{() => <ItemPicker value={it} onChange={(x) => { setIt(x); setF({ ...f, batchId: '' }); }} autoFocus />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lot" error={err.batchId}>
          {(p) => (
            <Select {...p} value={f.batchId} onChange={(e) => setF({ ...f, batchId: e.target.value })} required disabled={!it}>
              <option value="">Choose…</option>
              {lots.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNo} · {formatQty(b.qty, 0)} in stock{b.expiryDate ? ` · exp ${b.expiryDate}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Quantity on it" error={err.qty}>{(p) => <Input {...p} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="decimal" required />}</Field>
        <Field label="Code" hint="Scan the supplier's reel ID, or leave empty to number it" error={err.code}>{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className="font-mono" />}</Field>
        {it?.mslLevel === '6' && <Field label="Floor life on label (h)" error={err.labelHours}>{(p) => <Input {...p} value={f.labelHours} onChange={(e) => setF({ ...f, labelHours: e.target.value })} inputMode="numeric" required />}</Field>}
      </div>
    </FormDialog>
  );
}
