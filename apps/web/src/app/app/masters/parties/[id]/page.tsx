'use client';
import { Badge, Button, Card, CardHeader, PageHeader } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { PartyDialog } from '@/components/master-dialogs';
import { type Overview, RecordSections } from '@/components/record-sections';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { Party } from '@/lib/types';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] break-words">{children || '—'}</dd>
    </div>
  );
}

/** A customer or supplier and every document with them (decision 070). */
export default function PartyPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const party = useQuery({ queryKey: ['party', ws.tenantId, ws.entityId, id], queryFn: () => api<Party>(`/parties/${id}`, { scope: ws.scope }) });
  const overview = useQuery({ queryKey: ['party-overview', ws.tenantId, ws.entityId, id], queryFn: () => api<Overview>(`/parties/${id}/overview`, { scope: ws.scope }) });
  const p = party.data;
  const roles = p && [p.isCustomer && 'Customer', p.isSupplier && 'Supplier', p.isJobWorker && 'Job worker'].filter(Boolean).join(' · ');

  if (party.isError) {
    return (
      <>
        <PageHeader title="Party not found" description="It may have been removed, or you may not have access to it." />
        <Link href="/app/masters/parties" className="text-[13px] text-accent hover:underline">
          Back to customers and suppliers
        </Link>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={p?.name ?? 'Party'}
        description={p && `${p.code}${roles ? ` · ${roles}` : ''}`}
        actions={
          <>
            <Link href="/app/masters/parties" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
              <ArrowLeft className="size-4" /> Customers and suppliers
            </Link>
            {overview.data?.outstandingHref && (
              <Link href={overview.data.outstandingHref} className="text-[13px] text-accent hover:underline">
                Outstanding
              </Link>
            )}
            {p && ws.can('masters.party.update') && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit
              </Button>
            )}
          </>
        }
      />
      {p && (
        <Card className="mb-4">
          <CardHeader title="Details" actions={!p.isActive && <Badge tone="warning">Inactive</Badge>} />
          <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="GST treatment">{p.gstTreatment.replaceAll('_', ' ')}</Fact>
            <Fact label="GSTIN">{p.gstin && <span className="font-mono">{p.gstin}</span>}</Fact>
            <Fact label="PAN">{p.pan && <span className="font-mono">{p.pan}</span>}</Fact>
            <Fact label="State code">{p.stateCode}</Fact>
            <Fact label="Credit days">{p.creditDays?.toString()}</Fact>
            <Fact label="Credit limit">{p.creditLimit && `₹ ${Number(p.creditLimit).toLocaleString('en-IN')}`}</Fact>
            <Fact label="MSME">{p.msmeCategory && `${p.msmeCategory}${p.msmeUdyam ? ` · ${p.msmeUdyam}` : ''}`}</Fact>
            <Fact label="Contact">{[p.email, p.phone].filter(Boolean).join(' · ')}</Fact>
          </dl>
        </Card>
      )}
      <EntityGate what="documents">
        {overview.data && overview.data.sections.length === 0 && (
          <Card>
            <p className="px-5 py-4 text-[13px] text-muted">No documents with this party yet in this legal entity.</p>
          </Card>
        )}
        {overview.data && overview.data.sections.length > 0 && <RecordSections sections={overview.data.sections} />}
      </EntityGate>
      {editing && p && <PartyDialog party={p} onClose={() => (setEditing(false), void party.refetch())} />}
    </>
  );
}
