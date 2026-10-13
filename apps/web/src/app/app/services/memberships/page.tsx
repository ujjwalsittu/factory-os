'use client';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, DateInput } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney, today } from '@/lib/format';
import { formatMinutes, type Membership, type Plan } from '@/lib/services';
import type { Item, Party } from '@/lib/types';

/** Studio memberships: a pool of machine-hours per term, fee invoiced upfront (decision 056). */
export default function MembershipsPage() {
  const ws = useWorkspace();
  const router = useRouter();
  const [dialog, setDialog] = useState<'plan' | 'membership' | null>(null);
  const q = useQuery({ queryKey: ['memberships', ws.entityId], queryFn: () => api<Membership[]>('/services/memberships', { scope: ws.scope }), enabled: !!ws.entityId });
  return (
    <>
      <PageHeader
        title="Studio memberships"
        description="A plan is a pool of machine-hours for a term, with its fee invoiced upfront. Members pay member rates; billing a booking draws hours first and invoices only what goes beyond them. Unused hours expire with the term."
        actions={ws.entityId && ws.can('services.membership.create') && <Button onClick={() => setDialog('membership')}>New membership</Button>}
      />
      <EntityGate what="services">
        <div className="space-y-4">
          {q.data?.length === 0 ? (
            <EmptyState icon={<BadgePercent className="size-5" />} title="No memberships yet" description="Add a plan below, then sign a customer up." />
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>Membership</Th>
                      <Th>Customer</Th>
                      <Th>Plan</Th>
                      <Th>Term</Th>
                      <Th className="text-right">Used</Th>
                      <Th className="text-right">Left</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data?.map((m) => (
                      <tr key={m.id} className="border-t border-line text-[13px]">
                        <Td>
                          <Link href={`/app/services/memberships/${m.id}`} className="font-mono font-medium hover:text-accent">
                            {m.number}
                          </Link>
                        </Td>
                        <Td>{m.customerName}</Td>
                        <Td>
                          <span className="font-mono">{m.planCode}</span>
                        </Td>
                        <Td className="whitespace-nowrap">
                          {formatDate(m.startsOn)} → {formatDate(m.endsOn)}
                        </Td>
                        <Td className="text-right whitespace-nowrap">{formatMinutes(m.usedMinutes)}</Td>
                        <Td className="text-right whitespace-nowrap">{formatMinutes(m.remainingMinutes)}</Td>
                        <Td>
                          <MembershipStatus m={m} />
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
      {dialog === 'membership' && <MembershipDialog onClose={() => setDialog(null)} onSaved={(id) => router.push(`/app/services/memberships/${id}`)} />}
    </>
  );
}

function MembershipStatus({ m }: { m: Membership }) {
  const now = today();
  if (m.status === 'cancelled') return <Badge tone="danger">Cancelled</Badge>;
  if (m.endsOn < now) return <Badge>Expired</Badge>;
  if (m.startsOn > now) return <Badge tone="info">Starts {formatDate(m.startsOn)}</Badge>;
  return <Badge tone="success">Active</Badge>;
}

function Plans({ onAdd }: { onAdd: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plans', ws.entityId], queryFn: () => api<Plan[]>('/services/plans', { scope: ws.scope }), enabled: !!ws.entityId });
  const off = useMutation({
    mutationFn: (id: string) => api(`/services/plans/${id}/deactivate`, { method: 'POST', scope: ws.scope }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['plans'] }),
  });
  const canEdit = ws.can('services.membership.update');
  return (
    <Card>
      <CardHeader
        title="Plans"
        description="What a membership includes and costs. Changing what you offer means a new plan; existing memberships keep their terms."
        actions={
          ws.can('services.membership.create') && (
            <Button size="sm" onClick={onAdd}>
              New plan
            </Button>
          )
        }
      />
      {q.data?.length === 0 ? (
        <EmptyState size="compact" title="No plans yet" />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th className="text-right">Hours</Th>
                <Th>Term</Th>
                <Th className="text-right">Fee</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data?.map((p) => (
                <tr key={p.id} className="border-t border-line text-[13px]">
                  <Td>
                    <span className="font-mono font-medium">{p.code}</span> <span className="text-muted">{p.name}</span> {!p.isActive && <Badge>Not offered</Badge>}
                  </Td>
                  <Td className="text-right">{p.includedMinutes / 60}</Td>
                  <Td>{p.termMonths} months</Td>
                  <Td className="text-right font-mono">{formatMoney(p.fee)}</Td>
                  <Td className="text-right">
                    {canEdit && p.isActive && (
                      <Button size="sm" variant="ghost" loading={off.isPending && off.variables === p.id} onClick={() => off.mutate(p.id)}>
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
  const [f, setF] = useState({ code: '', name: '', includedHours: '100', termMonths: '12', fee: '', serviceItemId: '' });
  const m = useMutation({
    mutationFn: () => api('/services/plans', { method: 'POST', scope: ws.scope, body: { ...f, includedHours: Number(f.includedHours), termMonths: Number(f.termMonths) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plans'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="New plan" description="The fee is invoiced as the service item (its SAC code and GST rate) when a membership starts." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Save" wide>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" error={err.code}>{(p) => <Input {...p} value={f.code} onChange={set('code')} className="font-mono uppercase" required autoFocus placeholder="STUDIO-100" />}</Field>
        <Field label="Name" error={err.name} className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={set('name')} required placeholder="Studio 100 hours" />}</Field>
        <Field label="Machine-hours included" error={err.includedHours}>{(p) => <Input {...p} type="number" step={1} min={1} value={f.includedHours} onChange={set('includedHours')} required />}</Field>
        <Field label="Term (months)" error={err.termMonths}>{(p) => <Input {...p} type="number" step={1} min={1} value={f.termMonths} onChange={set('termMonths')} required />}</Field>
        <Field label="Fee (₹)" error={err.fee}>{(p) => <Input {...p} value={f.fee} onChange={set('fee')} inputMode="decimal" required />}</Field>
        <Field label="Service item" hint="A service item (SAC) for the fee" error={err.serviceItemId} className="sm:col-span-3">
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

function MembershipDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['plans', ws.entityId], queryFn: () => api<Plan[]>('/services/plans', { scope: ws.scope }) });
  const parties = useQuery({ queryKey: ['parties', ws.tenantId, 'all'], queryFn: () => api<Party[]>('/parties', { scope: ws.scope }) });
  const [f, setF] = useState({ customerId: '', planId: '', startsOn: today() });
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/services/memberships', { method: 'POST', scope: ws.scope, body: f }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['memberships'] });
      onClose();
      onSaved(r.id);
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="New membership" description="The plan fee becomes a draft tax invoice; submit it from Sales invoices." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Create membership">
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
                  {x.code} · {x.includedMinutes / 60} h · {x.termMonths} months
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Starts on" error={err.startsOn}>{(p) => <DateInput {...p} value={f.startsOn} onChange={set('startsOn')} required />}</Field>
      </div>
    </FormDialog>
  );
}
