'use client';
import {
  Alert,
  Badge,
  buttonClass,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/format';
import { SELLING, type SellingKind, type SellingRow } from '@/lib/selling';
import { STATUS_TONE } from '@/lib/stock';
import { EntityGate } from './entity-gate';
import { useWorkspace } from './workspace';

export function SellingList({ kind }: { kind: SellingKind }) {
  const ws = useWorkspace(),
    config = SELLING[kind];
  return (
    <>
      <PageHeader
        title={config.title}
        description={
          kind === 'invoices'
            ? 'Submit an invoice to ship goods and record GST. Print the issued invoice or save it as PDF.'
            : kind === 'orders'
              ? 'Confirm customer orders, then ship and bill from the order.'
              : 'Quote goods and services, then turn an accepted quotation into a sales order.'
        }
        actions={
          ws.entityId &&
          ws.can(`selling.${config.resource}.create`) && (
            <Link
              className={buttonClass('primary', 'md')}
              href={`/app/selling/${kind}/new`}
            >
              New{' '}
              {config.singular === 'invoice'
                ? 'sales invoice'
                : config.singular}
            </Link>
          )
        }
      />
      <EntityGate what="selling">
        <Rows kind={kind} />
      </EntityGate>
    </>
  );
}
function Rows({ kind }: { kind: SellingKind }) {
  const ws = useWorkspace(),
    config = SELLING[kind];
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['selling', kind, ws.tenantId, ws.entityId, status],
    queryFn: () =>
      api<SellingRow[]>(
        `/${config.endpoint}${status ? `?status=${status}` : ''}`,
        { scope: ws.scope },
      ),
    enabled: ws.can(`selling.${config.resource}.read`),
    retry: false,
  });
  if (!ws.can(`selling.${config.resource}.read`))
    return (
      <Alert tone="danger">
        You don't have permission to view {config.title.toLowerCase()}.
      </Alert>
    );
  return (
    <Card>
      <div className="border-b border-line p-3">
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="max-w-48"
        >
          <option value="">All statuses</option>
          <option value="draft">Drafts</option>
          <option value="submitted">Submitted</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>
      {q.error && <Alert tone="danger">{q.error.message}</Alert>}
      {q.isLoading && <p className="p-4 text-muted">Loading…</p>}
      {q.data?.length === 0 && (
        <EmptyState
          icon={<FileText className="size-5" />}
          title={`No ${config.title.toLowerCase()} yet`}
          description={`Create a ${config.singular} to start the selling workflow.`}
        />
      )}
      {!!q.data?.length && (
        <Table>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Date</Th>
              <Th>Customer</Th>
              {kind === 'orders' && <Th className="text-right">Invoiced</Th>}
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((d) => (
              <tr key={d.id}>
                <Td>
                  <Link
                    className="font-mono text-accent"
                    href={`/app/selling/${kind}/${d.id}`}
                  >
                    {d.number ?? 'Draft'}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">
                  {formatDate(d[config.date] ?? '')}
                </Td>
                <Td>{d.customerName}</Td>
                {kind === 'orders' && (
                  <Td className="tabular text-right">
                    {d.orderedQty && Number(d.orderedQty) > 0
                      ? `${Math.round((Number(d.invoicedQty) / Number(d.orderedQty)) * 100)}%`
                      : '—'}
                  </Td>
                )}
                <Td className="tabular whitespace-nowrap text-right">
                  {formatAmount(d.grandTotal, d.currency)}
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[d.status]}>
                    {d.closedAt
                      ? 'Closed'
                      : d.status === 'submitted'
                        ? 'Submitted'
                        : d.status === 'cancelled'
                          ? 'Cancelled'
                          : 'Draft'}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
