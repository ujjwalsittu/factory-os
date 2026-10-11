'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IndianRupee } from 'lucide-react';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney, today } from '@/lib/format';
import type { WorkCentre } from '@/lib/manufacturing';
import { formatMinutes, type RateCard, ROUNDING_STEPS } from '@/lib/services';
import type { Item } from '@/lib/types';

/** Hourly prices per machine (decision 055). */
export default function RateCardsPage() {
  const ws = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<RateCard | null>(null);
  const q = useQuery({ queryKey: ['rate-cards', ws.entityId], queryFn: () => api<RateCard[]>('/services/rate-cards', { scope: ws.scope }), enabled: !!ws.entityId });
  const canEdit = ws.can('services.rate_card.update');
  const now = today();
  return (
    <>
      <PageHeader
        title="Rate cards"
        description="The hourly price of each machine, with a member rate, a minimum per booking and the step usage is rounded up to. A booking is priced by the card valid on its start date."
        actions={ws.entityId && canEdit && <Button onClick={() => setAdding(true)}>New rate card</Button>}
      />
      <EntityGate what="services">
        {q.data?.length === 0 ? (
          <EmptyState icon={<IndianRupee className="size-5" />} title="No rate cards yet" description="Add a card for each machine you rent out by the hour." />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Machine</Th>
                    <Th>Service item</Th>
                    <Th className="text-right">Standard / h</Th>
                    <Th className="text-right">Member / h</Th>
                    <Th>Minimum</Th>
                    <Th>Rounding</Th>
                    <Th>Valid</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {q.data?.map((c) => {
                    const current = c.validFrom <= now && (!c.validTo || c.validTo >= now);
                    return (
                      <tr key={c.id} className="border-t border-line text-[13px]">
                        <Td>
                          <span className="font-mono font-medium">{c.machineCode}</span> <span className="text-muted">{c.machineName}</span>
                        </Td>
                        <Td>
                          <span className="font-mono">{c.itemCode}</span>
                        </Td>
                        <Td className="text-right font-mono">{formatMoney(c.standardRate)}</Td>
                        <Td className="text-right font-mono">{c.memberRate ? formatMoney(c.memberRate) : '—'}</Td>
                        <Td>{c.minimumMinutes ? formatMinutes(c.minimumMinutes) : '—'}</Td>
                        <Td>{c.roundingMinutes} min</Td>
                        <Td className="whitespace-nowrap">
                          {formatDate(c.validFrom)} → {c.validTo ? formatDate(c.validTo) : 'open'} {current && <Badge tone="success">Current</Badge>}
                        </Td>
                        <Td className="text-right">
                          {canEdit && !c.validTo && (
                            <Button size="sm" variant="ghost" onClick={() => setEnding(c)}>
                              End
                            </Button>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </Card>
        )}
      </EntityGate>
      {adding && <RateCardDialog onClose={() => setAdding(false)} />}
      {ending && <EndDialog card={ending} onClose={() => setEnding(null)} />}
    </>
  );
}

function RateCardDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const centres = useQuery({ queryKey: ['work-centres', ws.entityId], queryFn: () => api<WorkCentre[]>('/manufacturing/work-centres', { scope: ws.scope }) });
  const items = useQuery({ queryKey: ['items', ws.tenantId, 'all'], queryFn: () => api<Item[]>('/items', { scope: ws.scope }) });
  const [f, setF] = useState({ machineId: '', serviceItemId: '', standardRate: '', memberRate: '', minimumMinutes: '0', roundingMinutes: '15', validFrom: today(), validTo: '' });
  const m = useMutation({
    mutationFn: () =>
      api('/services/rate-cards', {
        method: 'POST',
        scope: ws.scope,
        body: { ...f, memberRate: f.memberRate || null, validTo: f.validTo || null, minimumMinutes: Number(f.minimumMinutes || 0), roundingMinutes: Number(f.roundingMinutes) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rate-cards'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="New rate card" description="Machine time is invoiced as the service item (its SAC code and GST rate)." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Save" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Machine" error={err.machineId}>
          {(p) => (
            <Select {...p} value={f.machineId} onChange={set('machineId')} required autoFocus>
              <option value="">Choose…</option>
              {centres.data?.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.machines.filter((mc) => mc.isActive).map((mc) => (
                    <option key={mc.id} value={mc.id}>
                      {mc.code} · {mc.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Service item" hint="A service item (SAC), e.g. machine time" error={err.serviceItemId}>
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
        <Field label="Standard rate (₹/h)" error={err.standardRate}>{(p) => <Input {...p} value={f.standardRate} onChange={set('standardRate')} inputMode="decimal" required />}</Field>
        <Field label="Member rate (₹/h)" hint="Blank: members pay the standard rate" error={err.memberRate}>{(p) => <Input {...p} value={f.memberRate} onChange={set('memberRate')} inputMode="decimal" />}</Field>
        <Field label="Minimum per booking (minutes)" hint="A multiple of the rounding" error={err.minimumMinutes}>{(p) => <Input {...p} value={f.minimumMinutes} onChange={set('minimumMinutes')} inputMode="numeric" />}</Field>
        <Field label="Round usage up to" error={err.roundingMinutes}>
          {(p) => (
            <Select {...p} value={f.roundingMinutes} onChange={set('roundingMinutes')}>
              {ROUNDING_STEPS.map((r) => (
                <option key={r} value={r}>
                  {r} minutes
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Valid from" error={err.validFrom}>{(p) => <Input {...p} type="date" value={f.validFrom} onChange={set('validFrom')} required />}</Field>
        <Field label="Valid to" hint="Blank: until ended" error={err.validTo}>{(p) => <Input {...p} type="date" value={f.validTo} onChange={set('validTo')} />}</Field>
      </div>
    </FormDialog>
  );
}

function EndDialog({ card, onClose }: { card: RateCard; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [validTo, setValidTo] = useState(today());
  const m = useMutation({
    mutationFn: () => api(`/services/rate-cards/${card.id}/end`, { method: 'POST', scope: ws.scope, body: { validTo } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rate-cards'] });
      onClose();
    },
  });
  return (
    <FormDialog title={`End the ${card.machineCode} rate card`} description="Bookings starting after this date need a new card." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="End card">
      <Field label="Last day">{(p) => <Input {...p} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} required />}</Field>
    </FormDialog>
  );
}
