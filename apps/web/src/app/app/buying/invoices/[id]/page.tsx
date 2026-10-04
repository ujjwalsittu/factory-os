'use client';
import { Alert } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { PurchaseInvoiceForm } from '@/components/purchase-invoice-form';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { PurchaseInvoiceDetail } from '@/lib/types';

function Invoice() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['purchase-invoice', id, ws.entityId], queryFn: () => api<PurchaseInvoiceDetail>(`/purchase-invoices/${id}`, { scope: ws.scope }), retry: false });
  if (q.error) return <Alert tone="danger" title="Can't open this invoice">{q.error.message}. It may belong to another legal entity.</Alert>;
  if (!q.data) return <p className="text-muted">Loading…</p>;
  return <PurchaseInvoiceForm key={`${q.data.id}:${q.data.status}`} invoice={q.data} />;
}

export default function Page() {
  return (
    <EntityGate>
      <Invoice />
    </EntityGate>
  );
}
