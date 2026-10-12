'use client';
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BookingDialog } from '@/components/booking-dialog';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { BOOKING_STATUS, type Booking, type BookingStatus, formatMinutes } from '@/lib/services';

/** Machine-hour bookings (decision 055). */
export default function BookingsPage() {
  const ws = useWorkspace();
  const router = useRouter();
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ['bookings', ws.entityId, status],
    queryFn: () => api<Booking[]>(`/services/bookings${status ? `?status=${status}` : ''}`, { scope: ws.scope }),
    enabled: !!ws.entityId,
  });
  return (
    <>
      <PageHeader
        title="Machine bookings"
        description="Customers renting machines by the hour. A confirmed booking reserves the machine and production is scheduled around it; usage is billed at the machine’s rate card."
        actions={ws.entityId && ws.can('services.booking.create') && <Button onClick={() => setAdding(true)}>New booking</Button>}
      />
      <EntityGate what="services">
        <div className="mb-3 w-48">
          <Field label="Status">
            {(p) => (
              <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as BookingStatus | '')}>
                <option value="">All</option>
                {Object.entries(BOOKING_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {q.data?.length === 0 ? (
          <EmptyState icon={<CalendarCheck2 className="size-5" />} title="No bookings" description="Book a machine for a customer; it stays tentative until you confirm it." />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Booking</Th>
                    <Th>Customer</Th>
                    <Th>Machine</Th>
                    <Th>From</Th>
                    <Th>To</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Used</Th>
                    <Th>Invoice</Th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.map((b) => (
                    <tr key={b.id} className="border-t border-line text-[13px]">
                      <Td>
                        <Link href={`/app/services/bookings/${b.id}`} className="font-mono font-medium hover:text-accent">
                          {b.number}
                        </Link>
                      </Td>
                      <Td>{b.customerName}</Td>
                      <Td>
                        <span className="font-mono">{b.machineCode}</span>
                      </Td>
                      <Td className="whitespace-nowrap">{formatDateTime(b.startsAt)}</Td>
                      <Td className="whitespace-nowrap">{formatDateTime(b.endsAt)}</Td>
                      <Td>
                        <Badge tone={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge>
                        {b.meterStatus === 'review' && (
                          <Badge tone="warning" className="ml-1">
                            Usage review
                          </Badge>
                        )}
                      </Td>
                      <Td className="text-right whitespace-nowrap">{b.usedMinutes ? formatMinutes(b.usedMinutes) : '—'}</Td>
                      <Td>
                        {b.salesInvoiceId && b.invoiceStatus !== 'cancelled' ? (
                          <Link href={`/app/selling/invoices/${b.salesInvoiceId}`} className="font-mono hover:text-accent">
                            {b.invoiceNumber ?? 'Draft'}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        )}
      </EntityGate>
      {adding && <BookingDialog booking={null} onClose={() => setAdding(false)} onSaved={(id) => router.push(`/app/services/bookings/${id}`)} />}
    </>
  );
}
