'use client';
import { Alert, Card } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWorkspace } from './workspace';
export function InvoiceBalance({
  type,
  id,
}: {
  type: 'sales' | 'purchase';
  id: string;
}) {
  const ws = useWorkspace();
  const q = useQuery({
    queryKey: ['invoice-balance', ws.tenantId, ws.entityId, type, id],
    queryFn: () =>
      api<{
        active: boolean;
        currency: string;
        openAmount: string;
        carryingInr: string;
      }>(`/${type}-invoices/${id}/balance`, { scope: ws.scope }),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  return (
    <Card className="p-4 mb-4">
      <p className="text-sm">
        Remaining bill balance:{' '}
        <span className="font-mono">
          {q.data ? `${q.data.currency} ${q.data.openAmount}` : 'Loading…'}
        </span>
        {q.data?.active && (
          <span className="text-muted"> · INR {q.data.carryingInr}</span>
        )}
      </p>
      {q.data && !q.data.active && (
        <p className="text-xs text-muted">
          Accounting inactive; this shows the submitted invoice total until
          cut-over establishes outstanding bills.
        </p>
      )}
    </Card>
  );
}
