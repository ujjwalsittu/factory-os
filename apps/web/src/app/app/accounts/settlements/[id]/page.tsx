'use client';
import { Alert } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { AccountingPage } from '@/components/accounting-shared';
import { SettlementForm } from '@/components/settlement-form';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { Settlement } from '@/lib/settlements';

function Doc() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['settlement', id, ws.entityId], queryFn: () => api<Settlement>(`/accounts/settlements/${id}`, { scope: ws.scope }), retry: false });
  if (q.error) return <Alert tone="danger" title="Can't open this document">{q.error.message}</Alert>;
  if (!q.data) return <p className="text-muted">Loading…</p>;
  return <SettlementForm key={`${q.data.id}:${q.data.status}:${q.data.advance?.openAmount ?? ''}`} settlement={q.data} />;
}

export default function Page() {
  return (
    <AccountingPage title="Receipts & payments" permission="accounts.settlement.read">
      <Doc />
    </AccountingPage>
  );
}
