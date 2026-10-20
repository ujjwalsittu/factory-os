'use client';
import { Badge, Button, buttonClass, Card, CardHeader, PageHeader } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { ItemDialog } from '@/components/master-dialogs';
import { type Overview, RecordSections } from '@/components/record-sections';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatQty, ITEM_TYPE_LABELS } from '@/lib/format';
import type { Item, Uom } from '@/lib/types';

const TRACKING = { none: 'Not tracked', batch: 'Batch / heat no.', serial: 'Serial no.' };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] break-words">{children || '—'}</dd>
    </div>
  );
}

/** An item and everything around it: stock, orders, BOMs, work orders, quality, maintenance (decision 070). */
export default function ItemPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const item = useQuery({ queryKey: ['item', ws.tenantId, ws.entityId, id], queryFn: () => api<Item>(`/items/${id}`, { scope: ws.scope }) });
  const uoms = useQuery({ queryKey: ['uoms', ws.tenantId, ws.entityId], queryFn: () => api<Uom[]>('/uoms', { scope: ws.scope }), enabled: ws.can('masters.uom.read') });
  const overview = useQuery({ queryKey: ['item-overview', ws.tenantId, ws.entityId, id], queryFn: () => api<Overview>(`/items/${id}/overview`, { scope: ws.scope }) });
  const it = item.data;
  const unit = uoms.data?.find((u) => u.id === it?.stockUomId);

  if (item.isError) {
    return (
      <>
        <PageHeader title="Item not found" description="It may have been removed, or you may not have access to it." />
        <Link href="/app/masters/items" className="text-[13px] text-accent hover:underline">
          Back to items
        </Link>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={it ? <span><span className="font-mono">{it.code}</span> · {it.name}</span> : 'Item'}
        description={it && ITEM_TYPE_LABELS[it.type]}
        actions={
          <>
            <Link href="/app/masters/items" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
              <ArrowLeft className="size-4" /> Items
            </Link>
            {it && overview.data?.belowReorder && ws.can('buying.purchase_order.create') && (
              <Link href={`/app/buying/orders/new?item=${it.id}&qty=${overview.data.belowReorder.shortfall.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}`} className={buttonClass('primary', 'md')}>
                Create purchase order
              </Link>
            )}
            {it && ws.can('masters.item.update') && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit
              </Button>
            )}
          </>
        }
      />
      {it && (
        <Card className="mb-4">
          <CardHeader title="Details" actions={!it.isActive && <Badge tone="warning">Inactive</Badge>} />
          <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Stock unit">{unit ? `${unit.code} · ${unit.name}` : ''}</Fact>
            <Fact label="Tracking">{TRACKING[it.tracking]}</Fact>
            <Fact label={it.type === 'service' ? 'SAC' : 'HSN'}>{it.hsnCode}</Fact>
            <Fact label="Reorder level">{it.reorderLevel ? formatQty(it.reorderLevel, unit?.decimals ?? 0) : ''}</Fact>
            <Fact label="Drawing no.">{it.drawingNo}</Fact>
            <Fact label="Revision">{it.revision}</Fact>
            <Fact label="Description">{it.description}</Fact>
            <Fact label="Flags">
              {[it.requiresIncomingInspection && 'Incoming inspection', it.exportControlled && 'Export-controlled', it.requiresFinalInspection && 'Final inspection', it.requiresFai && 'First article']
                .filter(Boolean)
                .join(' · ')}
            </Fact>
          </dl>
        </Card>
      )}
      <EntityGate what="stock and activity">
        {overview.data && overview.data.sections.length === 0 && (
          <Card>
            <p className="px-5 py-4 text-[13px] text-muted">Nothing recorded for this item yet in this legal entity.</p>
          </Card>
        )}
        {overview.data && overview.data.sections.length > 0 && <RecordSections sections={overview.data.sections} />}
      </EntityGate>
      {editing && it && <ItemDialog item={it} onClose={() => (setEditing(false), void item.refetch())} />}
    </>
  );
}
