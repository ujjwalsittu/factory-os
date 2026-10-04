'use client';
import { Badge, buttonClass, Card, cn, EmptyState, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { PURPOSE_LABELS, STATUS_TONE } from '@/lib/stock';
import type { DocStatus, StockEntryRow } from '@/lib/types';

const TABS: { key: DocStatus | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function StockEntriesPage() {
  const ws = useWorkspace();
  return (
    <>
      <PageHeader
        title="Stock entries"
        description="Receipts, issues, transfers and adjustments. Submitting posts to the stock ledger at FIFO cost."
        actions={
          ws.entityId &&
          ws.can('inventory.stock_entry.create') && (
            <div className="flex gap-2">
              {(['receipt', 'issue', 'transfer'] as const).map((p, i) => (
                <Link key={p} href={`/app/inventory/entries/new?purpose=${p}`} className={buttonClass(i === 0 ? 'primary' : 'secondary', 'md')}>
                  New {p}
                </Link>
              ))}
              <OtherPurposes />
            </div>
          )
        }
      />
      <EntityGate>
        <EntryList />
      </EntityGate>
    </>
  );
}

/** Less frequent purposes live in a menu so the toolbar stays calm. */
function OtherPurposes() {
  const router = useRouter();
  return (
    <Select className="w-44" value="" onChange={(e) => e.target.value && router.push(`/app/inventory/entries/new?purpose=${e.target.value}`)} aria-label="Other entry types">
      <option value="">Other…</option>
      <option value="return">Return to customer</option>
      <option value="scrap">Scrap</option>
      <option value="adjustment">Adjustment</option>
    </Select>
  );
}

function EntryList() {
  const ws = useWorkspace();
  const router = useRouter();
  const [status, setStatus] = useState<DocStatus | ''>('');
  const [purpose, setPurpose] = useState('');
  const q = useQuery({
    queryKey: ['stock-entries', ws.entityId, status, purpose],
    queryFn: () => api<StockEntryRow[]>(`/stock-entries?${new URLSearchParams({ ...(status && { status }), ...(purpose && { purpose }) })}`, { scope: ws.scope }),
  });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <div className="flex gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={status === t.key}
              onClick={() => setStatus(t.key)}
              className={cn('rounded-lg px-3 py-1.5 text-[13px] font-medium', status === t.key ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Select className="ml-auto w-44" value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Filter by purpose">
          <option value="">All purposes</option>
          {Object.entries(PURPOSE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      {q.data?.length === 0 ? (
        <EmptyState icon={<ArrowLeftRight className="size-5" />} title="No stock entries" description="Record a receipt to bring stock in. Batch-tracked items get their heat number here." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Date</Th>
              <Th>Purpose</Th>
              <Th>Party / reference</Th>
              <Th className="text-right">Lines</Th>
              <Th className="text-right">Value</Th>
              <Th>Status</Th>
              <Th>By</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((e) => (
              <Tr key={e.id} className="cursor-pointer" onClick={() => router.push(`/app/inventory/entries/${e.id}`)}>
                <Td className="font-mono text-[13px] font-medium">
                  <Link href={`/app/inventory/entries/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="hover:text-accent">
                    {e.number ?? <span className="text-subtle">Draft</span>}
                  </Link>
                </Td>
                <Td className="tabular text-[13px] whitespace-nowrap">{formatDate(e.postingDate)}</Td>
                <Td className="text-[13px]">{PURPOSE_LABELS[e.purpose]}</Td>
                <Td className="text-[13px]">
                  {e.partyName ?? ''}
                  {e.reference && <span className="ml-1 text-muted">{e.partyName ? '· ' : ''}{e.reference}</span>}
                </Td>
                <Td className="tabular text-right">{e.lineCount}</Td>
                <Td className="tabular text-right">{e.status === 'draft' ? '—' : formatMoney(e.totalValue)}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[e.status]} dot>
                    {e.status[0]!.toUpperCase() + e.status.slice(1)}
                  </Badge>
                </Td>
                <Td className="text-[13px] text-muted">{e.createdByName}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
