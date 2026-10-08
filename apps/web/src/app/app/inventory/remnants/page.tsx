'use client';
import { Card, EmptyState, Field, Input, PageHeader, Table, Td, Th } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { Ruler } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { ItemPicker } from '@/components/item-picker';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatQty } from '@/lib/format';
import type { Item } from '@/lib/types';

interface Remnant {
  batchId: string;
  batchNo: string;
  heatNo: string | null;
  lengthMm: string | null;
  parentBatchNo: string | null;
  itemCode: string;
  itemName: string;
  warehouse: string;
  qty: string;
  uom: string;
}

export default function RemnantsPage() {
  return (
    <>
      <PageHeader title="Remnants" description="Cut pieces of bar kept against their heat. Find one long enough before cutting a new bar; pieces are cut from the work order issue screen." />
      <EntityGate what="inventory">
        <RemnantList />
      </EntityGate>
    </>
  );
}

function RemnantList() {
  const ws = useWorkspace();
  const [item, setItem] = useState<Item | null>(null);
  const [minLength, setMinLength] = useState('');
  const q = useQuery({
    queryKey: ['remnants', ws.entityId, item?.id, minLength],
    queryFn: () => api<Remnant[]>(`/stock/remnants?${new URLSearchParams({ ...(item ? { itemId: item.id } : {}), ...(/^\d+(\.\d+)?$/.test(minLength) ? { minLengthMm: minLength } : {}) })}`, { scope: ws.scope }),
    staleTime: 0,
  });
  return (
    <Card>
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
        <Field label="Item" className="sm:col-span-2">
          {() => <ItemPicker value={item} onChange={setItem} />}
        </Field>
        <Field label="At least (mm)">
          {(f) => <Input {...f} inputMode="decimal" value={minLength} onChange={(e) => setMinLength(e.target.value)} placeholder="e.g. 340" />}
        </Field>
      </div>
      {q.data?.length === 0 ? (
        <EmptyState icon={<Ruler className="size-5" />} title="No remnants found" description="Remnants appear when stores cut a bar on the issue screen." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Remnant</Th>
                <Th>Item</Th>
                <Th>Heat</Th>
                <Th className="text-right">Length</Th>
                <Th className="text-right">Weight</Th>
                <Th>Where</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((r) => (
                <tr key={`${r.batchId}:${r.warehouse}`} className="border-t border-line">
                  <Td className="font-mono text-[13px]">
                    <Link className="hover:text-accent" href={`/app/manufacturing/genealogy?batch=${r.batchId}&direction=backward`}>
                      {r.batchNo}
                    </Link>
                    {r.parentBatchNo && <span className="block text-[11px] text-subtle">from {r.parentBatchNo}</span>}
                  </Td>
                  <Td className="text-[13px]">
                    <span className="font-mono">{r.itemCode}</span> <span className="text-muted">{r.itemName}</span>
                  </Td>
                  <Td className="font-mono text-[13px]">{r.heatNo ?? '—'}</Td>
                  <Td className="tabular text-right">{r.lengthMm ? `${formatQty(r.lengthMm, 0)} mm` : '—'}</Td>
                  <Td className="tabular text-right">
                    {formatQty(r.qty)} {r.uom}
                  </Td>
                  <Td className="text-[13px]">{r.warehouse}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}
