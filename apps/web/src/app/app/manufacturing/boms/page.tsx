'use client';
import { Badge, buttonClass, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { ListTree } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatQty } from '@/lib/format';
import { BOM_STATUS, type BomRow } from '@/lib/manufacturing';

export default function BomsPage() {
  const ws = useWorkspace();
  return (
    <>
      <PageHeader
        title="Bills of materials"
        description="What each item is made from and the operations that make it, one revision at a time. Active revisions are frozen; an engineering change is a new revision."
        actions={
          ws.entityId &&
          ws.can('manufacturing.bom.create') && (
            <Link href="/app/manufacturing/boms/new" className={buttonClass('primary', 'md')}>
              New BOM
            </Link>
          )
        }
      />
      <EntityGate what="manufacturing">
        <BomList />
      </EntityGate>
    </>
  );
}

function BomList() {
  const ws = useWorkspace();
  const router = useRouter();
  const q = useQuery({ queryKey: ['boms', ws.entityId], queryFn: () => api<BomRow[]>('/manufacturing/boms', { scope: ws.scope }) });
  return (
    <Card>
      {q.data?.length === 0 ? (
        <EmptyState icon={<ListTree className="size-5" />} title="No BOMs yet" description="Create one for each item you make: materials per unit and the routing of operations." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Revision</Th>
              <Th className="text-right">Makes</Th>
              <Th className="text-right">Materials</Th>
              <Th className="text-right">Operations</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((b) => (
              <Tr key={b.id} className="cursor-pointer" onClick={() => router.push(`/app/manufacturing/boms/${b.id}`)}>
                <Td>
                  <Link href={`/app/manufacturing/boms/${b.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent">
                    <span className="font-mono text-[13px] font-medium">{b.itemCode}</span> <span className="text-muted">{b.itemName}</span>
                  </Link>
                </Td>
                <Td className="font-mono text-[13px]">
                  {b.revision} {b.isDefault && <Badge tone="accent">Default</Badge>}
                </Td>
                <Td className="tabular text-right">{formatQty(b.quantity)}</Td>
                <Td className="tabular text-right">{b.materials}</Td>
                <Td className="tabular text-right">{b.operations}</Td>
                <Td>
                  <Badge tone={BOM_STATUS[b.status].tone} dot>
                    {BOM_STATUS[b.status].label}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
