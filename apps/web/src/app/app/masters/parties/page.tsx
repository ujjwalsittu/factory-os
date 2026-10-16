'use client';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Contact, Plus, Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PartyDialog } from '@/components/master-dialogs';
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
  const router = useRouter();
  const pathname = usePathname();
  // The role filter lives in the address, so the menu's Customers and Suppliers links open this page already filtered.
  const roleParam = params.get('role');
  const role = roleParam === 'customer' || roleParam === 'supplier' ? roleParam : '';
  const setRole = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set('role', value);
    else next.delete('role');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  const [editing, setEditing] = useState<Party | 'new' | null>(params.get('new') ? 'new' : null);
  const parties = useQuery({
    queryKey: ['parties', ws.tenantId, q, role],
    queryFn: () => api<Party[]>(`/parties?limit=500${q ? `&q=${encodeURIComponent(q)}` : ''}${role ? `&role=${role}` : ''}`, { scope: ws.scope }),
  });

  return (
    <>
      <PageHeader
        title={role === 'customer' ? 'Customers' : role === 'supplier' ? 'Suppliers' : 'Customers & suppliers'}
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
                      {p.isJobWorker && <Badge tone="neutral">Job worker</Badge>}
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

export default function Page() {
  return (
    <Suspense>
      <PartiesPage />
    </Suspense>
  );
}
