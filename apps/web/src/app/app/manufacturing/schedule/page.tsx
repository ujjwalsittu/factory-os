'use client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { Gantt } from '@/components/gantt';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDateTime, formatQty } from '@/lib/format';
import type { Bar, OutOfSequence, ScheduleView } from '@/lib/scheduling';

const ZOOM = {
  day: { hours: 48, pxPerHour: 40, step: 24 },
  week: { hours: 24 * 7, pxPerHour: 10, step: 24 * 7 },
} as const;

/** The start of the current hour, minus `back` hours. */
const hourStart = (back = 0) => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return new Date(d.getTime() - back * 3600e3);
};

export default function SchedulePage() {
  return (
    <>
      <PageHeader title="Schedule" description="Released work orders on machines, by priority and due date, within working time. Drag a bar to another time or machine in its work centre; moved bars stay put when you reschedule." />
      <EntityGate what="manufacturing">
        <Planner />
      </EntityGate>
    </>
  );
}

function Planner() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [zoom, setZoom] = useState<keyof typeof ZOOM>('day');
  const [from, setFrom] = useState(() => hourStart(2));
  const [selected, setSelected] = useState<Bar | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const z = ZOOM[zoom];
  const to = new Date(from.getTime() + z.hours * 3600e3);
  const key = ['schedule', ws.entityId, from.toISOString(), zoom];
  const q = useQuery({ queryKey: key, queryFn: () => api<ScheduleView>(`/manufacturing/schedule?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { scope: ws.scope }) });
  const canUpdate = ws.can('manufacturing.schedule.update');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['schedule'] });
  const run = useMutation({ mutationFn: () => api<ScheduleView>('/manufacturing/schedule/run', { method: 'POST', scope: ws.scope, body: {} }), onSuccess: () => (setSelected(null), refresh()) });
  const move = useMutation({
    mutationFn: (m: { bar: Bar; machineId: string; start: Date }) => api('/manufacturing/schedule/move', { method: 'POST', scope: ws.scope, body: { operationId: m.bar.operationId, machineId: m.machineId, start: m.start.toISOString(), runId: q.data?.run?.id } }),
    onMutate: () => setMoveError(null),
    onError: (e: Error) => setMoveError(e.message),
    onSettled: refresh,
  });
  const unpin = useMutation({ mutationFn: (b: Bar) => api(`/manufacturing/schedule/${b.operationId}/unpin`, { method: 'POST', scope: ws.scope, body: {} }), onSuccess: () => (setSelected(null), refresh()) });
  const v = q.data;
  const shift = (sign: number) => setFrom(new Date(from.getTime() + sign * z.step * 3600e3));

  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!v) return <p className="text-muted">Loading…</p>;
  if (v.calendarMissing)
    return (
      <Card>
        <EmptyState
          icon={<CalendarClock className="size-5" />}
          title="No working calendar yet"
          description="Scheduling needs shifts and holidays to know when machines work."
          action={
            <Link className="font-medium text-accent hover:underline" href="/app/manufacturing/calendars">
              Set up a calendar
            </Link>
          }
        />
      </Card>
    );
  const sel = selected && v.bars.find((b) => b.operationId === selected.operationId);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canUpdate && (
          <Button loading={run.isPending} onClick={() => run.mutate()}>
            Reschedule
          </Button>
        )}
        <div className="flex gap-1" role="tablist" aria-label="Zoom">
          {(['day', 'week'] as const).map((k) => (
            <Button key={k} role="tab" aria-selected={zoom === k} size="sm" variant={zoom === k ? 'secondary' : 'ghost'} onClick={() => setZoom(k)}>
              {k === 'day' ? 'Days' : 'Week'}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Earlier" onClick={() => shift(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setFrom(hourStart(2))}>
            Now
          </Button>
          <Button size="icon" variant="ghost" aria-label="Later" onClick={() => shift(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <p className="ml-auto text-[13px] text-muted">
          {v.run ? (
            <>
              Last run {formatDateTime(v.run.runAt)} · {v.run.placed} placed
              {v.run.unscheduled > 0 && ` · ${v.run.unscheduled} unscheduled`}
              {v.run.late > 0 && ` · ${v.run.late} late`}
            </>
          ) : (
            'Not scheduled yet'
          )}
        </p>
      </div>
      {v.stale && <Alert tone="warning">{v.run ? 'Out of date: work orders changed since the last run. Reschedule to update.' : 'Run Reschedule to place the released work orders.'}</Alert>}
      {run.error && <Alert tone="danger">{run.error.message}</Alert>}
      {moveError && <Alert tone="danger">{moveError}</Alert>}
      {v.machines.length === 0 ? (
        <Alert>Add machines to your work centres to schedule them.</Alert>
      ) : (
        <>
          <div className="hidden sm:block">
            <Gantt view={v} from={from} hours={z.hours} pxPerHour={z.pxPerHour} canMove={canUpdate && !move.isPending} selected={sel?.operationId ?? null} onSelect={setSelected} onMove={(bar, machineId, start) => move.mutate({ bar, machineId, start })} />
          </div>
          <Queues view={v} onSelect={setSelected} />
        </>
      )}
      {sel && (
        <Card className="p-4 text-[13px]" aria-label="Selected operation">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <Link className="font-mono font-medium hover:text-accent" href={`/app/manufacturing/work-orders/${sel.workOrderId}`}>
                {sel.number}
              </Link>{' '}
              · operation {sel.seq} {sel.name}
              <p className="text-muted">
                {sel.itemCode} {sel.itemName} · {formatQty(sel.qty)} · priority {sel.priority}
              </p>
              <p>
                {formatDateTime(sel.startsAt)} → {formatDateTime(sel.endsAt)}
                {sel.dueAt && <span className={sel.late ? 'text-danger' : 'text-muted'}> · due {formatDateTime(sel.dueAt)}</span>}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {sel.pinned && <Badge tone="info">Pinned</Badge>}
                {sel.running && <Badge tone="success">Running</Badge>}
                {sel.late && <Badge tone="danger">Late</Badge>}
                {sel.noMaterial && <Badge tone="warning">No material issued</Badge>}
                {sel.conflict && <Badge tone="warning">Starts before the previous operation ends</Badge>}
              </div>
            </div>
            {sel.pinned && canUpdate && (
              <Button size="sm" variant="secondary" loading={unpin.isPending} onClick={() => unpin.mutate(sel)}>
                Unpin
              </Button>
            )}
          </div>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <ListCard title="Late orders" empty="Nothing late.">
          {v.late.map((w) => (
            <li key={w.id} className="px-4 py-2 text-[13px]">
              <Link className="font-mono font-medium hover:text-accent" href={`/app/manufacturing/work-orders/${w.id}`}>
                {w.number}
              </Link>{' '}
              {w.itemCode}
              <p className="text-danger">
                Finishes {formatDateTime(w.scheduledFinish)}, due {formatDateTime(w.dueAt)}
              </p>
            </li>
          ))}
        </ListCard>
        <ListCard title="Not scheduled" empty="Everything released is on the schedule.">
          {[...v.unscheduled, ...v.conflicts].map((u) => (
            <li key={`${u.operationId}${u.reason}`} className="px-4 py-2 text-[13px]">
              <Link className="font-mono font-medium hover:text-accent" href={`/app/manufacturing/work-orders/${u.workOrderId}`}>
                {u.number}
              </Link>{' '}
              · {u.seq} {u.name}
              <p className="text-muted">{u.reason}</p>
            </li>
          ))}
        </ListCard>
        <OutOfSequenceCard />
      </div>
    </div>
  );
}

function ListCard({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      {children.length === 0 ? <p className="px-4 py-3 text-[13px] text-muted">{empty}</p> : <ul className="divide-y divide-line">{children}</ul>}
    </Card>
  );
}

function OutOfSequenceCard() {
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['out-of-sequence', ws.entityId], queryFn: () => api<OutOfSequence[]>('/manufacturing/schedule/out-of-sequence', { scope: ws.scope }) });
  return (
    <ListCard title="Started out of sequence" empty="Operators have followed the dispatch order.">
      {(q.data ?? []).slice(0, 20).map((o) => (
        <li key={o.id} className="px-4 py-2 text-[13px]">
          <Link className="font-mono font-medium hover:text-accent" href={`/app/manufacturing/work-orders/${o.workOrderId}`}>
            {o.number}
          </Link>{' '}
          · {o.seq} {o.operation} on {o.machine ?? '—'}
          <p className="text-muted">
            {o.operator}, {formatDateTime(o.startedAt)}: {o.reason}
          </p>
        </li>
      ))}
    </ListCard>
  );
}

/** Phones: each machine's queue as a list instead of the Gantt. */
function Queues({ view, onSelect }: { view: ScheduleView; onSelect: (b: Bar) => void }) {
  const lanes = [...view.machines.map((m) => ({ id: m.id as string | null, label: `${m.code} · ${m.workCentre}` })), { id: null, label: 'Job work' }];
  return (
    <div className="space-y-3 sm:hidden">
      {lanes.map((lane) => {
        const bars = view.bars.filter((b) => b.machineId === lane.id);
        if (!bars.length) return null;
        return (
          <Card key={lane.id ?? 'jw'}>
            <CardHeader title={lane.label} />
            <ul className="divide-y divide-line">
              {bars.map((b) => (
                <li key={b.operationId}>
                  <button type="button" className="w-full px-4 py-2 text-left text-[13px]" onClick={() => onSelect(b)}>
                    <span className="font-mono font-medium">{b.number}</span> · {b.seq} {b.name}
                    {b.late && <Badge tone="danger" className="ml-1">Late</Badge>}
                    <span className="block text-muted">
                      {formatDateTime(b.startsAt)} → {formatDateTime(b.endsAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
