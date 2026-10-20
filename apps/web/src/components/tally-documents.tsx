'use client';
import { Alert, Badge, Card, CardHeader, Table, Td, Th } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { formatDate, formatMoney, formatQty } from '@/lib/format';
import { EntityGate } from './entity-gate';
import { useWorkspace } from './workspace';

/** Decision 075: what a document created from a Tally voucher carries. */
export interface TallySourced {
  source?: string;
  taxDifference?: { expected: Record<string, string>; tally: Record<string, string> } | null;
}

/** "From Tally" and, when FactoryOS's GST differs from Tally's by more than a rupee, both figures. */
export function TallyBanner({ doc }: { doc: TallySourced | undefined }) {
  if (doc?.source !== 'tally') return null;
  const d = doc.taxDifference;
  return (
    <Alert tone={d ? 'warning' : 'info'}>
      <span className="mr-2">
        <Badge tone="info">From Tally</Badge>
      </span>
      Created from a Tally voucher in a month kept in Tally, with Tally&apos;s number and amounts. It changes only through Tally.
      {d && (
        <span className="mt-1 block">
          Tax differs from FactoryOS&apos;s calculation. Tally: {(['cgst', 'sgst', 'igst'] as const).map((h) => `${h.toUpperCase()} ${formatMoney(d.tally[h])}`).join(', ')}. FactoryOS
          would charge: {(['cgst', 'sgst', 'igst'] as const).map((h) => `${h.toUpperCase()} ${formatMoney(d.expected[h])}`).join(', ')}. Tally&apos;s figures stand.
        </span>
      )}
    </Alert>
  );
}

interface TallyNote extends TallySourced {
  id: string;
  number: string | null;
  postingDate: string;
  reason: string;
  originalInvoiceId: string | null;
  tallyBillReference: string | null;
  tallyLines: { itemId: string; hsnCode: string | null; qty: string; rate: string; gstRate: string; taxableValue: string; cgst: string; sgst: string; igst: string; cess: string }[] | null;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  grandTotal: string;
  stockEntryId?: string | null;
}

/**
 * Note pages are editors over FactoryOS invoice lines; a note from Tally (075a) is a value note that may have no such
 * lines, so it is shown read-only here instead.
 */
export function TallyNoteSwitch({ kind, children }: { kind: 'sales' | 'supplier'; children: ReactNode }) {
  const ws = useWorkspace(),
    params = useParams<{ id: string }>();
  const path = kind === 'sales' ? `/sales-notes/${params.id}` : `/buying/supplier-notes/${params.id}`;
  const note = useQuery({
    queryKey: [kind === 'sales' ? 'sales-note' : 'supplier-note', ws.tenantId, ws.entityId, params.id, 'tally'],
    queryFn: () => api<TallyNote>(path, { scope: ws.scope }),
    enabled: !!ws.entityId && ws.can(kind === 'sales' ? 'selling.sales_note.read' : 'buying.supplier_note.read'),
  });
  if (note.isLoading) return <p>Loading…</p>;
  if (note.data?.source !== 'tally') return <>{children}</>;
  return (
    <EntityGate>
      <TallyNoteView note={note.data} kind={kind} />
    </EntityGate>
  );
}

function TallyNoteView({ note: n, kind }: { note: TallyNote; kind: 'sales' | 'supplier' }) {
  const items = useWorkspace();
  const names = useQuery({
    queryKey: ['items', items.tenantId, 'tally-note-names'],
    queryFn: async () => {
      const v = await api<{ id: string; code: string; name: string }[] | { data: { id: string; code: string; name: string }[] }>('/items?limit=500', { scope: items.scope });
      return new Map((Array.isArray(v) ? v : v.data).map((i) => [i.id, `${i.code} · ${i.name}`]));
    },
  });
  const invoicePath = kind === 'sales' ? '/app/selling/invoices' : '/app/buying/invoices';
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">
        {kind === 'sales' ? 'Customer credit note' : 'Supplier debit note'} {n.number}
      </h1>
      <TallyBanner doc={n} />
      <Card>
        <CardHeader title="Details" />
        <dl className="grid gap-3 px-5 pb-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Date</dt>
            <dd>{formatDate(n.postingDate)}</dd>
          </div>
          <div>
            <dt className="text-muted">Against</dt>
            <dd>
              {n.originalInvoiceId ? (
                <Link href={`${invoicePath}/${n.originalInvoiceId}`} className="text-accent hover:underline">
                  {n.tallyBillReference ?? 'The invoice'}
                </Link>
              ) : (
                (n.tallyBillReference ?? 'No bill reference in Tally')
              )}
              {!n.originalInvoiceId && n.tallyBillReference && <span className="block text-xs text-muted">Not a FactoryOS invoice (before the cut-over or not imported)</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Reason</dt>
            <dd>{n.reason}</dd>
          </div>
        </dl>
      </Card>
      <Card>
        <CardHeader title="Lines as in Tally" />
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>HSN/SAC</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">GST %</Th>
                <Th className="text-right">Taxable</Th>
                <Th className="text-right">Tax</Th>
              </tr>
            </thead>
            <tbody>
              {(n.tallyLines ?? []).map((l, i) => (
                <tr key={i}>
                  <Td>{names.data?.get(l.itemId) ?? '…'}</Td>
                  <Td>{l.hsnCode ?? '—'}</Td>
                  <Td className="text-right">{formatQty(l.qty)}</Td>
                  <Td className="text-right">{l.gstRate}</Td>
                  <Td className="text-right">{formatMoney(l.taxableValue)}</Td>
                  <Td className="text-right">{formatMoney(String(Number(l.cgst) + Number(l.sgst) + Number(l.igst) + Number(l.cess)))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <dl className="grid gap-2 p-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Taxable value</dt>
            <dd>{formatMoney(n.taxableValue)}</dd>
          </div>
          <div>
            <dt className="text-muted">CGST · SGST · IGST</dt>
            <dd>
              {formatMoney(n.cgst)} · {formatMoney(n.sgst)} · {formatMoney(n.igst)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Total</dt>
            <dd className="font-semibold">{formatMoney(n.grandTotal)}</dd>
          </div>
        </dl>
        {n.stockEntryId && (
          <p className="px-5 pb-5 text-sm">
            Goods moved on{' '}
            <Link href={`/app/inventory/entries/${n.stockEntryId}`} className="text-accent hover:underline">
              a stock entry
            </Link>
            .
          </p>
        )}
      </Card>
    </div>
  );
}
