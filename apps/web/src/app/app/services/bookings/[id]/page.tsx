'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BookingDialog } from '@/components/booking-dialog';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
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
  const [dialog, setDialog] = useState<'edit' | 'cancel' | 'usage' | null>(null);
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
    mutationFn: () => api<{ invoiceId: string }>(`/services/bookings/${id}/invoice`, { method: 'POST', scope: ws.scope, body: {} }),
    onSuccess: (r) => {
      refresh();
      router.push(`/app/selling/invoices/${r.invoiceId}`);
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
              {(b.status === 'in_use' || b.status === 'completed') && can('services.usage.create') && !(b.invoiceStatus === 'draft' || b.invoiceStatus === 'submitted') && (
                <Button variant="secondary" onClick={() => setDialog('usage')}>
                  Record usage
                </Button>
              )}
              {b.billable && can('services.billing.create') && can('selling.sales_invoice.create') && (
                <Button loading={invoice.isPending} onClick={() => invoice.mutate()}>
                  Create invoice
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
                          <Td>{u.source === 'timer' ? 'Timer' : 'By hand'}</Td>
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
                        <Detail label="Amount before GST">
                          <span className="font-mono font-medium">{formatMoney(b.charge.amount)}</span>
                        </Detail>
                      </>
                    )}
                  </dl>
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
          {(p) => <Input {...p} value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} inputMode="numeric" required autoFocus />}
        </Field>
        <Field label="Note" error={err.note} className="sm:col-span-2">
          {(p) => <Input {...p} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required placeholder="Operator log sheet" />}
        </Field>
      </div>
    </FormDialog>
  );
}
