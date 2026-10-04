'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Factory, Plus, Receipt } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { LegalEntity } from '@/lib/types';

const PROVIDERS: [string, string][] = [
  ['mock', 'Mock (testing)'],
  ['nic_direct', 'NIC direct (government portal)'],
  ['masters_india', 'Masters India'],
  ['cleartax', 'ClearTax'],
  ['iris', 'IRIS'],
  ['adaequare', 'Adaequare'],
  ['cygnet', 'Cygnet'],
  ['tera', 'Tera'],
];
const GST_TYPES: [string, string][] = [
  ['regular', 'Regular'],
  ['sez_unit', 'SEZ unit'],
  ['sez_developer', 'SEZ developer'],
  ['composition', 'Composition'],
  ['isd', 'Input service distributor'],
];

type DialogState = { kind: 'entity' } | { kind: 'gst'; entity: LegalEntity } | { kind: 'plant'; entity: LegalEntity } | null;

export default function EntitiesPage() {
  const ws = useWorkspace();
  const params = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>(params.get('new') ? { kind: 'entity' } : null);
  const q = useQuery({ queryKey: ['entities', ws.tenantId], queryFn: () => api<LegalEntity[]>('/entities', { scope: ws.tenantScope }) });
  const canCreate = ws.canTenant('settings.entity.create');
  const canUpdate = ws.canTenant('settings.entity.update');
  const entities = q.data ?? [];
  const nameOf = (id: string | null) => entities.find((e) => e.id === id)?.shortName;

  return (
    <>
      <PageHeader
        title="Legal entities & GST"
        description="Each legal entity has its own PAN, books and number series. GST registrations and plants belong to an entity."
        actions={
          canCreate && (
            <Button onClick={() => setDialog({ kind: 'entity' })}>
              <Plus className="size-4" /> Add entity
            </Button>
          )
        }
      />
      {q.isLoading && <p className="text-muted">Loading…</p>}
      {q.data && entities.length === 0 && (
        <Card>
          <EmptyState
            icon={<Building2 className="size-5" />}
            title="No legal entities yet"
            description="Add your company first. Subsidiaries such as an acquired company are added with a parent."
            action={canCreate && <Button onClick={() => setDialog({ kind: 'entity' })}>Add entity</Button>}
          />
        </Card>
      )}
      <div className="space-y-4">
        {entities.map((e) => (
          <Card key={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold">{e.legalName}</h2>
                  <Badge tone={e.parentEntityId ? 'info' : 'accent'}>{e.parentEntityId ? `Subsidiary of ${nameOf(e.parentEntityId)}` : 'Parent'}</Badge>
                  {!e.isActive && <Badge tone="danger">Inactive</Badge>}
                </div>
                <p className="mt-1 font-mono text-[12px] text-muted">
                  {e.code} · PAN {e.pan ?? '—'} {e.cin ? `· CIN ${e.cin}` : ''} · FY starts {e.fyStartMonth === 4 ? 'April' : `month ${e.fyStartMonth}`}
                </p>
              </div>
              {canUpdate && (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'gst', entity: e })}>
                    <Receipt className="size-3.5" /> Add GSTIN
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'plant', entity: e })}>
                    <Factory className="size-3.5" /> Add plant
                  </Button>
                </div>
              )}
            </div>
            <div className="grid gap-6 px-5 py-4 md:grid-cols-[2fr_1fr]">
              <section>
                <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-subtle uppercase">GST registrations</h3>
                {e.gstRegistrations.length === 0 ? (
                  <p className="text-[13px] text-muted">None yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {e.gstRegistrations.map((r) => (
                      <li key={r.id} className="rounded-lg border border-line px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] font-medium">{r.gstin}</span>
                          <Badge>{GST_TYPES.find(([k]) => k === r.type)?.[1] ?? r.type}</Badge>
                          {r.einvoiceApplicableFrom ? (
                            <Badge tone={new Date(r.einvoiceApplicableFrom) > new Date() ? 'warning' : 'success'} dot>
                              E-invoice from {formatDate(r.einvoiceApplicableFrom)}
                            </Badge>
                          ) : (
                            <Badge>E-invoice not applicable</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-[12px] text-muted">
                          IRP: {label(r.irpProvider)} · E-way bill: {label(r.ewbProvider)} · Returns: {label(r.returnsProvider)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-subtle uppercase">Plants</h3>
                {e.plants.length === 0 ? (
                  <p className="text-[13px] text-muted">None yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {e.plants.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 text-[13px]">
                        <Factory className="size-3.5 text-subtle" /> {p.name} <span className="font-mono text-[11px] text-subtle">{p.code}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </Card>
        ))}
      </div>

      {dialog?.kind === 'entity' && <EntityDialog entities={entities} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'gst' && <GstDialog entity={dialog.entity} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'plant' && <PlantDialog entity={dialog.entity} onClose={() => setDialog(null)} />}
    </>
  );
}

const label = (p: string) => PROVIDERS.find(([k]) => k === p)?.[1] ?? p;

function useSave<T>(path: string) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => api(path, { method: 'POST', body, scope: ws.tenantScope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['entities'] });
      void qc.invalidateQueries({ queryKey: ['ctx'] });
    },
  });
}



function EntityDialog({ entities, onClose }: { entities: LegalEntity[]; onClose: () => void }) {
  const [f, setF] = useState({ legalName: '', shortName: '', code: '', pan: '', cin: '', parentEntityId: '' });
  const m = useSave('/entities');
  const e = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });
  return (
    <FormDialog
      title="Add legal entity"
      description="A company, LLP or other legal person with its own PAN and books."
      onClose={onClose}
      pending={m.isPending}
      error={m.error}
      onSubmit={() =>
        m.mutate(
          { legalName: f.legalName, shortName: f.shortName, code: f.code, pan: f.pan || undefined, cin: f.cin || undefined, parentEntityId: f.parentEntityId || null },
          { onSuccess: onClose },
        )
      }
    >
      <Field label="Legal name" error={e.legalName}>{(p) => <Input {...p} value={f.legalName} onChange={set('legalName')} placeholder="EarthNow Private Limited" required />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Short name" error={e.shortName}>{(p) => <Input {...p} value={f.shortName} onChange={set('shortName')} placeholder="EarthNow" required />}</Field>
        <Field label="Code" hint="2–6 characters, used in document numbers" error={e.code}>{(p) => <Input {...p} value={f.code} onChange={set('code')} placeholder="EN" className="font-mono uppercase" required />}</Field>
        <Field label="PAN" error={e.pan}>{(p) => <Input {...p} value={f.pan} onChange={set('pan')} placeholder="AAACE1234F" className="font-mono uppercase" />}</Field>
        <Field label="CIN" error={e.cin}>{(p) => <Input {...p} value={f.cin} onChange={set('cin')} className="font-mono uppercase" />}</Field>
      </div>
      <Field label="Parent entity" hint="Set this for subsidiaries, e.g. an acquired company" error={e.parentEntityId}>
        {(p) => (
          <Select {...p} value={f.parentEntityId} onChange={set('parentEntityId')}>
            <option value="">None (top-level entity)</option>
            {entities.map((x) => (
              <option key={x.id} value={x.id}>
                {x.shortName}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </FormDialog>
  );
}

function GstDialog({ entity, onClose }: { entity: LegalEntity; onClose: () => void }) {
  const [f, setF] = useState({ gstin: '', type: 'regular', tradeName: '', einvoiceApplicableFrom: '', irpProvider: 'nic_direct', ewbProvider: 'nic_direct', returnsProvider: 'mock' });
  const m = useSave(`/entities/${entity.id}/gst-registrations`);
  const e = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });
  return (
    <FormDialog
      title={`Add GST registration · ${entity.shortName}`}
      description="The GSTIN is validated (format, state code and check digit) and must match the entity's PAN."
      onClose={onClose}
      pending={m.isPending}
      error={m.error}
      onSubmit={() =>
        m.mutate(
          { ...f, gstin: f.gstin.trim().toUpperCase(), tradeName: f.tradeName || undefined, einvoiceApplicableFrom: f.einvoiceApplicableFrom || null },
          { onSuccess: onClose },
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="GSTIN" error={e.gstin}>{(p) => <Input {...p} value={f.gstin} onChange={set('gstin')} placeholder="27AAACA1234B1Z5" maxLength={15} className="font-mono uppercase" required />}</Field>
        <Field label="Registration type" error={e.type}>
          {(p) => (
            <Select {...p} value={f.type} onChange={set('type')}>
              {GST_TYPES.map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Trade name" error={e.tradeName}>{(p) => <Input {...p} value={f.tradeName} onChange={set('tradeName')} />}</Field>
      <Field label="E-invoicing applies from" hint="Leave empty if not applicable yet. Invoices before this date are issued without IRN." error={e.einvoiceApplicableFrom}>
        {(p) => <Input {...p} type="date" value={f.einvoiceApplicableFrom} onChange={set('einvoiceApplicableFrom')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        {(['irpProvider', 'ewbProvider', 'returnsProvider'] as const).map((k) => (
          <Field key={k} label={k === 'irpProvider' ? 'E-invoice (IRP)' : k === 'ewbProvider' ? 'E-way bill' : 'GST returns'}>
            {(p) => (
              <Select {...p} value={f[k]} onChange={set(k)}>
                {PROVIDERS.filter(([v]) => k !== 'returnsProvider' || v !== 'nic_direct').map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            )}
          </Field>
        ))}
      </div>
      <p className="text-[12px] text-muted">Provider credentials are entered separately under Integrations (Phase 1) and stored encrypted.</p>
    </FormDialog>
  );
}

function PlantDialog({ entity, onClose }: { entity: LegalEntity; onClose: () => void }) {
  const [f, setF] = useState({ name: '', code: '', gstRegistrationId: '' });
  const m = useSave(`/entities/${entity.id}/plants`);
  const e = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });
  return (
    <FormDialog title={`Add plant · ${entity.shortName}`} onClose={onClose} pending={m.isPending} error={m.error} onSubmit={() => m.mutate({ ...f, gstRegistrationId: f.gstRegistrationId || null }, { onSuccess: onClose })}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={e.name}>{(p) => <Input {...p} value={f.name} onChange={set('name')} placeholder="Navi Mumbai" required />}</Field>
        <Field label="Code" error={e.code}>{(p) => <Input {...p} value={f.code} onChange={set('code')} placeholder="NM1" className="font-mono uppercase" required />}</Field>
      </div>
      <Field label="GST registration" hint="Which GSTIN this plant supplies from">
        {(p) => (
          <Select {...p} value={f.gstRegistrationId} onChange={set('gstRegistrationId')}>
            <option value="">—</option>
            {entity.gstRegistrations.map((r) => (
              <option key={r.id} value={r.id}>{r.gstin}</option>
            ))}
          </Select>
        )}
      </Field>
    </FormDialog>
  );
}
