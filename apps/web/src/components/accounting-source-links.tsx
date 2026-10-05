'use client';
import { Alert, Card } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { Journal } from '@/lib/accounting';
import { useWorkspace } from './workspace';
export function AccountingSourceLinks({
  type,
  id,
}: {
  type: 'stock_entry' | 'purchase_invoice' | 'sales_invoice' | 'landed_cost';
  id: string;
}) {
  const ws = useWorkspace();
  const q = useQuery({
    queryKey: ['source-journals', ws.tenantId, ws.entityId, type, id],
    queryFn: () =>
      api<Journal[]>(`/accounts/journals?sourceType=${type}&sourceId=${id}`, {
        scope: ws.scope,
      }),
    enabled: ws.can('accounts.voucher.read'),
    retry: false,
  });
  if (!ws.can('accounts.voucher.read')) return null;
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!q.data?.length) return null;
  return (
    <Card className="p-4">
      <p className="mb-2 text-sm font-medium">Accounting vouchers</p>
      <div className="flex flex-wrap gap-4">
        {q.data.map((v) => (
          <Link
            key={v.id}
            className="text-sm text-accent"
            href={`/app/accounts/journals/${v.id}`}
          >
            {v.number} · {v.purpose === 'reversal' ? 'Reversal' : v.status}
          </Link>
        ))}
      </div>
    </Card>
  );
}
