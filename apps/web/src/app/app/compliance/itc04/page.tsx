'use client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney, formatQty } from '@/lib/format';
import { DEADLINE, type DeadlineLine } from '@/lib/job-work';

interface Itc04 {
  period: { label: string; from: string; to: string; due: string };
  frequency: 'half_yearly' | 'annual';
  configuredFrequency: 'half_yearly' | 'annual' | null;
  gstins: {
    gstin: string | null;
    table4: { gstin: string | null; jobWorker: string; jobWorkerState: string | null; challanNo: string | null; challanDate: string; description: string; uqc: string; qty: string; taxableValue: string; goodsType: string; igstRate: string | null; cgstRate: string | null; sgstRate: string | null }[];
    table5a: { gstin: string | null; jobWorker: string; originalChallanNo: string | null; originalChallanDate: string; jobWorkerChallanNo: string | null; receivedDate: string; natureOfWork: string | null; description: string; uqc: string; qty: string; lossQty: string; scrapQty: string }[];
  }[];
}

/** Periods of the current and previous two financial years, newest first. */
function periods(today: string) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const fy = m >= 4 ? y : y - 1;
  const out: string[] = [];
  for (let k = 0; k < 3; k++) {
    const label = `${fy - k}-${String((fy - k + 1) % 100).padStart(2, '0')}`;
    out.push(`${label} H2`, `${label} H1`, label);
  }
  return out;
}

export default function Itc04Page() {
  const [tab, setTab] = useState<'return' | 'deadlines'>('return');
  return (
    <>
      <PageHeader title="ITC-04" description="Goods sent to job workers and received back (rule 45(3)), and the Section 143 deadlines for bringing them back." />
      <EntityGate what="ITC-04">
        <div className="mb-4 flex gap-1" role="tablist" aria-label="View">
          {(['return', 'deadlines'] as const).map((t) => (
            <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? 'secondary' : 'ghost'} onClick={() => setTab(t)}>
              {t === 'return' ? 'Return' : 'Deadlines'}
            </Button>
          ))}
        </div>
        {tab === 'return' ? <Return /> : <Deadlines />}
      </EntityGate>
    </>
  );
}

function Return() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const options = periods(today);
  const [period, setPeriod] = useState(options[Number(today.slice(5, 7)) >= 4 && Number(today.slice(5, 7)) <= 9 ? 1 : 0]!);
  const [exportError, setExportError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['itc04', ws.entityId, period], queryFn: () => api<Itc04>(`/compliance/itc04?period=${encodeURIComponent(period)}`, { scope: ws.scope }) });
  const save = useMutation({
    mutationFn: (frequency: 'half_yearly' | 'annual') => api('/compliance/itc04/settings', { method: 'PUT', scope: ws.scope, body: { fy: period.slice(0, 7), frequency } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['itc04'] }),
  });
  const r = q.data;
  const download = async () => {
    setExportError(null);
    const res = await fetch(`/api/compliance/itc04/export.csv?period=${encodeURIComponent(period)}`, { headers: { ...(ws.tenantId ? { 'x-tenant-id': ws.tenantId } : {}), ...(ws.entityId ? { 'x-entity-id': ws.entityId } : {}) }, credentials: 'include' });
    if (!res.ok) return setExportError(`Export failed (${res.status})`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = `ITC-04 ${period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const mismatch = r && r.configuredFrequency && r.configuredFrequency !== r.frequency;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <Field label="Period">
          {(f) => (
            <Select {...f} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {options.map((p) => (
                <option key={p} value={p}>
                  {p.endsWith('H1') ? `${p.slice(0, 7)} · Apr–Sep` : p.endsWith('H2') ? `${p.slice(0, 7)} · Oct–Mar` : `${p} · full year`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {r && (
          <p className="pb-2 text-[13px] text-muted">
            {formatDate(r.period.from)} – {formatDate(r.period.to)} · due <strong>{formatDate(r.period.due)}</strong>
          </p>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {ws.can('compliance.itc04.update') && (
            <Select aria-label="Filing frequency for this year" value={r?.configuredFrequency ?? ''} onChange={(e) => e.target.value && save.mutate(e.target.value as 'half_yearly' | 'annual')}>
              <option value="">Frequency for {period.slice(0, 7)}…</option>
              <option value="half_yearly">Half-yearly (turnover above ₹5 crore last year)</option>
              <option value="annual">Annual</option>
            </Select>
          )}
          {ws.can('compliance.itc04.export') && (
            <Button variant="secondary" onClick={() => void download()}>
              Export CSV
            </Button>
          )}
        </div>
      </Card>
      {exportError && <Alert tone="danger">{exportError}</Alert>}
      {mismatch && <Alert>This year is set to {r!.configuredFrequency === 'annual' ? 'annual' : 'half-yearly'} filing; you are viewing a {r!.frequency === 'annual' ? 'full-year' : 'half-year'} period.</Alert>}
      <Alert>The CSV follows the fields of FORM GST ITC-04. It is not yet matched to the GST portal&apos;s offline-tool template, so check the columns before uploading.</Alert>
      {q.error && <Alert tone="danger">{q.error.message}</Alert>}
      {r && r.gstins.length === 0 && (
        <Card>
          <EmptyState icon={<FileSpreadsheet className="size-5" />} title="Nothing to report" description="No goods were sent to or received from job workers in this period." />
        </Card>
      )}
      {r?.gstins.map((g) => (
        <div key={g.gstin ?? 'none'} className="space-y-4">
          <Card>
            <CardHeader title={`Table 4 · goods sent · ${g.gstin ?? 'no GSTIN'}`} description={`${g.table4.length} challan line${g.table4.length === 1 ? '' : 's'}`} />
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Job worker</Th>
                    <Th>Challan</Th>
                    <Th>Goods</Th>
                    <Th className="text-right">Quantity</Th>
                    <Th className="text-right">Taxable value</Th>
                    <Th>Type</Th>
                    <Th className="text-right">Tax rate</Th>
                  </tr>
                </thead>
                <tbody>
                  {g.table4.map((x, i) => (
                    <tr key={i} className="border-t border-line text-[13px]">
                      <Td>
                        {x.jobWorker}
                        <span className="block font-mono text-subtle">{x.gstin ?? `State ${x.jobWorkerState}`}</span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <span className="font-mono">{x.challanNo}</span>
                        <span className="block text-subtle">{formatDate(x.challanDate)}</span>
                      </Td>
                      <Td>{x.description}</Td>
                      <Td className="tabular text-right">
                        {formatQty(x.qty)} {x.uqc}
                      </Td>
                      <Td className="tabular text-right">{formatMoney(x.taxableValue)}</Td>
                      <Td>{x.goodsType === 'capital_good' ? 'Capital goods' : 'Inputs'}</Td>
                      <Td className="tabular text-right whitespace-nowrap">{x.igstRate ? `IGST ${Number(x.igstRate)}%` : x.cgstRate ? `CGST ${Number(x.cgstRate)}% + SGST ${Number(x.sgstRate)}%` : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
          <Card>
            <CardHeader title={`Table 5A · received back · ${g.gstin ?? 'no GSTIN'}`} description="Each row discharges an original challan; losses and waste are part of the quantity used." />
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Job worker</Th>
                    <Th>Original challan</Th>
                    <Th>Their challan</Th>
                    <Th>Goods</Th>
                    <Th className="text-right">Back</Th>
                    <Th className="text-right">Loss</Th>
                    <Th className="text-right">Waste</Th>
                  </tr>
                </thead>
                <tbody>
                  {g.table5a.map((x, i) => (
                    <tr key={i} className="border-t border-line text-[13px]">
                      <Td>{x.jobWorker}</Td>
                      <Td className="whitespace-nowrap">
                        <span className="font-mono">{x.originalChallanNo}</span>
                        <span className="block text-subtle">{formatDate(x.originalChallanDate)}</span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {x.jobWorkerChallanNo ?? '—'}
                        <span className="block text-subtle">received {formatDate(x.receivedDate)}</span>
                      </Td>
                      <Td>
                        {x.description}
                        {x.natureOfWork && <span className="block text-subtle">{x.natureOfWork}</span>}
                      </Td>
                      <Td className="tabular text-right">
                        {formatQty(x.qty)} {x.uqc}
                      </Td>
                      <Td className="tabular text-right">{Number(x.lossQty) ? formatQty(x.lossQty) : '—'}</Td>
                      <Td className="tabular text-right">{Number(x.scrapQty) ? formatQty(x.scrapQty) : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}

function Deadlines() {
  const ws = useWorkspace();
  const [action, setAction] = useState<{ kind: 'extend' | 'deemed'; line: DeadlineLine } | null>(null);
  const q = useQuery({ queryKey: ['itc04-deadlines', ws.entityId], queryFn: () => api<{ today: string; soon: number; lines: DeadlineLine[] }>('/compliance/itc04/deadlines', { scope: ws.scope }) });
  const can = ws.can('compliance.itc04.update');
  return (
    <Card>
      <CardHeader title="Goods still at job workers" description="Inputs must come back within one year and capital goods within three (Section 143). After that they are treated as supplied on the challan date." />
      {q.data?.lines.length === 0 ? (
        <EmptyState icon={<FileSpreadsheet className="size-5" />} title="Nothing outstanding" description="Every challan line has come back." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Challan</Th>
                <Th>Job worker</Th>
                <Th>Goods</Th>
                <Th className="text-right">Still there</Th>
                <Th>Return by</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data?.lines.map((l) => (
                <tr key={l.id} className="border-t border-line text-[13px]">
                  <Td className="whitespace-nowrap">
                    <Link className="font-mono hover:text-accent" href={`/app/manufacturing/job-work/${l.orderId}`}>
                      {l.challanNo}
                    </Link>
                    <span className="block text-subtle">{formatDate(l.challanDate)}</span>
                  </Td>
                  <Td>{l.jobWorker}</Td>
                  <Td>
                    <span className="font-mono">{l.itemCode}</span> {l.itemName}
                    <span className="block text-subtle">{l.goodsType === 'capital_good' ? 'Capital goods' : 'Inputs'}</span>
                  </Td>
                  <Td className="tabular text-right">
                    {formatQty(l.open)} {l.uqc}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {l.due ? formatDate(l.due) : 'No limit (tool)'}
                    {l.extendedDueBy && <span className="block text-subtle">extended · {l.extensionRef}</span>}
                    {l.deemedSupplyInvoiceNo && <span className="block text-subtle">invoice {l.deemedSupplyInvoiceNo}</span>}
                    <Badge tone={DEADLINE[l.state].tone}>{DEADLINE[l.state].label}</Badge>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {can && l.dueBy && !l.deemedSupplyInvoiceNo && l.state !== 'overdue' && (
                      <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'extend', line: l })}>
                        Extension…
                      </Button>
                    )}
                    {can && l.state === 'overdue' && (
                      <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'deemed', line: l })}>
                        Record deemed supply…
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {action && <LineAction {...action} onClose={() => setAction(null)} />}
    </Card>
  );
}

function LineAction({ kind, line, onClose }: { kind: 'extend' | 'deemed'; line: DeadlineLine; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [form, setForm] = useState({ extendedDueBy: '', extensionRef: '', invoiceNo: '' });
  const m = useMutation({
    mutationFn: () =>
      api(`/manufacturing/job-work/challan-lines/${line.id}/${kind === 'extend' ? 'extend' : 'deemed-supply'}`, {
        method: 'POST',
        scope: ws.scope,
        body: kind === 'extend' ? { extendedDueBy: form.extendedDueBy, extensionRef: form.extensionRef } : { invoiceNo: form.invoiceNo },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['itc04-deadlines'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return kind === 'extend' ? (
    <FormDialog title={`Extension for ${line.challanNo}`} description={`The Commissioner may extend by up to ${line.goodsType === 'capital_good' ? 'two years' : 'one year'} (Section 143(1), second proviso).`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Record extension">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New return-by date" error={err.extendedDueBy}>
          {(f) => <Input {...f} type="date" value={form.extendedDueBy} onChange={(e) => setForm({ ...form, extendedDueBy: e.target.value })} required autoFocus />}
        </Field>
        <Field label="Order reference" error={err.extensionRef}>
          {(f) => <Input {...f} value={form.extensionRef} onChange={(e) => setForm({ ...form, extensionRef: e.target.value })} required />}
        </Field>
      </div>
    </FormDialog>
  ) : (
    <FormDialog title={`Deemed supply · ${line.challanNo}`} description={`${formatQty(line.open)} ${line.uqc} of ${line.itemCode} is treated as supplied to ${line.jobWorker} on ${formatDate(line.challanDate)} (Section 143(3)/(4)). Raise the tax invoice, declare it in GSTR-1, then record its number here.`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Record">
      <Field label="Tax invoice number" error={err.invoiceNo}>
        {(f) => <Input {...f} value={form.invoiceNo} onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
