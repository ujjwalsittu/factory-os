'use client';
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, PageHeader, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatMoney, formatQty } from '@/lib/format';
import type { OutsourcedState } from '@/lib/job-work';
import { type Availability, CARD_STATUS, formatMinutes, MOVEMENT_LABEL, type Movement, type Trace, WO_STATUS, type WorkOrderDetail } from '@/lib/manufacturing';

type Dialogs = 'issue' | 'return' | 'output' | 'close' | 'reopen' | 'cancel' | null;

export function WorkOrderView({ wo }: { wo: WorkOrderDetail }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [cancelling, setCancelling] = useState<{ path: string; title: string; confirm: string } | null>(null);
  const [trace, setTrace] = useState<string | null>(null);
  const [pieces, setPieces] = useState<{ kind: 'send' | 'receive'; op: WorkOrderDetail['operations'][number] } | null>(null);
  const outsourced = wo.operations.some((o) => o.outsourced);
  const jw = useQuery({
    queryKey: ['work-order-job-work', wo.id, ws.entityId],
    queryFn: () => api<OutsourcedState>(`/manufacturing/work-orders/${wo.id}/job-work`, { scope: ws.scope }),
    enabled: outsourced && ws.can('manufacturing.job_work.read'),
  });
  const refresh = (data: WorkOrderDetail) => {
    qc.setQueryData(['work-order', wo.id, ws.entityId], data);
    void qc.invalidateQueries({ queryKey: ['work-orders'] });
  };
  const release = useMutation({ mutationFn: () => api<WorkOrderDetail>(`/manufacturing/work-orders/${wo.id}/release`, { method: 'POST', body: {}, scope: ws.scope }), onSuccess: refresh });
  const released = wo.status === 'released';
  const canPost = ws.can('manufacturing.work_order.submit');
  // Rounded to the API's 6 places: a float difference like 0.30000000000000004 would be refused.
  const remaining = Math.max(0, Number((Number(wo.plannedQty) - Number(wo.producedQty)).toFixed(6)));
  const nothingPosted = !wo.movements.some((m) => m.status === 'submitted') && !wo.jobCards.some((c) => c.status !== 'cancelled');

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {wo.number ?? 'Draft work order'}
            <Badge tone={WO_STATUS[wo.status].tone} dot>
              {WO_STATUS[wo.status].label}
            </Badge>
          </span>
        }
        description={
          <>
            <span className="font-mono">{wo.itemCode}</span> {wo.itemName} · revision {wo.revision} · {formatQty(wo.producedQty)} of {formatQty(wo.plannedQty)} {wo.uom} made
            {wo.salesOrder && <> · for {wo.salesOrder}</>}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {wo.status === 'draft' && canPost && (
              <Button loading={release.isPending} onClick={() => release.mutate()}>
                Release
              </Button>
            )}
            {released && canPost && (
              <>
                <Button onClick={() => setDialog('issue')}>Issue material</Button>
                <Button variant="secondary" onClick={() => setDialog('output')}>
                  Record output
                </Button>
                <Button variant="secondary" onClick={() => setDialog('return')} disabled={Number(wo.producedQty) > 0}>
                  Return material
                </Button>
              </>
            )}
            {released && ws.can('manufacturing.work_order.approve') && (
              <Button variant="secondary" onClick={() => setDialog('close')}>
                Close
              </Button>
            )}
            {wo.status === 'completed' && ws.can('manufacturing.work_order.approve') && (
              <Button variant="secondary" onClick={() => setDialog('reopen')}>
                Reopen
              </Button>
            )}
            {(wo.status === 'draft' || (released && nothingPosted)) && ws.can('manufacturing.work_order.cancel') && (
              <Button variant="ghost" onClick={() => setDialog('cancel')}>
                Cancel work order
              </Button>
            )}
          </div>
        }
      />
      {release.error && <Alert tone="danger" className="mb-4">{release.error.message}</Alert>}
      {wo.status === 'cancelled' && <Alert tone="danger" className="mb-4">Cancelled: {wo.cancelReason}</Alert>}
      {wo.status === 'draft' && <Alert className="mb-4">Releasing copies BOM revision {wo.revision} into this order, scaled to {formatQty(wo.plannedQty)} {wo.uom}. Later BOM changes won't affect it.</Alert>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Material" value={formatMoney(wo.cost.material)} />
        <Stat label={Number(wo.cost.jobWork) ? 'Time + job work' : 'Time absorbed'} value={formatMoney(String(Number(wo.cost.absorbed) + Number(wo.cost.jobWork ?? 0)))} />
        <Stat label="Output value" value={formatMoney(wo.cost.output)} />
        <Stat label="Still in WIP" value={formatMoney(wo.cost.wip)} strong />
        <Stat label="Variance on close" value={formatMoney(wo.cost.variance)} />
        <Stat label="Actual unit cost" value={wo.cost.unitCost ? formatMoney(wo.cost.unitCost) : '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Materials" description={`Issued from ${wo.sourceWarehouse}`} />
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th className="text-right">Required</Th>
                <Th className="text-right">Issued</Th>
              </tr>
            </thead>
            <tbody>
              {wo.materials.length === 0 && (
                <tr>
                  <Td colSpan={3} className="text-muted">
                    {wo.status === 'draft' ? 'Copied from the BOM on release.' : 'No materials on this BOM.'}
                  </Td>
                </tr>
              )}
              {wo.materials.map((m) => (
                <tr key={m.itemId} className="border-t border-line">
                  <Td>
                    <span className="font-mono text-[13px]">{m.itemCode}</span> <span className="text-muted">{m.itemName}</span>
                    {m.backflush && (
                      <Badge tone="info" className="ml-2">
                        Backflush
                      </Badge>
                    )}
                    {m.requiredQty === null && (
                      <Badge tone="warning" className="ml-2">
                        Not on BOM
                      </Badge>
                    )}
                  </Td>
                  <Td className="tabular text-right">{m.requiredQty === null ? '—' : `${formatQty(m.requiredQty)} ${m.uom}`}</Td>
                  <Td className={`tabular text-right ${m.requiredQty !== null && Number(m.issuedQty) > Number(m.requiredQty) ? 'text-warning' : ''}`}>
                    {formatQty(m.issuedQty)} {m.uom}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Operations" description={released ? <Link className="text-accent hover:underline" href="/app/manufacturing/shop-floor">Record time on the shop floor →</Link> : undefined} />
          <Table>
            <thead>
              <tr>
                <Th>Op</Th>
                <Th>Work centre</Th>
                <Th className="text-right">Planned</Th>
                <Th className="text-right">Actual</Th>
                <Th className="text-right">Good</Th>
              </tr>
            </thead>
            <tbody>
              {wo.operations.map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <Td>
                    <span className="font-mono text-[13px]">{o.seq}</span> {o.name}
                  </Td>
                  {o.outsourced ? (
                    <OutsourcedCells
                      op={o}
                      state={jw.data?.operations.find((x) => x.operationId === o.id)}
                      orders={jw.data?.orders.filter((x) => x.operationId === o.id) ?? []}
                      canAct={released && ws.can('manufacturing.job_work.submit')}
                      onSend={() => setPieces({ kind: 'send', op: o })}
                      onReceive={() => setPieces({ kind: 'receive', op: o })}
                    />
                  ) : (
                    <>
                      <Td className="text-[13px]">
                        {o.workCentre} <span className="text-subtle">· {formatMoney(o.hourlyRate)}/h</span>
                      </Td>
                      <Td className="tabular text-right text-[13px]">{formatMinutes(o.plannedMinutes)}</Td>
                      <Td className="tabular text-right text-[13px]">{formatMinutes(o.actualMinutes)}</Td>
                      <Td className="tabular text-right text-[13px]">{formatQty(o.goodQty)}</Td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      {wo.jobCards.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Job cards" />
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Op</Th>
                  <Th>Operator</Th>
                  <Th>Machine</Th>
                  <Th className="text-right">Time</Th>
                  <Th className="text-right">Good / rework / scrap</Th>
                  <Th className="text-right">Absorbed</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {wo.jobCards.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <Td className="font-mono text-[13px]">{c.seq}</Td>
                    <Td className="text-[13px]">{c.operator}</Td>
                    <Td className="font-mono text-[13px]">{c.machine ?? '—'}</Td>
                    <Td className="tabular text-right text-[13px]">{formatMinutes(c.minutes)}</Td>
                    <Td className="tabular text-right text-[13px]">{c.status === 'completed' ? `${formatQty(c.goodQty)} / ${formatQty(c.reworkQty)} / ${formatQty(c.scrapQty)}` : '—'}</Td>
                    <Td className="tabular text-right text-[13px]">{c.value ? formatMoney(c.value) : '—'}</Td>
                    <Td>
                      <Badge tone={CARD_STATUS[c.status].tone} dot>
                        {CARD_STATUS[c.status].label}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      {released && c.status !== 'cancelled' && ws.can('manufacturing.work_order.cancel') && (
                        <Button size="sm" variant="ghost" onClick={() => setCancelling({ path: `/manufacturing/job-cards/${c.id}/cancel`, title: `Cancel job card (op ${c.seq})`, confirm: 'Cancel job card' })}>
                          Cancel
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader title="Material and output movements" description={`Output goes to ${wo.targetWarehouse}. Movements are reversed newest output first.`} />
        {wo.movements.length === 0 ? (
          <p className="p-4 text-muted">Nothing has moved yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Entry</Th>
                  <Th>Kind</Th>
                  <Th>Item · batch</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Value</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {wo.movements.map((mv) => (
                  <MovementRows
                    key={mv.id}
                    mv={mv}
                    canCancel={released && !mv.backflush && mv.status === 'submitted' && ws.can('manufacturing.work_order.cancel')}
                    onCancel={() => setCancelling({ path: `/manufacturing/work-orders/${wo.id}/movements/${mv.id}/cancel`, title: `Cancel ${MOVEMENT_LABEL[mv.purpose]!.toLowerCase()} ${mv.number}`, confirm: `Cancel ${MOVEMENT_LABEL[mv.purpose]!.toLowerCase()}` })}
                    onTrace={setTrace}
                  />
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      {dialog === 'issue' && <IssueDialog wo={wo} onDone={refresh} onClose={() => setDialog(null)} />}
      {dialog === 'return' && <ReturnDialog wo={wo} onDone={refresh} onClose={() => setDialog(null)} />}
      {dialog === 'output' && <OutputDialog wo={wo} remaining={remaining} onDone={refresh} onClose={() => setDialog(null)} />}
      {dialog === 'close' && (
        <ConfirmDialog
          wo={wo}
          path="close"
          title={`Close ${wo.number}`}
          description={Number(wo.cost.wip) ? `${formatMoney(wo.cost.wip)} is still in WIP and goes to manufacturing variance. Reopening reverses it.` : 'Nothing is left in WIP; no variance will be booked.'}
          confirm="Close work order"
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'reopen' && <ConfirmDialog wo={wo} path="reopen" title={`Reopen ${wo.number}`} description="Reverses the close variance so you can record more, or cancel outputs." confirm="Reopen" reason onDone={refresh} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <ConfirmDialog wo={wo} path="cancel" title="Cancel work order" description="Only possible while nothing has been posted against it." confirm="Cancel work order" reason onDone={refresh} onClose={() => setDialog(null)} />}
      {cancelling && <CancelDialog {...cancelling} onDone={(d) => { if (d && typeof d === 'object' && 'movements' in d) refresh(d as WorkOrderDetail); }} onClose={() => setCancelling(null)} />}
      {trace && <TraceDialog batchId={trace} onClose={() => setTrace(null)} />}
      {pieces && (
        <PiecesDialog
          wo={wo}
          kind={pieces.kind}
          op={pieces.op}
          state={jw.data?.operations.find((x) => x.operationId === pieces.op.id)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ['work-order-job-work', wo.id] });
            void qc.invalidateQueries({ queryKey: ['work-order', wo.id] });
          }}
          onClose={() => setPieces(null)}
        />
      )}
    </>
  );
}

/** An outsourced operation (decision 047): pieces go to a job worker on a challan and come back; output waits for them. */
function OutsourcedCells({
  op,
  state,
  orders,
  canAct,
  onSend,
  onReceive,
}: {
  op: WorkOrderDetail['operations'][number];
  state: OutsourcedState['operations'][number] | undefined;
  orders: OutsourcedState['orders'];
  canAct: boolean;
  onSend: () => void;
  onReceive: () => void;
}) {
  return (
    <>
      <Td className="text-[13px]">
        <Badge tone="info">Job worker</Badge> {op.supplier ?? <span className="text-subtle">choose when sending</span>}
        {orders.map((o) => (
          <Link key={o.id} className="block font-mono text-[12px] text-muted hover:text-accent" href={`/app/manufacturing/job-work/${o.id}`}>
            {o.number} · {o.supplier}
          </Link>
        ))}
      </Td>
      <Td className="tabular text-right text-[13px]" colSpan={2}>
        {state && Number(state.atVendor) > 0 ? <span>{formatQty(state.atVendor)} with job worker</span> : <span className="text-subtle">—</span>}
        {canAct && (
          <span className="mt-1 flex justify-end gap-1">
            <Button size="sm" variant="secondary" onClick={onSend}>
              Send…
            </Button>
            {state && Number(state.atVendor) > 0 && (
              <Button size="sm" variant="secondary" onClick={onReceive}>
                Receive…
              </Button>
            )}
          </span>
        )}
      </Td>
      <Td className="tabular text-right text-[13px]">{formatQty(state?.good ?? '0')}</Td>
    </>
  );
}

function PiecesDialog({ wo, kind, op, state, onDone, onClose }: { wo: WorkOrderDetail; kind: 'send' | 'receive'; op: WorkOrderDetail['operations'][number]; state: OutsourcedState['operations'][number] | undefined; onDone: () => void; onClose: () => void }) {
  const ws = useWorkspace();
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const left = Math.max(0, Number(wo.plannedQty) - Number(state?.sent ?? 0));
  const [form, setForm] = useState({ postingDate: today, qty: kind === 'send' ? String(left || '') : (state?.atVendor ? String(Number(state.atVendor)) : ''), rejectedQty: '', ewayBillNo: '', vehicleNo: '', jobWorkerChallanNo: '' });
  const m = useMutation({
    mutationFn: () =>
      api(`/manufacturing/work-orders/${wo.id}/operations/${op.id}/${kind}`, {
        method: 'POST',
        scope: ws.scope,
        body:
          kind === 'send'
            ? { postingDate: form.postingDate, qty: form.qty, ewayBillNo: form.ewayBillNo || null, vehicleNo: form.vehicleNo || null }
            : { postingDate: form.postingDate, qty: form.qty || '0', rejectedQty: form.rejectedQty || '0', jobWorkerChallanNo: form.jobWorkerChallanNo || null },
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return kind === 'send' ? (
    <FormDialog title={`Send to job worker · op ${op.seq} ${op.name}`} description={`A delivery challan to ${op.supplier ?? 'the job worker'} for pieces of ${wo.number}. They stay in WIP; no stock or GL moves.`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Issue challan">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" error={err.postingDate}>
          {(f) => <Input {...f} type="date" value={form.postingDate} onChange={set('postingDate')} required />}
        </Field>
        <Field label={`Pieces (${wo.uom})`} error={err.qty ?? err['lines.0.qty']} hint={`${formatQty(String(left))} not yet sent`}>
          {(f) => <Input {...f} inputMode="decimal" value={form.qty} onChange={set('qty')} required autoFocus />}
        </Field>
        <Field label="E-way bill no." error={err.ewayBillNo} hint="12 digits, if generated">
          {(f) => <Input {...f} inputMode="numeric" value={form.ewayBillNo} onChange={set('ewayBillNo')} />}
        </Field>
        <Field label="Vehicle no." error={err.vehicleNo}>
          {(f) => <Input {...f} value={form.vehicleNo} onChange={(e) => setForm({ ...form, vehicleNo: e.target.value.toUpperCase() })} />}
        </Field>
      </div>
    </FormDialog>
  ) : (
    <FormDialog title={`Receive from job worker · op ${op.seq} ${op.name}`} description="Good pieces count toward output; rejected pieces stay in this work order's cost." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Receive">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" error={err.postingDate}>
          {(f) => <Input {...f} type="date" value={form.postingDate} onChange={set('postingDate')} required />}
        </Field>
        <Field label="Their challan no." error={err.jobWorkerChallanNo}>
          {(f) => <Input {...f} value={form.jobWorkerChallanNo} onChange={set('jobWorkerChallanNo')} />}
        </Field>
        <Field label="Good pieces" error={err.qty ?? err['received.0.qty']} hint={`${formatQty(state?.atVendor ?? '0')} with the job worker`}>
          {(f) => <Input {...f} inputMode="decimal" value={form.qty} onChange={set('qty')} autoFocus />}
        </Field>
        <Field label="Rejected at the job worker" error={err.rejectedQty}>
          {(f) => <Input {...f} inputMode="decimal" value={form.rejectedQty} onChange={set('rejectedQty')} />}
        </Field>
      </div>
    </FormDialog>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Card className="p-3">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={`tabular mt-1 ${strong ? 'text-lg font-semibold' : 'text-base'}`}>{value}</p>
    </Card>
  );
}

function MovementRows({ mv, canCancel, onCancel, onTrace }: { mv: Movement; canCancel: boolean; onCancel: () => void; onTrace: (batchId: string) => void }) {
  const off = mv.status === 'cancelled' ? 'text-subtle line-through' : '';
  return (
    <>
      {mv.lines.map((l, i) => (
        <tr key={i} className="border-t border-line">
          {i === 0 && (
            <>
              <Td rowSpan={mv.lines.length} className="align-top font-mono text-[12px] whitespace-nowrap">
                {mv.number}
                <span className="block text-subtle">{formatDate(mv.postingDate)}</span>
              </Td>
              <Td rowSpan={mv.lines.length} className="align-top text-[13px]">
                {MOVEMENT_LABEL[mv.purpose]}
                {mv.backflush && <span className="block text-[12px] text-subtle">backflush</span>}
                {mv.status === 'cancelled' && (
                  <Badge tone="danger" className="mt-1">
                    Cancelled
                  </Badge>
                )}
              </Td>
            </>
          )}
          <Td className={`text-[13px] ${off}`}>
            <span className="font-mono">{l.itemCode}</span>
            {l.batchNo && (
              <>
                {' · '}
                {mv.purpose === 'production_output' && mv.status === 'submitted' && l.batchId ? (
                  <button type="button" className="font-mono text-accent hover:underline" onClick={() => onTrace(l.batchId!)}>
                    {l.batchNo}
                  </button>
                ) : (
                  <span className="font-mono">{l.batchNo}</span>
                )}
                {l.heatNo && l.heatNo !== l.batchNo && <span className="text-subtle"> heat {l.heatNo}</span>}
              </>
            )}
          </Td>
          <Td className={`tabular text-right text-[13px] ${off}`}>{formatQty(l.qty)}</Td>
          <Td className={`tabular text-right text-[13px] ${off}`}>{formatMoney(l.value)}</Td>
          {i === 0 && (
            <Td rowSpan={mv.lines.length} className="text-right align-top">
              {canCancel && (
                <Button size="sm" variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
              )}
            </Td>
          )}
        </tr>
      ))}
    </>
  );
}

/** Suggests batches oldest first for what is still required; the user can change any quantity. */
function IssueDialog({ wo, onDone, onClose }: { wo: WorkOrderDetail; onDone: (d: WorkOrderDetail) => void; onClose: () => void }) {
  const ws = useWorkspace();
  const avail = useQuery({ queryKey: ['wo-availability', wo.id], queryFn: () => api<Availability[]>(`/manufacturing/work-orders/${wo.id}/availability`, { scope: ws.scope }), staleTime: 0 });
  const manual = wo.materials.filter((m) => !m.backflush && m.requiredQty !== null);
  const suggestion = useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of manual) {
      let need = Math.max(0, Number(m.requiredQty) - Number(m.issuedQty));
      for (const a of (avail.data ?? []).filter((x) => x.itemId === m.itemId)) {
        const take = Math.min(need, Number(a.qty));
        if (take > 0) out[`${a.warehouseId}:${a.batchId ?? ''}`] = String(Number(take.toFixed(6)));
        need -= take;
      }
    }
    return out;
  }, [avail.data, manual]);
  const [qty, setQty] = useState<Record<string, string> | null>(null);
  const [cutting, setCutting] = useState<Availability | null>(null);
  const values = qty ?? suggestion;
  const m = useMutation({
    mutationFn: () =>
      api<WorkOrderDetail>(`/manufacturing/work-orders/${wo.id}/issue`, {
        method: 'POST',
        scope: ws.scope,
        body: {
          lines: (avail.data ?? [])
            .filter((a) => Number(values[`${a.warehouseId}:${a.batchId ?? ''}`] || 0) > 0)
            .map((a) => ({ itemId: a.itemId, batchId: a.batchId, warehouseId: a.warehouseId, qty: values[`${a.warehouseId}:${a.batchId ?? ''}`] })),
        },
      }),
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  return (
    <>
    <FormDialog title="Issue material" description="Batches are suggested oldest first for what is still required. Change any quantity, or pick a specific heat." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Issue" wide>
      {manual.length === 0 && <Alert>Every material on this order is backflushed on output.</Alert>}
      {manual.map((mat) => {
        const rows = (avail.data ?? []).filter((a) => a.itemId === mat.itemId);
        return (
          <div key={mat.itemId}>
            <p className="mb-1 text-[13px] font-medium">
              <span className="font-mono">{mat.itemCode}</span> {mat.itemName} <span className="text-muted">· still to issue {formatQty(String(Math.max(0, Number(mat.requiredQty) - Number(mat.issuedQty))))} {mat.uom}</span>
            </p>
            {rows.length === 0 ? (
              <p className="text-[13px] text-warning">No stock available for issue.</p>
            ) : (
              <Table>
                <tbody>
                  {rows.map((a) => {
                    const key = `${a.warehouseId}:${a.batchId ?? ''}`;
                    return (
                      <tr key={key} className="border-t border-line">
                        <Td className="text-[13px]">
                          {a.batchNo ? <span className="font-mono">{a.batchNo}</span> : 'Unbatched'}
                          {a.kind === 'remnant' && (
                            <Badge tone="info" className="ml-1">
                              Remnant {a.lengthMm ? `${formatQty(a.lengthMm, 0)} mm` : ''}
                            </Badge>
                          )}
                          {a.heatNo && a.heatNo !== a.batchNo && <span className="text-subtle"> heat {a.heatNo}</span>}
                          <span className="text-subtle"> · {a.warehouse}</span>
                          {a.expiryDate && <span className="text-subtle"> · exp {formatDate(a.expiryDate)}</span>}
                        </Td>
                        <Td className="tabular text-right text-[13px] text-muted whitespace-nowrap">
                          {formatQty(a.qty)} available
                          {mat.tracking === 'batch' && a.batchId && ws.can('inventory.stock_entry.submit') && (
                            <Button size="sm" variant="ghost" className="ml-1" onClick={() => setCutting(a)}>
                              Cut…
                            </Button>
                          )}
                        </Td>
                        <Td className="w-36">
                          <Input aria-label={`Issue ${mat.itemCode} ${a.batchNo ?? ''}`} inputMode="decimal" className="text-right" value={values[key] ?? ''} onChange={(e) => setQty({ ...values, [key]: e.target.value })} />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </div>
        );
      })}
    </FormDialog>
    {/* A sibling, not a child: a form inside the issue form would submit the page. */}
    {cutting && (
      <CutDialog
        stock={cutting}
        itemCode={manual.find((x) => x.itemId === cutting.itemId)?.itemCode ?? ''}
        onDone={() => {
          setQty(null);
          void avail.refetch();
        }}
        onClose={() => setCutting(null)}
      />
    )}
    </>
  );
}

function ReturnDialog({ wo, onDone, onClose }: { wo: WorkOrderDetail; onDone: (d: WorkOrderDetail) => void; onClose: () => void }) {
  const ws = useWorkspace();
  // Net issued per item and batch, from the movements.
  const net = useMemo(() => {
    const map = new Map<string, { itemId: string; itemCode: string; batchId: string | null; batchNo: string | null; qty: number }>();
    for (const mv of wo.movements.filter((x) => x.status === 'submitted' && x.purpose !== 'production_output'))
      for (const l of mv.lines) {
        const key = `${l.itemId}:${l.batchId ?? ''}`;
        const cur = map.get(key) ?? { itemId: l.itemId, itemCode: l.itemCode, batchId: l.batchId, batchNo: l.batchNo, qty: 0 };
        cur.qty += (mv.purpose === 'production_issue' ? 1 : -1) * Number(l.qty);
        map.set(key, cur);
      }
    return [...map.entries()].filter(([, v]) => v.qty > 0.0000005);
  }, [wo.movements]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () =>
      api<WorkOrderDetail>(`/manufacturing/work-orders/${wo.id}/return`, {
        method: 'POST',
        scope: ws.scope,
        body: { lines: net.filter(([k]) => Number(qty[k] || 0) > 0).map(([k, v]) => ({ itemId: v.itemId, batchId: v.batchId, qty: qty[k] })) },
      }),
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  return (
    <FormDialog title="Return material to stores" description={`Unused material goes back to ${wo.sourceWarehouse} with its batch, at the cost it was issued at.`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Return">
      {net.length === 0 ? (
        <Alert>Nothing has been issued to this order.</Alert>
      ) : (
        <Table>
          <tbody>
            {net.map(([k, v]) => (
              <tr key={k} className="border-t border-line">
                <Td className="text-[13px]">
                  <span className="font-mono">{v.itemCode}</span>
                  {v.batchNo && <span className="font-mono"> · {v.batchNo}</span>}
                </Td>
                <Td className="tabular text-right text-[13px] text-muted">{formatQty(String(v.qty))} issued</Td>
                <Td className="w-36">
                  <Input aria-label={`Return ${v.itemCode} ${v.batchNo ?? ''}`} inputMode="decimal" className="text-right" value={qty[k] ?? ''} onChange={(e) => setQty({ ...qty, [k]: e.target.value })} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </FormDialog>
  );
}

function OutputDialog({ wo, remaining, onDone, onClose }: { wo: WorkOrderDetail; remaining: number; onDone: (d: WorkOrderDetail) => void; onClose: () => void }) {
  const ws = useWorkspace();
  const [qty, setQty] = useState(remaining ? String(remaining) : '');
  const [batchNo, setBatchNo] = useState('');
  const flush = wo.materials.filter((m) => m.backflush);
  const serial = wo.tracking === 'serial';
  // As-built (decision 046): serial components issued to this order and not yet built into an assembly.
  const serialMats = serial ? wo.materials.filter((x) => x.tracking === 'serial' && x.qtyPerUnit) : [];
  const built = new Set(wo.asBuilt.map((b) => b.componentBatchId));
  const freeSerials = useMemo(() => {
    const net = new Map<string, { itemId: string; batchId: string; batchNo: string; n: number }>();
    for (const mv of wo.movements.filter((x) => x.status === 'submitted' && x.purpose !== 'production_output'))
      for (const l of mv.lines)
        if (l.batchId && serialMats.some((x) => x.itemId === l.itemId)) {
          const cur = net.get(l.batchId) ?? { itemId: l.itemId, batchId: l.batchId, batchNo: l.batchNo ?? '', n: 0 };
          cur.n += mv.purpose === 'production_issue' ? 1 : -1;
          net.set(l.batchId, cur);
        }
    return [...net.values()].filter((x) => x.n > 0 && !built.has(x.batchId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo.movements, wo.asBuilt]);
  // As-built pickers are shown for up to MAX_ASSEMBLIES units; a larger serial output is refused here rather than sent with fewer assemblies than units.
  const MAX_ASSEMBLIES = 200;
  const units = serial && /^\d+$/.test(qty) ? Number(qty) : 0;
  const tooMany = serialMats.length > 0 && units > MAX_ASSEMBLIES;
  const slots = serialMats.flatMap((mat) => Array.from({ length: Number(mat.qtyPerUnit) }, (_, k) => ({ mat, k })));
  const [picked, setPicked] = useState<Record<string, string>>({});
  const asBuilt = serialMats.length ? Array.from({ length: units }, (_, u) => slots.map((s) => picked[`${u}:${s.mat.itemId}:${s.k}`]).filter((x): x is string => !!x)) : undefined;
  const m = useMutation({
    mutationFn: () => {
      if (tooMany) throw new Error(`Record at most ${MAX_ASSEMBLIES} serial assemblies at a time.`);
      if (asBuilt?.some((a) => a.length < slots.length)) throw new Error('Choose every component serial for each assembly.');
      return api<WorkOrderDetail>(`/manufacturing/work-orders/${wo.id}/output`, { method: 'POST', scope: ws.scope, body: { qty, batchNo: batchNo || null, ...(asBuilt ? { asBuilt } : {}) } });
    },
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const final = Number(qty) >= remaining;
  return (
    <FormDialog title="Record output" description={`Finished ${wo.itemCode} into ${wo.targetWarehouse}, valued at actual cost from WIP.`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Receive output">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Quantity (${wo.uom})`} error={err.qty} hint={`${formatQty(String(remaining))} still to make`}>
          {(f) => <Input {...f} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} required autoFocus />}
        </Field>
        {wo.tracking === 'batch' && (
          <Field label="Lot / batch number" error={err.batchNo} hint="Leave empty to use the work order number">
            {(f) => <Input {...f} value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder={wo.number ?? ''} />}
          </Field>
        )}
        {serial && <p className="self-end pb-2 text-[13px] text-muted">One serial number is generated per unit, each with an equal share of the cost.</p>}
      </div>
      {tooMany && <Alert tone="danger">{`Record at most ${MAX_ASSEMBLIES} serial assemblies at a time; split this output.`}</Alert>}
      {serialMats.length > 0 && units > 0 && !tooMany && (
        <div>
          <p className="mb-1 text-[13px] font-medium">As-built: component serials in each assembly</p>
          <div className="space-y-2">
            {Array.from({ length: units }, (_, u) => (
              <div key={u} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
                <span className="w-24 text-[13px] text-muted">Assembly {u + 1}</span>
                {slots.map((sl) => {
                  const key = `${u}:${sl.mat.itemId}:${sl.k}`;
                  const taken = new Set(Object.entries(picked).filter(([k2]) => k2 !== key).map(([, v]) => v));
                  return (
                    <select
                      key={key}
                      aria-label={`Assembly ${u + 1} ${sl.mat.itemCode} ${sl.k + 1}`}
                      className="h-8 rounded-lg border border-line bg-surface px-2 font-mono text-[13px]"
                      value={picked[key] ?? ''}
                      onChange={(e) => setPicked({ ...picked, [key]: e.target.value })}
                    >
                      <option value="">{sl.mat.itemCode}…</option>
                      {freeSerials
                        .filter((f) => f.itemId === sl.mat.itemId && (!taken.has(f.batchId) || picked[key] === f.batchId))
                        .map((f) => (
                          <option key={f.batchId} value={f.batchId}>
                            {f.batchNo}
                          </option>
                        ))}
                    </select>
                  );
                })}
              </div>
            ))}
          </div>
          {freeSerials.length === 0 && <p className="mt-1 text-[13px] text-warning">Issue the component serials to this work order first.</p>}
        </div>
      )}
      {flush.length > 0 && <p className="text-[13px] text-muted">Backflushed now: {flush.map((f) => f.itemCode).join(', ')}.</p>}
      <Alert>
        {final
          ? `This output completes the order, so it takes everything in WIP${Number(wo.cost.wip) ? ` (${formatMoney(wo.cost.wip)} plus any backflush)` : ''}.`
          : `It takes its share of WIP for the ${formatQty(String(remaining))} still to make.`}
      </Alert>
    </FormDialog>
  );
}

function ConfirmDialog({ wo, path, title, description, confirm, reason: needsReason, onDone, onClose }: { wo: WorkOrderDetail; path: string; title: string; description: string; confirm: string; reason?: boolean; onDone: (d: WorkOrderDetail) => void; onClose: () => void }) {
  const ws = useWorkspace();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api<WorkOrderDetail>(`/manufacturing/work-orders/${wo.id}/${path}`, { method: 'POST', scope: ws.scope, body: needsReason ? { reason } : {} }),
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  return (
    <FormDialog title={title} description={description} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel={confirm}>
      {needsReason && (
        <Field label="Reason (recorded in the audit log)" error={fieldErrors(m.error).reason}>
          {(f) => <Input {...f} value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required autoFocus />}
        </Field>
      )}
    </FormDialog>
  );
}

function CancelDialog({ path, title, confirm, onDone, onClose }: { path: string; title: string; confirm: string; onDone: (d: unknown) => void; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api<unknown>(path, { method: 'POST', body: { reason }, scope: ws.scope }),
    onSuccess: (d) => {
      onDone(d);
      void qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <FormDialog title={title} description="Posts exact reversals: stock, WIP and (when books are active) the GL." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel={confirm}>
      <Field label="Reason (recorded in the audit log)" error={fieldErrors(m.error).reason}>
        {(f) => <Input {...f} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required autoFocus />}
      </Field>
    </FormDialog>
  );
}

/** Cut part of a bar into a remnant piece (decision 046), from the issue screen. */
function CutDialog({ stock, itemCode, onDone, onClose }: { stock: Availability; itemCode: string; onDone: () => void; onClose: () => void }) {
  const ws = useWorkspace();
  const [form, setForm] = useState({ qty: '', lengthMm: '', remnantNo: '' });
  const m = useMutation({
    mutationFn: () =>
      api<{ remnantNo: string }>('/stock/cuts', {
        method: 'POST',
        scope: ws.scope,
        body: { postingDate: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), itemId: stock.itemId, warehouseId: stock.warehouseId, batchId: stock.batchId, qty: form.qty, lengthMm: form.lengthMm, remnantNo: form.remnantNo || null },
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Cut ${itemCode} ${stock.batchNo ?? ''}`} description={`Weigh the piece you set aside. It becomes a remnant of heat ${stock.heatNo ?? stock.batchNo}, valued by weight at its FIFO cost.`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Cut remnant">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Remnant weight" error={err.qty} hint={`${formatQty(stock.qty)} on hand`}>
          {(f) => <Input {...f} inputMode="decimal" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} required autoFocus />}
        </Field>
        <Field label="Length (mm)" error={err.lengthMm}>
          {(f) => <Input {...f} inputMode="decimal" value={form.lengthMm} onChange={(e) => setForm({ ...form, lengthMm: e.target.value })} required />}
        </Field>
        <Field label="Remnant no." hint="Empty = automatic" error={err.remnantNo}>
          {(f) => <Input {...f} value={form.remnantNo} onChange={(e) => setForm({ ...form, remnantNo: e.target.value })} className="font-mono" />}
        </Field>
      </div>
    </FormDialog>
  );
}

function TraceDialog({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['trace', batchId], queryFn: () => api<Trace>(`/manufacturing/trace/${batchId}`, { scope: ws.scope }) });
  const t = q.data;
  return (
    <Dialog open onClose={onClose} title={t ? `Trace ${t.batch.itemCode} · ${t.batch.batchNo}` : 'Trace'} description="Backward: what this lot was made from. Forward: where it was used." footer={
        <>
          <Link className="mr-auto text-[13px] text-accent hover:underline" href={`/app/manufacturing/genealogy?batch=${batchId}`}>
            Open full genealogy →
          </Link>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }>
      {q.error instanceof ApiError && <Alert tone="danger">{q.error.message}</Alert>}
      {t && (
        <div className="space-y-4 text-[13px]">
          <section>
            <h3 className="mb-1 font-medium">Made by</h3>
            {t.backward.workOrders.length === 0 ? <p className="text-muted">Not made by a work order (purchased or received).</p> : t.backward.workOrders.map((w) => <p key={w.workOrderId} className="font-mono">{w.number}</p>)}
            {t.backward.consumed.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {t.backward.consumed.map((c, i) => (
                  <li key={i}>
                    <span className="font-mono">{c.itemCode}</span> {c.batchNo ? <span className="font-mono">· {c.batchNo}</span> : null}
                    {c.heatNo && c.heatNo !== c.batchNo ? <span className="text-subtle"> heat {c.heatNo}</span> : null} — {formatQty(c.qty)}
                    <span className="text-subtle"> into {c.number}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-1 font-medium">Used in</h3>
            {t.forward.workOrders.length === 0 ? (
              <p className="text-muted">Not issued to any work order yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {t.forward.produced.map((p, i) => (
                  <li key={i}>
                    <span className="font-mono">{p.number}</span> → <span className="font-mono">{p.itemCode}</span> {p.batchNo && <span className="font-mono">· {p.batchNo}</span>} — {formatQty(p.qty)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
