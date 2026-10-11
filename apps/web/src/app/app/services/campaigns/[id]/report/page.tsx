'use client';
import { Alert, Button } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { type CampaignDetail, STEP_RESULT } from '@/lib/services';

/** Printable test report of an approved campaign (decision 057). */
export default function CampaignReportPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['campaign', ws.entityId, id], queryFn: () => api<CampaignDetail>(`/services/campaigns/${id}`, { scope: ws.scope }), enabled: !!ws.entityId });
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!q.data) return <p>Loading…</p>;
  const c = q.data;
  const entity = ws.tenantCtx.entities.find((e) => e.id === ws.entityId);
  return (
    <div className="mx-auto max-w-5xl space-y-5 print:max-w-none print:text-black">
      <div className="flex gap-4 print:hidden">
        <Link className="text-accent" href={`/app/services/campaigns/${c.id}`}>
          Back to campaign
        </Link>
        <Button onClick={() => window.print()} disabled={!c.reportApprovedAt}>
          Print / save PDF
        </Button>
      </div>
      {!c.reportApprovedAt && <Alert tone="warning">The report is not approved yet; this is a preview.</Alert>}
      <article className="space-y-5 border border-line bg-surface p-6 text-[13px] print:border-black print:bg-white print:p-0">
        <header className="flex flex-wrap justify-between gap-4 border-b border-line pb-4">
          <div>
            <h1 className="text-2xl font-semibold">Test report</h1>
            <p className="mt-1 font-semibold">{entity?.legalName}</p>
          </div>
          <div className="text-right">
            <p className="font-mono font-semibold">{c.number}</p>
            {c.reportApprovedAt && <p>Issued {formatDate(c.reportApprovedAt)}</p>}
          </div>
        </header>
        <section className="grid gap-2 sm:grid-cols-2">
          <p>
            <span className="text-muted">Customer</span> {c.customerName}
            {c.customerRef && ` · ref ${c.customerRef}`}
          </p>
          <p>
            <span className="text-muted">Test</span> {c.title}
          </p>
          {c.scope && (
            <p className="sm:col-span-2">
              <span className="text-muted">Scope</span> {c.scope}
            </p>
          )}
        </section>
        <section>
          <h2 className="mb-2 font-semibold">Item tested</h2>
          <ul className="list-disc pl-5">
            {c.custody.map((i) => (
              <li key={i.id}>
                {i.description}
                {i.qty > 1 && ` × ${i.qty}`}
                {i.serialNo && `, S/N ${i.serialNo}`} (received {formatDate(i.receivedAt)}, challan {i.inwardChallanNo}; {i.receivedCondition})
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-2 font-semibold">Results</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="py-1 pr-2">Step</th>
                <th className="py-1 pr-2">Requirement</th>
                <th className="py-1 pr-2">Measured</th>
                <th className="py-1">Result</th>
              </tr>
            </thead>
            <tbody>
              {c.steps.map((s) => (
                <tr key={s.id} className="border-b border-line align-top">
                  <td className="py-1 pr-2">
                    {s.seq} {s.name}
                  </td>
                  <td className="py-1 pr-2">{s.requirement ?? '—'}</td>
                  <td className="py-1 pr-2">
                    {s.measured ?? '—'}
                    {s.notes && <span className="block text-muted">{s.notes}</span>}
                  </td>
                  <td className="py-1 font-semibold">{STEP_RESULT[s.result].label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {c.files.length > 0 && (
          <section>
            <h2 className="mb-2 font-semibold">Attached records</h2>
            <ul className="list-disc pl-5">
              {c.files.map((f) => (
                <li key={f.id}>{f.fileName}</li>
              ))}
            </ul>
          </section>
        )}
        <section className="border-t border-line pt-4">
          <h2 className="mb-1 font-semibold">Conclusion</h2>
          <p>{c.reportSummary ?? '—'}</p>
          {c.reportApprovedAt && (
            <p className="mt-4">
              Approved by <span className="font-semibold">{c.approvedByName}</span> on {formatDateTime(c.reportApprovedAt)}
            </p>
          )}
        </section>
      </article>
    </div>
  );
}
