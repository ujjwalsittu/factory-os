'use client';
import { Alert, Badge, Button, Card, CardHeader, PageHeader, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { BILLABLE_KIND, type BillingRunDetail } from '@/lib/services';

const STATUS = {
  draft: { label: 'Draft', tone: 'warning' },
  submitted: { label: 'Submitted', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  deleted: { label: 'Draft deleted', tone: 'neutral' },
} as const;

/** One billing run: its invoices to review and submit, and what could not be billed. */
export default function BillingRunPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['billing-run', ws.entityId, id], queryFn: () => api<BillingRunDetail>(`/services/billing-runs/${id}`, { scope: ws.scope }), enabled: !!ws.entityId });
  const submit = useMutation({
    mutationFn: () => api<{ submitted: number; refused: number }>(`/services/billing-runs/${id}/submit`, { method: 'POST', scope: ws.scope }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['billing-run'] });
      void qc.invalidateQueries({ queryKey: ['billing-runs'] });
    },
  });
  const r = q.data;
  const drafts = r?.invoices.filter((i) => i.invoiceStatus === 'draft').length ?? 0;
  return (
    <>
      <PageHeader
        title={r ? r.number : 'Billing run'}
        description={r ? `Invoices dated ${formatDate(r.asOf)} · by ${r.createdByName}, ${formatDateTime(r.createdAt)}` : undefined}
        actions={
          drafts > 0 &&
          ws.can('selling.sales_invoice.submit') && (
            <Button loading={submit.isPending} onClick={() => submit.mutate()}>
              Submit all ({drafts})
            </Button>
          )
        }
      />
      <EntityGate what="services">
        {submit.error && <Alert tone="danger" className="mb-3">{submit.error.message}</Alert>}
        {submit.data && (
          <Alert tone={submit.data.refused ? 'warning' : 'success'} className="mb-3">
            {submit.data.submitted} submitted{submit.data.refused ? `; ${submit.data.refused} stayed draft (see below)` : ''}.
          </Alert>
        )}
        {r && (
          <div className="space-y-4">
            <Card>
              <CardHeader title="Invoices" description="Review or edit a draft from its invoice page; Submit all runs the usual checks on each one, and any refused stays a draft with the reason." />
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>Customer</Th>
                      <Th>Items</Th>
                      <Th>Invoice</Th>
                      <Th className="text-right">Total</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.invoices.map((i) => (
                      <tr key={i.id} className="border-t border-line align-top text-[13px]">
                        <Td>
                          {i.customerName}
                          {i.customerRef && <p className="font-mono text-[12px] text-subtle">PO {i.customerRef}</p>}
                        </Td>
                        <Td>
                          <ul className="space-y-0.5">
                            {i.items.map((it) => (
                              <li key={it.sourceId}>
                                <span className="text-subtle">{BILLABLE_KIND[it.kind].replace(/s$/, '')} · </span>
                                {it.label}
                              </li>
                            ))}
                          </ul>
                        </Td>
                        <Td>
                          {i.salesInvoiceId && i.invoiceStatus ? (
                            <>
                              <Link href={`/app/selling/invoices/${i.salesInvoiceId}`} className="font-mono hover:text-accent">
                                {i.invoiceNumber ?? 'Draft invoice'}
                              </Link>{' '}
                              <Badge tone={STATUS[i.invoiceStatus].tone}>{STATUS[i.invoiceStatus].label}</Badge>
                              {i.submitError && i.invoiceStatus === 'draft' && <p className="mt-1 text-[12px] text-danger">{i.submitError}</p>}
                            </>
                          ) : (
                            <span className="text-muted">Covered by membership, no invoice</span>
                          )}
                        </Td>
                        <Td className="text-right font-mono">{i.grandTotal ? formatMoney(i.grandTotal) : formatMoney(i.amount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card>
            {r.failures.length > 0 && (
              <Card>
                <CardHeader title="Not billed" description="These stay due; fix the cause and include them in the next run, or bill them from their own pages." />
                <ul className="divide-y divide-line text-[13px]">
                  {r.failures.map((f, n) => (
                    <li key={n} className="px-4 py-2">
                      {f.customerName && <span className="font-medium">{f.customerName} · </span>}
                      {f.items.join(', ')}
                      <p className="text-[12px] text-danger">{f.message}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </EntityGate>
    </>
  );
}
