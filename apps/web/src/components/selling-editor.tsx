'use client';
import { Alert } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { api } from '@/lib/api';
import { SELLING, type SellingDocument, type SellingKind } from '@/lib/selling';
import { EntityGate } from './entity-gate';
import { SellingForm } from './selling-form';
import { useWorkspace } from './workspace';

export function SellingEditor({
  kind,
  fresh = false,
}: {
  kind: SellingKind;
  fresh?: boolean;
}) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <EntityGate what="selling">
        <Editor kind={kind} fresh={fresh} />
      </EntityGate>
    </Suspense>
  );
}
function Editor({ kind, fresh }: { kind: SellingKind; fresh: boolean }) {
  const ws = useWorkspace(),
    { id } = useParams<{ id: string }>(),
    params = useSearchParams();
  const so = kind === 'invoices' && fresh ? params.get('so') : null;
  const q = useQuery({
    queryKey: ['selling', kind, ws.tenantId, ws.entityId, id],
    queryFn: () =>
      api<SellingDocument>(`/${SELLING[kind].endpoint}/${id}`, {
        scope: ws.scope,
      }),
    enabled: !fresh,
    retry: false,
  });
  const order = useQuery({
    queryKey: ['selling', 'orders', ws.tenantId, ws.entityId, so],
    queryFn: () =>
      api<SellingDocument>(`/sales-orders/${so}`, { scope: ws.scope }),
    enabled: !!so,
    retry: false,
  });
  if (q.error || order.error)
    return (
      <Alert tone="danger" title="Can't open this document">
        {q.error?.message ?? order.error?.message}
      </Alert>
    );
  if ((!fresh && !q.data) || (so && !order.data))
    return <p className="text-muted">Loading…</p>;
  return (
    <SellingForm
      key={`${ws.entityId}:${id ?? 'new'}:${q.data?.status ?? 'draft'}`}
      kind={kind}
      doc={q.data}
      sourceOrder={order.data}
    />
  );
}
