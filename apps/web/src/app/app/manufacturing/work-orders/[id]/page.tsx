'use client';
import { Alert } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { WorkOrderView } from '@/components/work-order-view';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { WorkOrderDetail } from '@/lib/manufacturing';

function Order() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  // Job cards move on the shop floor, so this page always refetches.
  const q = useQuery({ queryKey: ['work-order', id, ws.entityId], queryFn: () => api<WorkOrderDetail>(`/manufacturing/work-orders/${id}`, { scope: ws.scope }), retry: false, staleTime: 0, refetchOnMount: 'always' });
  if (q.error) return <Alert tone="danger" title="Can't open this work order">{q.error.message}. It may belong to another legal entity.</Alert>;
  if (!q.data) return <p className="text-muted">Loading…</p>;
  return <WorkOrderView wo={q.data} />;
}

export default function Page() {
  return (
    <EntityGate what="manufacturing">
      <Order />
    </EntityGate>
  );
}
