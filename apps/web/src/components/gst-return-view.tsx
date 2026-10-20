'use client';
import { Alert, Badge, Card, CardHeader, Table, Td, Th } from '@factoryos/ui';
import { CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { formatDate, formatMoney, formatQty } from '@/lib/format';
import { type Amounts, type Attention, type Check, documentHref, type Gstr1, type Gstr3b, SECTION_LABEL, type Taxes } from '@/lib/gst-returns';

const money = (v: string) => formatMoney(v);
const HEADS = ['igst', 'cgst', 'sgst', 'cess'] as const;

/** The reconciliation checks: GSTR-1 against 3B, document series, and both against the ledger. */
export function ChecksCard({ checks }: { checks: Check[] }) {
  return (
    <Card>
      <CardHeader title="Checks" description="Each figure is compared with another source before review." />
      <ul className="divide-y divide-line">
        {checks.map((c) => (
          <li key={c.name} className="flex items-start gap-3 px-5 py-3 text-[13px]">
            {c.ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />}
            <span className="min-w-0">
              <span className="font-medium text-fg">{c.name}</span>
              <span className="sr-only">{c.ok ? ' — passes' : ' — fails'}</span>
              <span className="block break-words text-muted">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Documents that need a correction before filing; blocking ones stop review. */
export function AttentionCard({ items }: { items: Attention[] }) {
  if (!items.length) return null;
  return (
    <Card>
      <CardHeader title="Needs attention" description="Correct these documents, then prepare the return again." />
      <ul className="divide-y divide-line">
        {items.map((a, i) => (
          <li key={`${a.documentId}-${i}`} className="flex flex-wrap items-center gap-2 px-5 py-3 text-[13px]">
            <Badge tone={a.blocking ? 'danger' : 'warning'}>{a.blocking ? 'Blocks review' : 'Check'}</Badge>
            <Link className="font-mono hover:text-accent" href={documentHref(a.documentType, a.documentId)}>
              {a.number}
            </Link>
            <span className="text-muted">{a.reason}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AmountCells({ a }: { a: Amounts }) {
  return (
    <>
      <Td className="tabular text-right">{money(a.taxable)}</Td>
      {HEADS.map((h) => (
        <Td key={h} className="tabular text-right">
          {Number(a[h]) ? money(a[h]) : '—'}
        </Td>
      ))}
    </>
  );
}
const AmountHeads = () => (
  <>
    <Th className="text-right">Taxable</Th>
    <Th className="text-right">IGST</Th>
    <Th className="text-right">CGST</Th>
    <Th className="text-right">SGST</Th>
    <Th className="text-right">Cess</Th>
  </>
);

/** GSTR-1 by section, each document linking to its page (drill-down), then B2CS, nil, HSN and documents issued. */
export function Gstr1View({ g }: { g: Gstr1 }) {
  const sections = (['b2b', 'b2cl', 'exp', 'cdnr', 'cdnur'] as const).map((s) => ({ s, rows: g.entries.filter((e) => e.section === s) }));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Summary" description="Totals by section. Notes are net: a credit note reduces the figure." />
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Section</Th>
                <AmountHeads />
              </tr>
            </thead>
            <tbody>
              {(Object.keys(g.totals) as (keyof Gstr1['totals'])[]).map((k) => (
                <tr key={k} className="border-t border-line text-[13px]">
                  <Td className="font-medium uppercase">{k}</Td>
                  <AmountCells a={g.totals[k]} />
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
      {sections
        .filter((x) => x.rows.length)
        .map(({ s, rows }) => (
          <Card key={s}>
            <CardHeader title={SECTION_LABEL[s]!} description={`${rows.length} document${rows.length === 1 ? '' : 's'}`} />
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Document</Th>
                    <Th>Buyer GSTIN</Th>
                    <Th>Place of supply</Th>
                    <AmountHeads />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.documentId} className="border-t border-line text-[13px]">
                      <Td className="whitespace-nowrap">
                        <Link className="font-mono hover:text-accent" href={documentHref(e.documentType, e.documentId)}>
                          {e.number}
                        </Link>
                        <span className="block text-subtle">
                          {formatDate(e.date)}
                          {e.subtype && e.subtype !== 'R' ? ` · ${e.subtype}` : ''}
                          {e.reverseCharge ? ' · reverse charge' : ''}
                        </span>
                      </Td>
                      <Td className="font-mono">{e.counterpartyGstin ?? '—'}</Td>
                      <Td>{e.placeOfSupply ?? '—'}</Td>
                      <AmountCells a={e.amounts} />
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        ))}
      {g.b2cs.length > 0 && (
        <Card>
          <CardHeader title="B2CS · other sales to unregistered buyers (7)" description="By place of supply and rate." />
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Place of supply</Th>
                  <Th className="text-right">Rate</Th>
                  <AmountHeads />
                </tr>
              </thead>
              <tbody>
                {g.b2cs.map((r) => (
                  <tr key={`${r.placeOfSupply}-${r.rate}`} className="border-t border-line text-[13px]">
                    <Td>{r.placeOfSupply}</Td>
                    <Td className="tabular text-right">{Number(r.rate)}%</Td>
                    <AmountCells a={r} />
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
      {g.nil.length > 0 && (
        <Card>
          <CardHeader title="Nil-rated supplies (8)" />
          <div className="overflow-x-auto">
            <Table>
              <tbody>
                {g.nil.map((n) => (
                  <tr key={n.table} className="border-t border-line text-[13px]">
                    <Td>{n.table}</Td>
                    <Td className="tabular text-right">{money(n.nil)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
      {g.hsn.length > 0 && (
        <Card>
          <CardHeader title="HSN summary (12)" description="Split into B2B and B2C, with the GST unit code of each unit." />
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Part</Th>
                  <Th>HSN / SAC</Th>
                  <Th className="text-right">Quantity</Th>
                  <Th className="text-right">Rate</Th>
                  <AmountHeads />
                </tr>
              </thead>
              <tbody>
                {g.hsn.map((h, i) => (
                  <tr key={i} className="border-t border-line text-[13px]">
                    <Td className="uppercase">{h.part}</Td>
                    <Td className="font-mono">{h.hsn}</Td>
                    <Td className="tabular text-right whitespace-nowrap">
                      {formatQty(h.qty, 2)} {h.uqc}
                    </Td>
                    <Td className="tabular text-right">{Number(h.rate)}%</Td>
                    <AmountCells a={h} />
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
      {g.documents.length > 0 && (
        <Card>
          <CardHeader title="Documents issued (13)" />
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Nature</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Cancelled</Th>
                </tr>
              </thead>
              <tbody>
                {g.documents.map((d) => (
                  <tr key={`${d.nature}-${d.series}`} className="border-t border-line text-[13px]">
                    <Td>
                      {d.nature.replaceAll('_', ' ')}
                      {d.gaps.length > 0 && <span className="block text-warning">Missing: {d.gaps.join(', ')}</span>}
                    </Td>
                    <Td className="font-mono">{d.from}</Td>
                    <Td className="font-mono">{d.to}</Td>
                    <Td className="tabular text-right">{d.total}</Td>
                    <Td className="tabular text-right">{d.cancelled}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function TaxRows({ rows }: { rows: [string, Taxes | Amounts][] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <thead>
          <tr>
            <Th>Row</Th>
            <Th className="text-right">Taxable</Th>
            <Th className="text-right">IGST</Th>
            <Th className="text-right">CGST</Th>
            <Th className="text-right">SGST</Th>
            <Th className="text-right">Cess</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a]) => (
            <tr key={label} className="border-t border-line text-[13px]">
              <Td>{label}</Td>
              <Td className="tabular text-right">{'taxable' in a ? money(a.taxable) : '—'}</Td>
              {HEADS.map((h) => (
                <Td key={h} className="tabular text-right">
                  {Number(a[h]) ? money(a[h]) : '—'}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/** GSTR-3B tables, labelled by what each row holds (the portal's current labels are not pinned; see decision 074a). */
export function Gstr3bView({ g }: { g: Gstr3b }) {
  const t = g['3.1'],
    i = g['4'];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="3.1 · Outward and reverse-charge inward supplies" />
        <TaxRows
          rows={[
            ['(a) Outward taxable', t.a],
            ['(b) Zero rated', t.b],
            ['(c) Nil rated and exempt', t.c],
            ['(d) Inward, reverse charge', t.d],
            ['(e) Non-GST outward', t.e],
          ]}
        />
      </Card>
      {g['3.2'].length > 0 && (
        <Card>
          <CardHeader title="3.2 · Inter-State supplies to unregistered persons" />
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Place of supply</Th>
                  <Th className="text-right">Taxable</Th>
                  <Th className="text-right">IGST</Th>
                </tr>
              </thead>
              <tbody>
                {g['3.2'].map((r) => (
                  <tr key={r.placeOfSupply} className="border-t border-line text-[13px]">
                    <Td>{r.placeOfSupply}</Td>
                    <Td className="tabular text-right">{money(r.unregistered.taxable)}</Td>
                    <Td className="tabular text-right">{money(r.unregistered.igst)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="4 · Eligible input tax credit" />
        <TaxRows
          rows={[
            ['(A)(1) Import of goods', i.a1],
            ['(A)(2) Import of services', i.a2],
            ['(A)(3) Reverse charge', i.a3],
            ['(A)(4) Input service distributor', i.a4],
            ['(A)(5) All other ITC', i.a5],
            ['(B)(1) Reversed, as per rules', i.b1],
            ['(B)(2) Reversed, others', i.b2],
            ['(C) Net ITC available', i.c],
            ['(D)(1) Ineligible, section 17(5)', i.d1],
            ['(D)(2) Ineligible, others', i.d2],
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="5 · Exempt, nil and non-GST inward supplies" />
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Nature</Th>
                <Th className="text-right">Inter-State</Th>
                <Th className="text-right">Intra-State</Th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line text-[13px]">
                <Td>Composition, exempt and nil</Td>
                <Td className="tabular text-right">{money(g['5'].compositionExemptNil.inter)}</Td>
                <Td className="tabular text-right">{money(g['5'].compositionExemptNil.intra)}</Td>
              </tr>
              <tr className="border-t border-line text-[13px]">
                <Td>Non-GST</Td>
                <Td className="tabular text-right">{money(g['5'].nonGst.inter)}</Td>
                <Td className="tabular text-right">{money(g['5'].nonGst.intra)}</Td>
              </tr>
            </tbody>
          </Table>
        </div>
      </Card>
      <Card>
        <CardHeader title="6.1 · Tax payable" description="How it is paid (ITC or cash) is chosen on the portal." />
        <TaxRows rows={[['Other than reverse charge', g['6.1']]]} />
      </Card>
      <Alert>Rows are labelled by what they hold. Key them into the current GSTR-3B form on the portal.</Alert>
    </div>
  );
}
