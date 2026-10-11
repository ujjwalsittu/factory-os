'use client';
import { Field, Input, Select } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { CAPA_SOURCE, type CapaPerson, type CapaRow, type NcrDetail } from '@/lib/quality';

/** Raise a CAPA (decision 061): from an NCR, which it links and whose description seeds the problem, or standalone. */
export function RaiseCapaDialog({ ncr, onClose }: { ncr?: NcrDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const people = useQuery({ queryKey: ['capa-people', ws.tenantId], queryFn: () => api<CapaPerson[]>('/quality/capa-people', { scope: ws.scope }) });
  const [f, setF] = useState({
    source: (ncr ? 'ncr' : 'audit') as keyof typeof CAPA_SOURCE,
    title: '',
    problem: ncr ? `${ncr.number}: ${ncr.itemCode} ${ncr.itemName}, ${ncr.description}` : '',
    severity: 'minor' as 'minor' | 'major',
    ownerUserId: ws.me.user.id,
    verifyAfterDays: '60',
  });
  const m = useMutation({
    mutationFn: () => api<CapaRow>('/quality/capas', { method: 'POST', scope: ws.scope, body: { ...f, verifyAfterDays: Number(f.verifyAfterDays), ncrIds: ncr ? [ncr.id] : [] } }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['capas'] });
      router.push(`/app/quality/capas/${c.id}`);
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog
      title="Raise CAPA"
      description={ncr ? `Linked to ${ncr.number}. Find the root cause, act on it and check later that it worked.` : 'Find the root cause, act on it and check later that it worked.'}
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel="Raise CAPA"
      wide
    >
      <Field label="Title" error={err.title}>
        {(p) => <Input {...p} value={f.title} onChange={set('title')} required autoFocus placeholder="A short name for the problem" />}
      </Field>
      <Field label="Problem (D2)" error={err.problem}>
        {(p) => <Input {...p} value={f.problem} onChange={set('problem')} required placeholder="What, where, when and how much" />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {!ncr && (
          <Field label="Source" error={err.source}>
            {(p) => (
              <Select {...p} value={f.source} onChange={set('source')}>
                {Object.entries(CAPA_SOURCE)
                  .filter(([k]) => k !== 'ncr')
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Severity" error={err.severity} hint={f.severity === 'major' ? 'Major CAPAs complete the 8D sections.' : undefined}>
          {(p) => (
            <Select {...p} value={f.severity} onChange={set('severity')}>
              <option value="minor">Minor</option>
              <option value="major">Major (8D)</option>
            </Select>
          )}
        </Field>
        <Field label="Owner" error={err.ownerUserId}>
          {(p) => (
            <Select {...p} value={f.ownerUserId} onChange={set('ownerUserId')}>
              {people.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Check effectiveness after (days)" error={err.verifyAfterDays} hint="30 to 180 days after the actions are done.">
          {(p) => <Input {...p} type="number" min={30} max={180} value={f.verifyAfterDays} onChange={set('verifyAfterDays')} required />}
        </Field>
      </div>
    </FormDialog>
  );
}
