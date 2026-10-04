'use client';
import { Alert } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { PurchaseOrderForm } from '@/components/purchase-order-form';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { PurchaseOrderDetail } from '@/lib/types';

function Order() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['purchase-order', id, ws.entityId], queryFn: () => api<PurchaseOrderDetail>(`/purchase-orders/${id}`, { scope: ws.scope }), retry: false });
  if (q.error) return <Alert tone="danger" title="Can't open this purchase order">{q.error.message}. It may belong to another legal entity.</Alert>;
  if (!q.data) return <p className="text-muted">Loading…</p>;
  return <PurchaseOrderForm key={`${q.data.id}:${q.data.status}`} po={q.data} />;
}

export default function Page() {
  return (
    <EntityGate>
      <Order />
    </EntityGate>
  );
}
