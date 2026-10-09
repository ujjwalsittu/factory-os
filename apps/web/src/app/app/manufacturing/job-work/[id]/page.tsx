'use client';
import { Alert, Badge, Button, buttonClass, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney, formatQty } from '@/lib/format';
import { DEADLINE, type JobWorkDetail, JW_STATUS } from '@/lib/job-work';
import type { Batch, Warehouse } from '@/lib/types';

const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export default function JobWorkOrderPage() {
  return (
    <EntityGate what="job work">
      <OrderView />
    </EntityGate>
  );
}

type Dialog = { kind: 'send' } | { kind: 'receive' } | { kind: 'reason'; title: string; path: string; confirm: string; description: string } | null;

function OrderView() {
  const ws = useWorkspace();
  const { id } = useParams<{ id: string }>();
  const [dialog, setDialog] = useState<Dialog>(null);
  const q = useQuery({ queryKey: ['job-work-order', ws.entityId, id], queryFn: () => api<JobWorkDetail>(`/manufacturing/job-work/${id}`, { scope: ws.scope }) });
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  const o = q.data;
  if (!o) return <p className="text-muted">Loading…</p>;
  const canSubmit = ws.can('manufacturing.job_work.submit');
  const canCancel = ws.can('manufacturing.job_work.cancel');
  const conversion = o.kind === 'conversion';
  const live = (o.status === 'draft' || o.status === 'open');
  return (
    <>
      <PageHeader
        title={`${o.number} · ${o.supplier}`}
        description={conversion ? `Subcontract: ${formatQty(o.targetQty)} ${o.target?.code} ${o.target?.name}${o.natureOfWork ? ` — ${o.natureOfWork}` : ''}` : `Outsourced operation ${o.operation} of work order ${o.workOrder}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={JW_STATUS[o.status].tone} dot>
              {JW_STATUS[o.status].label}
            </Badge>
            {conversion && live && canSubmit && <Button onClick={() => setDialog({ kind: 'send' })}>Send material</Button>}
            {conversion && o.status === 'open' && Number(o.atVendor) > 0 && canSubmit && (
              <Button variant="secondary" onClick={() => setDialog({ kind: 'receive' })}>
                Receive back
              </Button>
            )}
            {!conversion && o.workOrderId && (
              <Link className={buttonClass('secondary')} href={`/app/manufacturing/work-orders/${o.workOrderId}`}>
                Open work order
              </Link>
            )}
            {o.status === 'open' && canSubmit && (
              <Button variant="ghost" onClick={() => setDialog({ kind: 'reason', title: 'Close order', path: `/manufacturing/job-work/${id}/close`, confirm: 'Close order', description: 'Close once nothing is left at the job worker, or the rest is recorded as a deemed supply.' })}>
                Close
              </Button>
            )}
            {o.status === 'draft' && canCancel && (
              <Button variant="ghost" onClick={() => setDialog({ kind: 'reason', title: 'Cancel order', path: `/manufacturing/job-work/${id}/cancel`, confirm: 'Cancel order', description: 'Nothing has been sent on this order.' })}>
                Cancel
              </Button>
            )}
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="At the job worker" value={Number(o.atVendor) ? formatQty(o.atVendor) : '—'} />
        <Stat label="Received back" value={formatQty(o.receipts.filter((r) => r.status === 'submitted').reduce((s, r) => s + r.lines.reduce((t, l) => t + Number(l.qty), 0), 0).toString())} />
        <Stat label="Processing charged" value={Number(o.charged) ? formatMoney(o.charged) : '—'} hint="Purchase invoices that charge a receipt of this order" />
      </div>
      {o.closeReason && <Alert className="mt-4">{o.status === 'closed' ? 'Closed' : 'Cancelled'}: {o.closeReason}</Alert>}

      <Card className="mt-4">
        <CardHeader title="Delivery challans" description="Goods sent under Section 143. Inputs come back within one year, capital goods within three; tools are exempt." />
        {o.challans.length === 0 ? (
          <p className="p-4 text-[13px] text-muted">Nothing sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Challan</Th>
                  <Th>Goods</Th>
                  <Th className="text-right">Sent</Th>
                  <Th className="text-right">Still there</Th>
                  <Th className="text-right">Value</Th>
                  <Th>Return by</Th>
                </tr>
              </thead>
              <tbody>
                {o.challans.flatMap((c) =>
                  c.lines.map((l, k) => (
                    <tr key={l.id} className="border-t border-line align-top">
                      <Td className="text-[13px] whitespace-nowrap">
                        {k === 0 && (
                          <>
                            <Link className="font-mono font-medium hover:text-accent" href={`/app/manufacturing/job-work/challans/${c.id}`}>
                              {c.number}
                            </Link>
                            <span className="block text-subtle">{formatDate(c.postingDate)}</span>
                            {c.status === 'cancelled' && <Badge tone="danger">Cancelled</Badge>}
                            {c.interstate && !c.ewayBillNo && c.status === 'submitted' && <span className="block text-[12px] text-warning">Interstate · no e-way bill no.</span>}
                            {c.status === 'submitted' && canCancel && c.lines.every((x) => Number(x.open ?? 0) === Number(x.qty)) && (
                              <button type="button" className="block text-[12px] text-muted hover:text-danger" onClick={() => setDialog({ kind: 'reason', title: `Cancel challan ${c.number}`, path: `/manufacturing/job-work/challans/${c.id}/cancel`, confirm: 'Cancel challan', description: 'Only while nothing has come back against it. Stock returns to where it left from.' })}>
                                Cancel…
                              </button>
                            )}
                          </>
                        )}
                      </Td>
                      <Td className="text-[13px]">
                        <span className="font-mono">{l.itemCode}</span> {l.itemName}
                        {l.batchNo && <span className="block font-mono text-subtle">{l.batchNo}</span>}
                        <span className="block text-[12px] text-subtle">{l.goodsType === 'capital_good' ? 'Capital goods' : 'Inputs'}</span>
                      </Td>
                      <Td className="tabular text-right">
                        {formatQty(l.qty)} {l.uom}
                      </Td>
                      <Td className="tabular text-right">{Number(l.open) ? formatQty(l.open) : '—'}</Td>
                      <Td className="tabular text-right">{formatMoney(l.value)}</Td>
                      <Td className="text-[13px] whitespace-nowrap">
                        {l.extendedDueBy ?? l.dueBy ? formatDate((l.extendedDueBy ?? l.dueBy)!) : 'No limit'}
                        {l.extendedDueBy && <span className="block text-[12px] text-subtle">extended ({l.extensionRef})</span>}
                        {l.deemedSupplyInvoiceNo && <span className="block text-[12px] text-subtle">deemed supply {l.deemedSupplyInvoiceNo}</span>}
                        {l.deadline && l.deadline !== 'open' && <Badge tone={DEADLINE[l.deadline].tone}>{DEADLINE[l.deadline].label}</Badge>}
                      </Td>
                    </tr>
                  )),
                )}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Received back" description="Each receipt discharges the oldest challan lines first; losses and scrap stay in the cost of what came back." />
        {o.receipts.length === 0 ? (
          <p className="p-4 text-[13px] text-muted">Nothing received yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {o.receipts.map((r) => (
              <div key={r.id} className="p-4 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{r.number}</span>
                  <span className="text-subtle">{formatDate(r.postingDate)}</span>
                  {r.jobWorkerChallanNo && <span className="text-muted">their challan {r.jobWorkerChallanNo}</span>}
                  {r.status === 'cancelled' && <Badge tone="danger">Cancelled</Badge>}
                  {r.status === 'submitted' && canCancel && (
                    <button type="button" className="text-[12px] text-muted hover:text-danger" onClick={() => setDialog({ kind: 'reason', title: `Cancel receipt ${r.number}`, path: `/manufacturing/job-work/receipts/${r.id}/cancel`, confirm: 'Cancel receipt', description: 'The goods go back to the job worker exactly. Cancel any purchase invoice that charges this receipt first.' })}>
                      Cancel…
                    </button>
                  )}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {r.lines.map((l) => (
                    <li key={l.id}>
                      <span className="font-mono">{l.itemCode}</span> {l.itemName} {l.batchNo && <span className="font-mono text-subtle">{l.batchNo}</span>} — {formatQty(l.qty)} good
                      {Number(l.rejectedQty) > 0 && <span className="text-danger">, {formatQty(l.rejectedQty)} rejected</span>}
                      {Number(l.value) > 0 && <span className="text-muted"> · {formatMoney(l.value)}</span>}
                      {l.warehouse && <span className="text-subtle"> into {l.warehouse}</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[12px] text-subtle">
                  Against {r.consumed.map((c) => `${c.challan} ${formatQty(c.qty)}${Number(c.lossQty) ? ` (loss ${formatQty(c.lossQty)})` : ''}${Number(c.scrapQty) ? ` (scrap ${formatQty(c.scrapQty)})` : ''}`).join(', ')}
                </p>
                {r.invoices.map((v) => (
                  <p key={v.invoiceId} className="text-[12px] text-muted">
                    Charged by{' '}
                    <Link className="hover:text-accent" href={`/app/buying/invoices/${v.invoiceId}`}>
                      {v.number ?? 'draft invoice'} ({v.supplierInvoiceNo})
                    </Link>{' '}
                    {formatMoney(v.taxableValue)}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>

      {dialog?.kind === 'send' && <SendDialog order={o} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'receive' && <ReceiveDialog order={o} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'reason' && <ReasonDialog {...dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-[12px] text-subtle">{hint}</p>}
    </Card>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['job-work-order'] });
    void qc.invalidateQueries({ queryKey: ['job-work'] });
  };
}

function ReasonDialog({ title, path, confirm, description, onClose }: { title: string; path: string; confirm: string; description: string; onClose: () => void }) {
  const ws = useWorkspace();
  const refresh = useRefresh();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(path, { method: 'POST', scope: ws.scope, body: { reason } }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <FormDialog title={title} description={description} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel={confirm}>
      <Field label="Reason (recorded in the audit log)" error={fieldErrors(m.error).reason}>
        {(f) => <Input {...f} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}
      </Field>
    </FormDialog>
  );
}

type SendLine = { itemId: string; batchId: string; qty: string; goodsType: '' | 'input' | 'capital_good' };

function SendDialog({ order, onClose }: { order: JobWorkDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const refresh = useRefresh();
  const [head, setHead] = useState({ postingDate: today(), fromWarehouseId: '', ewayBillNo: '', vehicleNo: '' });
  const [lines, setLines] = useState<SendLine[]>(order.materials.map((m) => ({ itemId: m.itemId, batchId: '', qty: m.qty, goodsType: '' })));
  const warehouses = useQuery({ queryKey: ['warehouses', ws.entityId], queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }) });
  const ours = (warehouses.data ?? []).filter((w) => w.isActive && w.availableForIssue && w.type !== 'customer_owned' && w.type !== 'at_job_worker');
  const m = useMutation({
    mutationFn: () =>
      api<{ warning: string | null }>(`/manufacturing/job-work/${order.id}/challans`, {
        method: 'POST',
        scope: ws.scope,
        body: {
          postingDate: head.postingDate,
          fromWarehouseId: head.fromWarehouseId,
          ewayBillNo: head.ewayBillNo || null,
          vehicleNo: head.vehicleNo || null,
          lines: lines.map((l) => ({ itemId: l.itemId, batchId: l.batchId || null, qty: l.qty, goodsType: l.goodsType || null })),
        },
      }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Send material (delivery challan)" description={`To ${order.supplier} for job work. The stock moves into "At ${order.supplier}" and stays ours, at its FIFO value.`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Issue challan" wide>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Date" error={err.postingDate}>
          {(f) => <Input {...f} type="date" value={head.postingDate} onChange={(e) => setHead({ ...head, postingDate: e.target.value })} required />}
        </Field>
        <Field label="From warehouse" error={err.fromWarehouseId}>
          {(f) => (
            <Select {...f} value={head.fromWarehouseId} onChange={(e) => setHead({ ...head, fromWarehouseId: e.target.value })} required>
              <option value="">Choose…</option>
              {ours.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="E-way bill no." error={err.ewayBillNo} hint="12 digits, if generated">
          {(f) => <Input {...f} inputMode="numeric" value={head.ewayBillNo} onChange={(e) => setHead({ ...head, ewayBillNo: e.target.value })} />}
        </Field>
        <Field label="Vehicle no." error={err.vehicleNo}>
          {(f) => <Input {...f} value={head.vehicleNo} onChange={(e) => setHead({ ...head, vehicleNo: e.target.value.toUpperCase() })} />}
        </Field>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => {
          const mat = order.materials.find((x) => x.itemId === l.itemId)!;
          return (
            <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_12rem_7rem_9rem_auto]">
              <p className="col-span-2 pb-2 text-[13px] sm:col-span-1">
                <span className="font-mono">{mat.itemCode}</span> {mat.itemName}
              </p>
              {mat.tracking !== 'none' ? (
                <BatchSelect label={`Batch ${mat.itemCode} ${i + 1}`} itemId={l.itemId} warehouseId={head.fromWarehouseId} value={l.batchId} onChange={(v) => setLines(lines.map((y, k) => (k === i ? { ...y, batchId: v } : y)))} error={err[`lines.${i}.batchId`]} />
              ) : (
                <span className="hidden sm:block" />
              )}
              <Field label={`Quantity (${mat.uom})`} error={err[`lines.${i}.qty`]}>
                {(f) => <Input {...f} aria-label={`Send ${mat.itemCode} ${i + 1}`} inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((y, k) => (k === i ? { ...y, qty: e.target.value } : y)))} />}
              </Field>
              <Field label="Goods type">
                {(f) => (
                  <Select {...f} value={l.goodsType} onChange={(e) => setLines(lines.map((y, k) => (k === i ? { ...y, goodsType: e.target.value as SendLine['goodsType'] } : y)))}>
                    <option value="">From the item</option>
                    <option value="input">Inputs (1 year)</option>
                    <option value="capital_good">Capital goods (3 years)</option>
                  </Select>
                )}
              </Field>
              <div className="flex gap-1">
                <Button variant="ghost" aria-label={`Another batch of ${mat.itemCode}`} onClick={() => setLines([...lines.slice(0, i + 1), { itemId: l.itemId, batchId: '', qty: '', goodsType: '' }, ...lines.slice(i + 1)])}>
                  <Plus className="size-4" />
                </Button>
                <Button variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, k) => k !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </FormDialog>
  );
}

function BatchSelect({ label, itemId, warehouseId, value, onChange, error }: { label: string; itemId: string; warehouseId: string; value: string; onChange: (v: string) => void; error?: string }) {
  const ws = useWorkspace();
  const q = useQuery({
    queryKey: ['batches', ws.entityId, itemId, warehouseId],
    queryFn: () => api<(Batch & { qty: string })[]>(`/batches?itemId=${itemId}&inStock=true&owner=company${warehouseId ? `&warehouseId=${warehouseId}` : ''}`, { scope: ws.scope }),
    enabled: !!warehouseId,
  });
  return (
    <Field label="Batch / heat" error={error}>
      {(f) => (
        <Select {...f} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} disabled={!warehouseId}>
          <option value="">{warehouseId ? 'Choose…' : 'Choose a warehouse first'}</option>
          {q.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.batchNo} ({formatQty(b.qty)})
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function ReceiveDialog({ order, onClose }: { order: JobWorkDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const refresh = useRefresh();
  // What is still at the job worker, by item and batch.
  const open = new Map<string, { itemId: string; batchId: string | null; label: string; uom: string; qty: number }>();
  for (const c of order.challans)
    for (const l of c.lines) {
      if (!Number(l.open)) continue;
      const key = `${l.itemId}:${l.batchId ?? ''}`;
      const cur = open.get(key) ?? { itemId: l.itemId, batchId: l.batchId, label: `${l.itemCode}${l.batchNo ? ` ${l.batchNo}` : ''}`, uom: l.uom, qty: 0 };
      cur.qty += Number(l.open);
      open.set(key, cur);
    }
  const received = order.receipts.filter((r) => r.status === 'submitted').reduce((s, r) => s + r.lines.reduce((t, l) => t + Number(l.qty), 0), 0);
  const [head, setHead] = useState({ postingDate: today(), jobWorkerChallanNo: '', jobWorkerChallanDate: '' });
  const [consumed, setConsumed] = useState([...open.values()].map((x) => ({ ...x, used: String(x.qty), lossQty: '', scrapQty: '' })));
  const [lines, setLines] = useState([{ qty: String(Math.max(Number(order.targetQty ?? 0) - received, 0) || ''), batchNo: '', warehouseId: order.targetWarehouseId ?? '' }]);
  const warehouses = useQuery({ queryKey: ['warehouses', ws.entityId], queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }) });
  const ours = (warehouses.data ?? []).filter((w) => w.isActive && w.type !== 'customer_owned' && w.type !== 'at_job_worker');
  const tracked = order.target?.tracking !== 'none';
  const m = useMutation({
    mutationFn: () =>
      api(`/manufacturing/job-work/${order.id}/receipts`, {
        method: 'POST',
        scope: ws.scope,
        body: {
          postingDate: head.postingDate,
          jobWorkerChallanNo: head.jobWorkerChallanNo || null,
          jobWorkerChallanDate: head.jobWorkerChallanDate || null,
          consumed: consumed.filter((c) => Number(c.used) > 0).map((c) => ({ itemId: c.itemId, batchId: c.batchId, qty: c.used, lossQty: c.lossQty || '0', scrapQty: c.scrapQty || '0' })),
          received: lines.map((l) => ({ qty: l.qty, batchNo: l.batchNo || null, warehouseId: l.warehouseId || null })),
        },
      }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Receive back from the job worker" description="What was used up there, and what came back. The goods carry the exact FIFO cost of the material used." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Receive" wide>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date" error={err.postingDate}>
          {(f) => <Input {...f} type="date" value={head.postingDate} onChange={(e) => setHead({ ...head, postingDate: e.target.value })} required />}
        </Field>
        <Field label="Their challan / invoice no." error={err.jobWorkerChallanNo}>
          {(f) => <Input {...f} value={head.jobWorkerChallanNo} onChange={(e) => setHead({ ...head, jobWorkerChallanNo: e.target.value })} />}
        </Field>
        <Field label="Their document date" error={err.jobWorkerChallanDate}>
          {(f) => <Input {...f} type="date" value={head.jobWorkerChallanDate} onChange={(e) => setHead({ ...head, jobWorkerChallanDate: e.target.value })} />}
        </Field>
      </div>
      <div>
        <p className="mb-1 text-[13px] font-medium">Used up at the job worker</p>
        <div className="space-y-2">
          {consumed.map((c, i) => (
            <div key={i} className="grid grid-cols-3 items-end gap-2 sm:grid-cols-[1fr_7rem_7rem_7rem]">
              <p className="col-span-3 pb-2 text-[13px] sm:col-span-1">
                <span className="font-mono">{c.label}</span> <span className="text-subtle">({formatQty(String(c.qty))} {c.uom} there)</span>
              </p>
              <Field label="Used" error={err[`consumed.${i}.qty`]}>
                {(f) => <Input {...f} aria-label={`Used ${c.label}`} inputMode="decimal" value={c.used} onChange={(e) => setConsumed(consumed.map((y, k) => (k === i ? { ...y, used: e.target.value } : y)))} />}
              </Field>
              <Field label="of which lost" error={err[`consumed.${i}.lossQty`]}>
                {(f) => <Input {...f} aria-label={`Lost ${c.label}`} inputMode="decimal" value={c.lossQty} onChange={(e) => setConsumed(consumed.map((y, k) => (k === i ? { ...y, lossQty: e.target.value } : y)))} />}
              </Field>
              <Field label="of which scrap" error={err[`consumed.${i}.scrapQty`]}>
                {(f) => <Input {...f} aria-label={`Scrap ${c.label}`} inputMode="decimal" value={c.scrapQty} onChange={(e) => setConsumed(consumed.map((y, k) => (k === i ? { ...y, scrapQty: e.target.value } : y)))} />}
              </Field>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[13px] font-medium">
            Came back: <span className="font-mono">{order.target?.code}</span> {order.target?.name}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { qty: '', batchNo: '', warehouseId: order.targetWarehouseId ?? '' }])}>
            <Plus className="size-4" /> Another lot
          </Button>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[7rem_1fr_1fr_auto]">
              <Field label="Quantity" error={err[`received.${i}.qty`]}>
                {(f) => <Input {...f} aria-label={`Received ${i + 1}`} inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((y, k) => (k === i ? { ...y, qty: e.target.value } : y)))} />}
              </Field>
              {tracked ? (
                <Field label="Lot / batch no." hint="Empty: same heat if one went out, else the order number" error={err[`received.${i}.batchNo`]}>
                  {(f) => <Input {...f} value={l.batchNo} onChange={(e) => setLines(lines.map((y, k) => (k === i ? { ...y, batchNo: e.target.value } : y)))} />}
                </Field>
              ) : (
                <span />
              )}
              <Field label="Into" error={err[`received.${i}.warehouseId`]}>
                {(f) => (
                  <Select {...f} value={l.warehouseId} onChange={(e) => setLines(lines.map((y, k) => (k === i ? { ...y, warehouseId: e.target.value } : y)))}>
                    <option value="">Choose…</option>
                    {ours.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {lines.length > 1 ? (
                <Button variant="ghost" aria-label={`Remove lot ${i + 1}`} onClick={() => setLines(lines.filter((_, k) => k !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      </div>
    </FormDialog>
  );
}
