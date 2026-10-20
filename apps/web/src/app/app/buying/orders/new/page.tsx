'use client';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { PurchaseOrderForm } from '@/components/purchase-order-form';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { Item } from '@/lib/types';

/** `?item=<id>&qty=<n>` starts the order with that item (hand-off from "below reorder level", decision 068). */
function New() {
  const ws = useWorkspace();
  const params = useSearchParams();
  // Read once: saving rewrites the URL to the draft's address.
  const [itemId] = useState(() => params.get('item'));
  const [qty] = useState(() => (/^\d+(\.\d+)?$/.test(params.get('qty') ?? '') ? params.get('qty')! : ''));
  const item = useQuery({ queryKey: ['item', ws.tenantId, itemId], queryFn: () => api<Item>(`/items/${itemId}`, { scope: ws.scope }), enabled: !!itemId, retry: false });
  if (itemId && item.isPending) return <p>Loading…</p>;
  const initialItem = item.data ? { item: { id: item.data.id, code: item.data.code, name: item.data.name, uomCode: item.data.uomCode }, qty } : undefined;
  return <PurchaseOrderForm initialItem={initialItem} />;
}

export default function Page() {
  return (
    <EntityGate>
      <Suspense>
        <New />
      </Suspense>
    </EntityGate>
  );
}
