'use client';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, DateInput } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Satellite } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney, today } from '@/lib/format';
import { type Subscription, SUBSCRIPTION_PERIOD, type SubscriptionPeriod, type SubscriptionPlan } from '@/lib/services';
import type { Item, Party } from '@/lib/types';

/** EarthNow subscriptions: a prepaid bundle of reports and alerts per period, fee in advance (decision 059). */
export default function SubscriptionsPage() {
  const ws = useWorkspace();
  const router = useRouter();
  const [dialog, setDialog] = useState<'plan' | 'subscription' | null>(null);
  const q = useQuery({ queryKey: ['subscriptions', ws.entityId], queryFn: () => api<Subscription[]>('/services/subscriptions', { scope: ws.scope }), enabled: !!ws.entityId });
  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Monitoring of a customer's area of interest. A plan is a bundle of reports and alerts per period with its fee invoiced in advance; anything delivered beyond the bundle is charged on the next invoice."
        actions={ws.entityId && ws.can('services.subscription.create') && <Button onClick={() => setDialog('subscription')}>New subscription</Button>}
      />
      <EntityGate what="services">
        <div className="space-y-4">
          {q.data?.length === 0 ? (
            <EmptyState icon={<Satellite className="size-5" />} title="No subscriptions yet" description="Add a plan below, then subscribe a customer's area of interest." />
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>Subscription</Th>
                      <Th>Customer</Th>
                      <Th>Plan</Th>
                      <Th>Area of interest</Th>
                      <Th>Next period</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data?.map((s) => (
                      <tr key={s.id} className="border-t border-line text-[13px]">
                        <Td>
                          <Link href={`/app/services/subscriptions/${s.id}`} className="font-mono font-medium hover:text-accent">
                            {s.number}
                          </Link>
                        </Td>
                        <Td>{s.customerName}</Td>
                        <Td>
                          <span className="font-mono">{s.planCode}</span>
                          <p className="text-[12px] text-subtle">{s.solution}</p>
                        </Td>
                        <Td>
                          {s.aoiName}
                          {s.aoiHectares && <span className="text-muted"> · {Number(s.aoiHectares)} ha</span>}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {s.next ? (
                            <>
                              {formatDate(s.next.start)} {s.next.due && <Badge tone="warning">Due</Badge>}
                            </>
                          ) : (
                            '—'
                          )}
                        </Td>
                        <Td>
                          {s.status === 'cancelled' ? (
                            <Badge tone={s.endDate && s.endDate >= today() ? 'warning' : 'neutral'}>{s.endDate && s.endDate >= today() ? `Ends ${formatDate(s.endDate)}` : 'Ended'}</Badge>
                          ) : s.startDate > today() ? (
                            <Badge tone="info">Starts {formatDate(s.startDate)}</Badge>
                          ) : (
                            <Badge tone="success">Active</Badge>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card>
          )}
          <Plans onAdd={() => setDialog('plan')} />
        </div>
      </EntityGate>
      {dialog === 'plan' && <PlanDialog onClose={() => setDialog(null)} />}
      {dialog === 'subscription' && <SubscribeDialog onClose={() => setDialog(null)} onSaved={(id) => router.push(`/app/services/subscriptions/${id}`)} />}
    </>
  );
}

function Plans({ onAdd }: { onAdd: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['subscription-plans', ws.entityId], queryFn: () => api<SubscriptionPlan[]>('/services/subscription-plans', { scope: ws.scope }), enabled: !!ws.entityId });
  const stop = useMutation({
    mutationFn: (id: string) => api(`/services/subscription-plans/${id}/stop`, { method: 'POST', scope: ws.scope }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['subscription-plans'] }),
  });
  return (
    <Card>
      <CardHeader
        title="Plans"
        description="What a period includes and costs. Changing what you offer means a new plan; subscribers move to it with Change plan."
        actions={
          ws.can('services.subscription.create') && (
            <Button size="sm" onClick={onAdd}>
              New plan
            </Button>
          )
        }
      />
      {q.data?.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-muted">No plans yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th>Period</Th>
                <Th className="text-right">Fee</Th>
                <Th className="text-right">Reports</Th>
                <Th className="text-right">Alerts</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data?.map((p) => (
                <tr key={p.id} className="border-t border-line text-[13px]">
                  <Td>
                    <span className="font-mono font-medium">{p.code}</span> <span className="text-muted">{p.name}</span> {!p.isActive && <Badge>Not offered</Badge>}
                    <p className="text-[12px] text-subtle">{p.solution}</p>
                  </Td>
                  <Td>{SUBSCRIPTION_PERIOD[p.period]}</Td>
                  <Td className="text-right font-mono">{formatMoney(p.fee)}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {p.includedReports} incl. · <span className="font-mono">{formatMoney(p.reportRate)}</span> extra
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {p.includedAlerts} incl. · <span className="font-mono">{formatMoney(p.alertRate)}</span> extra
                  </Td>
                  <Td className="text-right">
                    {ws.can('services.subscription.update') && p.isActive && (
                      <Button size="sm" variant="ghost" loading={stop.isPending && stop.variables === p.id} onClick={() => stop.mutate(p.id)}>
                        Stop offering
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function PlanDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ['items', ws.tenantId, 'all'], queryFn: () => api<Item[]>('/items', { scope: ws.scope }) });
  const [f, setF] = useState({ code: '', name: '', solution: '', period: 'month' as SubscriptionPeriod, fee: '', includedReports: '4', includedAlerts: '10', reportRate: '', alertRate: '', serviceItemId: '' });
  const m = useMutation({
    mutationFn: () =>
      api('/services/subscription-plans', {
        method: 'POST',
        scope: ws.scope,
        body: { ...f, includedReports: Number(f.includedReports), includedAlerts: Number(f.includedAlerts), reportRate: f.reportRate || '0', alertRate: f.alertRate || '0' },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['subscription-plans'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="New plan" description="The fee and any overage are invoiced as the service item (its SAC code and GST rate)." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Save" wide>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" error={err.code}>{(p) => <Input {...p} value={f.code} onChange={set('code')} className="font-mono uppercase" required autoFocus placeholder="CROP-STD" />}</Field>
        <Field label="Name" error={err.name} className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={set('name')} required placeholder="Crop health standard" />}</Field>
        <Field label="Solution" error={err.solution}>{(p) => <Input {...p} value={f.solution} onChange={set('solution')} required placeholder="Crop health" />}</Field>
        <Field label="Period" error={err.period}>
          {(p) => (
            <Select {...p} value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as SubscriptionPeriod })}>
              {(Object.keys(SUBSCRIPTION_PERIOD) as SubscriptionPeriod[]).map((k) => (
                <option key={k} value={k}>
                  {SUBSCRIPTION_PERIOD[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Fee per period (₹)" error={err.fee}>{(p) => <Input {...p} value={f.fee} onChange={set('fee')} inputMode="decimal" required />}</Field>
        <Field label="Reports included" error={err.includedReports}>{(p) => <Input {...p} type="number" min={0} step={1} value={f.includedReports} onChange={set('includedReports')} required />}</Field>
        <Field label="Alerts included" error={err.includedAlerts}>{(p) => <Input {...p} type="number" min={0} step={1} value={f.includedAlerts} onChange={set('includedAlerts')} required />}</Field>
        <div />
        <Field label="Extra report (₹)" error={err.reportRate}>{(p) => <Input {...p} value={f.reportRate} onChange={set('reportRate')} inputMode="decimal" />}</Field>
        <Field label="Extra alert (₹)" error={err.alertRate}>{(p) => <Input {...p} value={f.alertRate} onChange={set('alertRate')} inputMode="decimal" />}</Field>
        <Field label="Service item" hint="A service item (SAC)" error={err.serviceItemId}>
          {(p) => (
            <Select {...p} value={f.serviceItemId} onChange={set('serviceItemId')} required>
              <option value="">Choose…</option>
              {items.data?.filter((i) => i.type === 'service' && i.isActive).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code} · {i.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

function SubscribeDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['subscription-plans', ws.entityId], queryFn: () => api<SubscriptionPlan[]>('/services/subscription-plans', { scope: ws.scope }) });
  const parties = useQuery({ queryKey: ['parties', ws.tenantId, 'all'], queryFn: () => api<Party[]>('/parties', { scope: ws.scope }) });
  const [f, setF] = useState({ customerId: '', planId: '', customerRef: '', aoiName: '', aoiHectares: '', aoiNotes: '', startDate: today() });
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/services/subscriptions', { method: 'POST', scope: ws.scope, body: { ...f, customerRef: f.customerRef || null, aoiHectares: f.aoiHectares || null, aoiNotes: f.aoiNotes || null } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      onClose();
      onSaved(r.id);
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="New subscription" description="Periods run from the start date. Each period's fee is invoiced from a week before it starts." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Subscribe" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" error={err.customerId}>
          {(p) => (
            <Select {...p} value={f.customerId} onChange={set('customerId')} required autoFocus>
              <option value="">Choose…</option>
              {parties.data?.filter((c) => c.isCustomer && c.isActive).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Plan" error={err.planId}>
          {(p) => (
            <Select {...p} value={f.planId} onChange={set('planId')} required>
              <option value="">Choose…</option>
              {plans.data?.filter((x) => x.isActive).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} · {x.name} · {formatMoney(x.fee)}/{x.period}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Area of interest" error={err.aoiName}>{(p) => <Input {...p} value={f.aoiName} onChange={set('aoiName')} required placeholder="Nashik vineyards block A" />}</Field>
        <Field label="Area (ha)" error={err.aoiHectares}>{(p) => <Input {...p} value={f.aoiHectares} onChange={set('aoiHectares')} inputMode="decimal" />}</Field>
        <Field label="Start" hint="Up to a year back for one agreed earlier" error={err.startDate}>{(p) => <DateInput {...p} value={f.startDate} onChange={set('startDate')} required />}</Field>
        <Field label="Customer reference" error={err.customerRef}>{(p) => <Input {...p} value={f.customerRef} onChange={set('customerRef')} />}</Field>
        <Field label="AOI notes" hint="Boundary file, coordinates or village list" error={err.aoiNotes} className="sm:col-span-2">{(p) => <Input {...p} value={f.aoiNotes} onChange={set('aoiNotes')} />}</Field>
      </div>
    </FormDialog>
  );
}
