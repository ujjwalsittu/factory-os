'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { ItemPicker } from '@/components/item-picker';
import { useWorkspace } from '@/components/workspace';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { BOM_STATUS, type BomDetail, type WorkCentre } from '@/lib/manufacturing';
import type { Item } from '@/lib/types';

type ItemRef = Pick<Item, 'id' | 'code' | 'name'> & { tracking?: string; uomCode?: string };
interface MaterialRow {
  item: ItemRef | null;
  qty: string;
  backflush: boolean;
}
interface OperationRow {
  seq: string;
  name: string;
  workCentreId: string;
  setupMinutes: string;
  runMinutesPerUnit: string;
  instructions: string;
}

const num = (v: string) => String(Number(v));

export function BomEditor({ bom }: { bom: BomDetail | null }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const editable = !bom || bom.status === 'draft';
  const [item, setItem] = useState<ItemRef | null>(bom ? { id: bom.itemId, code: bom.itemCode, name: bom.itemName } : null);
  const [revision, setRevision] = useState(bom?.revision ?? 'A');
  const [quantity, setQuantity] = useState(bom ? num(bom.quantity) : '1');
  const [remarks, setRemarks] = useState(bom?.remarks ?? '');
  const [materials, setMaterials] = useState<MaterialRow[]>(
    bom?.materials.map((m) => ({ item: { id: m.itemId, code: m.itemCode, name: m.itemName, tracking: m.tracking, uomCode: m.uom }, qty: num(m.qty), backflush: m.backflush })) ?? [{ item: null, qty: '', backflush: false }],
  );
  const [operations, setOperations] = useState<OperationRow[]>(
    bom?.operations.map((o) => ({ seq: String(o.seq), name: o.name, workCentreId: o.workCentreId, setupMinutes: num(o.setupMinutes), runMinutesPerUnit: num(o.runMinutesPerUnit), instructions: o.instructions ?? '' })) ?? [],
  );
  const [copying, setCopying] = useState(false);
  const centres = useQuery({ queryKey: ['work-centres', ws.entityId], queryFn: () => api<WorkCentre[]>('/manufacturing/work-centres', { scope: ws.scope }) });

  const body = () => ({
    itemId: item?.id,
    revision,
    quantity,
    remarks: remarks || null,
    materials: materials.filter((m) => m.item).map((m) => ({ itemId: m.item!.id, qty: m.qty, backflush: m.backflush })),
    operations: operations.map((o) => ({ seq: Number(o.seq), name: o.name, workCentreId: o.workCentreId, setupMinutes: o.setupMinutes || '0', runMinutesPerUnit: o.runMinutesPerUnit || '0', instructions: o.instructions || null })),
  });
  const done = (b: BomDetail) => {
    void qc.invalidateQueries({ queryKey: ['boms'] });
    qc.setQueryData(['bom', b.id, ws.entityId], b);
    if (!bom || bom.id !== b.id) router.push(`/app/manufacturing/boms/${b.id}`);
  };
  const save = useMutation({
    mutationFn: () => (bom ? api<BomDetail>(`/manufacturing/boms/${bom.id}`, { method: 'PUT', body: body(), scope: ws.scope }) : api<BomDetail>('/manufacturing/boms', { method: 'POST', body: body(), scope: ws.scope })),
    onSuccess: done,
  });
  const action = useMutation({
    mutationFn: (what: 'activate' | 'default' | 'obsolete') => api<BomDetail>(`/manufacturing/boms/${bom!.id}/${what}`, { method: 'POST', body: {}, scope: ws.scope }),
    onSuccess: done,
  });
  const err = save.error instanceof ApiError ? save.error : action.error instanceof ApiError ? action.error : null;
  const fe = fieldErrors(save.error);

  return (
    <>
      <PageHeader
        title={bom ? `${bom.itemCode} · revision ${bom.revision}` : 'New bill of materials'}
        description={bom ? bom.itemName : 'Materials per the quantity this BOM makes, then the operations in order.'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {bom && (
              <Badge tone={BOM_STATUS[bom.status].tone} dot>
                {BOM_STATUS[bom.status].label}
                {bom.isDefault ? ' · default' : ''}
              </Badge>
            )}
            {editable && ws.can(bom ? 'manufacturing.bom.update' : 'manufacturing.bom.create') && (
              <Button variant={bom ? 'secondary' : 'primary'} loading={save.isPending} onClick={() => save.mutate()}>
                Save draft
              </Button>
            )}
            {bom?.status === 'draft' && ws.can('manufacturing.bom.submit') && (
              <Button loading={action.isPending} onClick={() => action.mutate('activate')}>
                Activate
              </Button>
            )}
            {bom?.status === 'active' && !bom.isDefault && ws.can('manufacturing.bom.submit') && (
              <Button variant="secondary" onClick={() => action.mutate('default')}>
                Make default
              </Button>
            )}
            {bom && bom.status !== 'draft' && ws.can('manufacturing.bom.create') && (
              <Button variant="secondary" onClick={() => setCopying(true)}>
                New revision
              </Button>
            )}
            {bom?.status === 'active' && ws.can('manufacturing.bom.cancel') && (
              <Button variant="ghost" onClick={() => action.mutate('obsolete')}>
                Make obsolete
              </Button>
            )}
          </div>
        }
      />
      {err && !err.issues.length && <Alert tone="danger" className="mb-4">{err.message}</Alert>}
      {bom?.status === 'active' && <Alert className="mb-4">Active revisions are frozen. Released work orders keep their own copy, so changing this BOM never alters an order already on the floor.</Alert>}

      <Card className="mb-4 p-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Item made" error={fe.itemId} className="sm:col-span-2">
            {(f) => (editable && !bom ? <ItemPicker value={item} onChange={setItem} invalid={!!f['aria-invalid']} /> : <Input {...f} value={`${item?.code} · ${item?.name}`} disabled />)}
          </Field>
          <Field label="Revision" error={fe.revision}>
            {(f) => <Input {...f} value={revision} onChange={(e) => setRevision(e.target.value.toUpperCase())} disabled={!editable} />}
          </Field>
          <Field label="Quantity it makes" error={fe.quantity} hint="Materials below are for this quantity">
            {(f) => <Input {...f} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={!editable} />}
          </Field>
        </div>
        <Field label="Remarks" className="mt-4">
          {(f) => <Input {...f} value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!editable} placeholder="Drawing, ECN reference…" />}
        </Field>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Materials" description="Backflush deducts the material automatically when output is recorded (fasteners, consumables). Batch-tracked material is issued by heat instead." />
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th className="w-32 text-right">Qty</Th>
              <Th className="w-28">Backflush</Th>
              <Th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {materials.map((m, i) => (
              <tr key={i} className="border-t border-line">
                <Td className="min-w-64">
                  {editable ? (
                    <ItemPicker value={m.item} onChange={(it) => setMaterials(materials.map((x, j) => (j === i ? { ...x, item: it, backflush: it.tracking === 'none' ? x.backflush : false } : x)))} invalid={!!fe[`materials.${i}.itemId`]} />
                  ) : (
                    <span>
                      <span className="font-mono text-[13px]">{m.item?.code}</span> <span className="text-muted">{m.item?.name}</span>
                    </span>
                  )}
                </Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <Input aria-label={`Quantity of material ${i + 1}`} inputMode="decimal" className="text-right" value={m.qty} onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} disabled={!editable} />
                    <span className="text-[12px] text-subtle">{m.item?.uomCode}</span>
                  </div>
                </Td>
                <Td>
                  <input type="checkbox" aria-label={`Backflush material ${i + 1}`} checked={m.backflush} disabled={!editable || (m.item?.tracking ?? 'none') !== 'none'} onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, backflush: e.target.checked } : x)))} />
                </Td>
                <Td>
                  {editable && (
                    <Button size="icon" variant="ghost" aria-label="Remove material" onClick={() => setMaterials(materials.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {editable && (
          <div className="border-t border-line p-3">
            <Button size="sm" variant="ghost" onClick={() => setMaterials([...materials, { item: null, qty: '', backflush: false }])}>
              <Plus className="size-4" /> Add material
            </Button>
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <CardHeader title="Operations (routing)" description="Planned time = setup + run per unit × quantity. Job cards record the actual time." />
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th className="w-20">Seq</Th>
                <Th>Operation</Th>
                <Th>Work centre</Th>
                <Th className="w-28 text-right">Setup min</Th>
                <Th className="w-28 text-right">Run min/unit</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {operations.map((o, i) => {
                const set = (patch: Partial<OperationRow>) => setOperations(operations.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                const centre = centres.data?.find((c) => c.id === o.workCentreId);
                return (
                  <tr key={i} className="border-t border-line">
                    <Td>
                      <Input aria-label={`Sequence of operation ${i + 1}`} inputMode="numeric" value={o.seq} onChange={(e) => set({ seq: e.target.value })} disabled={!editable} />
                    </Td>
                    <Td className="min-w-48">
                      <Input aria-label={`Name of operation ${i + 1}`} value={o.name} onChange={(e) => set({ name: e.target.value })} disabled={!editable} placeholder="Mill complete" />
                    </Td>
                    <Td className="min-w-48">
                      <Select aria-label={`Work centre of operation ${i + 1}`} value={o.workCentreId} onChange={(e) => set({ workCentreId: e.target.value })} disabled={!editable}>
                        <option value="">Choose…</option>
                        {centres.data?.filter((c) => c.isActive || c.id === o.workCentreId).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} · {c.name}
                          </option>
                        ))}
                      </Select>
                      {centre && <p className="mt-1 text-[12px] text-subtle">{formatMoney(centre.hourlyRate)}/h</p>}
                    </Td>
                    <Td>
                      <Input aria-label={`Setup minutes of operation ${i + 1}`} inputMode="decimal" className="text-right" value={o.setupMinutes} onChange={(e) => set({ setupMinutes: e.target.value })} disabled={!editable} />
                    </Td>
                    <Td>
                      <Input aria-label={`Run minutes per unit of operation ${i + 1}`} inputMode="decimal" className="text-right" value={o.runMinutesPerUnit} onChange={(e) => set({ runMinutesPerUnit: e.target.value })} disabled={!editable} />
                    </Td>
                    <Td>
                      {editable && (
                        <Button size="icon" variant="ghost" aria-label="Remove operation" onClick={() => setOperations(operations.filter((_, j) => j !== i))}>
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        {editable && (
          <div className="border-t border-line p-3">
            <Button size="sm" variant="ghost" onClick={() => setOperations([...operations, { seq: String((operations.length + 1) * 10), name: '', workCentreId: '', setupMinutes: '0', runMinutesPerUnit: '0', instructions: '' }])}>
              <Plus className="size-4" /> Add operation
            </Button>
          </div>
        )}
      </Card>
      {fe && Object.keys(fe).length > 0 && (
        <Alert tone="danger">
          {Object.entries(fe).map(([k, v]) => (
            <div key={k}>{v}</div>
          ))}
        </Alert>
      )}
      {copying && bom && <CopyDialog bom={bom} onClose={() => setCopying(false)} />}
    </>
  );
}

function CopyDialog({ bom, onClose }: { bom: BomDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const qc = useQueryClient();
  const next = bom.revision.length === 1 && bom.revision >= 'A' && bom.revision < 'Z' ? String.fromCharCode(bom.revision.charCodeAt(0) + 1) : '';
  const [revision, setRevision] = useState(next);
  const m = useMutation({
    mutationFn: () => api<BomDetail>(`/manufacturing/boms/${bom.id}/copy`, { method: 'POST', body: { revision }, scope: ws.scope }),
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: ['boms'] });
      router.push(`/app/manufacturing/boms/${b.id}`);
      onClose();
    },
  });
  return (
    <FormDialog title="New revision" description={`Starts a draft copy of revision ${bom.revision}. Activate it when the engineering change is approved.`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Create draft">
      <Field label="Revision" error={fieldErrors(m.error).revision}>
        {(f) => <Input {...f} value={revision} onChange={(e) => setRevision(e.target.value.toUpperCase())} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
