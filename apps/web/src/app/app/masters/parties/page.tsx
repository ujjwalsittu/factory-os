'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Contact, Plus, Search } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { Party } from '@/lib/types';

const TREATMENTS: [string, string][] = [
  ['registered', 'Registered (GSTIN)'],
  ['unregistered', 'Unregistered'],
  ['composition', 'Composition dealer'],
  ['sez', 'SEZ unit / developer'],
  ['overseas', 'Overseas (import / export)'],
  ['deemed_export', 'Deemed export'],
];
const NEEDS_GSTIN = new Set(['registered', 'composition', 'sez']);

function PartiesPage() {
  const ws = useWorkspace();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [editing, setEditing] = useState<Party | 'new' | null>(params.get('new') ? 'new' : null);
  const parties = useQuery({
    queryKey: ['parties', ws.tenantId, q, role],
    queryFn: () => api<Party[]>(`/parties?limit=500${q ? `&q=${encodeURIComponent(q)}` : ''}${role ? `&role=${role}` : ''}`, { scope: ws.scope }),
  });

  return (
    <>
      <PageHeader
        title="Customers & suppliers"
        description="One record per business, whether you buy from them, sell to them, or both."
        actions={
          ws.can('masters.party.create') && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> New party
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-subtle" />
            <Input className="pl-9" placeholder="Search name, code or GSTIN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search parties" />
          </div>
          <Select className="w-44" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role">
            <option value="">Customers & suppliers</option>
            <option value="customer">Customers</option>
            <option value="supplier">Suppliers</option>
          </Select>
        </div>
        {parties.data?.length === 0 ? (
          <EmptyState icon={<Contact className="size-5" />} title={q || role ? 'No matches' : 'No customers or suppliers yet'} description="GSTINs are validated and the state is taken from them automatically." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>GSTIN</Th>
                <Th>State</Th>
                <Th>MSME</Th>
                <Th className="text-right">Credit days</Th>
              </tr>
            </thead>
            <tbody>
              {parties.data?.map((p) => (
                <Tr key={p.id} className="cursor-pointer" onClick={() => setEditing(p)}>
                  <Td>
                    <p className={p.isActive ? 'font-medium' : 'font-medium text-subtle line-through'}>{p.name}</p>
                    <p className="font-mono text-[12px] text-subtle">{p.code}</p>
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      {p.isCustomer && <Badge tone="accent">Customer</Badge>}
                      {p.isSupplier && <Badge tone="info">Supplier</Badge>}
                    </div>
                  </Td>
                  <Td className="font-mono text-[12px]">{p.gstin ?? <span className="text-subtle">{TREATMENTS.find(([k]) => k === p.gstTreatment)?.[1]}</span>}</Td>
                  <Td className="font-mono text-[12px]">{p.stateCode ?? '—'}</Td>
                  <Td>{p.msmeCategory ? <Badge tone="warning">{p.msmeCategory}</Badge> : <span className="text-subtle">—</span>}</Td>
                  <Td className="tabular text-right">{p.creditDays ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <PartyDialog party={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PartyDialog({ party, onClose }: { party: Party | null; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: party?.code ?? '',
    name: party?.name ?? '',
    isCustomer: party?.isCustomer ?? false,
    isSupplier: party?.isSupplier ?? true,
    gstTreatment: party?.gstTreatment ?? 'registered',
    gstin: party?.gstin ?? '',
    pan: party?.pan ?? '',
    stateCode: party?.stateCode ?? '',
    msmeUdyam: party?.msmeUdyam ?? '',
    msmeCategory: party?.msmeCategory ?? '',
    creditDays: party?.creditDays?.toString() ?? '',
    creditLimit: party?.creditLimit ?? '',
    email: party?.email ?? '',
    phone: party?.phone ?? '',
    isActive: party?.isActive ?? true,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const canEdit = party ? ws.can('masters.party.update') : ws.can('masters.party.create');
  const needsGstin = NEEDS_GSTIN.has(f.gstTreatment);
  const m = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        isCustomer: f.isCustomer,
        isSupplier: f.isSupplier,
        gstTreatment: f.gstTreatment,
        gstin: f.gstin || null,
        pan: needsGstin ? null : f.pan || null,
        stateCode: needsGstin ? null : f.stateCode || null,
        msmeUdyam: f.msmeUdyam || null,
        msmeCategory: f.msmeCategory || null,
        creditDays: f.creditDays ? Number(f.creditDays) : null,
        creditLimit: f.creditLimit || null,
        email: f.email || null,
        phone: f.phone || null,
        isActive: f.isActive,
      };
      return party ? api(`/parties/${party.id}`, { method: 'PATCH', body, scope: ws.scope }) : api('/parties', { method: 'POST', body: { ...body, code: f.code }, scope: ws.scope });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['parties'] });
      onClose();
    },
  });
  const e = fieldErrors(m.error);
  const msmeLate = f.isSupplier && f.msmeCategory && Number(f.creditDays) > 45;

  return (
    <FormDialog title={party ? party.name : 'New customer or supplier'} onClose={onClose} onSubmit={() => (canEdit ? m.mutate() : onClose())} pending={m.isPending} error={m.error} submitLabel={canEdit ? 'Save' : 'Close'} wide>
      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code" error={e.code}>{(p) => <Input {...p} value={f.code} onChange={set('code')} className="font-mono uppercase" disabled={!!party} required placeholder="TIMET" />}</Field>
          <Field label="Legal name" error={e.name} className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={set('name')} required />}</Field>
        </div>
        <div className="flex gap-6 text-[13px]">
          {(
            [
              ['isSupplier', 'Supplier'],
              ['isCustomer', 'Customer'],
              ['isActive', 'Active'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.checked })} />
              {label}
            </label>
          ))}
          {e.isCustomer && <span className="text-danger">{e.isCustomer}</span>}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="GST treatment" error={e.gstTreatment}>
            {(p) => (
              <Select {...p} value={f.gstTreatment} onChange={set('gstTreatment')}>
                {TREATMENTS.map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            )}
          </Field>
          {needsGstin ? (
            <Field label="GSTIN" hint="State and PAN are taken from it" error={e.gstin} className="sm:col-span-2">
              {(p) => <Input {...p} value={f.gstin} onChange={set('gstin')} maxLength={15} className="font-mono uppercase" required />}
            </Field>
          ) : (
            <>
              <Field label="PAN" error={e.pan}>{(p) => <Input {...p} value={f.pan} onChange={set('pan')} className="font-mono uppercase" />}</Field>
              <Field label="State code" hint="Place of supply, e.g. 27" error={e.stateCode}>{(p) => <Input {...p} value={f.stateCode} onChange={set('stateCode')} maxLength={2} className="font-mono" />}</Field>
            </>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Credit days" error={e.creditDays}>{(p) => <Input {...p} value={f.creditDays} onChange={set('creditDays')} inputMode="numeric" />}</Field>
          {f.isCustomer && <Field label="Credit limit (₹)" hint="Leave blank for no limit. Submitting above the limit requires an approver." error={e.creditLimit}>{(p) => <Input {...p} value={f.creditLimit} onChange={set('creditLimit')} inputMode="decimal" />}</Field>}
          <Field label="Email" error={e.email}>{(p) => <Input {...p} type="email" value={f.email} onChange={set('email')} />}</Field>
          <Field label="Phone" error={e.phone}>{(p) => <Input {...p} value={f.phone} onChange={set('phone')} />}</Field>
        </div>
        {f.isSupplier && (
          <div className="rounded-lg border border-line p-4">
            <p className="text-[13px] font-medium">MSME (Udyam)</p>
            <p className="mb-3 text-[12px] text-muted">Payments to micro and small enterprises are due within 45 days (Sec 43B(h)).</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Udyam number" error={e.msmeUdyam} className="sm:col-span-2">{(p) => <Input {...p} value={f.msmeUdyam} onChange={set('msmeUdyam')} className="font-mono uppercase" placeholder="UDYAM-MH-12-0001234" />}</Field>
              <Field label="Category" error={e.msmeCategory}>
                {(p) => (
                  <Select {...p} value={f.msmeCategory} onChange={set('msmeCategory')}>
                    <option value="">Not MSME</option>
                    <option value="micro">Micro</option>
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                  </Select>
                )}
              </Field>
            </div>
            {msmeLate && <p className="mt-2 text-[12px] text-warning">Credit days above 45 aren't allowed for micro and small suppliers: late payments are disallowed as expense.</p>}
          </div>
        )}
      </fieldset>
    </FormDialog>
  );
}

export default function Page() {
  return (
    <Suspense>
      <PartiesPage />
    </Suspense>
  );
}
