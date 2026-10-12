'use client';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Square, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { certifiedLabel, useSkillCoverage } from '@/components/skill-coverage';
import { useWorkspace } from '@/components/workspace';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatQty } from '@/lib/format';
import { CARD_STATUS, formatMinutes, type JobCard, PAUSE_REASONS, type ShopFloor } from '@/lib/manufacturing';
import type { CapaPerson } from '@/lib/quality';

export default function ShopFloorPage() {
  return (
    <>
      <PageHeader title="Shop floor" description="Start the operation you're working on, pause with a reason, and stop with the quantity made. Time is taken from the clock." />
      <EntityGate what="manufacturing">
        <Floor />
      </EntityGate>
    </>
  );
}

function Floor() {
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['shop-floor', ws.entityId], queryFn: () => api<ShopFloor>('/manufacturing/shop-floor', { scope: ws.scope }), staleTime: 0, refetchInterval: 30_000 });
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!q.data) return <p className="text-muted">Loading…</p>;
  const { mine, operations, openCards, machines } = q.data;
  const toCosign = openCards.filter((c) => c.cosignUserId === ws.me.user.id && !c.cosignedAt);
  return (
    <div className="space-y-4">
      {toCosign.map((c) => (
        <CosignCard key={c.id} card={c} />
      ))}
      {mine && <MyCard card={mine} />}
      {operations.length === 0 ? (
        <Card>
          <EmptyState icon={<Timer className="size-5" />} title="Nothing released" description="Released work orders show their operations here." />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {operations.map((o) => {
            const busy = openCards.filter((c) => c.operationId === o.operationId);
            // Operations come in schedule order: the first one on a machine is its next job.
            const next = !!o.scheduledMachineId && operations.find((x) => x.scheduledMachineId === o.scheduledMachineId)?.operationId === o.operationId;
            const scheduledOn = machines.find((m) => m.id === o.scheduledMachineId);
            return (
              <Card key={o.operationId} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-[12px] text-muted">{o.number}</p>
                    <p className="font-medium">
                      <span className="font-mono">{o.seq}</span> · {o.name}
                    </p>
                    <p className="text-[13px] text-muted">
                      <span className="font-mono">{o.itemCode}</span> {o.itemName}
                    </p>
                  </div>
                  <Badge tone="info">{o.workCentre}</Badge>
                </div>
                <p className="mt-2 text-[13px] text-muted">
                  {formatQty(o.goodQty)} good of {formatQty(o.plannedQty)} · plan {formatMinutes(o.plannedMinutes)}
                </p>
                {o.scheduledStart && (
                  <p className="mt-1 text-[13px]">
                    {next && (
                      <Badge tone="success" className="mr-1">
                        Next on {scheduledOn?.code}
                      </Badge>
                    )}
                    <span className="text-muted">
                      {next ? '' : `On ${scheduledOn?.code ?? 'a machine'} · `}from {formatDateTime(o.scheduledStart)}
                    </span>
                  </p>
                )}
                {o.instructions && <p className="mt-1 text-[13px]">{o.instructions}</p>}
                {busy.map((c) => (
                  <p key={c.id} className="mt-2 text-[13px]">
                    <Badge tone={CARD_STATUS[c.status].tone} dot>
                      {CARD_STATUS[c.status].label}
                    </Badge>{' '}
                    {c.operator}
                    {c.machine && <span className="font-mono"> · {c.machine}</span>}
                    {c.cosignUserId && !c.cosignedAt && <span className="text-warning"> · awaiting co-sign by {c.cosigner}</span>}
                  </p>
                ))}
                {!mine && ws.can('manufacturing.job_card.update') && <StartButton operationId={o.operationId} label={`Start op ${o.seq} on ${o.number}`} machines={machines.filter((m) => m.workCentreId === o.workCentreId)} scheduledMachineId={o.scheduledMachineId} />}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StartButton({ operationId, label, machines, scheduledMachineId }: { operationId: string; label: string; machines: ShopFloor['machines']; scheduledMachineId: string | null }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [machineId, setMachineId] = useState(scheduledMachineId ?? (machines.length === 1 ? machines[0]!.id : ''));
  // Set when the API says this start is out of the machine's dispatch order (decision 049).
  const [reason, setReason] = useState<string | null>(null);
  // Set when the API says the operator is a trainee and needs a co-signer (decision 062).
  const [cosign, setCosign] = useState<string | null>(null);
  const coverage = useSkillCoverage();
  const candidates = useQuery({
    queryKey: ['skill-candidates', ws.entityId, operationId, machineId],
    queryFn: () => api<{ people: CapaPerson[] }>(`/quality/skill-candidates?operationId=${operationId}${machineId ? `&machineId=${machineId}` : ''}`, { scope: ws.scope }),
    enabled: cosign !== null,
  });
  const m = useMutation({
    mutationFn: () => api('/manufacturing/job-cards', { method: 'POST', body: { operationId, machineId: machineId || null, outOfSequenceReason: reason || null, cosignUserId: cosign || null }, scope: ws.scope }),
    onSuccess: () => {
      setReason(null);
      setCosign(null);
      void qc.invalidateQueries({ queryKey: ['shop-floor'] });
      void qc.invalidateQueries({ queryKey: ['out-of-sequence'] });
      void qc.invalidateQueries({ queryKey: ['schedule'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.issues.some((i) => i.path === 'outOfSequenceReason') && reason === null) setReason('');
      if (e instanceof ApiError && e.issues.some((i) => i.path === 'cosignUserId') && cosign === null) setCosign('');
    },
  });
  const askReason = reason !== null;
  const askCosign = cosign !== null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {machines.length > 0 && (
        <Select aria-label="Machine" className="w-auto min-w-32 flex-1" value={machineId} onChange={(e) => { setMachineId(e.target.value); setCosign(null); }}>
          <option value="">No machine</option>
          {machines.map((mc) => {
            const label = certifiedLabel(coverage.get(mc.id));
            return (
              <option key={mc.id} value={mc.id}>
                {mc.code} · {mc.name}
                {label ? ` (${label})` : ''}
              </option>
            );
          })}
        </Select>
      )}
      {askCosign && (
        <Select aria-label="Co-signer" className="w-full" value={cosign} onChange={(e) => setCosign(e.target.value)}>
          <option value="">Who co-signs?</option>
          {candidates.data?.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )}
      {askReason && <Input aria-label="Reason for starting out of sequence" className="w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this job first?" autoFocus />}
      <Button size="lg" aria-label={label} loading={m.isPending} disabled={(askReason && reason.trim().length < 3) || (askCosign && !cosign)} onClick={() => m.mutate()}>
        <Play className="size-4" /> {askReason ? 'Start anyway' : askCosign ? 'Start with co-signer' : 'Start'}
      </Button>
      {m.error instanceof ApiError && <p className={`w-full text-[13px] ${askReason || askCosign ? 'text-warning' : 'text-danger'}`}>{m.error.message}</p>}
    </div>
  );
}

/** The operator's own open card: live clock, pause/resume and stop. */
function MyCard({ card }: { card: JobCard }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [pausing, setPausing] = useState(false);
  const [stopping, setStopping] = useState(false);
  // Base for the live part of the clock: reset whenever the server sends fresh minutes.
  const [loaded, setLoaded] = useState(() => Date.now());
  useEffect(() => {
    setLoaded(Date.now());
    setNow(Date.now());
  }, [card.minutes, card.status]);
  useEffect(() => {
    if (card.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [card.status]);
  // Minutes from the server's latest figure, plus the time since while running.
  const minutes = Number(card.minutes) + (card.status === 'running' ? (now - loaded) / 60_000 : 0);
  const resume = useMutation({
    mutationFn: () => api(`/manufacturing/job-cards/${card.id}/resume`, { method: 'POST', body: {}, scope: ws.scope }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shop-floor'] }),
  });
  const h = Math.floor(minutes / 60);
  const mm = Math.floor(minutes % 60);
  const ss = Math.floor((minutes * 60) % 60);
  return (
    <Card className="border-accent p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] text-muted">My job</p>
          <p className="text-lg font-semibold">
            <span className="font-mono">{card.number}</span> · op {card.seq} {card.operation}
          </p>
          <p className="text-[13px] text-muted">
            {card.workCentre}
            {card.machine && <span className="font-mono"> · {card.machine}</span>}
            {card.pauseReason && <> · paused: {card.pauseReason}</>}
          </p>
          {card.override && (
            <p className="text-[13px] text-warning">
              Started under an allowance by {card.override.by}: {card.override.reason}
            </p>
          )}
        </div>
        <p className="tabular font-mono text-3xl" aria-label="Running time">
          {h}:{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
        </p>
      </div>
      {card.cosignUserId && !card.cosignedAt ? (
        <Alert tone="warning" className="mt-4">
          Waiting for {card.cosigner} to co-sign from their own login. The clock is running; pause and stop open once they confirm.
        </Alert>
      ) : (
      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex">
        {card.status === 'running' ? (
          <Button size="lg" variant="secondary" onClick={() => setPausing(true)}>
            <Pause className="size-4" /> Pause
          </Button>
        ) : (
          <Button size="lg" variant="secondary" loading={resume.isPending} onClick={() => resume.mutate()}>
            <Play className="size-4" /> Resume
          </Button>
        )}
        {ws.can('manufacturing.job_card.submit') && (
          <Button size="lg" onClick={() => setStopping(true)}>
            <Square className="size-4" /> Stop
          </Button>
        )}
      </div>
      )}
      {pausing && <PauseDialog card={card} onClose={() => setPausing(false)} />}
      {stopping && <StopDialog card={card} onClose={() => setStopping(false)} />}
    </Card>
  );
}

/** A trainee named me as co-signer: confirm from my own login (decision 062). */
function CosignCard({ card }: { card: JobCard }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api(`/manufacturing/job-cards/${card.id}/cosign`, { method: 'POST', body: {}, scope: ws.scope }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shop-floor'] }),
  });
  return (
    <Card className="border-warning p-4">
      <p className="text-[12px] text-muted">Co-sign requested</p>
      <p className="font-medium">
        {card.operator} (trainee) · <span className="font-mono">{card.number}</span> op {card.seq} {card.operation}
        {card.machine && <span className="font-mono"> · {card.machine}</span>}
      </p>
      <p className="text-[13px] text-muted">Confirm that you are supervising this run.</p>
      <Button className="mt-3" loading={m.isPending} onClick={() => m.mutate()}>
        Co-sign
      </Button>
      {m.error && <p className="mt-2 text-[13px] text-danger">{m.error.message}</p>}
    </Card>
  );
}

function PauseDialog({ card, onClose }: { card: JobCard; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [reason, setReason] = useState(PAUSE_REASONS[0]!);
  const [other, setOther] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/manufacturing/job-cards/${card.id}/pause`, { method: 'POST', body: { reason: reason === 'Other' ? other : reason }, scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['shop-floor'] });
      onClose();
    },
  });
  return (
    <FormDialog title="Pause" description="Paused time isn't charged to the work order." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Pause">
      <Field label="Reason" error={fieldErrors(m.error).reason}>
        {(f) => (
          <Select {...f} value={reason} onChange={(e) => setReason(e.target.value)}>
            {PAUSE_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        )}
      </Field>
      {reason === 'Other' && (
        <Field label="Describe">
          {(f) => <Input {...f} value={other} onChange={(e) => setOther(e.target.value)} required autoFocus />}
        </Field>
      )}
    </FormDialog>
  );
}

function StopDialog({ card, onClose }: { card: JobCard; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [form, setForm] = useState({ goodQty: '', reworkQty: '', scrapQty: '', remarks: '' });
  const m = useMutation({
    mutationFn: () =>
      api(`/manufacturing/job-cards/${card.id}/stop`, {
        method: 'POST',
        scope: ws.scope,
        body: { goodQty: form.goodQty || '0', reworkQty: form.reworkQty || '0', scrapQty: form.scrapQty || '0', remarks: form.remarks || null },
      }),
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <FormDialog title={`Stop op ${card.seq}`} description="Enter what you made in this run. The time is charged to the work order at the work centre rate." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Stop and record">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Good" error={err.goodQty}>
          {(f) => <Input {...f} inputMode="decimal" value={form.goodQty} onChange={set('goodQty')} autoFocus />}
        </Field>
        <Field label="Rework" error={err.reworkQty}>
          {(f) => <Input {...f} inputMode="decimal" value={form.reworkQty} onChange={set('reworkQty')} />}
        </Field>
        <Field label="Scrap" error={err.scrapQty}>
          {(f) => <Input {...f} inputMode="decimal" value={form.scrapQty} onChange={set('scrapQty')} />}
        </Field>
      </div>
      <Field label="Remarks">
        {(f) => <Input {...f} value={form.remarks} onChange={set('remarks')} placeholder="Tool wear, deviation, NCR number…" />}
      </Field>
    </FormDialog>
  );
}
