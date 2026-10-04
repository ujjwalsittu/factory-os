'use client';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { Handshake, Printer } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatQty, today } from '@/lib/format';
import { PURPOSE_LABELS, WASTE_CATEGORY_LABELS } from '@/lib/stock';
import type { CustomerStatement, Party } from '@/lib/types';

const monthStart = () => `${today().slice(0, 8)}01`;

export default function CustomerMaterialPage() {
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Customer material" description="Statement of customer-supplied material: received, consumed, returned, scrapped and on hand, with the waste it produced." />
      </div>
      <EntityGate what="customer material">
        <Statement />
      </EntityGate>
    </>
  );
}

function Statement() {
  const ws = useWorkspace();
  const customers = useQuery({ queryKey: ['parties', ws.tenantId, '', 'customer'], queryFn: () => api<Party[]>('/parties?role=customer&limit=500', { scope: ws.scope }) });
  const [partyId, setPartyId] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const q = useQuery({
    queryKey: ['customer-statement', ws.entityId, partyId, from, to],
    queryFn: () => api<CustomerStatement>(`/reports/customer-material?partyId=${partyId}&from=${from}&to=${to}`, { scope: ws.scope }),
    enabled: !!partyId && !!from && !!to && from <= to,
  });
  const entity = ws.tenantCtx.entities.find((e) => e.id === ws.entityId);
  const s = q.data;

  return (
    <div className="space-y-6">
      <Card className="p-4 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Customer" className="min-w-64 flex-1">
            {(p) => (
              <Select {...p} value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                <option value="">Choose…</option>
                {customers.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="From">{(p) => <Input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="To">{(p) => <Input {...p} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
          <Button variant="secondary" onClick={() => window.print()} disabled={!s}>
            <Printer className="size-4" /> Print / PDF
          </Button>
        </div>
      </Card>

      {!partyId ? (
        <Card>
          <EmptyState icon={<Handshake className="size-5" />} title="Choose a customer" description="The statement reconciles everything they sent with what was used, returned, scrapped and is still with you." />
        </Card>
      ) : s ? (
        <>
          <div className="hidden print:block">
            <p className="text-[18px] font-semibold">{entity?.legalName}</p>
            <p className="text-[13px]">Statement of customer-supplied material</p>
          </div>
          <Card className="p-5 print:border-0 print:shadow-none">
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <p className="text-[12px] text-muted uppercase">Customer</p>
                <p className="text-[16px] font-semibold">{s.customer.name}</p>
                {s.customer.gstin && <p className="font-mono text-[12px] text-muted">GSTIN {s.customer.gstin}</p>}
              </div>
              <div className="text-right">
                <p className="text-[12px] text-muted uppercase">Period</p>
                <p className="text-[14px] font-medium">
                  {formatDate(s.from)} – {formatDate(s.to)}
                </p>
              </div>
            </div>
          </Card>

          <Card className="print:border-0 print:shadow-none">
            <CardHeader title="Material" description="Quantities in each item's stock unit" />
            {s.items.length === 0 ? (
              <EmptyState title="No material from this customer up to this date" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Item · batch / heat</Th>
                    <Th className="text-right">Opening</Th>
                    <Th className="text-right">Received</Th>
                    <Th className="text-right">Consumed</Th>
                    <Th className="text-right">Returned</Th>
                    <Th className="text-right">Scrapped</Th>
                    <Th className="text-right">Adjusted</Th>
                    <Th className="text-right">With us</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.items.map((i) => (
                    <Tr key={`${i.itemId}:${i.batchNo}`}>
                      <Td>
                        <span className="font-mono text-[13px] font-medium">{i.itemCode}</span> <span className="text-[13px] text-muted">{i.itemName}</span>
                        {i.batchNo && <p className="font-mono text-[12px] text-subtle">{i.batchNo}{i.heatNo && i.heatNo !== i.batchNo ? ` · ${i.heatNo}` : ''}</p>}
                      </Td>
                      {(['opening', 'received', 'consumed', 'returned', 'scrapped', 'adjusted'] as const).map((k) => (
                        <Td key={k} className="tabular text-right text-[13px] whitespace-nowrap">
                          {Number(i[k]) ? formatQty(i[k]) : <span className="text-subtle">—</span>}
                        </Td>
                      ))}
                      <Td className="tabular text-right font-semibold whitespace-nowrap">
                        {formatQty(i.closing)} <span className="text-[11px] font-normal text-subtle">{i.uomCode}</span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card className="print:border-0 print:shadow-none">
            <CardHeader title="Waste from their material" description="Their waste is returned, or disposed of only with their consent" />
            {s.waste.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-muted">No waste recorded.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Stream</Th>
                    <Th className="text-right">Opening</Th>
                    <Th className="text-right">Generated</Th>
                    <Th className="text-right">Returned to you</Th>
                    <Th className="text-right">Disposed (with consent)</Th>
                    <Th className="text-right">Pending</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.waste.map((w) => (
                    <Tr key={`${w.category}:${w.material}`}>
                      <Td>
                        <p className="text-[13px] font-medium">{w.material}</p>
                        <p className="text-[12px] text-muted">{WASTE_CATEGORY_LABELS[w.category]}</p>
                      </Td>
                      {(['opening', 'generated', 'returned', 'disposedWithConsent'] as const).map((k) => (
                        <Td key={k} className="tabular text-right text-[13px] whitespace-nowrap">
                          {Number(w[k]) ? formatQty(w[k]) : <span className="text-subtle">—</span>}
                        </Td>
                      ))}
                      <Td className="tabular text-right font-semibold whitespace-nowrap">
                        {formatQty(w.pending)} <span className="text-[11px] font-normal text-subtle">{w.uomCode}</span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card className="print:break-before-page print:border-0 print:shadow-none">
            <CardHeader title="Documents in the period" />
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Document</Th>
                  <Th>Type</Th>
                  <Th>Reference</Th>
                  <Th>Item · batch</Th>
                  <Th className="text-right">Qty</Th>
                </tr>
              </thead>
              <tbody>
                {s.movements.map((mv, i) => (
                  <Tr key={i}>
                    <Td className="text-[13px] whitespace-nowrap">{formatDate(mv.postingDate)}</Td>
                    <Td>
                      <Link href={`/app/inventory/entries/${mv.entryId}`} className="font-mono text-[13px] hover:text-accent">
                        {mv.number}
                      </Link>
                      {mv.isReversal && (
                        <Badge tone="danger" className="ml-2">
                          Reversal
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-[13px]">{PURPOSE_LABELS[mv.purpose]}</Td>
                    <Td className="text-[13px] text-muted">{mv.reference ?? '—'}</Td>
                    <Td className="font-mono text-[12px]">
                      {mv.itemCode}
                      {mv.batchNo ? ` · ${mv.batchNo}` : ''}
                    </Td>
                    <Td className={`tabular text-right text-[13px] whitespace-nowrap ${Number(mv.qty) < 0 ? 'text-danger' : 'text-success'}`}>
                      {Number(mv.qty) > 0 ? '+' : ''}
                      {formatQty(mv.qty)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <p className="text-[12px] text-subtle">
            Generated by FactoryOS on {formatDate(new Date())}. Internal transfers between our warehouses are not listed; cancelled documents appear with their reversals.
          </p>
        </>
      ) : (
        <p className="text-muted">{q.isLoading ? 'Loading…' : q.error?.message}</p>
      )}
    </div>
  );
}
