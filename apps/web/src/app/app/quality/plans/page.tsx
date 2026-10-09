'use client';
import { Badge, buttonClass, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { type PlanRow, STAGE } from '@/lib/quality';

const STATUS = { draft: { label: 'Draft', tone: 'neutral' }, active: { label: 'Active', tone: 'success' }, obsolete: { label: 'Obsolete', tone: 'warning' } } as const;

export default function PlansPage() {
  const ws = useWorkspace();
  return (
    <>
      <PageHeader
        title="Inspection plans"
        description="What to check, to what limits and on how many samples: incoming, in-process (per routing operation) and final. Revisioned like BOMs."
        actions={ws.entityId && ws.can('quality.plan.create') && <Link className={buttonClass()} href="/app/quality/plans/new">New plan</Link>}
      />
      <EntityGate what="quality">
        <List />
      </EntityGate>
    </>
  );
}

function List() {
  const ws = useWorkspace();
  const router = useRouter();
  const q = useQuery({ queryKey: ['plans', ws.entityId], queryFn: () => api<PlanRow[]>('/quality/plans', { scope: ws.scope }) });
  return (
    <Card>
      {q.data?.length === 0 ? (
        <EmptyState icon={<ListChecks className="size-5" />} title="No plans" description="Without a plan, inspectors record free-text checks. Add a final plan for items you ship." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Stage</Th>
                <Th>Revision</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((p) => (
                <Tr key={p.id} className="cursor-pointer" onClick={() => router.push(`/app/quality/plans/${p.id}`)}>
                  <Td className="text-[13px]">
                    <span className="font-mono">{p.itemCode}</span> {p.itemName}
                  </Td>
                  <Td className="text-[13px]">
                    {STAGE[p.stage]}
                    {p.operationSeq && <span className="text-subtle"> · op {p.operationSeq}</span>}
                  </Td>
                  <Td className="font-mono text-[13px]">{p.revision}</Td>
                  <Td>
                    <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
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
