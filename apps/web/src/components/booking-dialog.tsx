'use client';
import { Field, Input, Select } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { WorkCentre } from '@/lib/manufacturing';
import { type Booking, fromLocal, toLocal } from '@/lib/services';
import type { Party } from '@/lib/types';
import { LookupSelect } from '@/components/lookup-select';

/** New booking, or move/resize/change a tentative or confirmed one (decision 055). Times are IST. */
export function BookingDialog({ booking, onClose, onSaved, campaign, project }: { booking: Booking | null; onClose: () => void; onSaved?: (id: string) => void; campaign?: { id: string; number: string; customerId: string }; project?: { id: string; number: string; customerId: string } }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const centres = useQuery({ queryKey: ['work-centres', ws.entityId], queryFn: () => api<WorkCentre[]>('/manufacturing/work-centres', { scope: ws.scope }) });
  const parties = useQuery({ queryKey: ['parties', ws.tenantId, 'all'], queryFn: () => api<Party[]>('/parties', { scope: ws.scope }) });
  const hour = new Date();
  hour.setMinutes(0, 0, 0);
  const [f, setF] = useState({
    customerId: booking?.customerId ?? campaign?.customerId ?? project?.customerId ?? '',
    machineId: booking?.machineId ?? '',
    startsAt: toLocal(booking?.startsAt ?? new Date(hour.getTime() + 24 * 3600e3).toISOString()),
    endsAt: toLocal(booking?.endsAt ?? new Date(hour.getTime() + 30 * 3600e3).toISOString()),
    purpose: booking?.purpose ?? '',
  });
  const m = useMutation({
    mutationFn: () =>
      api<{ id?: string }>(booking ? `/services/bookings/${booking.id}` : '/services/bookings', {
        method: booking ? 'PUT' : 'POST',
        scope: ws.scope,
        body: { ...f, startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt), purpose: f.purpose || null, ...(campaign && !booking ? { campaignId: campaign.id } : {}), ...(project && !booking ? { projectId: project.id } : {}) },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['booking'] });
      void qc.invalidateQueries({ queryKey: ['schedule'] });
      void qc.invalidateQueries({ queryKey: ['campaign'] });
      void qc.invalidateQueries({ queryKey: ['project'] });
      onClose();
      if (!booking && r.id) onSaved?.(r.id);
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog
      title={booking ? `Change ${booking.number}` : campaign ? `Book for ${campaign.number}` : project ? `Book for ${project.number}` : 'New booking'}
      description={booking?.status === 'confirmed' ? 'The machine stays reserved; the new time is checked against other reservations and pinned or running production.' : 'Times are in IST. A new booking is tentative until confirmed.'}
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel="Save"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" error={err.customerId}>
          {(p) => (
            <LookupSelect kind="party" noun="customer" prefill={{ roles: { isCustomer: true } }} {...p} value={f.customerId} onChange={set('customerId')} required autoFocus disabled={!!campaign || !!project}>
              <option value="">Choose…</option>
              {parties.data?.filter((c) => c.isCustomer && c.isActive).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.maasMember ? ' · member' : ''}
                </option>
              ))}
            </LookupSelect>
          )}
        </Field>
        <Field label="Machine" error={err.machineId}>
          {(p) => (
            <Select {...p} value={f.machineId} onChange={set('machineId')} required>
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
        <Field label="From" error={err.startsAt}>
          {(p) => <Input {...p} type="datetime-local" value={f.startsAt} onChange={set('startsAt')} required />}
        </Field>
        <Field label="To" error={err.endsAt}>
          {(p) => <Input {...p} type="datetime-local" value={f.endsAt} onChange={set('endsAt')} required />}
        </Field>
      </div>
      <Field label="Purpose" error={err.purpose}>
        {(p) => <Input {...p} value={f.purpose} onChange={set('purpose')} placeholder="Prototype brackets, customer’s own CAM program" />}
      </Field>
    </FormDialog>
  );
}
