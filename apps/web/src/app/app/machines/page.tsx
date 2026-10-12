'use client';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { MACHINE_STATE, type MachineRow } from '@/lib/iot';
import { formatMinutes } from '@/lib/services';

/** Plant → Machines (decision 063): each machine's live state from its tap, and today's occupied hours. */
export default function MachinesPage() {
  return (
    <>
      <PageHeader title="Machines" description="Live state from each machine's tap. Occupied time counts everything except off and maintenance; it is what metered bookings bill." />
      <EntityGate what="plant">
        <Grid />
      </EntityGate>
    </>
  );
}

function Grid() {
  const ws = useWorkspace();
  const router = useRouter();
  const q = useQuery({ queryKey: ['plant-machines', ws.entityId], queryFn: () => api<MachineRow[]>('/plant/machines', { scope: ws.scope }), refetchInterval: 30_000 });
  if (q.data?.length === 0)
    return (
      <Card>
        <EmptyState icon={<Cpu className="size-5" />} title="No machines" description="Add machines under Manufacturing → Work centres, then a tap for each under Plant → Devices." />
      </Card>
    );
  return (
    <Card>
      <div className="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <Th>Machine</Th>
              <Th>State</Th>
              <Th>Last data</Th>
              <Th className="text-right">Occupied today</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((m) => (
              <Tr key={m.id} className="cursor-pointer" onClick={() => router.push(`/app/machines/${m.id}`)}>
                <Td className="text-[13px]">
                  <Link className="font-mono font-medium hover:text-accent" href={`/app/machines/${m.id}`} onClick={(e) => e.stopPropagation()}>
                    {m.code}
                  </Link>{' '}
                  {m.name}
                  <span className="block text-subtle">{m.workCentre}</span>
                </Td>
                <Td>
                  {!m.device ? (
                    <span className="text-[13px] text-subtle">No tap</span>
                  ) : m.stale || !m.state ? (
                    <Badge tone="neutral">No data</Badge>
                  ) : (
                    <Badge tone={MACHINE_STATE[m.state].tone} dot>
                      {MACHINE_STATE[m.state].label}
                    </Badge>
                  )}
                </Td>
                <Td className="text-[13px] whitespace-nowrap">{m.device ? (m.lastSeenAt ? formatDateTime(m.lastSeenAt) : 'Never') : ''}</Td>
                <Td className="tabular text-right text-[13px]">{m.todayMinutes === null ? '' : formatMinutes(m.todayMinutes)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}
