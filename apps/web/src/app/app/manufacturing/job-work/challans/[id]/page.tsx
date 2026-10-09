'use client';
import { Alert, Button, Table, Td, Th } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatQty } from '@/lib/format';
import type { ChallanPrint } from '@/lib/job-work';

/** Delivery challan for job work (CGST rule 55(1)(b); evidence docs/compliance/itc04-evidence.md). */
export default function ChallanPrintPage() {
  return (
    <EntityGate what="job work">
      <Challan />
    </EntityGate>
  );
}

const money = (v: string) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Addr = ChallanPrint['consigner']['address'];
const address = (a: Addr) => (a ? [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', ') : '');

function Challan() {
  const ws = useWorkspace();
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['job-work-challan', ws.entityId, id], queryFn: () => api<ChallanPrint>(`/manufacturing/job-work/challans/${id}`, { scope: ws.scope }) });
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  const c = q.data;
  if (!c) return <p className="text-muted">Loading…</p>;
  const total = c.lines.reduce((s, l) => s + Number(l.value), 0);
  return (
    <>
      <div className="mb-5 flex gap-3 print:hidden">
        <Link className="text-[13px] hover:text-accent" href={`/app/manufacturing/job-work`}>
          Back to job work
        </Link>
        <Button onClick={() => window.print()}>Print / PDF</Button>
      </div>
      <article className="mx-auto max-w-[210mm] space-y-5 bg-surface p-8 text-sm print:p-0">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Delivery challan</h1>
            <p className="text-muted">For job work · Rule 55 of the CGST Rules</p>
          </div>
          <dl className="text-right">
            <dt className="text-muted">Challan no.</dt>
            <dd className="font-mono text-lg font-semibold">{c.number}</dd>
            <dt className="mt-1 text-muted">Date</dt>
            <dd>{formatDate(c.postingDate)}</dd>
          </dl>
        </header>
        {c.status === 'cancelled' && <Alert tone="danger">CANCELLED — {c.cancelReason}</Alert>}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[12px] text-muted">Consigner (principal)</p>
            <p className="font-semibold">{c.consigner.name}</p>
            <p>{address(c.consigner.address)}</p>
            <p>GSTIN {c.consigner.gstin ?? '—'}</p>
          </div>
          <div>
            <p className="text-[12px] text-muted">Consignee (job worker)</p>
            <p className="font-semibold">{c.consignee.name}</p>
            <p>{address(c.consignee.address)}</p>
            <p>GSTIN {c.consignee.gstin ?? 'Unregistered'}</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <dt className="text-[12px] text-muted">Job work order</dt>
            <dd className="font-mono">{c.orderNumber}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Nature of work</dt>
            <dd>{c.natureOfWork ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Place of supply</dt>
            <dd>{c.interstate ? `State ${c.placeOfSupplyStateCode} (inter-State)` : 'Intra-State'}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">E-way bill / vehicle</dt>
            <dd>
              {c.ewayBillNo ?? '—'} / {c.vehicleNo ?? '—'}
            </dd>
          </div>
        </dl>
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Description</Th>
              <Th>HSN</Th>
              <Th className="text-right">Quantity</Th>
              <Th className="text-right">Taxable value (₹)</Th>
            </tr>
          </thead>
          <tbody>
            {c.lines.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <Td>{l.lineNo}</Td>
                <Td>
                  {l.itemCode} {l.itemName}
                  {l.batchNo && <span className="block text-[12px]">Batch / heat {l.batchNo}</span>}
                  <span className="block text-[12px] text-muted">{l.goodsType === 'capital_good' ? 'Capital goods' : 'Inputs'}</span>
                </Td>
                <Td className="font-mono">{l.hsnCode ?? '—'}</Td>
                <Td className="tabular text-right">
                  {formatQty(l.qty)} {l.uom}
                </Td>
                <Td className="tabular text-right">{money(l.value)}</Td>
              </tr>
            ))}
            <tr className="border-t border-line font-semibold">
              <Td colSpan={4} className="text-right">
                Total
              </Td>
              <Td className="tabular text-right">{money(String(total))}</Td>
            </tr>
          </tbody>
        </Table>
        <p className="font-medium">Goods sent for job work under Section 143 of the CGST Act, 2017 — not a supply. No tax is charged.</p>
        <div className="flex justify-end pt-10">
          <div className="text-center">
            <div className="w-56 border-t border-line pt-1">Signature of the authorised signatory</div>
            <p>For {c.consigner.name}</p>
          </div>
        </div>
      </article>
    </>
  );
}
