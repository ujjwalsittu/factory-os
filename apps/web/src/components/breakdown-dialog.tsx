'use client';
import { Field, Input, Select } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { MachineRow } from '@/lib/iot';

/** `datetime-local` value in India time for an instant. */
const localIst = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 16);

/**
 * Report a breakdown (decision 066): the machine is blocked on the schedule from when it stopped until the order is
 * done. Operators can raise one; a maintenance person works it.
 */
export function BreakdownDialog({ machineId, since, onClose }: { machineId?: string; since?: string | null; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const machines = useQuery({ queryKey: ['plant-machines', ws.entityId], queryFn: () => api<MachineRow[]>('/plant/machines', { scope: ws.scope }), enabled: !machineId });
  const [f, setF] = useState({ machineId: machineId ?? '', symptom: '', failedAt: localIst(since ? new Date(since) : new Date()) });
  const m = useMutation({
    mutationFn: () =>
      api<{ id: string; number: string }>('/maintenance/breakdowns', {
        method: 'POST',
        scope: ws.scope,
        body: { machineId: f.machineId, symptom: f.symptom, failedAt: f.failedAt ? new Date(`${f.failedAt}:00+05:30`).toISOString() : null },
      }),
    onSuccess: (o) => {
      void qc.invalidateQueries({ queryKey: ['maintenance'] });
      void qc.invalidateQueries({ queryKey: ['schedule'] });
      onClose();
      if (ws.can('maintenance.order.update')) router.push(`/app/maintenance/orders/${o.id}`);
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog
      title="Report a breakdown"
      description="The machine is blocked on the schedule from when it stopped until maintenance closes the order."
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel="Report breakdown"
    >
      <div className="grid gap-4">
        {!machineId && (
          <Field label="Machine" error={err.machineId}>
            {(p) => (
              <Select {...p} value={f.machineId} onChange={(e) => setF({ ...f, machineId: e.target.value })} required>
                <option value="">Choose…</option>
                {machines.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} · {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="What happened" error={err.symptom} hint="The alarm or what you saw and heard">
          {(p) => <Input {...p} value={f.symptom} onChange={(e) => setF({ ...f, symptom: e.target.value })} placeholder="Spindle drive alarm 401, will not restart" required autoFocus />}
        </Field>
        <Field label="Stopped at" error={err.failedAt} hint="Up to 7 days back">
          {(p) => <Input {...p} type="datetime-local" value={f.failedAt} onChange={(e) => setF({ ...f, failedAt: e.target.value })} max={localIst(new Date())} />}
        </Field>
      </div>
    </FormDialog>
  );
}
