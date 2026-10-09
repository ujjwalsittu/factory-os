'use client';
import { Alert, Badge, Button, Field, Input, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { FAI_REASON, FAI_STATUS, type FaiDetail } from '@/lib/quality';

/** AS9102 Forms 1–3 on screen and in print (decision 048). */
export default function FaiDetailPage() {
  return (
    <EntityGate what="quality">
      <View />
    </EntityGate>
  );
}

function View() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [rejecting, setRejecting] = useState(false);
  const q = useQuery({ queryKey: ['fai', ws.entityId, id], queryFn: () => api<FaiDetail>(`/quality/fais/${id}`, { scope: ws.scope }) });
  const act = useMutation({
    mutationFn: (path: 'submit' | 'approve') => api<FaiDetail>(`/quality/fais/${id}/${path}`, { method: 'POST', scope: ws.scope, body: {} }),
    onSuccess: (d) => {
      qc.setQueryData(['fai', ws.entityId, id], d);
      void qc.invalidateQueries({ queryKey: ['fais'] });
    },
  });
  const f = q.data;
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!f) return <p className="text-muted">Loading…</p>;
  const { form1, form2, form3 } = f.forms;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link className="text-[13px] hover:text-accent" href="/app/quality/fai">
          ← FAIs
        </Link>
        <Badge tone={FAI_STATUS[f.status].tone}>{FAI_STATUS[f.status].label}</Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          {f.status === 'draft' && ws.can('quality.fai.submit') && (
            <Button loading={act.isPending} onClick={() => act.mutate('submit')}>
              Submit for approval
            </Button>
          )}
          {f.status === 'submitted' && ws.can('quality.fai.approve') && (
            <>
              <Button loading={act.isPending} onClick={() => act.mutate('approve')}>
                Approve
              </Button>
              <Button variant="secondary" onClick={() => setRejecting(true)}>
                Reject…
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={() => window.print()}>
            Print / PDF
          </Button>
        </div>
      </div>
      {act.error && <Alert tone="danger" className="mb-4 print:hidden">{act.error.message}</Alert>}
      {f.status === 'draft' && <Alert className="mb-4 print:hidden">Draft: the forms show current data and are frozen when you submit.</Alert>}
      <article className="mx-auto max-w-[297mm] space-y-6 bg-surface p-6 text-[13px] print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">First Article Inspection Report</h1>
            <p className="text-muted">AS9102 · {FAI_REASON[f.reason]}</p>
          </div>
          <dl className="text-right">
            <dt className="text-muted">FAI no.</dt>
            <dd className="font-mono text-lg font-semibold">{f.number}</dd>
          </dl>
        </header>

        <section>
          <h2 className="mb-2 font-semibold">Form 1 · Part number accountability</h2>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Item label="Part number" value={form1.partNumber} />
            <Item label="Part name" value={form1.partName} />
            <Item label="Revision" value={form1.revision} />
            <Item label="Drawing" value={form1.drawingNo} />
            <Item label="Organisation" value={form1.organization} />
            <Item label="Serial / lot" value={form1.serialOrLot} />
            <Item label="Prepared by" value={f.preparedBy} />
            <Item label="Approved by" value={f.decidedByName ? `${f.decidedByName}${f.decidedAt ? `, ${formatDateTime(f.decidedAt)}` : ''}` : null} />
          </dl>
          {form1.subAssemblies.length > 0 && (
            <Table className="mt-2">
              <thead>
                <tr>
                  <Th>Sub-assembly</Th>
                  <Th>Revision</Th>
                  <Th>FAI</Th>
                </tr>
              </thead>
              <tbody>
                {form1.subAssemblies.map((s) => (
                  <tr key={s.partNumber} className="border-t border-line">
                    <Td>
                      {s.partNumber} {s.name}
                    </Td>
                    <Td>{s.revision ?? '—'}</Td>
                    <Td>{s.fai ?? <span className="text-danger">none approved</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Form 2 · Product accountability</h2>
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th>Lot / heat</Th>
                <Th>Supplier</Th>
                <Th>Receipt</Th>
              </tr>
            </thead>
            <tbody>
              {form2.materials.length === 0 && (
                <tr>
                  <Td colSpan={4} className="text-muted">
                    No purchased material traced (choose the first-article lot).
                  </Td>
                </tr>
              )}
              {form2.materials.map((m, i) => (
                <tr key={i} className="border-t border-line">
                  <Td>{m.item}</Td>
                  <Td className="font-mono">
                    {m.lot}
                    {m.heat && m.heat !== m.lot ? ` · heat ${m.heat}` : ''}
                  </Td>
                  <Td>{m.supplier ?? '—'}</Td>
                  <Td className="font-mono">{m.receipt ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 font-medium">Special processes</p>
              {form2.specialProcesses.length === 0 ? (
                <p className="text-muted">None.</p>
              ) : (
                <ul>
                  {form2.specialProcesses.map((p, i) => (
                    <li key={i}>
                      {p.process ?? 'Job work'} — {p.supplier} <span className="font-mono text-subtle">{p.order}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1 font-medium">Functional tests</p>
              {form2.functionalTests.length === 0 ? (
                <p className="text-muted">None.</p>
              ) : (
                <ul>
                  {form2.functionalTests.map((t, i) => (
                    <li key={i}>
                      {t.description}: <span className={t.result === 'pass' ? 'text-success' : 'text-danger'}>{t.result}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Form 3 · Characteristic accountability</h2>
          <Table>
            <thead>
              <tr>
                <Th>Balloon</Th>
                <Th>Characteristic</Th>
                <Th>Requirement</Th>
                <Th>Results</Th>
                <Th>Conforms</Th>
              </tr>
            </thead>
            <tbody>
              {form3.characteristics.length === 0 && (
                <tr>
                  <Td colSpan={5} className="text-muted">
                    Link the final inspection of the first article.
                  </Td>
                </tr>
              )}
              {form3.characteristics.map((c, i) => (
                <tr key={i} className="border-t border-line">
                  <Td className="font-mono">{c.balloon ?? '—'}</Td>
                  <Td>
                    {c.description}
                    {c.key && <span className="ml-1 text-[11px] text-warning">KEY</span>}
                  </Td>
                  <Td>{c.requirement}</Td>
                  <Td className="tabular">{c.results.map((r) => (/^-?\d/.test(r) ? String(Number(r)) : r)).join(' / ') || '—'}</Td>
                  <Td className={c.result === 'pass' ? 'text-success' : c.result === 'fail' ? 'text-danger' : 'text-muted'}>{c.result === 'pass' ? 'Yes' : c.result === 'fail' ? 'No' : 'Not measured'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
        {f.decisionNote && <p className="text-muted">Decision note: {f.decisionNote}</p>}
      </article>
      <div className="mt-4 print:hidden">
        <AttachmentsPanel ownerType="fai" ownerId={f.id} defaultKind="fai" title="Signed FAI and supporting files" />
      </div>
      {rejecting && <Reject f={f} onClose={() => setRejecting(false)} />}
    </>
  );
}

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] text-muted uppercase">{label}</dt>
      <dd>{value ?? '—'}</dd>
    </div>
  );
}

function Reject({ f, onClose }: { f: FaiDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api<FaiDetail>(`/quality/fais/${f.id}/reject`, { method: 'POST', scope: ws.scope, body: { note } }),
    onSuccess: (d) => {
      qc.setQueryData(['fai', ws.entityId, f.id], d);
      onClose();
    },
  });
  return (
    <FormDialog title={`Reject ${f.number}`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Reject">
      <Field label="Reason" error={fieldErrors(m.error).note}>
        {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
