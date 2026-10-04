'use client';
import { Badge, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Search } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney, formatQty, today, WAREHOUSE_TYPE_LABELS } from '@/lib/format';
import type { BalanceRow, Party, Warehouse } from '@/lib/types';

export default function BalancePage() {
  return (
    <>
      <PageHeader title="Stock balance" description="What's where, by batch / heat number, valued at FIFO cost." />
      <EntityGate>
        <Balance />
      </EntityGate>
    </>
  );
}

function Balance() {
  const ws = useWorkspace();
  const [q, setQ] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [owner, setOwner] = useState('');
  const customers = useQuery({ queryKey: ['parties', ws.tenantId, '', 'customer'], queryFn: () => api<Party[]>('/parties?role=customer&limit=500', { scope: ws.scope }), enabled: ws.can('masters.party.read') });
  const warehouses = useQuery({ queryKey: ['warehouses', ws.entityId], queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }) });
  const rows = useQuery({
    queryKey: ['balance', ws.entityId, warehouseId, owner],
    queryFn: () => api<BalanceRow[]>(`/stock/balance?${new URLSearchParams({ ...(warehouseId && { warehouseId }), ...(owner && { owner }) })}`, { scope: ws.scope }),
  });

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = (rows.data ?? []).filter((r) => !needle || `${r.itemCode} ${r.itemName} ${r.batchNo ?? ''} ${r.heatNo ?? ''}`.toLowerCase().includes(needle));
    const map = new Map<string, { item: BalanceRow; rows: BalanceRow[]; qty: number; ownedQty: number; value: number }>();
    for (const r of filtered) {
      const g = map.get(r.itemId) ?? { item: r, rows: [], qty: 0, ownedQty: 0, value: 0 };
      g.rows.push(r);
      g.qty += Number(r.qty);
      if (r.ownership === 'company') g.ownedQty += Number(r.qty);
      g.value += Number(r.value);
      map.set(r.itemId, g);
    }
    return [...map.values()];
  }, [rows.data, q]);
  const total = groups.reduce((s, g) => s + g.value, 0);
  const now = today();

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-subtle" />
          <Input className="pl-9" placeholder="Filter by item, batch or heat number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter" />
        </div>
        <Select className="w-56" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Warehouse">
          <option value="">All warehouses</option>
          {warehouses.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} · {w.name}
            </option>
          ))}
        </Select>
        <Select className="w-56" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">All owners</option>
          <option value="company">Our own stock</option>
          <option value="customers">All customer material</option>
          {customers.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}&apos;s material
            </option>
          ))}
        </Select>
        <p className="ml-auto text-[13px] text-muted">
          Stock value <span className="tabular ml-2 text-[15px] font-semibold text-fg">{formatMoney(String(total))}</span>
        </p>
      </div>
      {groups.length === 0 ? (
        <EmptyState icon={<Boxes className="size-5" />} title={rows.isLoading ? 'Loading…' : 'No stock'} description="Submitted receipts show up here." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Item / warehouse</Th>
              <Th>Batch · heat no.</Th>
              <Th>Expiry</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Value</Th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.item.itemId}>
                <tr className="bg-surface-2/50">
                  <Td>
                    <Link href={`/app/inventory/ledger?itemId=${g.item.itemId}`} className="font-mono text-[13px] font-semibold hover:text-accent">
                      {g.item.itemCode}
                    </Link>{' '}
                    <span className="text-[13px] text-muted">{g.item.itemName}</span>
                    {g.item.reorderLevel && g.ownedQty < Number(g.item.reorderLevel) && (
                      <Badge tone="warning" className="ml-2">
                        Below reorder level
                      </Badge>
                    )}
                  </Td>
                  <Td />
                  <Td />
                  <Td className="tabular text-right font-semibold">
                    {formatQty(String(g.qty))} <span className="text-[11px] font-normal text-subtle">{g.item.uomCode}</span>
                  </Td>
                  <Td className="tabular text-right font-semibold">{formatMoney(String(g.value))}</Td>
                </tr>
                {g.rows.map((r) => (
                  <Tr key={`${r.warehouseId}:${r.batchId}`}>
                    <Td className="pl-8 text-[13px]">
                      <span className="font-mono">{r.warehouseCode}</span> <span className="text-muted">{r.warehouseName}</span>
                      {r.ownership === 'customer' && (
                        <Badge tone="warning" className="ml-2">
                          {r.ownerName ?? 'Customer'}&apos;s
                        </Badge>
                      )}
                      {(r.warehouseType === 'quarantine' || r.warehouseType === 'mrb') && (
                        <Badge tone="danger" className="ml-2">
                          {WAREHOUSE_TYPE_LABELS[r.warehouseType]}
                        </Badge>
                      )}
                    </Td>
                    <Td className="font-mono text-[12px] whitespace-nowrap">{r.batchNo ? `${r.batchNo}${r.heatNo && r.heatNo !== r.batchNo ? ` · ${r.heatNo}` : ''}` : '—'}</Td>
                    <Td className="text-[12px]">
                      {r.expiryDate ? <span className={r.expiryDate < now ? 'font-medium text-danger' : ''}>{formatDate(r.expiryDate)}</span> : '—'}
                    </Td>
                    <Td className="tabular text-right text-[13px]">{formatQty(r.qty)}</Td>
                    <Td className="tabular text-right text-[13px] text-muted">{formatMoney(r.value)}</Td>
                  </Tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
