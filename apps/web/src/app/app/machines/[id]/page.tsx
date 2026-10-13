'use client';
import { Alert, Badge, Button, Card, CardHeader, PageHeader } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BreakdownDialog } from '@/components/breakdown-dialog';
import { EntityGate } from '@/components/entity-gate';
import { StateStrip } from '@/components/state-strip';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Meter } from '@/lib/iot';
import { DUE_LABEL, intervalLabel, type MachineMaintenance, STATUS_LABEL } from '@/lib/maintenance';
import { formatMinutes } from '@/lib/services';

/** One machine: its states today from its tap (decision 063) and its maintenance (decision 066). */
export default function MachinePage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const [breakdown, setBreakdown] = useState(false);
  const q = useQuery({
    queryKey: ['machine-timeline', ws.entityId, id],
    queryFn: () => api<{ machine: { id: string; code: string; name: string }; meter: Meter | null }>(`/plant/machines/${id}/timeline`, { scope: ws.scope }),
    enabled: !!ws.entityId,
    refetchInterval: 60_000,
  });
  const mnt = useQuery({
    queryKey: ['maintenance', 'machine', ws.entityId, id],
    queryFn: () => api<MachineMaintenance>(`/maintenance/machines/${id}`, { scope: ws.scope }),
    enabled: !!ws.entityId && ws.can('maintenance.order.read'),
    refetchInterval: 60_000,
  });
  const d = q.data;
  const s = mnt.data;
  const openBreakdown = s?.open.find((o) => o.kind === 'breakdown');
  return (
    <>
      <PageHeader
        title={d ? `${d.machine.code} · ${d.machine.name}` : 'Machine'}
        description={d?.meter ? `Tap ${d.meter.device.code}, heartbeat ${d.meter.device.heartbeatSeconds} s` : undefined}
        actions={
          ws.entityId &&
          ws.can('maintenance.breakdown.create') &&
          !openBreakdown && (
            <Button variant="secondary" onClick={() => setBreakdown(true)}>
              Report breakdown
            </Button>
          )
        }
      />
      <EntityGate what="plant">
        <div className="space-y-4">
          {q.error && <Alert tone="danger">{q.error.message}</Alert>}
          {s?.alarmSince && !openBreakdown && (
            <Alert tone="warning">
              The tap has shown an alarm since {formatDateTime(s.alarmSince)}.{' '}
              {ws.can('maintenance.breakdown.create') && (
                <button type="button" className="font-medium underline" onClick={() => setBreakdown(true)}>
                  Raise a breakdown?
                </button>
              )}
            </Alert>
          )}
          {openBreakdown && (
            <Alert tone="danger">
              Broken down since {openBreakdown.failedAt && formatDateTime(openBreakdown.failedAt)}: {openBreakdown.symptom}.{' '}
              <Link className="font-medium underline" href={`/app/maintenance/orders/${openBreakdown.id}`}>
                {openBreakdown.number}
              </Link>
            </Alert>
          )}
          {d && (
            <Card>
              <CardHeader title="Today" description={d.meter ? `${formatMinutes(d.meter.minutes)} occupied${d.meter.covered ? '' : '; some of the day has no data'}` : 'This machine has no tap.'} />
              {d.meter && (
                <div className="px-5 py-4">
                  <StateStrip segments={d.meter.segments} label={`${d.machine.code} states today`} />
                </div>
              )}
            </Card>
          )}
          {s && <Maintenance s={s} />}
        </div>
      </EntityGate>
      {breakdown && <BreakdownDialog machineId={id} since={s?.alarmSince} onClose={() => setBreakdown(false)} />}
    </>
  );
}

function Maintenance({ s }: { s: MachineMaintenance }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const critical = useMutation({
    mutationFn: () => api(`/manufacturing/machines/${s.machine.id}`, { method: 'PUT', scope: ws.scope, body: { name: s.machine.name, critical: !s.machine.critical } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['maintenance'] });
      void qc.invalidateQueries({ queryKey: ['work-centres'] });
    },
  });
  const r = s.last90Days;
  return (
    <>
      <Card>
        <CardHeader
          title="Maintenance"
          description={
            r
              ? `Last 90 days: ${r.breakdowns} breakdown${r.breakdowns === 1 ? '' : 's'}, ${r.downtimeHours} h down${r.mttrHours != null ? `, MTTR ${r.mttrHours} h` : ''}${r.availability != null ? `, ${(r.availability * 100).toFixed(1)} % available` : ''}`
              : undefined
          }
          actions={
            <div className="flex items-center gap-2">
              {s.machine.critical && <Badge tone="warning">Critical</Badge>}
              {ws.can('manufacturing.work_centre.update') && (
                <Button size="sm" variant="ghost" loading={critical.isPending} onClick={() => critical.mutate()}>
                  {s.machine.critical ? 'Not critical' : 'Mark critical'}
                </Button>
              )}
            </div>
          }
        />
        {critical.error && <Alert tone="danger">{critical.error.message}</Alert>}
        {s.plans.length === 0 ? (
          <p className="px-5 pb-4 text-[13px] text-muted">
            No maintenance plan.{' '}
            {ws.can('maintenance.plan.create') && (
              <Link className="text-accent hover:underline" href="/app/maintenance/plans">
                Add one
              </Link>
            )}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {s.plans.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-[13px]">
                <span className="font-medium">{p.name}</span>
                <span className="text-subtle">{intervalLabel(p)}</span>
                <Badge tone={DUE_LABEL[p.due.status][1]}>{DUE_LABEL[p.due.status][0]}</Badge>
                {p.due.dueAt && <span className="text-muted">due {formatDate(p.due.dueAt)}</span>}
                {p.everyRunHours && <span className="text-muted">{p.due.runHoursSince} of {p.everyRunHours} running h</span>}
                {p.due.openOrder && (
                  <Link className="font-mono hover:text-accent" href={`/app/maintenance/orders/${p.due.openOrder.id}`}>
                    {p.due.openOrder.number}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {(s.open.length > 0 || s.history.length > 0) && (
        <Card>
          <CardHeader title="Orders" />
          <ul className="divide-y divide-line">
            {[...s.open, ...s.history].map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-3 px-5 py-2 text-[13px]">
                <Link className="font-mono font-medium hover:text-accent" href={`/app/maintenance/orders/${o.id}`}>
                  {o.number}
                </Link>
                <span>{o.kind === 'breakdown' ? o.symptom : o.title}</span>
                <Badge tone={STATUS_LABEL[o.status][1]}>{STATUS_LABEL[o.status][0]}</Badge>
                <span className="text-subtle">{formatDate(o.failedAt ?? o.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
