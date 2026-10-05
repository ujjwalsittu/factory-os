'use client';
import { Alert, Card } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { SourceAccountingStatus } from '@/lib/accounting';
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
      api<SourceAccountingStatus>(
        `/accounts/source-status?sourceType=${type}&sourceId=${id}`,
        {
          scope: ws.scope,
        },
      ),
    enabled:
      ws.can('accounts.voucher.read') ||
      ws.can(
        {
          stock_entry: 'inventory.stock_entry.read',
          purchase_invoice: 'buying.purchase_invoice.read',
          sales_invoice: 'selling.sales_invoice.read',
          landed_cost: 'buying.landed_cost.read',
        }[type],
      ),
    retry: false,
  });
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!q.data) return null;
  if (q.data.state === 'inactive')
    return (
      <Alert tone="info">
        Accounting inactive. This document has no GL posting; configure and
        reconcile the opening books before cut-over.
      </Alert>
    );
  if (q.data.state === 'historical')
    return (
      <Alert tone="info">
        Historical document from before accounting cut-over. Its outstanding
        balances belong in the reviewed opening books.
      </Alert>
    );
  if (q.data.state === 'missing')
    return (
      <Alert tone="danger">
        Expected accounting posting is missing. Investigate this document before
        relying on the books.
      </Alert>
    );
  if (q.data.state === 'no_value_change')
    return (
      <Alert tone="info">
        Accounted for with no monetary GL voucher: {q.data.reason}.
      </Alert>
    );
  if (!q.data.vouchers.length) return null;
  return (
    <Card className="p-4">
      <p className="mb-2 text-sm font-medium">Accounting vouchers</p>
      <div className="flex flex-wrap gap-4">
        {q.data.vouchers.map((v) => (
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
