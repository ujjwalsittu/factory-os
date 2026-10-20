'use client';
import { Alert, Button, Card, CardHeader, DateInput, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { HsnDialog, UomDialog } from '@/components/master-dialogs';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { UQC_CODES } from '@/lib/gst-returns';
import type { HsnCode, Uom } from '@/lib/types';

const GST_RATES = ['0', '0.1', '0.25', '1.5', '3', '5', '6', '7.5', '12', '18', '28', '40'];

export default function UnitsPage() {
  const ws = useWorkspace();
  const uoms = useQuery({ queryKey: ['uoms', ws.tenantId], queryFn: () => api<Uom[]>('/uoms', { scope: ws.scope }) });
  const hsn = useQuery({ queryKey: ['hsn', ws.tenantId], queryFn: () => api<HsnCode[]>('/hsn-codes', { scope: ws.scope }), enabled: ws.can('masters.hsn.read') });
  const [dialog, setDialog] = useState<'uom' | 'hsn' | null>(null);
  const qc = useQueryClient();
  const uqc = useMutation({
    mutationFn: ({ id, gstUqc }: { id: string; gstUqc: string | null }) => api(`/uoms/${id}`, { method: 'PATCH', body: { gstUqc }, scope: ws.scope }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['uoms'] }),
  });

  return (
    <>
      <PageHeader title="Units & HSN/SAC" description="Units of measure and the GST rate for each HSN (goods) or SAC (services) code, with effective dates." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        <Card>
          {uqc.error && <Alert tone="danger" className="m-4">{uqc.error.message}</Alert>}
          <CardHeader
            title="Units of measure"
            actions={
              ws.can('masters.uom.create') && (
                <Button size="sm" variant="secondary" onClick={() => setDialog('uom')}>
                  <Plus className="size-3.5" /> Add
                </Button>
              )
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th className="text-right">Decimals</Th>
                <Th>GST code</Th>
              </tr>
            </thead>
            <tbody>
              {uoms.data?.map((u) => (
                <Tr key={u.id}>
                  <Td className="font-mono text-[13px] font-medium">{u.code}</Td>
                  <Td>{u.name}</Td>
                  <Td className="tabular text-right">{u.decimals}</Td>
                  <Td>
                    {ws.can('masters.uom.update') ? (
                      <Select aria-label={`GST unit code for ${u.code}`} value={u.gstUqc ?? ''} disabled={uqc.isPending} onChange={(e) => uqc.mutate({ id: u.id, gstUqc: e.target.value || null })}>
                        <option value="">Not set</option>
                        {UQC_CODES.map(([c, label]) => (
                          <option key={c} value={c}>
                            {c} · {label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="font-mono text-[13px]">{u.gstUqc ?? '—'}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
        {ws.can('masters.hsn.read') && (
          <Card>
            <CardHeader
              title="HSN / SAC codes"
              description="Rates are effective-dated so a rate change doesn't rewrite history."
              actions={
                ws.can('masters.hsn.create') && (
                  <Button size="sm" variant="secondary" onClick={() => setDialog('hsn')}>
                    <Plus className="size-3.5" /> Add
                  </Button>
                )
              }
            />
            {hsn.data?.length === 0 ? (
              <EmptyState size="compact" title="No codes yet" description="Add the HSN/SAC codes you use; check rates against the current CBIC notification." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Code</Th>
                    <Th>Description</Th>
                    <Th className="text-right">GST</Th>
                    <Th>From</Th>
                  </tr>
                </thead>
                <tbody>
                  {hsn.data?.map((h) => (
                    <Tr key={h.id}>
                      <Td className="font-mono text-[13px]">
                        {h.code} <span className="text-[11px] text-subtle uppercase">{h.kind}</span>
                      </Td>
                      <Td className="text-[13px]">{h.description}</Td>
                      <Td className="tabular text-right">{Number(h.gstRate)}%</Td>
                      <Td className="text-[13px] whitespace-nowrap">{formatDate(h.effectiveFrom)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
      </div>
      {dialog === 'uom' && <UomDialog onClose={() => setDialog(null)} />}
      {dialog === 'hsn' && <HsnDialog onClose={() => setDialog(null)} />}
    </>
  );
}

