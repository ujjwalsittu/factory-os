'use client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BreakdownDialog } from '@/components/breakdown-dialog';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { DUE_LABEL, intervalLabel, type OrderRow, type Plan, STATUS_LABEL } from '@/lib/maintenance';

/** Maintenance (decision 066): what is due, and the orders being worked. */
export default function MaintenancePage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [breakdown, setBreakdown] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const gen = useMutation({
    mutationFn: () => api<{ created: { id: string; number: string; title: string }[] }>('/maintenance/due/generate', { method: 'POST', scope: ws.scope }),
    onSuccess: (r) => {
      setMade(r.created.length ? `Opened ${r.created.map((o) => `${o.number} (${o.title})`).join(', ')}.` : 'Nothing new is due.');
      void qc.invalidateQueries({ queryKey: ['maintenance'] });
    },
  });
  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Preventive plans fall due by the calendar or by running hours, whichever comes first. A breakdown blocks the machine on the schedule until its order is done."
        actions={
          ws.entityId && (
            <div className="flex gap-2">
              {ws.can('maintenance.breakdown.create') && (
                <Button variant="secondary" onClick={() => setBreakdown(true)}>
                  Report breakdown
                </Button>
              )}
              {ws.can('maintenance.order.create') && (
                <Button loading={gen.isPending} onClick={() => gen.mutate()}>
                  Open due orders
                </Button>
              )}
            </div>
          )
        }
      />
      <EntityGate what="maintenance">
        <div className="space-y-4">
          {gen.error && <Alert tone="danger">{gen.error.message}</Alert>}
          {made && <Alert tone="success">{made}</Alert>}
          {ws.can('maintenance.plan.read') && <Due />}
          <Orders />
        </div>
      </EntityGate>
      {breakdown && <BreakdownDialog onClose={() => setBreakdown(false)} />}
    </>
  );
}

function Due() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ['maintenance', 'plans', ws.entityId], queryFn: () => api<Plan[]>('/maintenance/plans', { scope: ws.scope }) });
  const open = useMutation({
    mutationFn: (planId: string) => api<{ id: string }>(`/maintenance/plans/${planId}/order`, { method: 'POST', scope: ws.scope }),
    onSuccess: (o) => {
      void qc.invalidateQueries({ queryKey: ['maintenance'] });
      router.push(`/app/maintenance/orders/${o.id}`);
    },
  });
  const rows = q.data ?? [];
  const attention = rows.filter((p) => p.due.status !== 'ok' || p.due.openOrder);
  return (
    <Card>
      <CardHeader
        title="Due"
        description={rows.length ? `${rows.filter((p) => p.due.status === 'overdue').length} overdue, ${rows.filter((p) => p.due.status === 'due_soon').length} due soon of ${rows.length} active plans` : undefined}
        actions={
          <Link className="text-[13px] font-medium text-accent hover:underline" href="/app/maintenance/plans">
            All plans
          </Link>
        }
      />
      {open.error && (
        <div className="px-4 pb-2">
          <Alert tone="danger">{open.error.message}</Alert>
        </div>
      )}
      {q.data && rows.length === 0 ? (
        <EmptyState icon={<Wrench className="size-5" />} title="No maintenance plans" description="Add a plan per machine: a service every so many days or running hours, with its checklist." />
      ) : attention.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-muted">Nothing is due. Every plan is within its interval.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Machine</Th>
                <Th>Plan</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th>Order</Th>
              </tr>
            </thead>
            <tbody>
              {attention.map((p) => (
                <Tr key={p.id}>
                  <Td className="text-[13px]">
                    <Link className="font-mono font-medium hover:text-accent" href={`/app/machines/${p.machineId}`}>
                      {p.machineCode}
                    </Link>{' '}
                    {p.machineName}
                  </Td>
                  <Td className="text-[13px]">
                    {p.name}
                    <span className="block text-subtle">{intervalLabel(p)}</span>
                  </Td>
                  <Td className="text-[13px] whitespace-nowrap">
                    {p.due.dueAt && formatDate(p.due.dueAt)}
                    {p.due.hoursLeft != null && <span className="block text-subtle">{p.due.hoursLeft >= 0 ? `${p.due.hoursLeft} h left` : `${-p.due.hoursLeft} h over`}</span>}
                  </Td>
                  <Td>
                    <Badge tone={DUE_LABEL[p.due.status][1]}>{DUE_LABEL[p.due.status][0]}</Badge>
                  </Td>
                  <Td className="text-[13px]">
                    {p.due.openOrder ? (
                      <Link className="font-mono hover:text-accent" href={`/app/maintenance/orders/${p.due.openOrder.id}`}>
                        {p.due.openOrder.number}
                      </Link>
                    ) : (
                      ws.can('maintenance.order.create') && (
                        <Button size="sm" variant="secondary" loading={open.isPending && open.variables === p.id} onClick={() => open.mutate(p.id)}>
                          Open order
                        </Button>
                      )
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function Orders() {
  const ws = useWorkspace();
  const router = useRouter();
  const [status, setStatus] = useState('open');
  const q = useQuery({ queryKey: ['maintenance', 'orders', ws.entityId, status], queryFn: () => api<OrderRow[]>(`/maintenance/orders${status ? `?status=${status}` : ''}`, { scope: ws.scope }) });
  return (
    <Card>
      <CardHeader
        title="Orders"
        actions={
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-40 text-[13px]">
            <option value="open">Open and in progress</option>
            <option value="done">Done, to verify</option>
            <option value="verified">Verified</option>
            <option value="cancelled">Cancelled</option>
            <option value="">All</option>
          </Select>
        }
      />
      {q.error && <Alert tone="danger">{q.error.message}</Alert>}
      {q.data?.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-muted">No orders here.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Machine</Th>
                <Th>What</Th>
                <Th>When</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((o) => (
                <Tr key={o.id} className="cursor-pointer" onClick={() => router.push(`/app/maintenance/orders/${o.id}`)}>
                  <Td className="text-[13px] whitespace-nowrap">
                    <Link className="font-mono font-medium hover:text-accent" href={`/app/maintenance/orders/${o.id}`} onClick={(e) => e.stopPropagation()}>
                      {o.number}
                    </Link>
                    <span className="block">{o.kind === 'breakdown' ? <Badge tone="danger">Breakdown</Badge> : <span className="text-subtle">Preventive</span>}</span>
                  </Td>
                  <Td className="text-[13px]">
                    <span className="font-mono">{o.machineCode}</span> {o.machineName}
                    {o.critical && <span className="block text-subtle">Critical</span>}
                  </Td>
                  <Td className="text-[13px]">{o.kind === 'breakdown' ? o.symptom : o.title}</Td>
                  <Td className="text-[13px] whitespace-nowrap">
                    {o.kind === 'breakdown' && o.failedAt ? `Stopped ${formatDateTime(o.failedAt)}` : o.scheduledStart ? `Planned ${formatDateTime(o.scheduledStart)}` : 'Not scheduled'}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_LABEL[o.status][1]}>{STATUS_LABEL[o.status][0]}</Badge>
                    {o.status === 'done' && o.critical && <span className="block text-[12px] text-warning">To verify</span>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}
