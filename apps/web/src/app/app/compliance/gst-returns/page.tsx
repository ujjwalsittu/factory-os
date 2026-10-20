'use client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { AmendmentsCard, AttentionCard, ChecksCard, Gstr1View, Gstr3bView } from '@/components/gst-return-view';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney, today } from '@/lib/format';
import { KIND_LABEL, monthLabel, type Preview, recentMonths, type ReturnRow, STATUS } from '@/lib/gst-returns';

export default function GstReturnsPage() {
  return (
    <>
      <PageHeader title="GST returns" description="GSTR-1 and GSTR-3B for each GSTIN and month, prepared from submitted documents, checked against the ledger, reviewed and approved by different people." />
      <EntityGate what="GST returns">
        <Returns />
      </EntityGate>
    </>
  );
}

function Returns() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const months = recentMonths(today());
  const regs = useQuery({ queryKey: ['gst-return-registrations', ws.entityId], queryFn: () => api<{ id: string; gstin: string }[]>('/gst-returns/registrations', { scope: ws.scope }) });
  const [regPick, setReg] = useState('');
  const regId = regPick || regs.data?.[0]?.id || '';
  const [period, setPeriod] = useState(months[1]!);
  const [view, setView] = useState<'gstr1' | 'gstr3b'>('gstr1');
  const list = useQuery({ queryKey: ['gst-returns', ws.entityId], queryFn: () => api<ReturnRow[]>('/gst-returns', { scope: ws.scope }) });
  const preview = useQuery({
    queryKey: ['gst-return-preview', ws.entityId, regId, period],
    queryFn: () => api<Preview>(`/gst-returns/preview?gstRegistrationId=${regId}&period=${period}`, { scope: ws.scope }),
    enabled: !!regId,
  });
  const prepare = useMutation({
    mutationFn: () => api<ReturnRow[]>('/gst-returns/prepare', { method: 'POST', scope: ws.scope, body: { gstRegistrationId: regId, period } }),
    onSuccess: (rows) => {
      void qc.invalidateQueries({ queryKey: ['gst-returns'] });
      const first = rows.find((r) => r.kind === view) ?? rows[0];
      if (first) router.push(`/app/compliance/gst-returns/${first.id}`);
    },
  });
  const existing = list.data?.filter((r) => r.gstRegistrationId === regId && r.period === period) ?? [];
  const locked = existing.some((r) => r.status === 'approved' || r.status === 'filed');
  const p = preview.data;
  const output = p ? ['igst', 'cgst', 'sgst', 'cess'].reduce((s, h) => s + Number(p.gstr3b['6.1'][h as 'igst']), 0) : 0;
  const itc = p ? ['igst', 'cgst', 'sgst', 'cess'].reduce((s, h) => s + Number(p.gstr3b['4'].c[h as 'igst']), 0) : 0;

  if (regs.data && regs.data.length === 0)
    return (
      <Card>
        <EmptyState icon={<FileSpreadsheet className="size-5" />} title="No GSTIN on this entity" description="Add the entity's GST registration under Settings → Entities & GST, then prepare its returns here." />
      </Card>
    );

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <Field label="GSTIN">
          {(f) => (
            <Select {...f} value={regId} onChange={(e) => setReg(e.target.value)}>
              {regs.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.gstin}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Month">
          {(f) => (
            <Select {...f} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {existing.map((r) => (
            <Link key={r.id} href={`/app/compliance/gst-returns/${r.id}`} className="inline-flex items-center gap-2 text-[13px] hover:text-accent">
              {KIND_LABEL[r.kind]} <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
            </Link>
          ))}
          {ws.can('compliance.gst_return.create') && (
            <Button onClick={() => prepare.mutate()} loading={prepare.isPending} disabled={!regId || locked} title={locked ? 'An approved or filed return is not prepared again' : undefined}>
              {existing.length ? 'Prepare again' : 'Prepare returns'}
            </Button>
          )}
        </div>
      </Card>
      {prepare.error && <Alert tone="danger">{prepare.error.message}</Alert>}
      {preview.error && <Alert tone="danger">{preview.error.message}</Alert>}
      {p && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-[12px] text-muted">Outward taxable value (3.1a)</p>
              <p className="tabular text-[20px] font-semibold">{formatMoney(p.gstr3b['3.1'].a.taxable)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[12px] text-muted">Tax on outward supplies (6.1)</p>
              <p className="tabular text-[20px] font-semibold">{formatMoney(output.toFixed(2))}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[12px] text-muted">Net input tax credit (4C)</p>
              <p className="tabular text-[20px] font-semibold">{formatMoney(itc.toFixed(2))}</p>
            </Card>
          </div>
          <Alert>
            This is what the books give for {monthLabel(period)} right now. Preparing saves it as a draft to review; documents changed afterwards need the return prepared again.
          </Alert>
          <AttentionCard items={p.attention} />
          {p.gstr1.amendments && <AmendmentsCard amendments={p.gstr1.amendments} />}
          <ChecksCard checks={p.checks} />
          <div className="flex gap-1" role="tablist" aria-label="Return">
            {(['gstr1', 'gstr3b'] as const).map((k) => (
              <Button key={k} role="tab" aria-selected={view === k} size="sm" variant={view === k ? 'secondary' : 'ghost'} onClick={() => setView(k)}>
                {KIND_LABEL[k]}
              </Button>
            ))}
          </div>
          {view === 'gstr1' ? <Gstr1View g={p.gstr1} /> : <Gstr3bView g={p.gstr3b} />}
        </>
      )}
      <Card>
        <CardHeader title="Prepared returns" />
        {list.data?.length === 0 ? (
          <EmptyState icon={<FileSpreadsheet className="size-5" />} title="No returns prepared yet" description="Choose a GSTIN and month above, check the figures, then prepare." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Month</Th>
                  <Th>Return</Th>
                  <Th>GSTIN</Th>
                  <Th>Status</Th>
                  <Th>ARN</Th>
                </tr>
              </thead>
              <tbody>
                {list.data?.map((r) => (
                  <tr key={r.id} className="border-t border-line text-[13px]">
                    <Td className="whitespace-nowrap">
                      <Link className="hover:text-accent" href={`/app/compliance/gst-returns/${r.id}`}>
                        {monthLabel(r.period)}
                      </Link>
                    </Td>
                    <Td>{KIND_LABEL[r.kind]}</Td>
                    <Td className="font-mono">{r.gstin}</Td>
                    <Td>
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{r.arn ? `${r.arn} · ${formatDate(r.filedOn!)}` : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
