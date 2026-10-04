'use client';
import { Alert, Button, Table, Td, Th } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatAmount, formatDate, formatQty } from '@/lib/format';
import type { SellingDocument } from '@/lib/selling';
import type { Address } from '@/lib/types';

export default function Page() {
  return (
    <EntityGate what="selling">
      <InvoicePrint />
    </EntityGate>
  );
}
function AddressBlock({ address }: { address?: Address | null }) {
  return address ? (
    <p>
      {address.line1}
      {address.line2 && (
        <>
          <br />
          {address.line2}
        </>
      )}
      <br />
      {address.city} · {address.pincode}
      <br />
      State code {address.stateCode}
      {address.country && ` · ${address.country}`}
    </p>
  ) : (
    <p>Address not recorded</p>
  );
}
function InvoicePrint() {
  const ws = useWorkspace(),
    { id } = useParams<{ id: string }>();
  const allowed =
    ws.can('selling.sales_invoice.read') &&
    ws.can('selling.sales_invoice.export');
  const q = useQuery({
    queryKey: ['selling', 'invoices', ws.tenantId, ws.entityId, id],
    queryFn: () =>
      api<SellingDocument>(`/sales-invoices/${id}`, { scope: ws.scope }),
    enabled: allowed,
    retry: false,
  });
  if (!allowed)
    return (
      <Alert tone="danger">
        You need sales invoice read and export permissions to print this
        invoice.
      </Alert>
    );
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!q.data) return <p>Loading…</p>;
  const inv = q.data,
    entity = ws.tenantCtx.entities.find((e) => e.id === ws.entityId);
  const zero =
    inv.supplyType === 'export_under_lut' ||
    inv.supplyType === 'sez_without_payment';
  const amount = (label: string, value: string | null) =>
    value != null && (
      <div className="flex justify-between gap-8">
        <span>{label}</span>
        <span className="tabular">{formatAmount(value, inv.currency)}</span>
      </div>
    );
  return (
    <div className="mx-auto max-w-5xl space-y-5 print:max-w-none print:text-black">
      <div className="flex gap-4 print:hidden">
        <Link className="text-accent" href={`/app/selling/invoices/${id}`}>
          Back to invoice
        </Link>
        <Button onClick={() => window.print()}>Print / save PDF</Button>
      </div>
      <article className="space-y-5 border border-line bg-surface p-6 print:border-black print:bg-white print:p-0">
        <header className="flex flex-wrap justify-between gap-4 border-b border-line pb-4">
          <div>
            <h1 className="text-2xl font-semibold">Tax invoice</h1>
            <h2 className="mt-2 font-semibold">
              {inv.ourTradeName ?? entity?.legalName}
            </h2>
            <p className="font-mono">GSTIN {inv.ourGstin}</p>
            <AddressBlock address={inv.ourAddress} />
          </div>
          <div>
            <p className="font-mono font-semibold">
              {inv.number ?? 'DRAFT — not a tax invoice'}
            </p>
            <p>Date {formatDate(inv.invoiceDate ?? '')}</p>
            <p>Due {inv.dueDate ? formatDate(inv.dueDate) : '—'}</p>
            {inv.status !== 'submitted' && (
              <p className="font-semibold uppercase">{inv.status}</p>
            )}
            {inv.customerPoNo && <p>Customer PO {inv.customerPoNo}</p>}
          </div>
        </header>
        <section className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <div>
            <h2 className="font-semibold">Bill to</h2>
            <p>{inv.customerName ?? inv.partyName}</p>
            <p>GSTIN {inv.customerGstin ?? 'Unregistered / overseas'}</p>
            <AddressBlock address={inv.billingAddress} />
          </div>
          <div>
            <h2 className="font-semibold">Ship to</h2>
            <AddressBlock address={inv.shippingAddress} />
            <p>Place of supply: {inv.placeOfSupplyStateCode}</p>
          </div>
        </section>
        {zero && (
          <div className="border border-line p-3">
            <p className="font-semibold uppercase">
              {inv.supplyType === 'export_under_lut'
                ? 'Supply meant for export under LUT without payment of IGST'
                : 'Supply meant for SEZ under LUT without payment of IGST'}
            </p>
            <p>LUT ARN: {inv.lutArn}</p>
          </div>
        )}
        {inv.supplyType === 'export_with_payment' && (
          <p className="font-semibold uppercase">
            Supply meant for export on payment of IGST
          </p>
        )}
        <Table className="print:table-fixed print:[&_th]:px-1 print:[&_td]:px-1 print:[&_th]:text-[9px] print:[&_td]:text-[10px] print:[&_td]:break-words print:[&_th]:text-black print:[&_td]:text-black">
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Description / heat</Th>
              <Th>HSN/SAC</Th>
              <Th className="text-right">Qty / UoM</Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">Taxable</Th>
              <Th>GST %</Th>
              <Th className="text-right">CGST</Th>
              <Th className="text-right">SGST</Th>
              <Th className="text-right">IGST</Th>
              <Th className="text-right">Cess</Th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="break-inside-avoid">
                <Td>{l.lineNo}</Td>
                <Td>
                  {l.itemCode} · {l.description ?? l.itemName}
                  {l.batchNo && <p className="font-mono">{l.batchNo}</p>}
                </Td>
                <Td>{l.hsnCode}</Td>
                <Td className="tabular text-right">
                  {formatQty(l.qty)} {l.uomCode}
                </Td>
                <Td className="tabular text-right">
                  {formatAmount(l.rate, inv.currency)}
                </Td>
                <Td className="tabular text-right">
                  {formatAmount(l.taxableValue, inv.currency)}
                </Td>
                <Td>{l.gstRate}</Td>
                <Td>{formatAmount(l.cgst, inv.currency)}</Td>
                <Td>{formatAmount(l.sgst, inv.currency)}</Td>
                <Td>{formatAmount(l.igst, inv.currency)}</Td>
                <Td>{formatAmount(l.cess, inv.currency)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="ml-auto max-w-sm space-y-1">
          {amount('Taxable value', inv.taxableValue)}
          {amount('CGST', inv.cgst)}
          {amount('SGST', inv.sgst)}
          {amount('IGST', inv.igst)}
          {amount('Cess', inv.cess)}
          <div className="border-t border-line pt-2 font-semibold">
            {amount(`Total (${inv.currency})`, inv.grandTotal)}
          </div>
          {inv.currency !== 'INR' && (
            <p>
              Exchange rate: ₹{inv.exchangeRate} per {inv.currency}
            </p>
          )}
        </div>
        {(inv.shippingBillNo || inv.portCode) && (
          <p>
            Shipping bill {inv.shippingBillNo ?? '—'}{' '}
            {inv.shippingBillDate && formatDate(inv.shippingBillDate)} · Port{' '}
            {inv.portCode ?? '—'}
          </p>
        )}
        {inv.remarks && <p>{inv.remarks}</p>}
        <footer className="border-t border-line pt-5 text-right">
          <p>For {inv.ourTradeName ?? entity?.legalName}</p>
          <p className="mt-8">Authorised signatory</p>
        </footer>
      </article>
    </div>
  );
}
