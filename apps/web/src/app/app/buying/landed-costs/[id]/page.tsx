'use client';
import { Alert } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { LandedCostForm } from '@/components/landed-cost-form';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { LandedCostDetail } from '@/lib/types';

function Voucher() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['landed-cost', id, ws.entityId], queryFn: () => api<LandedCostDetail>(`/landed-costs/${id}`, { scope: ws.scope }), retry: false });
  if (q.error) return <Alert tone="danger" title="Can't open this voucher">{q.error.message}. It may belong to another legal entity.</Alert>;
  if (!q.data) return <p className="text-muted">Loading…</p>;
  return <LandedCostForm key={`${q.data.id}:${q.data.status}`} voucher={q.data} />;
}

export default function Page() {
  return (
    <EntityGate what="buying">
      <Voucher />
    </EntityGate>
  );
}
