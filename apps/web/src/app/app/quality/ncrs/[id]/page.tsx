'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatQty } from '@/lib/format';
import type { WorkCentre } from '@/lib/manufacturing';
import { DISPOSITION, type Disposition, NCR_STATUS, type NcrDetail } from '@/lib/quality';
import type { Warehouse } from '@/lib/types';

const WASTE = ['rejected_parts', 'metal_swarf', 'metal_offcut', 'metal_powder', 'e_waste', 'coolant_oil', 'solvent', 'packaging', 'other'];

export default function NcrPage() {
  return (
    <EntityGate what="quality">
      <View />
    </EntityGate>
  );
}

function View() {
  const ws = useWorkspace();
  const { id } = useParams<{ id: string }>();
  const [dialog, setDialog] = useState<'propose' | 'approve' | 'cancel' | null>(null);
  const q = useQuery({ queryKey: ['ncr', ws.entityId, id], queryFn: () => api<NcrDetail>(`/quality/ncrs/${id}`, { scope: ws.scope }) });
  const qc = useQueryClient();
  const close = useMutation({ mutationFn: () => api<NcrDetail>(`/quality/ncrs/${id}/close`, { method: 'POST', scope: ws.scope, body: {} }), onSuccess: (d) => qc.setQueryData(['ncr', ws.entityId, id], d) });
  const n = q.data;
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!n) return <p className="text-muted">Loading…</p>;
  const proposed = n.dispositions.filter((d) => d.status === 'proposed');
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {n.number}
            <Badge tone={NCR_STATUS[n.status].tone}>{NCR_STATUS[n.status].label}</Badge>
          </span>
        }
        description={`${n.itemCode} ${n.itemName} · ${formatQty(n.qty)} ${n.uom}${n.batchNo ? ` · ${n.batchNo}` : ''}${n.workOrder ? ` · in WIP of ${n.workOrder}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {n.status === 'open' && ws.can('quality.ncr.submit') && (
              <Button variant={proposed.length ? 'secondary' : 'primary'} onClick={() => setDialog('propose')}>
                {proposed.length ? 'Change disposition' : 'Propose disposition'}
              </Button>
            )}
            {n.status === 'open' && proposed.length > 0 && ws.can('quality.ncr.approve') && <Button onClick={() => setDialog('approve')}>MRB approve</Button>}
            {n.status === 'dispositioned' && ws.can('quality.ncr.approve') && (
              <Button loading={close.isPending} onClick={() => close.mutate()}>
                Close NCR
              </Button>
            )}
            {n.status === 'open' && !n.inspectionRecordId && ws.can('quality.ncr.cancel') && (
              <Button variant="ghost" onClick={() => setDialog('cancel')}>
                Cancel
              </Button>
            )}
          </div>
        }
      />
      {close.error && <Alert tone="danger" className="mb-4">{close.error.message}</Alert>}
      <Card className="mb-4 p-4 text-[13px]">
        <p className="font-medium">{n.description}</p>
        {n.inspection && <p className="mt-1 text-muted">Raised by inspection {n.inspection}.</p>}
        {n.mrbWarehouseId ? <p className="mt-1 text-muted">On hold in MRB until dispositioned.</p> : <p className="mt-1 text-muted">Work in progress: dispositions are recorded on the work order; no stock moves.</p>}
        {n.cancelReason && <p className="mt-1 text-muted">Cancelled: {n.cancelReason}</p>}
      </Card>
      <Card className="mb-4">
        <CardHeader title="Disposition" description="Quantities add up to the NCR. Approval posts each line." />
        {n.dispositions.length === 0 ? (
          <p className="p-4 text-[13px] text-muted">Not proposed yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Decision</Th>
                <Th className="text-right">Qty</Th>
                <Th>Details</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {n.dispositions.map((d) => (
                <tr key={d.id} className="border-t border-line text-[13px]">
                  <Td className="font-medium">{DISPOSITION[d.kind]}</Td>
                  <Td className="tabular text-right">{formatQty(d.qty)}</Td>
                  <Td>
                    {d.concessionRef && <span>Concession {d.concessionRef} </span>}
                    {d.wasteCategory && <span className="text-muted">{d.wasteCategory.replaceAll('_', ' ')} </span>}
                    {d.note && <span className="text-muted">{d.note} </span>}
                    {d.workOrderId && (
                      <Link className="font-mono hover:text-accent" href={`/app/manufacturing/work-orders/${d.workOrderId}`}>
                        {d.reworkOrder}
                      </Link>
                    )}
                    {d.returnClaimId && (
                      <Link className="hover:text-accent" href={`/app/buying/return-claims/${d.returnClaimId}`}>
                        Supplier return claim (draft) →
                      </Link>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={d.status === 'posted' ? 'success' : 'neutral'}>{d.status === 'posted' ? 'Posted' : 'Proposed'}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <AttachmentsPanel ownerType="ncr" ownerId={n.id} defaultKind="photo" title="Photos and evidence" />
      {dialog === 'propose' && <Propose n={n} onClose={() => setDialog(null)} />}
      {dialog === 'approve' && <Approve n={n} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelNcr n={n} onClose={() => setDialog(null)} />}
    </>
  );
}

type Line = { kind: Disposition['kind']; qty: string; concessionRef: string; wasteCategory: string; note: string };

function Propose({ n, onClose }: { n: NcrDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const existing = n.dispositions.filter((d) => d.status === 'proposed');
  const [lines, setLines] = useState<Line[]>(existing.length ? existing.map((d) => ({ kind: d.kind, qty: String(Number(d.qty)), concessionRef: d.concessionRef ?? '', wasteCategory: d.wasteCategory ?? '', note: d.note ?? '' })) : [{ kind: 'scrap', qty: String(Number(n.qty)), concessionRef: '', wasteCategory: 'rejected_parts', note: '' }]);
  const m = useMutation({
    mutationFn: () => api<NcrDetail>(`/quality/ncrs/${n.id}/dispositions`, { method: 'POST', scope: ws.scope, body: { lines: lines.map((l) => ({ kind: l.kind, qty: l.qty, concessionRef: l.concessionRef || null, wasteCategory: l.kind === 'scrap' ? l.wasteCategory || null : null, note: l.note || null })) } }),
    onSuccess: (d) => {
      qc.setQueryData(['ncr', ws.entityId, n.id], d);
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <FormDialog title="Propose disposition" description={`Split the ${formatQty(n.qty)} ${n.uom} between decisions.`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Propose" wide>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[11rem_6rem_1fr_auto]">
            <Field label="Decision">
              {(p) => (
                <Select {...p} aria-label={`Decision ${i + 1}`} value={l.kind} onChange={(e) => set(i, { kind: e.target.value as Line['kind'] })}>
                  {Object.entries(DISPOSITION).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Qty" error={err[`lines.${i}.qty`]}>
              {(p) => <Input {...p} aria-label={`Quantity ${i + 1}`} inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />}
            </Field>
            {l.kind === 'use_as_is' ? (
              <Field label="Concession reference" error={err[`lines.${i}.concessionRef`]}>
                {(p) => <Input {...p} value={l.concessionRef} onChange={(e) => set(i, { concessionRef: e.target.value })} />}
              </Field>
            ) : l.kind === 'scrap' && n.mrbWarehouseId ? (
              <Field label="Waste category" error={err[`lines.${i}.wasteCategory`]}>
                {(p) => (
                  <Select {...p} value={l.wasteCategory} onChange={(e) => set(i, { wasteCategory: e.target.value })}>
                    {WASTE.map((w) => (
                      <option key={w} value={w}>
                        {w.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <Field label="Note">{(p) => <Input {...p} value={l.note} onChange={(e) => set(i, { note: e.target.value })} />}</Field>
            )}
            <Button variant="ghost" aria-label={`Remove decision ${i + 1}`} onClick={() => setLines(lines.filter((_, k) => k !== i))} disabled={lines.length === 1}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { kind: 'use_as_is', qty: '', concessionRef: '', wasteCategory: 'rejected_parts', note: '' }])}>
        <Plus className="size-4" /> Split
      </Button>
    </FormDialog>
  );
}

function Approve({ n, onClose }: { n: NcrDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const rework = n.mrbWarehouseId && n.dispositions.some((d) => d.status === 'proposed' && (d.kind === 'rework' || d.kind === 'repair'));
  const [f, setF] = useState({ reworkWorkCentreId: '', reworkTargetWarehouseId: '' });
  const centres = useQuery({ queryKey: ['work-centres', ws.entityId], queryFn: () => api<WorkCentre[]>('/manufacturing/work-centres', { scope: ws.scope }), enabled: !!rework });
  const warehouses = useQuery({ queryKey: ['warehouses', ws.entityId], queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }), enabled: !!rework });
  const m = useMutation({
    mutationFn: () => api<NcrDetail>(`/quality/ncrs/${n.id}/approve`, { method: 'POST', scope: ws.scope, body: rework ? f : {} }),
    onSuccess: (d) => {
      qc.setQueryData(['ncr', ws.entityId, n.id], d);
      void qc.invalidateQueries({ queryKey: ['ncrs'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="MRB approval" description="Posts every proposed line: release, rework order, scrap entry or supplier return claim." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Approve and post">
      {rework ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rework at work centre" error={err.reworkWorkCentreId}>
            {(p) => (
              <Select {...p} value={f.reworkWorkCentreId} onChange={(e) => setF({ ...f, reworkWorkCentreId: e.target.value })} required>
                <option value="">Choose…</option>
                {centres.data?.filter((c) => c.isActive).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reworked goods go to" error={err.reworkTargetWarehouseId}>
            {(p) => (
              <Select {...p} value={f.reworkTargetWarehouseId} onChange={(e) => setF({ ...f, reworkTargetWarehouseId: e.target.value })} required>
                <option value="">Choose…</option>
                {warehouses.data?.filter((w) => w.isActive && !['mrb', 'at_job_worker', 'customer_owned'].includes(w.type)).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : (
        <p className="text-[13px] text-muted">Approve the proposed disposition.</p>
      )}
    </FormDialog>
  );
}

function CancelNcr({ n, onClose }: { n: NcrDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api<NcrDetail>(`/quality/ncrs/${n.id}/cancel`, { method: 'POST', scope: ws.scope, body: { reason } }),
    onSuccess: (d) => {
      qc.setQueryData(['ncr', ws.entityId, n.id], d);
      onClose();
    },
  });
  return (
    <FormDialog title={`Cancel ${n.number}`} description="The held stock goes back where it came from." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Cancel NCR">
      <Field label="Reason" error={fieldErrors(m.error).reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
