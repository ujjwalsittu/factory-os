'use client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney, formatQty } from '@/lib/format';
import { limitsLabel, type OrderDetail, STATUS_LABEL, trimNum } from '@/lib/maintenance';
import { formatMinutes } from '@/lib/services';
import type { Item, Warehouse } from '@/lib/types';

const localIst = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 16);

/** A maintenance order (decision 066): checklist with readings, labour, spares from stores, sign-off and verification. */
export default function MaintenanceOrderPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['maintenance', 'order', ws.entityId, id], queryFn: () => api<OrderDetail>(`/maintenance/orders/${id}`, { scope: ws.scope }), enabled: !!ws.entityId });
  const o = q.data;
  return (
    <>
      <PageHeader
        title={o ? `${o.number} · ${o.kind === 'breakdown' ? 'Breakdown' : o.title}` : 'Maintenance order'}
        description={o ? `${o.machineCode} · ${o.machineName}${o.critical ? ' (critical: a supervisor verifies)' : ''}` : undefined}
        actions={o && <Badge tone={STATUS_LABEL[o.status][1]}>{STATUS_LABEL[o.status][0]}</Badge>}
      />
      <EntityGate what="maintenance">
        {q.error && <Alert tone="danger">{q.error.message}</Alert>}
        {o && <Order o={o} />}
      </EntityGate>
    </>
  );
}

function useAct(o: OrderDetail) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api<OrderDetail>(`/maintenance/orders/${o.id}/${path}`, { method: 'POST', scope: ws.scope, body: body ?? {} }),
    onSuccess: (d) => {
      qc.setQueryData(['maintenance', 'order', ws.entityId, o.id], d);
      void qc.invalidateQueries({ queryKey: ['maintenance'], predicate: (x) => x.queryKey[1] !== 'order' });
    },
  });
}

function Order({ o }: { o: OrderDetail }) {
  const ws = useWorkspace();
  const act = useAct(o);
  const [dialog, setDialog] = useState<null | 'schedule' | 'done' | 'cancel' | 'spares' | 'labour'>(null);
  const working = o.status === 'open' || o.status === 'in_progress';
  const canWork = ws.can('maintenance.order.update');
  return (
    <div className="space-y-4">
      {act.error && <Alert tone="danger">{act.error.message}</Alert>}
      {o.needsVerification && (
        <Alert tone="warning">
          Done by {o.doneByName} on {o.doneAt && formatDateTime(o.doneAt)}. This is a critical machine: a supervisor other than the technician verifies the work.
        </Alert>
      )}
      <Card>
        <CardHeader
          title={o.kind === 'breakdown' ? o.symptom ?? 'Breakdown' : 'Order'}
          actions={
            <div className="flex flex-wrap gap-2">
              {working && canWork && o.kind === 'preventive' && (
                <Button size="sm" variant="secondary" onClick={() => setDialog('schedule')}>
                  {o.scheduledStart ? 'Reschedule' : 'Schedule'}
                </Button>
              )}
              {o.status === 'open' && canWork && (
                <Button size="sm" variant="secondary" loading={act.isPending && act.variables?.path === 'start'} onClick={() => act.mutate({ path: 'start' })}>
                  Start
                </Button>
              )}
              {working && canWork && <Button size="sm" onClick={() => setDialog('done')}>Mark done</Button>}
              {o.needsVerification && ws.can('maintenance.order.approve') && o.doneBy !== ws.me.user.id && (
                <Button size="sm" loading={act.isPending && act.variables?.path === 'verify'} onClick={() => act.mutate({ path: 'verify' })}>
                  Verify
                </Button>
              )}
              {working && ws.can('maintenance.order.cancel') && (
                <Button size="sm" variant="ghost" onClick={() => setDialog('cancel')}>
                  Cancel order
                </Button>
              )}
            </div>
          }
        />
        <dl className="grid gap-x-6 gap-y-2 px-5 pb-4 text-[13px] sm:grid-cols-3">
          <Fact label="Machine">
            <Link className="font-mono hover:text-accent" href={`/app/machines/${o.machineId}`}>
              {o.machineCode}
            </Link>{' '}
            {o.machineName}
          </Fact>
          {o.kind === 'breakdown' ? (
            <Fact label="Stopped">
              {o.failedAt && formatDateTime(o.failedAt)}
              {o.reportedByName && <span className="text-subtle"> · reported by {o.reportedByName}</span>}
            </Fact>
          ) : (
            <Fact label="Planned">{o.scheduledStart ? formatDateTime(o.scheduledStart) : 'Not scheduled'}</Fact>
          )}
          {o.startedAt && <Fact label="Started">{formatDateTime(o.startedAt)}</Fact>}
          {o.doneAt && <Fact label="Done">{`${formatDateTime(o.doneAt)}${o.doneByName ? ` · ${o.doneByName}` : ''}`}</Fact>}
          {o.verifiedAt && <Fact label="Verified">{`${formatDateTime(o.verifiedAt)}${o.verifiedByName ? ` · ${o.verifiedByName}` : ''}`}</Fact>}
          {o.cause && <Fact label="Cause">{o.cause}</Fact>}
          {o.action && <Fact label="Action">{o.action}</Fact>}
          {o.cancelReason && <Fact label="Cancelled">{o.cancelReason}</Fact>}
          <Fact label="Cost">
            {formatMoney(o.cost.total)} <span className="text-subtle">(spares {formatMoney(o.cost.spares)}, labour {formatMoney(o.cost.labour)})</span>
          </Fact>
        </dl>
      </Card>
      {o.checklist.length > 0 && <Checklist o={o} editable={working && canWork} />}
      <Card>
        <CardHeader title="Labour" description="Costed at the machine's work centre rate" actions={working && canWork && <Button size="sm" variant="secondary" onClick={() => setDialog('labour')}>Add time</Button>} />
        {o.labour.length === 0 ? (
          <EmptyState size="compact" title="No time recorded" />
        ) : (
          <ul className="divide-y divide-line">
            {o.labour.map((l) => (
              <li key={l.id} className="flex flex-wrap gap-x-3 px-5 py-2 text-[13px]">
                <span className="font-medium">{l.technician}</span>
                <span>{formatMinutes(l.minutes)}</span>
                <span className="tabular">{formatMoney(l.cost)}</span>
                {l.note && <span className="text-muted">{l.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Spares" description="Issued from stores to repairs and maintenance" actions={working && canWork && <Button size="sm" variant="secondary" onClick={() => setDialog('spares')}>Issue spares</Button>} />
        {o.spares.length === 0 ? (
          <EmptyState size="compact" title="No spares issued" />
        ) : (
          <ul className="divide-y divide-line">
            {o.spares.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 px-5 py-2 text-[13px]">
                <span className="font-mono">{s.number}</span>
                {s.status === 'cancelled' && <Badge>Cancelled</Badge>}
                <span className={s.status === 'cancelled' ? 'text-subtle line-through' : ''}>
                  {s.lines.map((l) => `${l.itemCode} × ${formatQty(l.qty)} ${l.uom}`).join(', ')}
                </span>
                <span className="tabular">{formatMoney(s.lines.reduce((t, l) => t + Number(l.value ?? 0), 0).toFixed(2))}</span>
                {s.status === 'submitted' && working && canWork && <CancelSpares o={o} entryId={s.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {dialog === 'schedule' && <ScheduleDialog o={o} onClose={() => setDialog(null)} />}
      {dialog === 'done' && <DoneDialog o={o} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelDialog o={o} onClose={() => setDialog(null)} />}
      {dialog === 'labour' && <LabourDialog o={o} onClose={() => setDialog(null)} />}
      {dialog === 'spares' && <SparesDialog o={o} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-subtle">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Checklist({ o, editable }: { o: OrderDetail; editable: boolean }) {
  const left = o.checklist.filter((i) => !i.result).length;
  return (
    <Card>
      <CardHeader title="Checklist" description={left ? `${left} of ${o.checklist.length} to do` : 'All done'} />
      <div className="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Task</Th>
              <Th>Result</Th>
              {editable && <Th />}
            </tr>
          </thead>
          <tbody>
            {o.checklist.map((i) => (
              <ChecklistRow key={i.id} o={o} i={i} editable={editable} />
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}

function ChecklistRow({ o, i, editable }: { o: OrderDetail; i: OrderDetail['checklist'][number]; editable: boolean }) {
  const act = useAct(o);
  const [reading, setReading] = useState(i.result?.reading ? (trimNum(i.result.reading) ?? '') : '');
  const [note, setNote] = useState(i.result?.note ?? '');
  const [editing, setEditing] = useState(false);
  const limits = limitsLabel(i);
  const showForm = editable && (!i.result || editing);
  return (
    <tr className="border-t border-line align-top text-[13px]">
      <Td className="tabular text-subtle">{i.lineNo}</Td>
      <Td>
        {i.text}
        {limits && <span className="block text-subtle">{limits}</span>}
        {i.spareCode && <span className="block text-subtle">Spare: {i.spareCode} × {formatQty(i.spareQty)}</span>}
      </Td>
      <Td>
        {showForm ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act.mutate({ path: 'results', body: { itemId: i.id, reading: reading.trim() || null, note: note.trim() || null } }, { onSuccess: () => setEditing(false) });
            }}
          >
            {i.unit && <Input aria-label={`${i.text} reading`} inputMode="decimal" className="h-8 w-28" value={reading} onChange={(e) => setReading(e.target.value)} placeholder={i.unit} />}
            <Input aria-label={`${i.text} note`} className="h-8 min-w-48 flex-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" />
            <Button size="sm" type="submit" loading={act.isPending}>
              Done
            </Button>
            {act.error && <span className="w-full text-[12px] text-danger">{act.error.message}</span>}
          </form>
        ) : i.result ? (
          <>
            <Badge tone={i.result.outside ? 'warning' : 'success'}>{i.result.reading != null ? `${trimNum(i.result.reading)} ${i.unit ?? ''}` : 'Done'}</Badge>
            {i.result.outside && <span className="ml-2 text-warning">outside limits</span>}
            {i.result.note && <span className="block text-muted">{i.result.note}</span>}
            <span className="block text-subtle">
              {i.result.by} · {formatDateTime(i.result.doneAt)}
            </span>
          </>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </Td>
      {editable && (
        <Td>
          {i.result && !editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Change
            </Button>
          )}
        </Td>
      )}
    </tr>
  );
}

function ScheduleDialog({ o, onClose }: { o: OrderDetail; onClose: () => void }) {
  const act = useAct(o);
  const [start, setStart] = useState(o.scheduledStart ? localIst(new Date(o.scheduledStart)) : '');
  return (
    <FormDialog
      title={`Schedule ${o.number}`}
      description="The machine is reserved for the plan's planned time on the schedule. Clear the time to release it."
      onClose={onClose}
      onSubmit={() => act.mutate({ path: 'schedule', body: { start: start ? new Date(`${start}:00+05:30`).toISOString() : null } }, { onSuccess: onClose })}
      pending={act.isPending}
      error={act.error}
      submitLabel="Save"
    >
      <Field label="Start">{(p) => <Input {...p} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} autoFocus />}</Field>
    </FormDialog>
  );
}

function DoneDialog({ o, onClose }: { o: OrderDetail; onClose: () => void }) {
  const act = useAct(o);
  const [f, setF] = useState({ cause: o.cause ?? '', action: o.action ?? '' });
  const err = fieldErrors(act.error);
  const left = o.checklist.filter((i) => !i.result);
  return (
    <FormDialog
      title={`Sign off ${o.number}`}
      description={o.critical ? 'A critical machine: a supervisor verifies after you sign off.' : 'The plan counts its next interval from now.'}
      onClose={onClose}
      onSubmit={() => act.mutate({ path: 'done', body: { cause: f.cause.trim() || null, action: f.action.trim() || null } }, { onSuccess: onClose })}
      pending={act.isPending}
      error={act.error}
      submitLabel="Mark done"
    >
      {left.length > 0 && <Alert tone="warning">Checklist not finished: {left.map((i) => i.text).join('; ')}</Alert>}
      <div className="grid gap-4">
        <Field label={o.kind === 'breakdown' ? 'Cause' : 'Findings (optional)'} error={err.cause}>
          {(p) => <Input {...p} value={f.cause} onChange={(e) => setF({ ...f, cause: e.target.value })} required={o.kind === 'breakdown'} autoFocus />}
        </Field>
        <Field label={o.kind === 'breakdown' ? 'Action taken' : 'Action (optional)'} error={err.action}>
          {(p) => <Input {...p} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} required={o.kind === 'breakdown'} />}
        </Field>
      </div>
    </FormDialog>
  );
}

function CancelDialog({ o, onClose }: { o: OrderDetail; onClose: () => void }) {
  const act = useAct(o);
  const [reason, setReason] = useState('');
  const err = fieldErrors(act.error);
  return (
    <FormDialog title={`Cancel ${o.number}`} onClose={onClose} onSubmit={() => act.mutate({ path: 'cancel', body: { reason } }, { onSuccess: onClose })} pending={act.isPending} error={act.error} submitLabel="Cancel order">
      <Field label="Reason" error={err.reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}
      </Field>
    </FormDialog>
  );
}

function LabourDialog({ o, onClose }: { o: OrderDetail; onClose: () => void }) {
  const act = useAct(o);
  const [f, setF] = useState({ minutes: '', note: '' });
  const err = fieldErrors(act.error);
  return (
    <FormDialog
      title="Add time"
      description="Your time on this order, costed at the work centre's hourly rate."
      onClose={onClose}
      onSubmit={() => act.mutate({ path: 'labour', body: { minutes: Number(f.minutes), note: f.note.trim() || null } }, { onSuccess: onClose })}
      pending={act.isPending}
      error={act.error}
      submitLabel="Add"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minutes" error={err.minutes}>
          {(p) => <Input {...p} inputMode="numeric" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} required autoFocus />}
        </Field>
        <Field label="Note" error={err.note}>
          {(p) => <Input {...p} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}
        </Field>
      </div>
    </FormDialog>
  );
}

function SparesDialog({ o, onClose }: { o: OrderDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const act = useAct(o);
  const warehouses = useQuery({ queryKey: ['warehouses', ws.entityId], queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }) });
  const items = useQuery({ queryKey: ['items', ws.tenantId, 'all'], queryFn: () => api<Item[]>('/items', { scope: ws.scope }) });
  const suggested = o.checklist.filter((i) => i.spareItemId).map((i) => ({ itemId: i.spareItemId!, qty: trimNum(i.spareQty) ?? '1' }));
  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState(suggested.length ? suggested : [{ itemId: '', qty: '1' }]);
  const set = (n: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  const err = fieldErrors(act.error);
  return (
    <FormDialog
      title="Issue spares"
      description="Taken out of stock at its value and charged to repairs and maintenance."
      onClose={onClose}
      onSubmit={() => act.mutate({ path: 'spares', body: { warehouseId, lines: lines.filter((l) => l.itemId) } }, { onSuccess: onClose })}
      pending={act.isPending}
      error={act.error}
      submitLabel="Issue"
      wide
    >
      <div className="grid gap-4">
        <Field label="From warehouse" error={err.warehouseId}>
          {(p) => (
            <Select {...p} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
              <option value="">Choose…</option>
              {warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {lines.map((l, n) => (
          <div key={n} className="grid grid-cols-[1fr_8rem] gap-2">
            <Select aria-label={`Spare ${n + 1}`} value={l.itemId} onChange={(e) => set(n, { itemId: e.target.value })}>
              <option value="">Choose a spare…</option>
              {items.data?.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.code} · {it.name}
                </option>
              ))}
            </Select>
            <Input aria-label={`Quantity ${n + 1}`} inputMode="decimal" value={l.qty} onChange={(e) => set(n, { qty: e.target.value })} />
          </div>
        ))}
        <div>
          <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { itemId: '', qty: '1' }])}>
            Add a line
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}

function CancelSpares({ o, entryId }: { o: OrderDetail; entryId: string }) {
  const act = useAct(o);
  return (
    <Button size="sm" variant="ghost" loading={act.isPending} onClick={() => act.mutate({ path: `spares/${entryId}/cancel`, body: { reason: 'Returned unused to stores' } })}>
      Return to stores
    </Button>
  );
}
