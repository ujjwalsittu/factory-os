'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { WorkOrderView } from '@/components/work-order-view';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDateTime, formatQty } from '@/lib/format';
import type { WorkOrderDetail } from '@/lib/manufacturing';
import { type InspectionDetail, type InspectionRow, OUTCOME, STAGE } from '@/lib/quality';
import { PRIORITY, type ScheduleView } from '@/lib/scheduling';

function Order() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  // Job cards move on the shop floor, so this page always refetches.
  const q = useQuery({ queryKey: ['work-order', id, ws.entityId], queryFn: () => api<WorkOrderDetail>(`/manufacturing/work-orders/${id}`, { scope: ws.scope }), retry: false, staleTime: 0, refetchOnMount: 'always' });
  if (q.error) return <Alert tone="danger" title="Can't open this work order">{q.error.message}. It may belong to another legal entity.</Alert>;
  if (!q.data) return <p className="text-muted">Loading…</p>;
  return (
    <>
      {q.data.reworkOfNcrId && (
        <Alert className="mb-4">
          Rework order for{' '}
          <Link className="font-medium underline" href={`/app/quality/ncrs/${q.data.reworkOfNcrId}`}>
            its NCR
          </Link>
          . It issues the nonconforming pieces from MRB; its output is inspected again.
        </Alert>
      )}
      <WorkOrderView wo={q.data} />
      {ws.can('manufacturing.schedule.read') && q.data.status !== 'cancelled' && q.data.status !== 'completed' && <SchedulePanel wo={q.data} />}
      {ws.can('quality.inspection.read') && <Inspections wo={q.data} />}
    </>
  );
}

/** Final and in-process inspections of this order (decision 048); hidden when there are none and none can be started. */
function Inspections({ wo }: { wo: WorkOrderDetail }) {
  const ws = useWorkspace();
  const [checking, setChecking] = useState(false);
  const q = useQuery({ queryKey: ['inspections', ws.entityId, 'wo', wo.id], queryFn: () => api<InspectionRow[]>(`/quality/inspections?workOrderId=${wo.id}`, { scope: ws.scope }) });
  const ops = wo.operations.filter((o) => !o.outsourced);
  const canCheck = ws.can('quality.inspection.create') && wo.status === 'released' && ops.length > 0;
  if (!q.data?.length && !canCheck) return null;
  return (
    <Card className="mt-4">
      <CardHeader
        title="Inspections"
        description="Output of an item that needs final inspection waits in Quarantine until it is inspected. In-process checks record a failure on an NCR but don't stop the order."
        actions={
          canCheck && (
            <Button size="sm" variant="secondary" onClick={() => setChecking(true)}>
              In-process check
            </Button>
          )
        }
      />
      {checking && <InProcessCheck wo={wo} ops={ops} onClose={() => setChecking(false)} />}
      {!q.data?.length && <p className="px-4 py-3 text-[13px] text-muted">None yet.</p>}
      <ul className="divide-y divide-line">
        {q.data?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13px]">
            <Link className="font-mono font-medium hover:text-accent" href={`/app/quality/inspections/${r.id}`}>
              {r.number ?? `${STAGE[r.stage]} inspection`}
            </Link>
            <span className="text-muted">
              {STAGE[r.stage]} · {formatQty(r.qty)}
              {r.batchNo ? ` · ${r.batchNo}` : ''}
            </span>
            {r.status === 'draft' ? <Badge tone="warning">To inspect</Badge> : r.status === 'cancelled' ? <Badge tone="neutral">Cancelled</Badge> : r.outcome && <Badge tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].label}</Badge>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function Page() {
  return (
    <EntityGate what="manufacturing">
      <Order />
    </EntityGate>
  );
}

function InProcessCheck({ wo, ops, onClose }: { wo: WorkOrderDetail; ops: WorkOrderDetail['operations']; onClose: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [f, setF] = useState({ operationId: ops[0]?.id ?? '', qty: '1' });
  const m = useMutation({
    mutationFn: () => api<InspectionDetail>('/quality/inspections', { method: 'POST', scope: ws.scope, body: { stage: 'in_process', itemId: wo.itemId, qty: f.qty, sourceType: 'operation', workOrderId: wo.id, operationId: f.operationId } }),
    onSuccess: (r) => router.push(`/app/quality/inspections/${r.id}`),
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="In-process check" description="Uses the item's active in-process plan for the operation, if there is one." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Start">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Operation" error={err.operationId}>
          {(p) => (
            <Select {...p} value={f.operationId} onChange={(e) => setF({ ...f, operationId: e.target.value })} required autoFocus>
              {ops.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.seq} · {o.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={`Pieces checked (${wo.uom})`} error={err.qty}>
          {(p) => <Input {...p} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required />}
        </Field>
      </div>
    </FormDialog>
  );
}

/** Priority, scheduled finish and where each operation is planned (decision 049). */
function SchedulePanel({ wo }: { wo: WorkOrderDetail }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const from = new Date(Date.now() - 86400e3).toISOString();
  const to = new Date(Date.now() + 60 * 86400e3).toISOString();
  const q = useQuery({ queryKey: ['schedule', ws.entityId, 'wo', wo.id], queryFn: () => api<ScheduleView>(`/manufacturing/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { scope: ws.scope }) });
  const prio = useMutation({
    mutationFn: (priority: number) => api(`/manufacturing/work-orders/${wo.id}/priority`, { method: 'POST', scope: ws.scope, body: { priority } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['work-order', wo.id] });
      void qc.invalidateQueries({ queryKey: ['schedule'] });
    },
  });
  const bars = (q.data?.bars ?? []).filter((b) => b.workOrderId === wo.id).sort((a, b) => a.seq - b.seq);
  const machines = new Map((q.data?.machines ?? []).map((m) => [m.id, m.code]));
  const unscheduled = (q.data?.unscheduled ?? []).filter((u) => u.workOrderId === wo.id);
  const late = q.data?.late.some((l) => l.id === wo.id);
  return (
    <Card className="mt-4">
      <CardHeader
        title="Schedule"
        description={wo.scheduledFinish ? `Scheduled to finish ${formatDateTime(wo.scheduledFinish)}${late ? ' · late' : ''}` : wo.status === 'released' ? 'Not on the schedule yet: reschedule from Manufacturing → Schedule.' : 'Released orders are scheduled.'}
        actions={
          <Field label="Priority" className="w-40">
            {(p) => (
              <Select {...p} value={String(wo.priority ?? 3)} onChange={(e) => prio.mutate(Number(e.target.value))} disabled={!ws.can('manufacturing.schedule.update') || prio.isPending}>
                {PRIORITY.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        }
      />
      {prio.error && <Alert tone="danger" className="mx-4 mb-2">{prio.error.message}</Alert>}
      {bars.length > 0 && (
        <ul className="divide-y divide-line">
          {bars.map((b) => (
            <li key={b.operationId} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13px]">
              <span className="font-medium">
                {b.seq} {b.name}
              </span>
              <span className="font-mono text-muted">{b.machineId ? machines.get(b.machineId) : 'job worker'}</span>
              <span className="text-muted">
                {formatDateTime(b.startsAt)} → {formatDateTime(b.endsAt)}
              </span>
              {b.pinned && <Badge tone="info">Pinned</Badge>}
              {b.running && <Badge tone="success">Running</Badge>}
            </li>
          ))}
        </ul>
      )}
      {unscheduled.map((u) => (
        <p key={u.operationId} className="px-4 py-2 text-[13px] text-warning">
          Operation {u.seq} not scheduled: {u.reason}
        </p>
      ))}
    </Card>
  );
}
