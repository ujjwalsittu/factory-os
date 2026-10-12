'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BookingDialog } from '@/components/booking-dialog';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { StateStrip } from '@/components/state-strip';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { BOOKING_STATUS, type BookingDetail, formatMinutes } from '@/lib/services';

/** One machine booking: reserve, run, record usage and invoice (decision 055). */
export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const [dialog, setDialog] = useState<'edit' | 'cancel' | 'usage' | 'unbill' | 'review' | null>(null);
  const q = useQuery({ queryKey: ['booking', ws.entityId, id], queryFn: () => api<BookingDetail>(`/services/bookings/${id}`, { scope: ws.scope }), enabled: !!ws.entityId });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['booking'] });
    void qc.invalidateQueries({ queryKey: ['bookings'] });
    void qc.invalidateQueries({ queryKey: ['schedule'] });
  };
  const act = useMutation({
    mutationFn: (action: 'confirm' | 'start' | 'stop') => api(`/services/bookings/${id}/${action}`, { method: 'POST', scope: ws.scope }),
    onSuccess: refresh,
  });
  const invoice = useMutation({
    mutationFn: () => api<{ invoiceId: string | null }>(`/services/bookings/${id}/bill`, { method: 'POST', scope: ws.scope, body: {} }),
    onSuccess: (r) => {
      refresh();
      void qc.invalidateQueries({ queryKey: ['memberships'] });
      if (r.invoiceId) router.push(`/app/selling/invoices/${r.invoiceId}`);
    },
  });
  const b = q.data;
  const can = (p: string) => ws.can(p);
  const open = b && (b.status === 'tentative' || b.status === 'confirmed');
  return (
    <>
      <PageHeader
        title={b ? b.number : 'Booking'}
        description={b ? `${b.customerName} · ${b.machineCode} ${b.machineName}` : undefined}
        actions={
          b && (
            <div className="flex flex-wrap gap-2">
              {open && can('services.booking.update') && (
                <Button variant="secondary" onClick={() => setDialog('edit')}>
                  Change
                </Button>
              )}
              {b.status === 'tentative' && can('services.booking.update') && (
                <Button loading={act.isPending && act.variables === 'confirm'} onClick={() => act.mutate('confirm')}>
                  Confirm
                </Button>
              )}
              {b.status === 'confirmed' && can('services.usage.create') && (
                <Button loading={act.isPending && act.variables === 'start'} onClick={() => act.mutate('start')}>
                  Start machine
                </Button>
              )}
              {b.status === 'in_use' && can('services.usage.create') && (
                <Button loading={act.isPending && act.variables === 'stop'} onClick={() => act.mutate('stop')}>
                  Stop machine
                </Button>
              )}
              {(b.status === 'in_use' || b.status === 'completed') && can('services.usage.create') && !b.billed && b.meterStatus !== 'review' && (
                <Button variant="secondary" onClick={() => setDialog('usage')}>
                  Record usage
                </Button>
              )}
              {b.billable && can('services.billing.create') && (b.split?.overageMinutes === 0 || can('selling.sales_invoice.create')) && (
                <Button loading={invoice.isPending} onClick={() => invoice.mutate()}>
                  {b.split && b.split.overageMinutes === 0 ? 'Bill to membership' : 'Create invoice'}
                </Button>
              )}
              {b.drawnMinutes > 0 && !(b.invoiceStatus === 'draft' || b.invoiceStatus === 'submitted') && can('services.billing.create') && (
                <Button variant="ghost" onClick={() => setDialog('unbill')}>
                  Reverse billing
                </Button>
              )}
              {open && can('services.booking.update') && (
                <Button variant="ghost" onClick={() => setDialog('cancel')}>
                  Cancel booking
                </Button>
              )}
            </div>
          )
        }
      />
      <EntityGate what="services">
        {(act.error || invoice.error) && <Alert tone="danger" className="mb-3">{(act.error ?? invoice.error)!.message}</Alert>}
        {b && (
          <div className="space-y-4">
            <Card>
              <dl className="grid gap-x-6 gap-y-3 p-4 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="Status">
                  <Badge tone={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge>
                </Detail>
                <Detail label="Reserved">
                  {formatDateTime(b.startsAt)} → {formatDateTime(b.endsAt)}
                </Detail>
                <Detail label="Customer">
                  {b.customerName} {b.member && <Badge tone="accent">Member</Badge>}
                </Detail>
                <Detail label="Machine">
                  <span className="font-mono">{b.machineCode}</span> {b.machineName} · {b.workCentre}
                </Detail>
                {b.startedAt && <Detail label="Started">{formatDateTime(b.startedAt)}</Detail>}
                {b.stoppedAt && <Detail label="Stopped">{formatDateTime(b.stoppedAt)}</Detail>}
                {b.purpose && <Detail label="Purpose">{b.purpose}</Detail>}
                {b.cancelReason && <Detail label="Cancelled because">{b.cancelReason}</Detail>}
              </dl>
              {b.status === 'tentative' && <p className="px-4 pb-4 text-[12px] text-subtle">Tentative: shown on the schedule but the machine is not reserved until you confirm.</p>}
            </Card>
            {(b.meter || b.meterStatus !== 'none') && (
              <Card>
                <CardHeader
                  title="Meter"
                  description={b.meter ? `Tap ${b.meter.device.code}: occupied time is everything but off and maintenance.` : 'Metered at stop.'}
                  actions={
                    b.meterStatus === 'review' &&
                    can('services.usage.approve') && (
                      <Button size="sm" onClick={() => setDialog('review')}>
                        Review usage
                      </Button>
                    )
                  }
                />
                <div className="space-y-3 px-5 py-4 text-[13px]">
                  {b.meterStatus === 'review' && (
                    <Alert tone="warning" title="Usage needs review before billing">
                      {b.meter && !b.meter.covered ? 'The meter has gaps in this booking. ' : ''}
                      Metered {formatMinutes(b.meter?.minutes ?? b.meteredMinutes ?? 0)} against the timer’s {formatMinutes(b.timerMinutes ?? 0)}.
                    </Alert>
                  )}
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                    <Detail label={b.status === 'in_use' ? 'Occupied so far' : 'Metered'}>
                      {b.meter ? formatMinutes(b.meter.minutes) : b.meteredMinutes !== null ? formatMinutes(b.meteredMinutes) : '—'}
                      {b.meter && !b.meter.covered && <Badge tone="warning" className="ml-1">Gaps</Badge>}
                    </Detail>
                    {b.timerMinutes !== null && <Detail label="Timer at stop">{formatMinutes(b.timerMinutes)}</Detail>}
                    {b.meterStatus === 'applied' && (
                      <Detail label="Applied">{b.meterReviewedAt ? `Reviewed by ${b.meterReviewedByName}: ${b.meterReviewNote}` : 'Automatically (covered, within 10% of the timer)'}</Detail>
                    )}
                  </dl>
                  {b.meter && <StateStrip segments={b.meter.segments} label={`${b.machineCode} states during the booking`} />}
                </div>
              </Card>
            )}
            <Card>
              <CardHeader title="Usage" description="Machine time recorded by the timer or by hand. Entries are kept; a correction is a new entry." />
              {b.usage.length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-muted">Nothing recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Recorded</Th>
                        <Th>Source</Th>
                        <Th>Note</Th>
                        <Th className="text-right">Minutes</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.usage.map((u) => (
                        <tr key={u.id} className="border-t border-line text-[13px]">
                          <Td className="whitespace-nowrap">
                            {formatDateTime(u.recordedAt)} <span className="text-muted">· {u.recordedBy}</span>
                          </Td>
                          <Td>{u.source === 'timer' ? 'Timer' : u.source === 'meter' ? 'Meter' : 'By hand'}</Td>
                          <Td>{u.note ?? '—'}</Td>
                          <Td className={`text-right font-mono ${u.minutes < 0 ? 'text-danger' : ''}`}>{u.minutes}</Td>
                        </tr>
                      ))}
                      <tr className="border-t border-line text-[13px] font-medium">
                        <Td colSpan={3}>Total</Td>
                        <Td className="text-right font-mono">{formatMinutes(b.usedMinutes)}</Td>
                      </tr>
                    </tbody>
                  </Table>
                </div>
              )}
            </Card>
            <Card>
              <CardHeader title="Billing" description="Usage rounded up to the rate card’s step, never below its minimum." />
              <div className="px-4 pt-3 pb-4 text-[13px]">
                {(b.campaignId || b.projectId) && (
                  <Alert tone="info" className="mb-3">
                    {b.campaignId ? (
                      <>
                        Billed with test campaign{' '}
                        <Link href={`/app/services/campaigns/${b.campaignId}`} className="font-mono hover:text-accent">
                          {b.campaignNumber}
                        </Link>
                      </>
                    ) : (
                      <>
                        Billed through project{' '}
                        <Link href={`/app/services/projects/${b.projectId}`} className="font-mono hover:text-accent">
                          {b.projectNumber}
                        </Link>
                      </>
                    )}
                    , not by the hour. The value below is what the machine time is worth.
                  </Alert>
                )}
                {!b.rateCard ? (
                  <Alert tone="warning">No rate card for {b.machineCode} on {formatDate(b.startsAt)}. Add one under Services → Rate cards.</Alert>
                ) : (
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Detail label="Rate card">
                      {formatMoney(b.rateCard.standardRate)}/h{b.rateCard.memberRate && `, member ${formatMoney(b.rateCard.memberRate)}/h`} · minimum {formatMinutes(b.rateCard.minimumMinutes)} · {b.rateCard.roundingMinutes}-minute steps
                    </Detail>
                    {b.charge && (
                      <>
                        <Detail label="Billable">
                          {formatMinutes(b.charge.billableMinutes)} = {b.charge.hours} h
                        </Detail>
                        <Detail label={b.charge.memberRate ? 'Member rate' : 'Rate'}>{formatMoney(b.charge.rate)}/h</Detail>
                        <Detail label={b.membership ? 'Value of the hours' : 'Amount before GST'}>
                          <span className="font-mono font-medium">{formatMoney(b.charge.amount)}</span>
                        </Detail>
                      </>
                    )}
                  </dl>
                )}
                {b.membership && (
                  <p className="mt-3">
                    Membership{' '}
                    <Link href={`/app/services/memberships/${b.membership.id}`} className="font-mono font-medium hover:text-accent">
                      {b.membership.number}
                    </Link>
                    {b.drawnMinutes > 0
                      ? `: ${formatMinutes(b.drawnMinutes)} drawn for this booking.`
                      : b.split
                        ? `: ${formatMinutes(b.membership.remainingMinutes)} left until ${formatDate(b.membership.endsOn)}. Billing draws ${formatMinutes(b.split.coveredMinutes)}${b.split.overageMinutes ? ` and invoices ${b.split.overageHours} h (${formatMoney(b.split.overageAmount)}) beyond it.` : '; nothing to invoice.'}`
                        : '.'}
                  </p>
                )}
                {b.salesInvoiceId && b.invoiceStatus !== 'cancelled' && (
                  <p className="mt-3">
                    <Link href={`/app/selling/invoices/${b.salesInvoiceId}`} className="font-medium hover:text-accent">
                      {b.invoiceNumber ? `Invoice ${b.invoiceNumber}` : 'Draft invoice'}
                    </Link>{' '}
                    {b.invoiceNumber && <Badge>{b.invoiceStatus}</Badge>}
                  </p>
                )}
              </div>
            </Card>
          </div>
        )}
      </EntityGate>
      {dialog === 'edit' && b && <BookingDialog booking={b} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && b && <CancelDialog id={b.id} number={b.number} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'usage' && b && <UsageDialog id={b.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'review' && b && <ReviewDialog b={b} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'unbill' && b && <UnbillDialog id={b.id} onClose={() => setDialog(null)} onDone={() => { refresh(); void qc.invalidateQueries({ queryKey: ['memberships'] }); }} />}
    </>
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

function CancelDialog({ id, number, onClose, onDone }: { id: string; number: string; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/services/bookings/${id}/cancel`, { method: 'POST', scope: ws.scope, body: { reason } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Cancel ${number}`} description="The machine is released. The booking and its reason are kept." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Cancel booking">
      <Field label="Reason" error={err.reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}
      </Field>
    </FormDialog>
  );
}

function UsageDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [f, setF] = useState({ minutes: '', note: '' });
  const m = useMutation({
    mutationFn: () => api(`/services/bookings/${id}/usage`, { method: 'POST', scope: ws.scope, body: { minutes: Number(f.minutes), note: f.note } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Record usage" description="Minutes the machine ran, from a log sheet. Enter a negative number to correct an earlier entry." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Record">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Minutes" error={err.minutes}>
          {(p) => <Input {...p} type="number" step={1} value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} required autoFocus />}
        </Field>
        <Field label="Note" error={err.note} className="sm:col-span-2">
          {(p) => <Input {...p} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required placeholder="Operator log sheet" />}
        </Field>
      </div>
    </FormDialog>
  );
}

function UnbillDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/services/bookings/${id}/unbill`, { method: 'POST', scope: ws.scope, body: { reason } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Reverse billing" description="The hours go back to the membership (kept as a reversal entry) and the booking can be corrected and billed again." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Reverse">
      <Field label="Reason" error={err.reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}
      </Field>
    </FormDialog>
  );
}

/** Decision 063: settle a metered booking the meter couldn't settle on its own. */
function ReviewDialog({ b, onClose, onDone }: { b: BookingDetail; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [f, setF] = useState({ choice: 'metered' as 'metered' | 'timer' | 'corrected', minutes: '', note: '' });
  const m = useMutation({
    mutationFn: () => api(`/services/bookings/${b.id}/meter-review`, { method: 'POST', scope: ws.scope, body: f.choice === 'corrected' ? { choice: f.choice, minutes: Number(f.minutes), note: f.note } : { choice: f.choice, note: f.note } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Review usage" description="The usage becomes the figure you choose; the difference is recorded as one entry with your note, and billing opens." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Apply">
      <Field label="Use" error={err.choice}>
        {(p) => (
          <Select {...p} value={f.choice} onChange={(e) => setF({ ...f, choice: e.target.value as typeof f.choice })}>
            <option value="metered">Metered: {formatMinutes(b.meter?.minutes ?? b.meteredMinutes ?? 0)}{b.meter && !b.meter.covered ? ' (with gaps)' : ''}</option>
            <option value="timer">Timer: {formatMinutes(b.timerMinutes ?? 0)}</option>
            <option value="corrected">A corrected figure</option>
          </Select>
        )}
      </Field>
      {f.choice === 'corrected' && (
        <Field label="Minutes" error={err.minutes}>
          {(p) => <Input {...p} type="number" min={0} value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} required autoFocus />}
        </Field>
      )}
      <Field label="Why" error={err.note}>
        {(p) => <Input {...p} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required placeholder="e.g. tap lost Wi-Fi for 20 min; log sheet shows the spindle ran" />}
      </Field>
    </FormDialog>
  );
}
