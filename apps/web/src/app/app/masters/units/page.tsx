'use client';
import { Button, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { HsnCode, Uom } from '@/lib/types';

const GST_RATES = ['0', '0.1', '0.25', '1.5', '3', '5', '6', '7.5', '12', '18', '28', '40'];

export default function UnitsPage() {
  const ws = useWorkspace();
  const uoms = useQuery({ queryKey: ['uoms', ws.tenantId], queryFn: () => api<Uom[]>('/uoms', { scope: ws.scope }) });
  const hsn = useQuery({ queryKey: ['hsn', ws.tenantId], queryFn: () => api<HsnCode[]>('/hsn-codes', { scope: ws.scope }), enabled: ws.can('masters.hsn.read') });
  const [dialog, setDialog] = useState<'uom' | 'hsn' | null>(null);

  return (
    <>
      <PageHeader title="Units & HSN/SAC" description="Units of measure and the GST rate for each HSN (goods) or SAC (services) code, with effective dates." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        <Card>
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
              </tr>
            </thead>
            <tbody>
              {uoms.data?.map((u) => (
                <Tr key={u.id}>
                  <Td className="font-mono text-[13px] font-medium">{u.code}</Td>
                  <Td>{u.name}</Td>
                  <Td className="tabular text-right">{u.decimals}</Td>
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
              <p className="px-5 py-8 text-center text-[13px] text-muted">No codes yet. Add the HSN/SAC codes you use; check rates against the current CBIC notification.</p>
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

function UomDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ code: '', name: '', decimals: '0' });
  const m = useMutation({
    mutationFn: () => api('/uoms', { method: 'POST', body: { ...f, decimals: Number(f.decimals) }, scope: ws.scope }),
    onSuccess: () => (void qc.invalidateQueries({ queryKey: ['uoms'] }), onClose()),
  });
  const e = fieldErrors(m.error);
  return (
    <FormDialog title="Add unit" onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" error={e.code}>{(p) => <Input {...p} value={f.code} onChange={(ev) => setF({ ...f, code: ev.target.value })} className="font-mono uppercase" required />}</Field>
        <Field label="Name" error={e.name}>{(p) => <Input {...p} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} required />}</Field>
        <Field label="Decimals" error={e.decimals}>
          {(p) => (
            <Select {...p} value={f.decimals} onChange={(ev) => setF({ ...f, decimals: ev.target.value })}>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

function HsnDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ code: '', kind: 'hsn', description: '', gstRate: '18', effectiveFrom: '2017-07-01' });
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });
  const m = useMutation({
    mutationFn: () => api('/hsn-codes', { method: 'POST', body: f, scope: ws.scope }),
    onSuccess: () => (void qc.invalidateQueries({ queryKey: ['hsn'] }), onClose()),
  });
  const e = fieldErrors(m.error);
  return (
    <FormDialog title="Add HSN / SAC code" description="Confirm the rate against the current CBIC rate notification." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" error={e.code}>{(p) => <Input {...p} value={f.code} onChange={set('code')} inputMode="numeric" className="font-mono" required />}</Field>
        <Field label="Kind" error={e.kind}>
          {(p) => (
            <Select {...p} value={f.kind} onChange={set('kind')}>
              <option value="hsn">HSN (goods)</option>
              <option value="sac">SAC (services)</option>
            </Select>
          )}
        </Field>
        <Field label="GST rate %" error={e.gstRate}>
          {(p) => (
            <Select {...p} value={f.gstRate} onChange={set('gstRate')}>
              {GST_RATES.map((r) => (
                <option key={r} value={r}>{r}%</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Description" error={e.description}>{(p) => <Input {...p} value={f.description} onChange={set('description')} required />}</Field>
      <Field label="Effective from" error={e.effectiveFrom}>{(p) => <Input {...p} type="date" value={f.effectiveFrom} onChange={set('effectiveFrom')} required />}</Field>
    </FormDialog>
  );
}
