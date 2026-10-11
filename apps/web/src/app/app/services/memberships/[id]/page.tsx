'use client';
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { formatMinutes, type MembershipDetail } from '@/lib/services';

/** One studio membership: its term, hours used and left, the bookings that drew them, and the fee invoice. */
export default function MembershipPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const [cancelling, setCancelling] = useState(false);
  const q = useQuery({ queryKey: ['memberships', ws.entityId, id], queryFn: () => api<MembershipDetail>(`/services/memberships/${id}`, { scope: ws.scope }), enabled: !!ws.entityId });
  const m = q.data;
  return (
    <>
      <PageHeader
        title={m ? m.number : 'Membership'}
        description={m ? `${m.customerName} · ${m.planCode} ${m.planName}` : undefined}
        actions={
          m &&
          m.status === 'active' &&
          m.usedMinutes === 0 &&
          ws.can('services.membership.update') && (
            <Button variant="ghost" onClick={() => setCancelling(true)}>
              Cancel membership
            </Button>
          )
        }
      />
      <EntityGate what="services">
        {m && (
          <div className="space-y-4">
            <Card>
              <dl className="grid gap-x-6 gap-y-3 p-4 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="Status">{m.status === 'cancelled' ? <Badge tone="danger">Cancelled</Badge> : <Badge tone="success">Active</Badge>}</Detail>
                <Detail label="Term">
                  {formatDate(m.startsOn)} → {formatDate(m.endsOn)}
                </Detail>
                <Detail label="Hours">
                  {formatMinutes(m.usedMinutes)} used of {formatMinutes(m.includedMinutes)} · <span className="font-medium">{formatMinutes(m.remainingMinutes)} left</span>
                </Detail>
                <Detail label="Fee">
                  {formatMoney(m.fee)}{' '}
                  {m.salesInvoiceId ? (
                    <Link href={`/app/selling/invoices/${m.salesInvoiceId}`} className="hover:text-accent">
                      {m.invoiceNumber ? `· invoice ${m.invoiceNumber}` : '· draft invoice'}
                    </Link>
                  ) : (
                    <span className="text-muted">· no invoice</span>
                  )}
                </Detail>
                {m.cancelReason && <Detail label="Cancelled because">{m.cancelReason}</Detail>}
              </dl>
              <p className="px-4 pb-4 text-[12px] text-subtle">Hours left at the end of the term expire. A renewal is a new membership starting the day after.</p>
            </Card>
            <Card>
              <CardHeader title="Hours drawn" description="Bookings billed to this membership. A reversal is kept as a negative entry." />
              {m.draws.length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-muted">No bookings billed to it yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>When</Th>
                        <Th>Booking</Th>
                        <Th>Note</Th>
                        <Th className="text-right">Minutes</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.draws.map((d) => (
                        <tr key={d.id} className="border-t border-line text-[13px]">
                          <Td className="whitespace-nowrap">
                            {formatDateTime(d.createdAt)} <span className="text-muted">· {d.createdBy}</span>
                          </Td>
                          <Td>
                            <Link href={`/app/services/bookings/${d.bookingId}`} className="font-mono hover:text-accent">
                              {d.bookingNumber}
                            </Link>
                          </Td>
                          <Td>{d.reversalOf ? `Reversed: ${d.reason ?? ''}` : '—'}</Td>
                          <Td className={`text-right font-mono ${d.minutes < 0 ? 'text-danger' : ''}`}>{d.minutes}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </Card>
          </div>
        )}
      </EntityGate>
      {cancelling && m && <CancelDialog id={m.id} number={m.number} onClose={() => setCancelling(false)} />}
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

function CancelDialog({ id, number, onClose }: { id: string; number: string; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/services/memberships/${id}/cancel`, { method: 'POST', scope: ws.scope, body: { reason } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['memberships'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Cancel ${number}`} description="Only a membership with no hours drawn can be cancelled. Delete its draft fee invoice, or raise a credit note if it was submitted." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Cancel membership">
      <Field label="Reason" error={err.reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
