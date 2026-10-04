'use client';
import { Alert } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { StockEntryForm } from '@/components/stock-entry-form';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { StockEntryDetail } from '@/lib/types';

function Entry() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['stock-entry', id, ws.entityId], queryFn: () => api<StockEntryDetail>(`/stock-entries/${id}`, { scope: ws.scope }), retry: false });
  if (q.error) return <Alert tone="danger" title="Can't open this entry">{q.error.message}. It may belong to another legal entity.</Alert>;
  if (!q.data) return <p className="text-muted">Loading…</p>;
  // Remount after status changes so the form switches between edit and read-only.
  return <StockEntryForm key={`${q.data.id}:${q.data.status}`} entry={q.data} />;
}

export default function Page() {
  return (
    <EntityGate>
      <Entry />
    </EntityGate>
  );
}
