'use client';
import { Alert, Badge, Button, Card, CardHeader, DateInput, Field, Input, PageHeader, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { AttentionCard, ChecksCard, Gstr1View, Gstr3bView } from '@/components/gst-return-view';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, today } from '@/lib/format';
import { documentHref, KIND_LABEL, monthLabel, type ReturnDetail, SECTION_LABEL, STATUS } from '@/lib/gst-returns';

export default function GstReturnPage() {
  return (
    <EntityGate what="GST returns">
      <ReturnView />
    </EntityGate>
  );
}

function ReturnView() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [filing, setFiling] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['gst-return', ws.entityId, id], queryFn: () => api<ReturnDetail>(`/gst-returns/${id}`, { scope: ws.scope }) });
  const step = useMutation({
    mutationFn: (to: 'review' | 'approve') => api(`/gst-returns/${id}/${to}`, { method: 'POST', scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gst-return', ws.entityId, id] });
      void qc.invalidateQueries({ queryKey: ['gst-returns'] });
    },
  });
  const r = q.data;
  const download = async () => {
    setExportError(null);
    const res = await fetch(`/api/gst-returns/${id}/export`, { headers: { ...(ws.tenantId ? { 'x-tenant-id': ws.tenantId } : {}), ...(ws.entityId ? { 'x-entity-id': ws.entityId } : {}) }, credentials: 'include' });
    if (!res.ok) return setExportError(`Export failed (${res.status})`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = `${r!.kind}-${r!.gstin}-${r!.period}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const late = r?.lines.filter((l) => l.late) ?? [];
  const sections = r ? [...new Set(r.lines.map((l) => l.section))] : [];
  return (
    <>
      <PageHeader
        title={r ? `${KIND_LABEL[r.kind]} · ${monthLabel(r.period)}` : 'GST return'}
        description={r ? <span className="font-mono">{r.gstin}</span> : undefined}
        actions={
          r && (
            <>
              <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
              {r.status === 'draft' && ws.can('compliance.gst_return.create') && (
                <Button onClick={() => step.mutate('review')} loading={step.isPending}>
                  Mark reviewed
                </Button>
              )}
              {r.status === 'reviewed' && ws.can('compliance.gst_return.approve') && (
                <Button onClick={() => step.mutate('approve')} loading={step.isPending}>
                  Approve
                </Button>
              )}
              {r.status === 'approved' && ws.can('compliance.gst_return.file') && <Button onClick={() => setFiling(true)}>Record filing…</Button>}
              {ws.can('compliance.gst_return.export') && (
                <Button variant="secondary" onClick={() => void download()}>
                  Export sheets
                </Button>
              )}
            </>
          )
        }
      />
      <div className="space-y-4">
        <Link href="/app/compliance/gst-returns" className="text-[13px] text-muted hover:text-accent">
          ← All GST returns
        </Link>
        {q.error && <Alert tone="danger">{q.error.message}</Alert>}
        {step.error && <Alert tone="danger">{step.error.message}</Alert>}
        {exportError && <Alert tone="danger">{exportError}</Alert>}
        {r && (
          <>
            <Card className="grid gap-3 p-4 text-[13px] sm:grid-cols-4">
              <p>
                <span className="block text-muted">Prepared</span>
                {formatDateTime(r.preparedAt)}
              </p>
              <p>
                <span className="block text-muted">Reviewed</span>
                {r.reviewedAt ? formatDateTime(r.reviewedAt) : '—'}
              </p>
              <p>
                <span className="block text-muted">Approved</span>
                {r.approvedAt ? formatDateTime(r.approvedAt) : '—'}
              </p>
              <p>
                <span className="block text-muted">Filed</span>
                {r.arn ? (
                  <>
                    {formatDate(r.filedOn!)} · <span className="font-mono break-all">{r.arn}</span>
                  </>
                ) : (
                  '—'
                )}
              </p>
            </Card>
            {r.status === 'reviewed' && <Alert>The person who prepared the return cannot approve it. Approval and filing re-check the books first.</Alert>}
            {r.kind === 'gstr1' && <Alert>The GST offline-tool file comes once its format is pinned (decision 074a). Meanwhile the export gives one sheet per section to key into the tool.</Alert>}
            {r.changedSinceFiling.length > 0 && (
              <Alert tone="warning" title="Changed since filing">
                <ul className="mt-1 space-y-1">
                  {r.changedSinceFiling.map((c) => (
                    <li key={c.documentId}>
                      <Link className="font-mono underline" href={documentHref(c.documentType, c.documentId)}>
                        {c.number}
                      </Link>{' '}
                      — {c.what}
                    </li>
                  ))}
                </ul>
                <p className="mt-2">Report these in a later return or as an amendment.</p>
              </Alert>
            )}
            {late.length > 0 && (
              <Alert title="Documents from earlier filed months">
                {late.map((l) => (
                  <span key={l.id} className="mr-3 inline-block">
                    <Link className="font-mono underline" href={documentHref(l.documentType, l.documentId)}>
                      {l.documentNumber}
                    </Link>{' '}
                    ({monthLabel(l.late!)})
                  </span>
                ))}
              </Alert>
            )}
            {r.snapshot.attention && <AttentionCard items={r.snapshot.attention} />}
            <ChecksCard checks={r.snapshot.checks} />
            {r.kind === 'gstr1' && r.snapshot.gstr1 && <Gstr1View g={r.snapshot.gstr1} />}
            {r.kind === 'gstr3b' && r.snapshot.gstr3b && <Gstr3bView g={r.snapshot.gstr3b} />}
            {r.lines.length > 0 && (
              <Card>
                <CardHeader title="Documents in this return" description="Frozen when the return is filed; later changes show above." />
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Document</Th>
                        <Th>Date</Th>
                        <Th>Where</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {sections.flatMap((s) =>
                        r.lines
                          .filter((l) => l.section === s)
                          .map((l) => (
                            <tr key={l.id} className="border-t border-line text-[13px]">
                              <Td>
                                <Link className="font-mono hover:text-accent" href={documentHref(l.documentType, l.documentId)}>
                                  {l.documentNumber}
                                </Link>
                              </Td>
                              <Td className="whitespace-nowrap">{formatDate(l.documentDate)}</Td>
                              <Td>{SECTION_LABEL[s] ?? s}</Td>
                            </tr>
                          )),
                      )}
                    </tbody>
                  </Table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
      {filing && r && <FileDialog id={r.id} onClose={() => setFiling(false)} />}
    </>
  );
}

function FileDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [form, setForm] = useState({ arn: '', filedOn: today() });
  const m = useMutation({
    mutationFn: () => api(`/gst-returns/${id}/file`, { method: 'POST', scope: ws.scope, body: { arn: form.arn.trim().toUpperCase(), filedOn: form.filedOn } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gst-return', ws.entityId, id] });
      void qc.invalidateQueries({ queryKey: ['gst-returns'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Record filing" description="After filing on the GST portal, record its acknowledgement. The return's documents are then frozen; later changes need a reason and show as changed since filing." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Record filing">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ARN" error={err.arn}>
          {(f) => <Input {...f} value={form.arn} onChange={(e) => setForm({ ...form, arn: e.target.value })} required minLength={5} autoFocus />}
        </Field>
        <Field label="Filed on" error={err.filedOn}>
          {(f) => <DateInput {...f} value={form.filedOn} onChange={(e) => setForm({ ...form, filedOn: e.target.value })} required />}
        </Field>
      </div>
    </FormDialog>
  );
}
