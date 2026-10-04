'use client';
import { Badge, buttonClass, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { Ship } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { STATUS_TONE } from '@/lib/stock';
import type { LandedCostRow } from '@/lib/types';

export default function LandedCostsPage() {
  const ws = useWorkspace();
  return (
    <>
      <PageHeader
        title="Landed cost"
        description="Bills of Entry, customs duty, freight and clearing charges on imported material, spread into the cost of the batches they brought in."
        actions={
          ws.entityId &&
          ws.can('buying.landed_cost.create') && (
            <Link href="/app/buying/landed-costs/new" className={buttonClass('primary', 'md')}>
              New landed cost
            </Link>
          )
        }
      />
      <EntityGate what="buying">
        <VoucherList />
      </EntityGate>
    </>
  );
}

function VoucherList() {
  const ws = useWorkspace();
  const router = useRouter();
  const q = useQuery({ queryKey: ['landed-costs', ws.entityId], queryFn: () => api<LandedCostRow[]>('/landed-costs', { scope: ws.scope }) });
  return (
    <Card>
      {q.data?.length === 0 ? (
        <EmptyState icon={<Ship className="size-5" />} title="No landed cost vouchers" description="When a Bill of Entry or a freight/CHA bill arrives for an import, record it here against the receipts it covers." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Date</Th>
              <Th>Bill of Entry</Th>
              <Th>Receipts</Th>
              <Th className="text-right">Charges</Th>
              <Th className="text-right">On stock</Th>
              <Th className="text-right">Variance</Th>
              <Th className="text-right">Import IGST</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((v) => (
              <Tr key={v.id} className="cursor-pointer" onClick={() => router.push(`/app/buying/landed-costs/${v.id}`)}>
                <Td className="font-mono text-[13px] font-medium whitespace-nowrap">
                  <Link href={`/app/buying/landed-costs/${v.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent">
                    {v.number ?? <span className="text-subtle">Draft</span>}
                  </Link>
                </Td>
                <Td className="tabular text-[13px] whitespace-nowrap">{formatDate(v.postingDate)}</Td>
                <Td className="font-mono text-[12px]">
                  {v.boeNo ?? '—'}
                  {v.boeDate && <span className="text-subtle"> · {formatDate(v.boeDate)}</span>}
                </Td>
                <Td className="font-mono text-[12px]">{v.receipts ?? '—'}</Td>
                <Td className="tabular text-right">{formatMoney(v.totalCharges)}</Td>
                <Td className="tabular text-right text-[13px]">{v.status === 'draft' ? '—' : formatMoney(v.onHandValue)}</Td>
                <Td className="tabular text-right text-[13px]">{v.status === 'draft' ? '—' : formatMoney(v.varianceValue)}</Td>
                <Td className="tabular text-right text-[13px]">{formatMoney(v.importIgst)}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[v.status]} dot>
                    {v.status[0]!.toUpperCase() + v.status.slice(1)}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
