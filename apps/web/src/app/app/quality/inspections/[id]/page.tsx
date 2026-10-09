'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatQty } from '@/lib/format';
import { type Characteristic, type Gauge, type InspectionDetail, OUTCOME, STAGE } from '@/lib/quality';

export default function InspectionPage() {
  return (
    <EntityGate what="quality">
      <View />
    </EntityGate>
  );
}

const limits = (c: Characteristic) =>
  c.lowerLimit !== null || c.upperLimit !== null ? `${c.lowerLimit !== null ? Number(c.lowerLimit) : '−∞'} … ${c.upperLimit !== null ? Number(c.upperLimit) : '∞'}${c.unit ? ` ${c.unit}` : ''}` : (c.method ?? 'Conforms');

function View() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [submitting, setSubmitting] = useState(false);
  const q = useQuery({ queryKey: ['inspection', ws.entityId, id], queryFn: () => api<InspectionDetail>(`/quality/inspections/${id}`, { scope: ws.scope }) });
  const gauges = useQuery({ queryKey: ['gauges', ws.entityId], queryFn: () => api<Gauge[]>('/quality/gauges', { scope: ws.scope }) });
  const [values, setValues] = useState<Record<string, string>>({});
  const [gaugeFor, setGaugeFor] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState({ description: '', pass: '' });
  const save = useMutation({
    mutationFn: (results: object[]) => api<InspectionDetail>(`/quality/inspections/${id}/results`, { method: 'POST', scope: ws.scope, body: { results } }),
    onSuccess: (d) => {
      qc.setQueryData(['inspection', ws.entityId, id], d);
      setValues({});
      setExtra({ description: '', pass: '' });
    },
  });
  const r = q.data;
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!r) return <p className="text-muted">Loading…</p>;
  const draft = r.status === 'draft';
  const canEdit = draft && ws.can('quality.inspection.create');
  const latest = (cid: string | null, s: number) => r.results.find((x) => x.characteristicId === cid && x.sampleNo === s);
  const numeric = (c: Characteristic) => c.lowerLimit !== null || c.upperLimit !== null || c.kind === 'dimension';
  const pending = () => {
    const rows: object[] = [];
    for (const c of r.characteristics)
      for (let s = 1; s <= (c.samples ?? 1); s++) {
        const v = values[`${c.id}:${s}`];
        if (v === undefined || v === '') continue;
        rows.push(numeric(c) ? { characteristicId: c.id, sampleNo: s, measured: v, gaugeId: gaugeFor[c.id] || null } : { characteristicId: c.id, sampleNo: s, pass: v === 'pass', gaugeId: gaugeFor[c.id] || null });
      }
    if (extra.description && extra.pass) rows.push({ description: extra.description, pass: extra.pass === 'pass' });
    return rows;
  };
  const usable = (gauges.data ?? []).filter((g) => g.usable);
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {r.number ?? `${STAGE[r.stage]} inspection`}
            {r.outcome && <Badge tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].label}</Badge>}
            {r.status === 'cancelled' && <Badge tone="neutral">Cancelled</Badge>}
          </span>
        }
        description={`${r.itemCode} ${r.itemName}${r.itemRevision ? ` rev ${r.itemRevision}` : ''} · ${formatQty(r.qty)} ${r.uom}${r.batchNo ? ` · ${r.batchNo}` : ''}${r.workOrder ? ` · ${r.workOrder}` : ''}`}
        actions={
          draft &&
          ws.can('quality.inspection.submit') && (
            <Button onClick={() => setSubmitting(true)} disabled={!r.results.length}>
              Record result
            </Button>
          )
        }
      />
      {r.holdWarehouse && draft && (
        <Alert className="mb-4">
          Waiting in {r.holdWarehouse}. Accepted quantity moves to {r.acceptWarehouse}; rejected quantity goes to MRB on an NCR.
        </Alert>
      )}
      {r.ncr && (
        <Alert tone="warning" className="mb-4">
          Rejected quantity raised{' '}
          <Link className="font-medium underline" href={`/app/quality/ncrs/${r.ncr.id}`}>
            {r.ncr.number}
          </Link>
          .
        </Alert>
      )}
      {!r.plan && <Alert className="mb-4">No active inspection plan for this item and stage; record the checks you made below.</Alert>}
      {save.error && <Alert tone="danger" className="mb-4">{save.error.message}</Alert>}
      <Card>
        <CardHeader title={r.plan ? `Characteristics · plan rev ${r.plan.revision}` : 'Checks'} description="Measured values are judged against the limits. Re-entering a sample records a new reading; the latest counts." />
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Characteristic</Th>
                <Th>Requirement</Th>
                <Th>Samples</Th>
                {canEdit && <Th>Gauge</Th>}
              </tr>
            </thead>
            <tbody>
              {r.characteristics.map((c) => (
                <tr key={c.id} className="border-t border-line align-top text-[13px]">
                  <Td className="font-mono">{c.balloon ?? c.lineNo}</Td>
                  <Td>
                    {c.description}
                    {c.isKey && <Badge tone="warning">Key</Badge>}
                  </Td>
                  <Td className="whitespace-nowrap">{limits(c)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: c.samples ?? 1 }, (_, k) => {
                        const s = k + 1;
                        const done = latest(c.id, s);
                        const key = `${c.id}:${s}`;
                        return (
                          <div key={s} className="w-24">
                            {canEdit ? (
                              numeric(c) ? (
                                <Input aria-label={`${c.balloon ?? c.lineNo} sample ${s}`} inputMode="decimal" placeholder={done?.measured ? String(Number(done.measured)) : `#${s}`} value={values[key] ?? ''} onChange={(e) => setValues({ ...values, [key]: e.target.value })} aria-invalid={done && !done.pass ? true : undefined} />
                              ) : (
                                <Select aria-label={`${c.balloon ?? c.lineNo} sample ${s}`} value={values[key] ?? ''} onChange={(e) => setValues({ ...values, [key]: e.target.value })}>
                                  <option value="">{done ? (done.pass ? 'OK' : 'NOK') : `#${s}`}</option>
                                  <option value="pass">OK</option>
                                  <option value="fail">NOK</option>
                                </Select>
                              )
                            ) : null}
                            {done && (
                              <span className={`block text-[12px] ${done.pass ? 'text-success' : 'text-danger'}`}>
                                {done.measured ? Number(done.measured) : done.pass ? 'OK' : 'NOK'} {done.pass ? '✓' : '✗'}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Td>
                  {canEdit && (
                    <Td>
                      <Select aria-label={`Gauge for ${c.balloon ?? c.lineNo}`} value={gaugeFor[c.id] ?? ''} onChange={(e) => setGaugeFor({ ...gaugeFor, [c.id]: e.target.value })}>
                        <option value="">—</option>
                        {usable.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.code}
                          </option>
                        ))}
                      </Select>
                    </Td>
                  )}
                </tr>
              ))}
              {r.results
                .filter((x) => !x.characteristicId)
                .map((x) => (
                  <tr key={x.id} className="border-t border-line text-[13px]">
                    <Td>—</Td>
                    <Td>{x.description}</Td>
                    <Td>Conforms</Td>
                    <Td className={x.pass ? 'text-success' : 'text-danger'}>{x.pass ? 'OK ✓' : 'NOK ✗'}</Td>
                    {canEdit && <Td />}
                  </tr>
                ))}
            </tbody>
          </Table>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2 border-t border-line p-3">
            <Field label="Other check" className="min-w-56 flex-1">
              {(f) => <Input {...f} value={extra.description} onChange={(e) => setExtra({ ...extra, description: e.target.value })} placeholder="e.g. Burr-free edges" />}
            </Field>
            <Field label="Result">
              {(f) => (
                <Select {...f} value={extra.pass} onChange={(e) => setExtra({ ...extra, pass: e.target.value })}>
                  <option value="">—</option>
                  <option value="pass">OK</option>
                  <option value="fail">NOK</option>
                </Select>
              )}
            </Field>
            <Button className="ml-auto" loading={save.isPending} onClick={() => save.mutate(pending())} disabled={!pending().length}>
              Save readings
            </Button>
          </div>
        )}
      </Card>
      <div className="mt-4">
        <AttachmentsPanel ownerType="inspection_record" ownerId={r.id} defaultKind="cmm" title="Inspection reports and data" />
      </div>
      {submitting && <SubmitDialog r={r} onClose={() => setSubmitting(false)} />}
    </>
  );
}

function SubmitDialog({ r, onClose }: { r: InspectionDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const failed = r.results.some((x) => !x.pass);
  const [form, setForm] = useState({ qtyAccepted: failed ? '' : String(Number(r.qty)), qtyRejected: failed ? '' : '0', ncrDescription: '' });
  const m = useMutation({
    mutationFn: () => api<InspectionDetail>(`/quality/inspections/${r.id}/submit`, { method: 'POST', scope: ws.scope, body: { ...form, ncrDescription: form.ncrDescription || null } }),
    onSuccess: (d) => {
      qc.setQueryData(['inspection', ws.entityId, r.id], d);
      void qc.invalidateQueries({ queryKey: ['inspections'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const rejecting = Number(form.qtyRejected) > 0;
  return (
    <FormDialog title="Record the inspection result" description={`${formatQty(r.qty)} ${r.uom} inspected. Accepted and rejected must add up to the lot.`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Record result">
      {failed && <Alert tone="warning">A characteristic failed. Reject the nonconforming quantity; it goes to MRB on an NCR.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Accepted" error={err.qtyAccepted}>
          {(f) => <Input {...f} inputMode="decimal" value={form.qtyAccepted} onChange={(e) => setForm({ ...form, qtyAccepted: e.target.value })} required autoFocus />}
        </Field>
        <Field label="Rejected" error={err.qtyRejected}>
          {(f) => <Input {...f} inputMode="decimal" value={form.qtyRejected} onChange={(e) => setForm({ ...form, qtyRejected: e.target.value })} required />}
        </Field>
      </div>
      {rejecting && (
        <Field label="Nonconformance (for the NCR)" error={err.ncrDescription}>
          {(f) => <Input {...f} value={form.ncrDescription} onChange={(e) => setForm({ ...form, ncrDescription: e.target.value })} required />}
        </Field>
      )}
    </FormDialog>
  );
}
