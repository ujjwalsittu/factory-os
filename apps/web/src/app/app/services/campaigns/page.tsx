'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { CAMPAIGN_STATUS, type Campaign } from '@/lib/services';
import type { Item, Party } from '@/lib/types';

/** Test campaigns: quoted test services with the customer's payload in custody (decision 057). */
export default function CampaignsPage() {
  const ws = useWorkspace();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['campaigns', ws.entityId], queryFn: () => api<Campaign[]>('/services/campaigns', { scope: ws.scope }), enabled: !!ws.entityId });
  return (
    <>
      <PageHeader
        title="Test campaigns"
        description="Test services quoted as a lump sum: the customer's payload is held in custody (not stock), results are recorded per step and signed off by quality, and the campaign is invoiced once."
        actions={ws.entityId && ws.can('services.campaign.create') && <Button onClick={() => setAdding(true)}>New campaign</Button>}
      />
      <EntityGate what="services">
        {q.data?.length === 0 ? (
          <EmptyState icon={<FlaskConical className="size-5" />} title="No test campaigns yet" description="Create one from the customer's accepted quotation, then add its test steps." />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Campaign</Th>
                    <Th>Customer</Th>
                    <Th>Title</Th>
                    <Th className="text-right">Quoted</Th>
                    <Th>In custody</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.map((c) => (
                    <tr key={c.id} className="border-t border-line text-[13px]">
                      <Td>
                        <Link href={`/app/services/campaigns/${c.id}`} className="font-mono font-medium hover:text-accent">
                          {c.number}
                        </Link>
                        <p className="text-[12px] text-subtle">{formatDate(c.createdAt)}</p>
                      </Td>
                      <Td>{c.customerName}</Td>
                      <Td>{c.title}</Td>
                      <Td className="text-right font-mono">{formatMoney(c.quotedAmount)}</Td>
                      <Td>{c.inCustody ? <Badge tone="warning">{c.inCustody} item{c.inCustody === 1 ? '' : 's'}</Badge> : '—'}</Td>
                      <Td>
                        <Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        )}
      </EntityGate>
      {adding && <CampaignDialog onClose={() => setAdding(false)} onSaved={(id) => router.push(`/app/services/campaigns/${id}`)} />}
    </>
  );
}

function CampaignDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const parties = useQuery({ queryKey: ['parties', ws.tenantId, 'all'], queryFn: () => api<Party[]>('/parties', { scope: ws.scope }) });
  const items = useQuery({ queryKey: ['items', ws.tenantId, 'all'], queryFn: () => api<Item[]>('/items', { scope: ws.scope }) });
  const [f, setF] = useState({ customerId: '', title: '', scope: '', customerRef: '', serviceItemId: '', quotedAmount: '' });
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/services/campaigns', { method: 'POST', scope: ws.scope, body: { ...f, scope: f.scope || null, customerRef: f.customerRef || null } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      onClose();
      onSaved(r.id);
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="New test campaign" description="Starts as a draft; add the test steps, then accept it to receive the payload." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Create campaign" wide>
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
        <Field label="Customer reference" hint="Their PO or the quotation number" error={err.customerRef}>{(p) => <Input {...p} value={f.customerRef} onChange={set('customerRef')} />}</Field>
        <Field label="Title" error={err.title} className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={set('title')} required placeholder="TVAC qualification of 6U bus" />}</Field>
        <Field label="Scope" error={err.scope} className="sm:col-span-2">{(p) => <Input {...p} value={f.scope} onChange={set('scope')} placeholder="8 thermal cycles, −40 °C to +80 °C at 1e-5 mbar" />}</Field>
        <Field label="Service item" hint="A service item (SAC) for the test" error={err.serviceItemId}>
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
        <Field label="Quoted amount (₹)" error={err.quotedAmount}>{(p) => <Input {...p} value={f.quotedAmount} onChange={set('quotedAmount')} inputMode="decimal" required />}</Field>
      </div>
    </FormDialog>
  );
}
