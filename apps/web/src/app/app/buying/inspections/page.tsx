'use client';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatQty, today } from '@/lib/format';
import { STATUS_TONE } from '@/lib/stock';
import type { InspectionRow, PendingInspection, Warehouse } from '@/lib/types';

const RESULT: Record<string, { label: string; tone: 'success' | 'danger' | 'warning' }> = {
  accepted: { label: 'Accepted', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  partial: { label: 'Partly accepted', tone: 'warning' },
};

export default function InspectionsPage() {
  return (
    <>
      <PageHeader title="Incoming inspection" description="Material received into quarantine waits here. Accepted quantity moves to stores, rejected to MRB / hold, in one step." />
      <EntityGate what="inspection">
        <div className="space-y-6">
          <Pending />
          <History />
        </div>
      </EntityGate>
    </>
  );
}

function Pending() {
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['inspections-pending', ws.entityId], queryFn: () => api<PendingInspection[]>('/inspections/pending', { scope: ws.scope }) });
  const [inspecting, setInspecting] = useState<PendingInspection | null>(null);
  return (
    <Card>
      <CardHeader title="Waiting for inspection" description="Receipts in quarantine of items marked for incoming inspection" />
      {q.data?.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="size-5" />} title="Nothing waiting" description="Receipts of inspected items land here when they go into quarantine." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Receipt</Th>
              <Th>Supplier / owner</Th>
              <Th>Item · batch / heat</Th>
              <Th className="text-right">Received</Th>
              <Th className="text-right">Pending</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((r) => (
              <Tr key={r.receiptLineId}>
                <Td>
                  <Link href={`/app/inventory/entries/${r.receiptId}`} className="font-mono text-[13px] hover:text-accent">
                    {r.receiptNumber}
                  </Link>
                  <p className="text-[12px] text-muted">
                    {formatDate(r.postingDate)}
                    {r.reference ? ` · ${r.reference}` : ''}
                  </p>
                </Td>
                <Td className="text-[13px]">
                  {r.supplierName ?? '—'}
                  {r.ownerName && <Badge tone="warning" className="ml-2">{r.ownerName}&apos;s material</Badge>}
                </Td>
                <Td>
                  <span className="font-mono text-[13px] font-medium">{r.itemCode}</span> <span className="text-[13px] text-muted">{r.itemName}</span>
                  {r.batchNo && <p className="font-mono text-[12px] text-subtle">{r.batchNo}{r.heatNo && r.heatNo !== r.batchNo ? ` · ${r.heatNo}` : ''}</p>}
                </Td>
                <Td className="tabular text-right text-[13px]">{formatQty(r.qty)}</Td>
                <Td className="tabular text-right font-semibold whitespace-nowrap">
                  {formatQty(r.pending)} <span className="text-[11px] font-normal text-subtle">{r.uomCode}</span>
                </Td>
                <Td className="text-right">
                  {ws.can('quality.inspection.submit') && (
                    <Button size="sm" onClick={() => setInspecting(r)}>
                      Inspect
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {inspecting && <InspectDialog line={inspecting} onClose={() => setInspecting(null)} />}
    </Card>
  );
}

function InspectDialog({ line, onClose }: { line: PendingInspection; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const warehouses = useQuery({ queryKey: ['warehouses', ws.entityId], queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }) });
  const whs = (warehouses.data ?? []).filter((w) => w.isActive);
  const [f, setF] = useState({ inspectionDate: today(), qtyAccepted: String(Number(line.pending)), qtyRejected: '0', acceptWarehouseId: '', rejectWarehouseId: '', checks: '', remarks: '' });
  const m = useMutation({
    mutationFn: () =>
      api('/inspections', {
        method: 'POST',
        body: { ...f, receiptLineId: line.receiptLineId, qtyAccepted: f.qtyAccepted || '0', qtyRejected: f.qtyRejected || '0', acceptWarehouseId: f.acceptWarehouseId || null, rejectWarehouseId: f.rejectWarehouseId || null, checks: f.checks || null, remarks: f.remarks || null },
        scope: ws.scope,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inspections-pending'] });
      void qc.invalidateQueries({ queryKey: ['inspections'] });
      void qc.invalidateQueries({ queryKey: ['balance'] });
      onClose();
    },
  });
  const errs = fieldErrors(m.error);
  const rejected = Number(f.qtyRejected) > 0;
  const whSelect = (value: string, onChange: (v: string) => void, type: string, p: object) => (
    <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Default ({whs.find((w) => w.type === type)?.code ?? 'none'})</option>
      {whs.map((w) => (
        <option key={w.id} value={w.id}>
          {w.code} · {w.name}
        </option>
      ))}
    </Select>
  );
  return (
    <FormDialog
      title={`Inspect ${line.itemCode}${line.batchNo ? ` · ${line.batchNo}` : ''}`}
      description={`${formatQty(line.pending)} ${line.uomCode} pending from ${line.receiptNumber}. Partial inspections are fine; the rest stays in quarantine.`}
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel="Record and move stock"
      wide
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Inspection date">{(p) => <Input {...p} type="date" value={f.inspectionDate} onChange={(e) => setF({ ...f, inspectionDate: e.target.value })} required />}</Field>
        <Field label={`Accepted (${line.uomCode})`} error={errs.qtyAccepted}>
          {(p) => <Input {...p} className="tabular text-right" inputMode="decimal" value={f.qtyAccepted} onChange={(e) => setF({ ...f, qtyAccepted: e.target.value })} autoFocus />}
        </Field>
        <Field label={`Rejected (${line.uomCode})`}>{(p) => <Input {...p} className="tabular text-right" inputMode="decimal" value={f.qtyRejected} onChange={(e) => setF({ ...f, qtyRejected: e.target.value })} />}</Field>
        <Field label="Accepted to" className="sm:col-span-2">{(p) => whSelect(f.acceptWarehouseId, (v) => setF({ ...f, acceptWarehouseId: v }), 'stores', p)}</Field>
        {rejected && <Field label="Rejected to">{(p) => whSelect(f.rejectWarehouseId, (v) => setF({ ...f, rejectWarehouseId: v }), 'mrb', p)}</Field>}
        <Field label="Checks done" className="sm:col-span-3" hint="e.g. MTC verified against PO spec, dimensions, UT, hardness">
          {(p) => <Input {...p} value={f.checks} onChange={(e) => setF({ ...f, checks: e.target.value })} />}
        </Field>
        <Field label="Remarks" className="sm:col-span-3">{(p) => <Input {...p} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />}</Field>
      </div>
    </FormDialog>
  );
}

function History() {
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['inspections', ws.entityId], queryFn: () => api<InspectionRow[]>('/inspections', { scope: ws.scope }) });
  const [cancelling, setCancelling] = useState<InspectionRow | null>(null);
  if (!q.data?.length) return null;
  return (
    <Card>
      <CardHeader title="Inspections" />
      <Table>
        <thead>
          <tr>
            <Th>Number</Th>
            <Th>Date</Th>
            <Th>Receipt</Th>
            <Th>Item · batch</Th>
            <Th className="text-right">Accepted</Th>
            <Th className="text-right">Rejected</Th>
            <Th>Result</Th>
            <Th>Inspector</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {q.data.map((i) => (
            <Tr key={i.id}>
              <Td className="font-mono text-[13px] whitespace-nowrap">
                {i.transferEntryId ? (
                  <Link href={`/app/inventory/entries/${i.transferEntryId}`} className="hover:text-accent" title="Stock movement">
                    {i.number}
                  </Link>
                ) : (
                  i.number
                )}
              </Td>
              <Td className="tabular text-[13px] whitespace-nowrap">{formatDate(i.inspectionDate)}</Td>
              <Td className="font-mono text-[12px] whitespace-nowrap">{i.receiptNumber}</Td>
              <Td>
                <span className="font-mono text-[13px]">{i.itemCode}</span>
                {i.batchNo && <span className="font-mono text-[12px] text-subtle"> · {i.batchNo}</span>}
                {i.checks && <p className="text-[12px] text-muted">{i.checks}</p>}
              </Td>
              <Td className="tabular text-right text-[13px]">{formatQty(i.qtyAccepted)}</Td>
              <Td className="tabular text-right text-[13px]">{Number(i.qtyRejected) ? formatQty(i.qtyRejected) : '—'}</Td>
              <Td>
                {i.status === 'cancelled' ? (
                  <span title={i.cancelReason ?? undefined}>
                    <Badge tone={STATUS_TONE.cancelled}>Cancelled</Badge>
                  </span>
                ) : (
                  i.result && <Badge tone={RESULT[i.result]!.tone}>{RESULT[i.result]!.label}</Badge>
                )}
              </Td>
              <Td className="text-[13px] text-muted">{i.inspectorName}</Td>
              <Td className="text-right">
                {i.status === 'submitted' && ws.can('quality.inspection.cancel') && (
                  <Button size="sm" variant="ghost" onClick={() => setCancelling(i)}>
                    Cancel
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {cancelling && <CancelDialog inspection={cancelling} onClose={() => setCancelling(null)} />}
    </Card>
  );
}

function CancelDialog({ inspection, onClose }: { inspection: InspectionRow; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/inspections/${inspection.id}/cancel`, { method: 'POST', body: { reason }, scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inspections-pending'] });
      void qc.invalidateQueries({ queryKey: ['inspections'] });
      onClose();
    },
  });
  return (
    <FormDialog
      title={`Cancel ${inspection.number}`}
      description="The stock moves back to quarantine for re-inspection. Refused if it has already been issued."
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel="Cancel inspection"
    >
      <Field label="Reason (recorded in the audit log)" error={fieldErrors(m.error).reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
