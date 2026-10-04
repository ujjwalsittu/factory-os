'use client';
import { Badge, buttonClass, Card, cn, EmptyState, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { MSME_LABELS } from '@/lib/buying';
import { formatDate, formatMoney, today } from '@/lib/format';
import { STATUS_TONE } from '@/lib/stock';
import type { DocStatus, PurchaseInvoiceRow } from '@/lib/types';

const TABS: { key: DocStatus | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function PurchaseInvoicesPage() {
  const ws = useWorkspace();
  return (
    <>
      <PageHeader
        title="Purchase invoices"
        description="Supplier bills, matched to the purchase order and what was received. GST is calculated, never typed."
        actions={
          ws.entityId &&
          ws.can('buying.purchase_invoice.create') && (
            <Link href="/app/buying/invoices/new" className={buttonClass('primary', 'md')}>
              New purchase invoice
            </Link>
          )
        }
      />
      <EntityGate what="buying">
        <InvoiceList />
      </EntityGate>
    </>
  );
}

function InvoiceList() {
  const ws = useWorkspace();
  const router = useRouter();
  const [status, setStatus] = useState<DocStatus | ''>('');
  const q = useQuery({ queryKey: ['purchase-invoices', ws.entityId, status], queryFn: () => api<PurchaseInvoiceRow[]>(`/purchase-invoices${status ? `?status=${status}` : ''}`, { scope: ws.scope }) });
  const now = today();
  return (
    <Card>
      <div className="flex gap-1 border-b border-line px-4 py-2" role="tablist">
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
      {q.data?.length === 0 ? (
        <EmptyState icon={<FileText className="size-5" />} title="No purchase invoices" description="Record a supplier's bill from its purchase order, or on its own for services and petty purchases." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Supplier · invoice</Th>
              <Th>Invoice date</Th>
              <Th>PO</Th>
              <Th className="text-right">Taxable</Th>
              <Th className="text-right">GST</Th>
              <Th className="text-right">Total</Th>
              <Th>Due</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((i) => (
              <Tr key={i.id} className="cursor-pointer" onClick={() => router.push(`/app/buying/invoices/${i.id}`)}>
                <Td className="font-mono text-[13px] font-medium">
                  <Link href={`/app/buying/invoices/${i.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent">
                    {i.number ?? <span className="text-subtle">Draft</span>}
                  </Link>
                </Td>
                <Td className="text-[13px]">
                  {i.supplierName} <span className="font-mono text-muted">· {i.supplierInvoiceNo}</span>
                  {i.reverseCharge && <Badge tone="info" className="ml-2">RCM</Badge>}
                </Td>
                <Td className="tabular text-[13px] whitespace-nowrap">{formatDate(i.supplierInvoiceDate)}</Td>
                <Td className="font-mono text-[12px]">{i.poNumber ?? '—'}</Td>
                <Td className="tabular text-right text-[13px]">{formatMoney(i.taxableValue)}</Td>
                <Td className="tabular text-right text-[13px]">{formatMoney(i.totalTax)}</Td>
                <Td className="tabular text-right">{formatMoney(i.grandTotal)}</Td>
                <Td className="text-[13px] whitespace-nowrap">
                  {i.dueDate ? <span className={i.status === 'submitted' && i.dueDate < now ? 'text-danger' : ''}>{formatDate(i.dueDate)}</span> : '—'}
                  {i.msmeCategory && i.msmeCategory !== 'medium' && <Badge tone="warning" className="ml-2">MSME {MSME_LABELS[i.msmeCategory]}</Badge>}
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[i.status]} dot>
                    {i.status[0]!.toUpperCase() + i.status.slice(1)}
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
