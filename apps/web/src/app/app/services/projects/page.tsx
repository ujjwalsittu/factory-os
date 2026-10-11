'use client';
import { Badge, Button, Card, EmptyState, PageHeader, Table, Td, Th } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { ProjectDialog } from '@/components/project-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { type Project, PROJECT_STATUS } from '@/lib/services';

/** Projects billed by milestones, with retention and budget vs actual (decision 058). */
export default function ProjectsPage() {
  const ws = useWorkspace();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['projects', ws.entityId], queryFn: () => api<Project[]>('/services/projects', { scope: ws.scope }), enabled: !!ws.entityId });
  return (
    <>
      <PageHeader
        title="Projects"
        description="Contracts billed by milestone: each milestone is a full tax invoice, the customer's retention is tracked until released, and cost comes from linked work orders, bookings, purchases and timesheets."
        actions={ws.entityId && ws.can('services.project.create') && <Button onClick={() => setAdding(true)}>New project</Button>}
      />
      <EntityGate what="services">
        {q.data?.length === 0 ? (
          <EmptyState icon={<FolderKanban className="size-5" />} title="No projects yet" description="Create one from the customer's order or letter of award, then add its milestones." />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Project</Th>
                    <Th>Customer</Th>
                    <Th className="text-right">Contract</Th>
                    <Th className="text-right">Invoiced</Th>
                    <Th className="text-right">Retention held</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.map((p) => (
                    <tr key={p.id} className="border-t border-line text-[13px]">
                      <Td>
                        <Link href={`/app/services/projects/${p.id}`} className="font-mono font-medium hover:text-accent">
                          {p.number}
                        </Link>
                        <p className="text-[12px] text-subtle">{p.title}</p>
                      </Td>
                      <Td>{p.customerName}</Td>
                      <Td className="text-right font-mono">{formatMoney(p.contractValue)}</Td>
                      <Td className="text-right font-mono">{formatMoney(p.invoiced ?? '0')}</Td>
                      <Td className="text-right font-mono">{Number(p.retentionHeld) ? formatMoney(p.retentionHeld) : '—'}</Td>
                      <Td>
                        <Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        )}
      </EntityGate>
      {adding && <ProjectDialog project={null} onClose={() => setAdding(false)} onSaved={(id) => router.push(`/app/services/projects/${id}`)} />}
    </>
  );
}
