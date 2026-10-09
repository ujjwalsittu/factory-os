'use client';
import { Badge, Button, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatQty } from '@/lib/format';
import { type InspectionRow, OUTCOME, STAGE } from '@/lib/quality';

const TABS = [
  ['draft', 'To inspect'],
  ['submitted', 'Done'],
  ['cancelled', 'Cancelled'],
] as const;

export default function InspectionsPage() {
  return (
    <>
      <PageHeader title="Inspections" description="Final inspections of output waiting in Quarantine, incoming checks of job work returns, and in-process checks. Measurements are checked against the plan's limits." />
      <EntityGate what="quality">
        <List />
      </EntityGate>
    </>
  );
}

function List() {
  const ws = useWorkspace();
  const router = useRouter();
  const [status, setStatus] = useState<'draft' | 'submitted' | 'cancelled'>('draft');
  const q = useQuery({ queryKey: ['inspections', ws.entityId, status], queryFn: () => api<InspectionRow[]>(`/quality/inspections?status=${status}`, { scope: ws.scope }) });
  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-line p-2" role="tablist" aria-label="Status">
        {TABS.map(([k, label]) => (
          <Button key={k} role="tab" aria-selected={status === k} size="sm" variant={status === k ? 'secondary' : 'ghost'} onClick={() => setStatus(k)}>
            {label}
          </Button>
        ))}
      </div>
      {q.data?.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="size-5" />} title={status === 'draft' ? 'Nothing waiting' : 'None yet'} description="Output of items flagged for final inspection opens one here automatically." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Inspection</Th>
                <Th>Stage</Th>
                <Th>Item</Th>
                <Th className="text-right">Qty</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((r) => (
                <Tr key={r.id} className="cursor-pointer" onClick={() => router.push(`/app/quality/inspections/${r.id}`)}>
                  <Td className="text-[13px] whitespace-nowrap">
                    <Link className="font-mono font-medium hover:text-accent" href={`/app/quality/inspections/${r.id}`} onClick={(e) => e.stopPropagation()}>
                      {r.number ?? 'Open'}
                    </Link>
                    <span className="block text-subtle">{formatDate(r.createdAt)}</span>
                  </Td>
                  <Td className="text-[13px]">
                    {STAGE[r.stage]}
                    {r.workOrder && <span className="block font-mono text-subtle">{r.workOrder}</span>}
                  </Td>
                  <Td className="text-[13px]">
                    <span className="font-mono">{r.itemCode}</span> {r.itemName}
                    {r.batchNo && <span className="block font-mono text-subtle">{r.batchNo}</span>}
                  </Td>
                  <Td className="tabular text-right">{formatQty(r.qty)}</Td>
                  <Td>{r.outcome ? <Badge tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].label}</Badge> : <span className="text-subtle">—</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}
