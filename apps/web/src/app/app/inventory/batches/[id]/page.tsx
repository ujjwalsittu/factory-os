'use client';
// One lot, serial or remnant (decision 053): details as received, stock by warehouse, movements, quality records,
// certificates (upload MTCs here) and the certificate pack. Read-only apart from attachments.
import { Alert, Badge, Button, buttonClass, Card, CardHeader, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatQty } from '@/lib/format';
import { downloadCertificatePack } from '@/lib/quality';
import { BATCH_KIND } from '@/lib/stock';
import type { BatchDetail, LedgerRow } from '@/lib/types';

export default function BatchPage() {
  return (
    <EntityGate what="inventory">
      <View />
    </EntityGate>
  );
}

const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral' | 'accent'> = {
  draft: 'neutral',
  submitted: 'success',
  open: 'warning',
  proposed: 'warning',
  approved: 'success',
  closed: 'neutral',
  rejected: 'danger',
  cancelled: 'neutral',
};

function View() {
  const ws = useWorkspace();
  const { id } = useParams<{ id: string }>();
  const [packError, setPackError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['batch', ws.entityId, id], queryFn: () => api<BatchDetail>(`/batches/${id}`, { scope: ws.scope }) });
  const b = q.data;
  const ledger = useQuery({
    queryKey: ['batch-ledger', ws.entityId, id],
    queryFn: () => api<LedgerRow[]>(`/stock/ledger?itemId=${b!.itemId}&batchId=${id}`, { scope: ws.scope }),
    enabled: !!b && ws.can('inventory.report.read'),
  });
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!b) return <p className="text-muted">Loading…</p>;
  const total = b.stock.reduce((s, x) => s + Number(x.qty), 0);
  const field = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="text-[13px]">{value ?? '—'}</dd>
    </div>
  );
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{b.batchNo}</span>
            <Badge tone={BATCH_KIND[b.kind].tone}>{BATCH_KIND[b.kind].label}</Badge>
          </span>
        }
        description={`${b.itemCode} ${b.itemName} · ${formatQty(String(total))} ${b.uomCode} here`}
        actions={
          <div className="flex flex-wrap gap-2">
            {ws.can('manufacturing.genealogy.read') && (
              <Link href={`/app/manufacturing/genealogy?batch=${b.id}&direction=backward`} className={buttonClass('secondary', 'md')}>
                Genealogy
              </Link>
            )}
            {ws.can('quality.attachment.read') && (
              <Button
                variant="secondary"
                onClick={() => {
                  setPackError(null);
                  downloadCertificatePack(b.id, b.batchNo, ws.scope).catch((e: unknown) => setPackError(e instanceof Error ? e.message : 'Download failed'));
                }}
              >
                Certificate pack
              </Button>
            )}
          </div>
        }
      />
      {packError && <Alert tone="danger" className="mb-4">{packError}</Alert>}
      <div className="space-y-6">
        <Card className="p-5">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            {field('Item', `${b.itemCode} · ${b.itemName}`)}
            {field('Heat no.', b.heatNo && <span className="font-mono">{b.heatNo}</span>)}
            {field('Supplier', b.supplierName)}
            {field('Supplier batch no.', b.supplierBatchNo)}
            {field('Manufactured', b.mfgDate && formatDate(b.mfgDate))}
            {field('Expiry', b.expiryDate && formatDate(b.expiryDate))}
            {b.lengthMm && field('Length', `${formatQty(b.lengthMm)} mm`)}
            {b.parentBatchId &&
              field(
                'Cut from',
                <Link href={`/app/inventory/batches/${b.parentBatchId}`} className="font-mono text-accent hover:underline">
                  {b.parentBatchNo}
                </Link>,
              )}
            {field('Created', formatDate(b.createdAt.slice(0, 10)))}
          </dl>
          <p className="mt-3 text-[12px] text-subtle">Details are kept as received for traceability.</p>
        </Card>

        <Card>
          <CardHeader title="Stock" description="Where this batch is now, in this entity" />
          {b.stock.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-muted">None in stock: consumed, shipped or held in another entity.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Warehouse</Th>
                  <Th>Owner</Th>
                  <Th className="text-right">Quantity</Th>
                </tr>
              </thead>
              <tbody>
                {b.stock.map((s) => (
                  <Tr key={`${s.warehouseId}:${s.ownerName ?? ''}`}>
                    <Td>
                      <span className="font-mono text-[13px]">{s.warehouseCode}</span> <span className="text-[13px] text-muted">{s.warehouseName}</span>
                    </Td>
                    <Td className="text-[13px]">{s.ownerName ? `${s.ownerName}'s material` : 'Company'}</Td>
                    <Td className="tabular text-right">
                      {formatQty(s.qty)} <span className="text-[11px] text-subtle">{b.uomCode}</span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {ws.can('inventory.report.read') && (
          <Card>
            <CardHeader title="Movements" />
            {ledger.data?.length === 0 ? (
              <p className="px-5 py-4 text-[13px] text-muted">No movements in this entity.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Voucher</Th>
                    <Th>Warehouse</Th>
                    <Th className="text-right">Quantity</Th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data?.map((l) => (
                    <Tr key={l.seq}>
                      <Td className="tabular text-[13px] whitespace-nowrap">{formatDate(l.postingDate)}</Td>
                      <Td className="text-[13px]">
                        {l.voucherType === 'stock_entry' ? (
                          <Link href={`/app/inventory/entries/${l.voucherId}`} className="font-mono hover:text-accent">
                            {l.voucherNumber ?? '—'}
                          </Link>
                        ) : (
                          <span className="font-mono">{l.voucherNumber ?? '—'}</span>
                        )}
                        {l.isReversal && <span className="ml-2 text-[12px] text-muted">reversal</span>}
                      </Td>
                      <Td className="font-mono text-[13px]">{l.warehouseCode}</Td>
                      <Td className={`tabular text-right ${Number(l.qty) < 0 ? 'text-danger' : ''}`}>{formatQty(l.qty)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}

        {(b.inspections || b.ncrs || b.fais) && (
          <Card>
            <CardHeader title="Quality" description="Inspections, nonconformances and first-article inspections of this batch" />
            {!(b.inspections?.length || b.ncrs?.length || b.fais?.length) ? (
              <p className="px-5 py-4 text-[13px] text-muted">No quality records.</p>
            ) : (
              <ul className="divide-y divide-line">
                {b.inspections?.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-[13px]">
                    <span className="w-28 text-muted">Inspection</span>
                    {r.source === 'record' ? (
                      <Link href={`/app/quality/inspections/${r.id}`} className="font-mono text-accent hover:underline">
                        {r.number ?? 'Draft'}
                      </Link>
                    ) : (
                      <Link href="/app/buying/inspections" className="font-mono text-accent hover:underline">
                        {r.number}
                      </Link>
                    )}
                    <span className="text-muted">
                      {r.stage} · {formatQty(r.qty)} {b.uomCode}
                    </span>
                    <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.result ?? r.status}</Badge>
                  </li>
                ))}
                {b.ncrs?.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-[13px]">
                    <span className="w-28 text-muted">NCR</span>
                    <Link href={`/app/quality/ncrs/${n.id}`} className="font-mono text-accent hover:underline">
                      {n.number}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-muted">{n.description}</span>
                    <Badge tone={STATUS_TONE[n.status] ?? 'neutral'}>{n.status}</Badge>
                  </li>
                ))}
                {b.fais?.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-[13px]">
                    <span className="w-28 text-muted">First article</span>
                    <Link href={`/app/quality/fai/${f.id}`} className="font-mono text-accent hover:underline">
                      {f.number ?? 'Draft'}
                    </Link>
                    <Badge tone={STATUS_TONE[f.status] ?? 'neutral'}>{f.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {ws.can('quality.attachment.read') && <AttachmentsPanel ownerType="batch" ownerId={b.id} defaultKind="mtc" title="Certificates (MTC, CoC, CoA) and files" />}
      </div>
    </>
  );
}
