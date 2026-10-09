'use client';
import { Alert } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { PlanEditor } from '@/components/plan-editor';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { PlanDetail } from '@/lib/quality';

function Plan() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['plan', id, ws.entityId], queryFn: () => api<PlanDetail>(`/quality/plans/${id}`, { scope: ws.scope }) });
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!q.data) return <p className="text-muted">Loading…</p>;
  return <PlanEditor key={`${q.data.id}:${q.data.status}`} plan={q.data} />;
}

export default function PlanPage() {
  return (
    <EntityGate what="quality">
      <Plan />
    </EntityGate>
  );
}
