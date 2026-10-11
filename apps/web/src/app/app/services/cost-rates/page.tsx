'use client';
import { Button, Card, Field, Input, PageHeader, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';

interface PersonRate {
  userId: string;
  name: string;
  email: string;
  current: string | null;
  history: { id: string; hourlyRate: string; effectiveFrom: string; setByName: string }[];
}

/** Hourly cost of each member's time for project labour (decision 058). Salary-sensitive: its own permission. */
export default function CostRatesPage() {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<PersonRate | null>(null);
  const q = useQuery({ queryKey: ['cost-rates', ws.entityId], queryFn: () => api<PersonRate[]>('/services/cost-rates', { scope: ws.scope }), enabled: !!ws.entityId });
  return (
    <>
      <PageHeader title="Cost rates" description="What an hour of each person's time costs this entity. Timesheets are valued at the rate in force on the day worked; a new rate never changes approved hours. Only people with this permission see rates." />
      <EntityGate what="services">
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th className="text-right">Rate now (₹/h)</Th>
                  <Th>History</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {q.data?.map((p) => (
                  <tr key={p.userId} className="border-t border-line text-[13px]">
                    <Td>
                      {p.name}
                      <p className="text-[12px] text-subtle">{p.email}</p>
                    </Td>
                    <Td className="text-right font-mono">{p.current ? formatMoney(p.current) : '—'}</Td>
                    <Td className="text-[12px] text-muted">{p.history.length ? p.history.map((h) => `${formatMoney(h.hourlyRate)} from ${formatDate(h.effectiveFrom)}`).join(' · ') : 'No rate'}</Td>
                    <Td className="text-right">
                      {ws.can('services.cost_rate.update') && (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                          New rate
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      </EntityGate>
      {editing && <RateDialog person={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RateDialog({ person, onClose }: { person: PersonRate; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ hourlyRate: '', effectiveFrom: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()) });
  const m = useMutation({
    mutationFn: () => api('/services/cost-rates', { method: 'POST', scope: ws.scope, body: { userId: person.userId, ...f } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cost-rates'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Cost rate for ${person.name}`} description="Applies to hours worked from this date until a later rate." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Save rate">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rate (₹ per hour)" error={err.hourlyRate}>{(p) => <Input {...p} value={f.hourlyRate} onChange={(e) => setF({ ...f, hourlyRate: e.target.value })} inputMode="decimal" required autoFocus />}</Field>
        <Field label="From" error={err.effectiveFrom}>{(p) => <Input {...p} type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} required />}</Field>
      </div>
    </FormDialog>
  );
}
