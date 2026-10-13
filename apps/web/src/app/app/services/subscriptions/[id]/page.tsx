'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th, DateInput } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { SUBSCRIPTION_PERIOD, type SubscriptionDetail, type SubscriptionPlan } from '@/lib/services';

type Dialog = { kind: 'delivery' } | { kind: 'reverse'; id: string; title: string } | { kind: 'plan' } | { kind: 'cancel' };

/** One subscription: periods with the bundle used and their invoices, deliveries, plan history. */
export default function SubscriptionPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const q = useQuery({ queryKey: ['subscription', ws.entityId, id], queryFn: () => api<SubscriptionDetail>(`/services/subscriptions/${id}`, { scope: ws.scope }), enabled: !!ws.entityId });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['subscription'] });
    void qc.invalidateQueries({ queryKey: ['subscriptions'] });
  };
  const invoice = useMutation({
    mutationFn: () => api<{ invoiceId: string }>(`/services/subscriptions/${id}/invoice`, { method: 'POST', scope: ws.scope, body: {} }),
    onSuccess: (r) => {
      refresh();
      router.push(`/app/selling/invoices/${r.invoiceId}`);
    },
  });
  const s = q.data;
  const edit = ws.can('services.subscription.update');
  const canBill = ws.can('services.billing.create') && ws.can('selling.sales_invoice.create');
  const active = s?.status === 'active';
  const open = s && (active || (s.endDate && s.endDate >= s.today));
  const unbilledOverage = s?.periods.some((p) => p.ended && !p.overageInvoice && Number(p.overageAmount) > 0);
  const unbilledProration = s?.changes.some((c) => Number(c.prorationAmount) > 0 && !c.prorationInvoiced);
  const billable = s && (s.next?.due || unbilledOverage || unbilledProration);
  return (
    <>
      <PageHeader
        title={s ? s.number : 'Subscription'}
        description={s ? `${s.customerName} · ${s.aoiName}` : undefined}
        actions={
          s && (
            <div className="flex flex-wrap gap-2">
              {billable && canBill && (
                <Button loading={invoice.isPending} onClick={() => invoice.mutate()}>
                  {s.next?.due ? 'Invoice next period' : 'Invoice overage'}
                </Button>
              )}
              {active && edit && (
                <Button variant="secondary" onClick={() => setDialog({ kind: 'plan' })} disabled={!!s.pendingChange}>
                  Change plan
                </Button>
              )}
              {active && edit && (
                <Button variant="ghost" onClick={() => setDialog({ kind: 'cancel' })}>
                  Cancel at period end
                </Button>
              )}
            </div>
          )
        }
      />
      <EntityGate what="services">
        {invoice.error && <Alert tone="danger" className="mb-3">{invoice.error.message}</Alert>}
        {s && (
          <div className="space-y-4">
            <Card>
              <dl className="grid gap-x-6 gap-y-3 p-4 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="Plan">
                  <span className="font-mono">{s.plan.code}</span> {s.plan.name}
                  <span className="block text-muted">
                    {formatMoney(s.plan.fee)} {SUBSCRIPTION_PERIOD[s.plan.period].toLowerCase()} · {s.plan.includedReports} reports, {s.plan.includedAlerts} alerts
                  </span>
                </Detail>
                <Detail label="Area of interest">
                  {s.aoiName}
                  {s.aoiHectares && <span className="block text-muted">{Number(s.aoiHectares).toLocaleString('en-IN')} ha</span>}
                </Detail>
                <Detail label="Runs">
                  From {formatDate(s.startDate)}
                  {s.endDate && ` to ${formatDate(s.endDate)}`}
                </Detail>
                <Detail label="Next period">{s.next ? `${formatDate(s.next.start)}${s.next.due ? ' · due' : ''}` : '—'}</Detail>
                {s.customerRef && <Detail label="Customer reference">{s.customerRef}</Detail>}
                {s.pendingChange && (
                  <Detail label="Pending change">
                    {s.pendingChange.toPlan} from {formatDate(s.pendingChange.effectiveOn)}
                  </Detail>
                )}
                {s.cancelReason && <Detail label="Cancelled because">{s.cancelReason}</Detail>}
                {s.aoiNotes && <Detail label="AOI notes">{s.aoiNotes}</Detail>}
              </dl>
            </Card>

            <Card>
              <CardHeader title="Periods" description="Each period’s fee is invoiced in advance. Reports and alerts beyond its bundle are charged once the period ends." />
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>Period</Th>
                      <Th>Fee</Th>
                      <Th className="text-right">Reports</Th>
                      <Th className="text-right">Alerts</Th>
                      <Th className="text-right">Overage</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.periods.map((p) => (
                      <tr key={p.index} className="border-t border-line text-[13px]">
                        <Td className="whitespace-nowrap">
                          {formatDate(p.start)} → {formatDate(p.end)}
                          {!p.ended && p.start <= s.today && <Badge tone="accent" className="ml-2">Current</Badge>}
                        </Td>
                        <Td>
                          <span className="font-mono">{formatMoney(p.fee)}</span> <InvoiceLink inv={p.feeInvoice} none={Number(p.fee) ? 'not invoiced' : 'no fee'} />
                        </Td>
                        <Td className="text-right whitespace-nowrap">
                          {p.reports} / {p.includedReports}
                        </Td>
                        <Td className="text-right whitespace-nowrap">
                          {p.alerts} / {p.includedAlerts}
                        </Td>
                        <Td className="text-right whitespace-nowrap">
                          {Number(p.overageAmount) ? (
                            <>
                              <span className="font-mono">{formatMoney(p.overageAmount)}</span> <InvoiceLink inv={p.overageInvoice} none={p.ended ? 'to invoice' : 'so far'} />
                            </>
                          ) : (
                            '—'
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Deliveries"
                description="Reports and alerts sent to the customer, counted in the period of their date. Entries are kept; a wrong one is reversed."
                actions={
                  open &&
                  edit && (
                    <Button size="sm" onClick={() => setDialog({ kind: 'delivery' })}>
                      Record delivery
                    </Button>
                  )
                }
              />
              {s.deliveries.length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-muted">Nothing delivered yet.</p>
              ) : (
                <ul className="divide-y divide-line text-[13px]">
                  {s.deliveries.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2">
                      <span className={d.reversed || d.reversalOf ? 'text-muted' : undefined}>
                        <Badge tone={d.kind === 'report' ? 'info' : 'warning'}>{d.kind === 'report' ? 'Report' : 'Alert'}</Badge> {formatDate(d.deliveredOn)} · {d.title}
                        {d.reference && <span className="font-mono text-subtle"> · {d.reference}</span>}
                        {d.reversed && <span> (reversed)</span>}
                      </span>
                      {edit && !d.reversed && !d.reversalOf && (
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'reverse', id: d.id, title: d.title })}>
                          Reverse
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {s.changes.length > 0 && (
              <Card>
                <CardHeader title="Plan changes" description="Upgrades apply at once with the fee difference for the rest of the period on the next invoice; downgrades start with the next period." />
                <ul className="divide-y divide-line text-[13px]">
                  {s.changes.map((c) => (
                    <li key={c.id} className="flex justify-between gap-2 px-4 py-2">
                      <span>
                        {c.fromPlan} → {c.toPlan} from {formatDate(c.effectiveOn)}
                      </span>
                      <span className="font-mono">{Number(c.prorationAmount) ? `${formatMoney(c.prorationAmount)} ${c.prorationInvoiced ? 'invoiced' : 'to invoice'}` : '—'}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </EntityGate>
      {s && dialog?.kind === 'delivery' && <DeliveryDialog id={s.id} today={s.today} onClose={() => setDialog(null)} onDone={refresh} />}
      {s && dialog?.kind === 'reverse' && <ReverseDialog id={dialog.id} title={dialog.title} onClose={() => setDialog(null)} onDone={refresh} />}
      {s && dialog?.kind === 'plan' && <PlanChangeDialog s={s} onClose={() => setDialog(null)} onDone={refresh} />}
      {s && dialog?.kind === 'cancel' && <CancelDialog s={s} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

function InvoiceLink({ inv, none }: { inv: SubscriptionDetail['periods'][number]['feeInvoice']; none: string }) {
  if (!inv) return <span className="text-subtle">· {none}</span>;
  return (
    <Link href={`/app/selling/invoices/${inv.id}`} className="text-muted hover:text-accent">
      · {inv.number ?? 'draft invoice'}
    </Link>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-subtle">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function useAction<T = unknown>(path: string, onDone: () => void, onClose: () => void) {
  const ws = useWorkspace();
  return useMutation({
    mutationFn: (body: unknown) => api<T>(path, { method: 'POST', scope: ws.scope, body }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
}

function DeliveryDialog({ id, today, onClose, onDone }: { id: string; today: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ kind: 'report', deliveredOn: today, title: '', reference: '' });
  const m = useAction(`/services/subscriptions/${id}/deliveries`, onDone, onClose);
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="Record delivery" onClose={onClose} onSubmit={() => m.mutate({ ...f, reference: f.reference || null })} pending={m.isPending} error={m.error} submitLabel="Record">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind" error={err.kind}>
          {(p) => (
            <Select {...p} value={f.kind} onChange={set('kind')}>
              <option value="report">Report</option>
              <option value="alert">Alert</option>
            </Select>
          )}
        </Field>
        <Field label="Delivered on" error={err.deliveredOn}>{(p) => <DateInput {...p} value={f.deliveredOn} onChange={set('deliveredOn')} required />}</Field>
      </div>
      <Field label="Title" error={err.title}>{(p) => <Input {...p} value={f.title} onChange={set('title')} required autoFocus placeholder="Weekly crop health report" />}</Field>
      <Field label="Reference" hint="Report number or link" error={err.reference}>{(p) => <Input {...p} value={f.reference} onChange={set('reference')} />}</Field>
    </FormDialog>
  );
}

function ReverseDialog({ id, title, onClose, onDone }: { id: string; title: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const m = useAction(`/services/subscription-deliveries/${id}/reverse`, onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Reverse “${title}”`} description="The entry stays; a reversal takes it out of the count." onClose={onClose} onSubmit={() => m.mutate({ reason })} pending={m.isPending} error={m.error} submitLabel="Reverse">
      <Field label="Reason" error={err.reason}>{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}</Field>
    </FormDialog>
  );
}

function PlanChangeDialog({ s, onClose, onDone }: { s: SubscriptionDetail; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const plans = useQuery({ queryKey: ['subscription-plans', ws.entityId], queryFn: () => api<SubscriptionPlan[]>('/services/subscription-plans', { scope: ws.scope }) });
  const [planId, setPlanId] = useState('');
  const m = useAction(`/services/subscriptions/${s.id}/change-plan`, onDone, onClose);
  const err = fieldErrors(m.error);
  const to = plans.data?.find((p) => p.id === planId);
  const upgrade = to && Number(to.fee) > Number(s.plan.fee);
  return (
    <FormDialog title="Change plan" description="An upgrade applies today: the bigger bundle now, and the fee difference for the rest of this period on the next invoice. A downgrade starts with the next period." onClose={onClose} onSubmit={() => m.mutate({ planId })} pending={m.isPending} error={m.error} submitLabel="Change plan">
      <Field label="New plan" error={err.planId}>
        {(p) => (
          <Select {...p} value={planId} onChange={(e) => setPlanId(e.target.value)} required autoFocus>
            <option value="">Choose…</option>
            {plans.data?.filter((x) => x.isActive && x.id !== s.plan.id && x.period === s.plan.period).map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} · {x.name} · {formatMoney(x.fee)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {to && <p className="text-[13px] text-muted">{upgrade ? 'Upgrade: applies today, prorated.' : 'Downgrade: applies from the next period.'}</p>}
    </FormDialog>
  );
}

function CancelDialog({ s, onClose, onDone }: { s: SubscriptionDetail; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const m = useAction(`/services/subscriptions/${s.id}/cancel`, onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Cancel ${s.number}`} description="Monitoring continues to the end of the current or last invoiced period; its overage goes on a final invoice after that." onClose={onClose} onSubmit={() => m.mutate({ reason })} pending={m.isPending} error={m.error} submitLabel="Cancel at period end">
      <Field label="Reason" error={err.reason}>{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}</Field>
    </FormDialog>
  );
}
