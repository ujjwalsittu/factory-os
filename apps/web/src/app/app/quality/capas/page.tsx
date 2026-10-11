'use client';
import { Badge, Button, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { SearchCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { RaiseCapaDialog } from '@/components/raise-capa-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { CAPA_SOURCE, CAPA_STATUS, type CapaRow } from '@/lib/quality';

/** Corrective and preventive actions (decision 061). */
export default function CapasPage() {
  const ws = useWorkspace();
  const [raising, setRaising] = useState(false);
  return (
    <>
      <PageHeader
        title="CAPA"
        description="Corrective and preventive actions: a 5-Why to the root cause (8D for major problems), actions with owners and due dates, and an effectiveness check by someone else after the wait."
        actions={ws.entityId && ws.can('quality.capa.create') && <Button onClick={() => setRaising(true)}>Raise CAPA</Button>}
      />
      <EntityGate what="quality">
        <List />
      </EntityGate>
      {raising && <RaiseCapaDialog onClose={() => setRaising(false)} />}
    </>
  );
}

const FILTERS = ['open', 'in_action', 'verifying', 'closed', 'cancelled'] as const;

function List() {
  const ws = useWorkspace();
  const router = useRouter();
  const [status, setStatus] = useState<(typeof FILTERS)[number] | 'all'>('all');
  const q = useQuery({ queryKey: ['capas', ws.entityId, status], queryFn: () => api<CapaRow[]>(`/quality/capas${status === 'all' ? '' : `?status=${status}`}`, { scope: ws.scope }) });
  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-line p-2" role="tablist" aria-label="Status">
        {(['all', ...FILTERS] as const).map((f) => (
          <Button key={f} role="tab" aria-selected={status === f} size="sm" variant={status === f ? 'secondary' : 'ghost'} onClick={() => setStatus(f)}>
            {f === 'all' ? 'All' : CAPA_STATUS[f].label}
          </Button>
        ))}
      </div>
      {q.data?.length === 0 ? (
        <EmptyState icon={<SearchCheck className="size-5" />} title="Nothing here" description="Raise a CAPA from an NCR page, or here for an audit finding or a customer complaint." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>CAPA</Th>
                <Th>Problem</Th>
                <Th>Owner</Th>
                <Th>Next due</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((c) => (
                <Tr key={c.id} className="cursor-pointer" onClick={() => router.push(`/app/quality/capas/${c.id}`)}>
                  <Td className="text-[13px] whitespace-nowrap">
                    <Link className="font-mono font-medium hover:text-accent" href={`/app/quality/capas/${c.id}`} onClick={(e) => e.stopPropagation()}>
                      {c.number}
                    </Link>
                    <span className="block text-subtle">{CAPA_SOURCE[c.source]} · {formatDate(c.createdAt)}</span>
                  </Td>
                  <Td className="max-w-80 text-[13px]">
                    <span className="font-medium">{c.title}</span> {c.severity === 'major' && <Badge tone="danger">Major</Badge>}
                    <span className="block truncate text-muted">{c.problem}</span>
                  </Td>
                  <Td className="text-[13px] whitespace-nowrap">{c.ownerName}</Td>
                  <Td className="text-[13px] whitespace-nowrap">
                    {c.nextDue ? (
                      <span className={c.overdue || c.verificationDue ? 'font-medium text-danger' : undefined}>
                        {c.status === 'verifying' ? 'Check ' : `${c.openActions} action${c.openActions === 1 ? '' : 's'} · `}
                        {formatDate(c.nextDue)}
                        {c.overdue && ' · overdue'}
                        {c.verificationDue && ' · due'}
                      </span>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={CAPA_STATUS[c.status].tone}>{CAPA_STATUS[c.status].label}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}
