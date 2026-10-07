'use client';
import { Alert } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { BomEditor } from '@/components/bom-editor';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { BomDetail } from '@/lib/manufacturing';

function Bom() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['bom', id, ws.entityId], queryFn: () => api<BomDetail>(`/manufacturing/boms/${id}`, { scope: ws.scope }), retry: false });
  if (q.error) return <Alert tone="danger" title="Can't open this BOM">{q.error.message}. It may belong to another legal entity.</Alert>;
  if (!q.data) return <p className="text-muted">Loading…</p>;
  return <BomEditor key={`${q.data.id}:${q.data.status}:${q.data.isDefault}`} bom={q.data} />;
}

export default function Page() {
  return (
    <EntityGate what="manufacturing">
      <Bom />
    </EntityGate>
  );
}
