'use client';
import { Alert, Badge, Button, Card, EmptyState, Field, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { ItemPicker } from '@/components/item-picker';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { FAI_REASON, FAI_STATUS, type FaiDetail, type FaiRow, type InspectionRow } from '@/lib/quality';
import type { Batch, Item } from '@/lib/types';

export default function FaiPage() {
  const ws = useWorkspace();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="First article inspection"
        description="AS9102 Forms 1–3 for the first article of a new part, revision or process. Items flagged for FAI can't be invoiced until one is approved."
        actions={ws.entityId && ws.can('quality.fai.create') && <Button onClick={() => setCreating(true)}>New FAI</Button>}
      />
      <EntityGate what="quality">
        <List />
      </EntityGate>
      {creating && <NewFai onClose={() => setCreating(false)} />}
    </>
  );
}

function List() {
  const ws = useWorkspace();
  const router = useRouter();
  const q = useQuery({ queryKey: ['fais', ws.entityId], queryFn: () => api<FaiRow[]>('/quality/fais', { scope: ws.scope }) });
  return (
    <Card>
      {q.data?.length === 0 ? (
        <EmptyState icon={<FileCheck2 className="size-5" />} title="No FAIs yet" description="Flag items that need a first article inspection in Masters → Items; invoicing them will ask for one." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>FAI</Th>
                <Th>Part</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((f) => (
                <Tr key={f.id} className="cursor-pointer" onClick={() => router.push(`/app/quality/fai/${f.id}`)}>
                  <Td className="text-[13px] whitespace-nowrap">
                    <Link className="font-mono font-medium hover:text-accent" href={`/app/quality/fai/${f.id}`} onClick={(e) => e.stopPropagation()}>
                      {f.number}
                    </Link>
                    <span className="block text-subtle">{formatDate(f.createdAt)}</span>
                  </Td>
                  <Td className="text-[13px]">
                    <span className="font-mono">{f.itemCode}</span> {f.itemName} {f.itemRevision && <span className="text-subtle">rev {f.itemRevision}</span>}
                    {f.batchNo && <span className="block font-mono text-subtle">{f.batchNo}</span>}
                  </Td>
                  <Td className="text-[13px]">{FAI_REASON[f.reason]}</Td>
                  <Td>
                    <Badge tone={FAI_STATUS[f.status].tone}>{FAI_STATUS[f.status].label}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function NewFai({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [f, setF] = useState({ batchId: '', inspectionRecordId: '' });
  const req = useQuery({ queryKey: ['fai-req', ws.entityId, item?.id], queryFn: () => api<{ reason: keyof typeof FAI_REASON | null; revision: string | null }>(`/quality/fai-requirement?itemId=${item!.id}`, { scope: ws.scope }), enabled: !!item });
  const lots = useQuery({ queryKey: ['batches', ws.entityId, item?.id, 'all'], queryFn: () => api<Batch[]>(`/batches?itemId=${item!.id}`, { scope: ws.scope }), enabled: !!item && item.tracking !== 'none' });
  const records = useQuery({ queryKey: ['inspections', ws.entityId, 'final', item?.id], queryFn: () => api<InspectionRow[]>(`/quality/inspections?status=submitted&stage=final&itemId=${item!.id}`, { scope: ws.scope }), enabled: !!item });
  const m = useMutation({
    mutationFn: () => api<FaiDetail>('/quality/fais', { method: 'POST', scope: ws.scope, body: { itemId: item?.id, batchId: f.batchId || null, inspectionRecordId: f.inspectionRecordId || null } }),
    onSuccess: (x) => {
      void qc.invalidateQueries({ queryKey: ['fais'] });
      router.push(`/app/quality/fai/${x.id}`);
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="New FAI" description="Pick the part, its first-article lot or serial, and the final inspection that measured it." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Create">
      <Field label="Part" error={err.itemId}>
        {(p) => <ItemPicker value={item} onChange={(it) => (setItem(it), setF({ batchId: '', inspectionRecordId: '' }))} invalid={!!p['aria-invalid']} autoFocus />}
      </Field>
      {req.data && <Alert>{req.data.reason ? `Required now: ${FAI_REASON[req.data.reason].toLowerCase()} (rev ${req.data.revision ?? '—'}).` : 'Not required right now; you can still record one.'}</Alert>}
      {item && item.tracking !== 'none' && (
        <Field label="First-article lot / serial" error={err.batchId}>
          {(p) => (
            <Select {...p} value={f.batchId} onChange={(e) => setF({ ...f, batchId: e.target.value })}>
              <option value="">Choose…</option>
              {lots.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNo}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {item && (
        <Field label="Final inspection (Form 3)" error={err.inspectionRecordId}>
          {(p) => (
            <Select {...p} value={f.inspectionRecordId} onChange={(e) => setF({ ...f, inspectionRecordId: e.target.value })}>
              <option value="">Choose…</option>
              {records.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number} {r.batchNo ? `· ${r.batchNo}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </FormDialog>
  );
}
