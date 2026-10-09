'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fieldErrors } from '@/components/form-dialog';
import { ItemPicker } from '@/components/item-picker';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { type PlanDetail, STAGE, type Stage } from '@/lib/quality';

type Row = { balloon: string; description: string; kind: 'dimension' | 'visual' | 'functional' | 'document'; nominal: string; lowerLimit: string; upperLimit: string; unit: string; method: string; isKey: boolean; sampleSize: string };
const blank = (): Row => ({ balloon: '', description: '', kind: 'dimension', nominal: '', lowerLimit: '', upperLimit: '', unit: 'mm', method: '', isKey: false, sampleSize: '' });
const num = (v: string | null) => (v === null ? '' : String(Number(v)));

/** Inspection plan editor (decision 048): characteristics with limits and sample sizes; activate replaces the previous revision. */
export function PlanEditor({ plan }: { plan: PlanDetail | null }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const editable = !plan || plan.status === 'draft';
  const [item, setItem] = useState<{ id: string; code: string; name: string } | null>(plan ? { id: plan.itemId, code: plan.itemCode, name: plan.itemName } : null);
  const [stage, setStage] = useState<Stage>(plan?.stage ?? 'final');
  const [seq, setSeq] = useState(plan?.operationSeq ? String(plan.operationSeq) : '');
  const [revision, setRevision] = useState(plan?.revision ?? 'A');
  const [rows, setRows] = useState<Row[]>(
    plan?.characteristics.map((c) => ({ balloon: c.balloon ?? '', description: c.description, kind: c.kind, nominal: num(c.nominal), lowerLimit: num(c.lowerLimit), upperLimit: num(c.upperLimit), unit: c.unit ?? '', method: c.method ?? '', isKey: c.isKey, sampleSize: c.sampleSize ? String(c.sampleSize) : '' })) ?? [blank()],
  );
  const body = () => ({
    itemId: item?.id,
    stage,
    operationSeq: stage === 'in_process' ? Number(seq) || null : null,
    revision,
    characteristics: rows.map((r) => ({
      balloon: r.balloon || null,
      description: r.description,
      kind: r.kind,
      nominal: r.nominal || null,
      lowerLimit: r.lowerLimit || null,
      upperLimit: r.upperLimit || null,
      unit: r.unit || null,
      method: r.method || null,
      isKey: r.isKey,
      sampleSize: r.sampleSize ? Number(r.sampleSize) : null,
    })),
  });
  const done = (p: PlanDetail) => {
    void qc.invalidateQueries({ queryKey: ['plans'] });
    qc.setQueryData(['plan', p.id, ws.entityId], p);
    if (!plan) router.push(`/app/quality/plans/${p.id}`);
  };
  const save = useMutation({ mutationFn: () => api<PlanDetail>(plan ? `/quality/plans/${plan.id}` : '/quality/plans', { method: plan ? 'PUT' : 'POST', scope: ws.scope, body: body() }), onSuccess: done });
  const activate = useMutation({ mutationFn: () => api<PlanDetail>(`/quality/plans/${plan!.id}/activate`, { method: 'POST', scope: ws.scope, body: {} }), onSuccess: (p) => (done(p), router.refresh()) });
  const err = fieldErrors(save.error);
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <>
      <PageHeader
        title={plan ? `${plan.itemCode} · ${STAGE[plan.stage]} plan rev ${plan.revision}` : 'New inspection plan'}
        description={plan ? plan.itemName : 'Characteristics in balloon order, with limits and how many pieces to measure.'}
        actions={
          <div className="flex gap-2">
            {plan && <Badge tone={plan.status === 'active' ? 'success' : plan.status === 'obsolete' ? 'warning' : 'neutral'}>{plan.status}</Badge>}
            {editable && ws.can(plan ? 'quality.plan.update' : 'quality.plan.create') && (
              <Button variant={plan ? 'secondary' : 'primary'} loading={save.isPending} onClick={() => save.mutate()}>
                {plan ? 'Save' : 'Create draft'}
              </Button>
            )}
            {plan?.status === 'draft' && ws.can('quality.plan.submit') && (
              <Button loading={activate.isPending} onClick={() => activate.mutate()}>
                Activate
              </Button>
            )}
          </div>
        }
      />
      {(save.error || activate.error) && <Alert tone="danger" className="mb-4">{(save.error ?? activate.error)!.message}</Alert>}
      <Card className="mb-4 grid gap-4 p-4 sm:grid-cols-4">
        <Field label="Item" error={err.itemId} className="sm:col-span-2">
          {(f) => <ItemPicker value={item} onChange={setItem} invalid={!!f['aria-invalid']} />}
        </Field>
        <Field label="Stage">
          {(f) => (
            <Select {...f} value={stage} onChange={(e) => setStage(e.target.value as Stage)} disabled={!editable}>
              {Object.entries(STAGE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Revision" error={err.revision}>
            {(f) => <Input {...f} value={revision} onChange={(e) => setRevision(e.target.value.toUpperCase())} disabled={!editable} />}
          </Field>
          {stage === 'in_process' && (
            <Field label="Operation" error={err.operationSeq}>
              {(f) => <Input {...f} inputMode="numeric" value={seq} onChange={(e) => setSeq(e.target.value)} disabled={!editable} placeholder="20" />}
            </Field>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Characteristics" description="Leave samples empty to measure every piece. Measured values outside the limits fail automatically." />
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th className="w-16">Balloon</Th>
                <Th className="min-w-48">Description</Th>
                <Th className="w-32">Kind</Th>
                <Th className="w-24">Nominal</Th>
                <Th className="w-24">Min</Th>
                <Th className="w-24">Max</Th>
                <Th className="w-20">Unit</Th>
                <Th className="w-20">Samples</Th>
                <Th className="w-14">Key</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <Td>
                    <Input aria-label={`Balloon ${i + 1}`} value={r.balloon} onChange={(e) => set(i, { balloon: e.target.value })} disabled={!editable} />
                  </Td>
                  <Td>
                    <Input aria-label={`Description ${i + 1}`} value={r.description} onChange={(e) => set(i, { description: e.target.value })} disabled={!editable} aria-invalid={err[`characteristics.${i}.description`] ? true : undefined} />
                  </Td>
                  <Td>
                    <Select aria-label={`Kind ${i + 1}`} value={r.kind} onChange={(e) => set(i, { kind: e.target.value as Row['kind'] })} disabled={!editable}>
                      <option value="dimension">Dimension</option>
                      <option value="visual">Visual</option>
                      <option value="functional">Functional test</option>
                      <option value="document">Document</option>
                    </Select>
                  </Td>
                  {(['nominal', 'lowerLimit', 'upperLimit'] as const).map((k) => (
                    <Td key={k}>
                      <Input aria-label={`${k === 'lowerLimit' ? 'Min' : k === 'upperLimit' ? 'Max' : 'Nominal'} ${i + 1}`} inputMode="decimal" value={r[k]} onChange={(e) => set(i, { [k]: e.target.value })} disabled={!editable || r.kind !== 'dimension'} />
                    </Td>
                  ))}
                  <Td>
                    <Input aria-label={`Unit ${i + 1}`} value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} disabled={!editable || r.kind !== 'dimension'} />
                  </Td>
                  <Td>
                    <Input aria-label={`Samples ${i + 1}`} inputMode="numeric" value={r.sampleSize} onChange={(e) => set(i, { sampleSize: e.target.value })} disabled={!editable} placeholder="All" />
                  </Td>
                  <Td className="text-center">
                    <input type="checkbox" aria-label={`Key characteristic ${i + 1}`} className="size-4 accent-[var(--accent)]" checked={r.isKey} onChange={(e) => set(i, { isKey: e.target.checked })} disabled={!editable} />
                  </Td>
                  <Td>
                    {editable && rows.length > 1 && (
                      <Button size="icon" variant="ghost" aria-label={`Remove characteristic ${i + 1}`} onClick={() => setRows(rows.filter((_, k) => k !== i))}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        {editable && (
          <div className="border-t border-line p-3">
            <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { ...blank(), balloon: String(rows.length + 1) }])}>
              <Plus className="size-4" /> Add characteristic
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
