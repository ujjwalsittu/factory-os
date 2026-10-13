'use client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Table, Td, Th, DateInput } from '@factoryos/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, today } from '@/lib/format';
import { BILLABLE_KIND, type BillableKind, type BillingPreview, type BillingRun } from '@/lib/services';

const ALL = Object.keys(BILLABLE_KIND) as BillableKind[];

/** Billing runs (decision 060): everything due across services, one draft invoice per customer and PO. */
export default function BillingRunsPage() {
  const ws = useWorkspace();
  const router = useRouter();
  const [preparing, setPreparing] = useState(false);
  const q = useQuery({ queryKey: ['billing-runs', ws.entityId], queryFn: () => api<BillingRun[]>('/services/billing-runs', { scope: ws.scope }), enabled: !!ws.entityId });
  const canRun = ws.can('services.billing_run.create') && ws.can('services.billing.create') && ws.can('selling.sales_invoice.create');
  return (
    <>
      <PageHeader
        title="Billing runs"
        description="Raise everything due across subscriptions, machine bookings, project milestones and test campaigns at once: one draft invoice per customer and PO, reviewed and then submitted together."
        actions={ws.entityId && canRun && !preparing && <Button onClick={() => setPreparing(true)}>New run</Button>}
      />
      <EntityGate what="services">
        <div className="space-y-4">
          {preparing && <NewRun onCancel={() => setPreparing(false)} onDone={(id) => router.push(`/app/services/billing-runs/${id}`)} />}
          {q.data?.length === 0 && !preparing ? (
            <EmptyState icon={<ReceiptText className="size-5" />} title="No billing runs yet" description="Start one to see everything that is due." />
          ) : (
            (q.data?.length ?? 0) > 0 && (
              <Card>
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Run</Th>
                        <Th>Invoice date</Th>
                        <Th className="text-right">Invoices</Th>
                        <Th className="text-right">Total</Th>
                        <Th>State</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data?.map((r) => (
                        <tr key={r.id} className="border-t border-line text-[13px]">
                          <Td>
                            <Link href={`/app/services/billing-runs/${r.id}`} className="font-mono font-medium hover:text-accent">
                              {r.number}
                            </Link>
                            <p className="text-[12px] text-subtle">
                              {r.createdByName} · {formatDateTime(r.createdAt)}
                            </p>
                          </Td>
                          <Td>{formatDate(r.asOf)}</Td>
                          <Td className="text-right">{r.invoices}</Td>
                          <Td className="text-right font-mono">{formatMoney(r.total ?? '0')}</Td>
                          <Td className="whitespace-nowrap">
                            {r.drafts ? <Badge tone="warning">{r.drafts} draft{r.drafts === 1 ? '' : 's'}</Badge> : <Badge tone="success">Submitted</Badge>} {r.failures.length > 0 && <Badge tone="danger">{r.failures.length} not billed</Badge>}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </Card>
            )
          )}
        </div>
      </EntityGate>
    </>
  );
}

function NewRun({ onCancel, onDone }: { onCancel: () => void; onDone: (id: string) => void }) {
  const ws = useWorkspace();
  const [asOf, setAsOf] = useState(today());
  const [kinds, setKinds] = useState<BillableKind[]>(ALL);
  const preview = useQuery({
    queryKey: ['billing-preview', ws.entityId, kinds.join(',')],
    queryFn: () => api<BillingPreview>(`/services/billing-runs/preview?kinds=${kinds.join(',')}`, { scope: ws.scope }),
    enabled: kinds.length > 0,
  });
  const run = useMutation({
    mutationFn: () => api<{ id: string }>('/services/billing-runs', { method: 'POST', scope: ws.scope, body: { asOf, kinds } }),
    onSuccess: (r) => onDone(r.id),
  });
  const p = preview.data;
  const toggle = (k: BillableKind) => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]);
  return (
    <Card>
      <CardHeader
        title="New billing run"
        description="Check what is due, then create the drafts. Nothing is written until you do."
        actions={
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Close
          </Button>
        }
      />
      <div className="space-y-4 px-4 pb-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Invoice date">{(props) => <DateInput {...props} value={asOf} max={today()} onChange={(e) => setAsOf(e.target.value)} />}</Field>
          <fieldset className="flex flex-wrap gap-3 text-[13px]">
            <legend className="mb-1 text-[12px] text-subtle">Include</legend>
            {ALL.map((k) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggle(k)} />
                {BILLABLE_KIND[k]}
              </label>
            ))}
          </fieldset>
        </div>
        {run.error && <Alert tone="danger">{run.error.message}</Alert>}
        {preview.error && <Alert tone="danger">{preview.error.message}</Alert>}
        {p && (
          <>
            {p.groups.length === 0 ? (
              <p className="text-[13px] text-muted">Nothing is due.</p>
            ) : (
              <div className="overflow-x-auto rounded border border-line">
                <Table>
                  <thead>
                    <tr>
                      <Th>Customer</Th>
                      <Th>Items</Th>
                      <Th className="text-right">Before GST</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.groups.map((g) => (
                      <tr key={`${g.customerId}|${g.customerRef ?? ''}`} className="border-t border-line align-top text-[13px]">
                        <Td>
                          {g.customerName}
                          {g.customerRef && <p className="font-mono text-[12px] text-subtle">PO {g.customerRef}</p>}
                        </Td>
                        <Td>
                          <ul className="space-y-0.5">
                            {g.items.map((i) => (
                              <li key={i.sourceId}>
                                <span className="text-subtle">{BILLABLE_KIND[i.kind].replace(/s$/, '')} · </span>
                                {i.label}
                                {Number(i.amount) === 0 && <span className="text-muted"> (covered by membership)</span>}
                              </li>
                            ))}
                          </ul>
                        </Td>
                        <Td className="text-right font-mono">{formatMoney(g.amount)}</Td>
                      </tr>
                    ))}
                    <tr className="border-t border-line text-[13px] font-medium">
                      <Td>Total</Td>
                      <Td>
                        {p.groups.length} customer group{p.groups.length === 1 ? '' : 's'}
                      </Td>
                      <Td className="text-right font-mono">{formatMoney(p.total)}</Td>
                    </tr>
                  </tbody>
                </Table>
              </div>
            )}
            {p.skipped.length > 0 && (
              <Alert tone="warning">
                Not billable now: {p.skipped.map((s) => s.message).join('; ')}
              </Alert>
            )}
            <div className="flex justify-end">
              <Button loading={run.isPending} disabled={!p.groups.length} onClick={() => run.mutate()}>
                Create drafts
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
