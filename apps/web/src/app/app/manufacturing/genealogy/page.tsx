'use client';
import { Alert, Badge, Button, buttonClass, Card, CardHeader, EmptyState, Input, PageHeader, Table, Td, Th } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatQty } from '@/lib/format';

interface Hit {
  batchId: string;
  batchNo: string;
  heatNo: string | null;
  kind: 'lot' | 'serial' | 'remnant';
  itemCode: string;
  itemName: string;
}
interface Node {
  batchId: string;
  batchNo: string;
  heatNo: string | null;
  kind: 'lot' | 'serial' | 'remnant';
  lengthMm: string | null;
  itemCode: string;
  itemName: string;
  via: { type: 'work_order' | 'remnant' | 'as_built'; number: string | null; qty: string } | null;
  receipts: { number: string | null; date: string; supplier: string | null; qty: string }[];
  stock: { warehouse: string; qty: string }[];
  deliveries: { invoice: string | null; date: string; customer: string | null; qty: string; returned: string }[];
  seen?: boolean;
  children: Node[];
}
interface Tree {
  direction: 'backward' | 'forward';
  root: Node;
  truncated: boolean;
  nodes: number;
}
interface RecallRow extends Omit<Node, 'children' | 'via'> {
  depth: number;
  viaNumber: string | null;
}

const KIND: Record<Node['kind'], string> = { lot: 'Lot', serial: 'Serial', remnant: 'Remnant' };

export default function GenealogyPage() {
  return (
    <>
      <PageHeader title="Genealogy" description="Trace a serial, lot or heat: backward to what went into it and its purchase receipts, forward to everything made from it and the customers it shipped to." />
      <EntityGate what="manufacturing">
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <Explorer />
        </Suspense>
      </EntityGate>
    </>
  );
}

function Explorer() {
  const ws = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const batchId = params.get('batch');
  const direction = (params.get('direction') as 'backward' | 'forward') ?? 'backward';
  const [q, setQ] = useState('');
  const hits = useQuery({ queryKey: ['genealogy-search', ws.entityId, q], queryFn: () => api<Hit[]>(`/manufacturing/genealogy?q=${encodeURIComponent(q)}`, { scope: ws.scope }), enabled: q.trim().length >= 2 });
  const go = (id: string, dir = direction) => router.replace(`/app/manufacturing/genealogy?batch=${id}&direction=${dir}`);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <Input aria-label="Search serial, lot or heat" placeholder="Search serial, lot, heat or item code…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={!batchId} />
        {hits.data && q.trim().length >= 2 && (
          <div className="mt-2 max-h-64 overflow-y-auto">
            {hits.data.length === 0 && <p className="text-[13px] text-muted">Nothing found.</p>}
            {hits.data.map((h) => (
              <button key={h.batchId} type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2" onClick={() => (setQ(''), go(h.batchId))}>
                <span className="font-mono font-medium">{h.batchNo}</span>
                <Badge tone="neutral">{KIND[h.kind]}</Badge>
                <span className="text-muted">
                  <span className="font-mono">{h.itemCode}</span> {h.itemName}
                </span>
                {h.heatNo && h.heatNo !== h.batchNo && <span className="text-subtle">heat {h.heatNo}</span>}
              </button>
            ))}
          </div>
        )}
      </Card>
      {batchId ? (
        <TreeView batchId={batchId} direction={direction} onDirection={(d) => go(batchId, d)} onOpen={(id) => go(id)} />
      ) : (
        <Card>
          <EmptyState icon={<GitBranch className="size-5" />} title="Search to start" description="Find a satellite serial to see every heat in it, or a heat to list every part and customer it reached." />
        </Card>
      )}
    </div>
  );
}

function TreeView({ batchId, direction, onDirection, onOpen }: { batchId: string; direction: 'backward' | 'forward'; onDirection: (d: 'backward' | 'forward') => void; onOpen: (id: string) => void }) {
  const ws = useWorkspace();
  const tree = useQuery({ queryKey: ['genealogy', batchId, direction], queryFn: () => api<Tree>(`/manufacturing/genealogy/${batchId}?direction=${direction}`, { scope: ws.scope }) });
  const recall = useQuery({ queryKey: ['recall', batchId], queryFn: () => api<{ truncated: boolean; rows: RecallRow[] }>(`/manufacturing/genealogy/${batchId}/recall`, { scope: ws.scope }), enabled: direction === 'forward' });
  if (tree.error) return <Alert tone="danger">{tree.error.message}</Alert>;
  const t = tree.data;
  return (
    <>
      <Card>
        <CardHeader
          title={t ? `${t.root.itemCode} · ${t.root.batchNo}` : 'Loading…'}
          description={t ? `${t.nodes} item${t.nodes === 1 ? '' : 's'} traced${t.truncated ? ' · truncated at the traversal limit' : ''}` : undefined}
          actions={
            <div className="flex gap-1" role="tablist" aria-label="Direction">
              {(['backward', 'forward'] as const).map((d) => (
                <Button key={d} role="tab" aria-selected={direction === d} size="sm" variant={direction === d ? 'secondary' : 'ghost'} onClick={() => onDirection(d)}>
                  {d === 'backward' ? 'Made from' : 'Went into'}
                </Button>
              ))}
            </div>
          }
        />
        {t && (
          <ul className="p-3">
            <NodeRow node={t.root} depth={0} onOpen={onOpen} />
          </ul>
        )}
      </Card>
      {direction === 'forward' && recall.data && (
        <Card className="mt-4">
          <CardHeader
            title="Recall list"
            description="Every serial and lot reached, and where it is now."
            actions={
              ws.can('manufacturing.genealogy.export') && (
                <a className={buttonClass('secondary', 'sm')} href={`/api/manufacturing/genealogy/${batchId}/recall.csv?tenant=${ws.tenantId}`} onClick={(e) => (e.preventDefault(), void download(batchId, ws.scope))}>
                  Export CSV
                </a>
              )
            }
          />
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Serial / lot</Th>
                  <Th>Item</Th>
                  <Th>Where now</Th>
                </tr>
              </thead>
              <tbody>
                {recall.data.rows.map((r) => (
                  <tr key={r.batchId} className="border-t border-line">
                    <Td className="font-mono text-[13px]" style={{ paddingLeft: `${0.75 + r.depth * 0.75}rem` }}>
                      {r.batchNo}
                    </Td>
                    <Td className="text-[13px]">
                      <span className="font-mono">{r.itemCode}</span> <span className="text-muted">{r.itemName}</span>
                    </Td>
                    <Td className="text-[13px]">
                      <Where node={r} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
    </>
  );
}

async function download(batchId: string, scope: { tenantId?: string | null; entityId?: string | null }) {
  const res = await fetch(`/api/manufacturing/genealogy/${batchId}/recall.csv`, { headers: { ...(scope.tenantId ? { 'x-tenant-id': scope.tenantId } : {}), ...(scope.entityId ? { 'x-entity-id': scope.entityId } : {}) }, credentials: 'include' });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `recall-${batchId.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Where({ node }: { node: Pick<Node, 'stock' | 'deliveries' | 'receipts'> }) {
  const parts: string[] = [];
  for (const s of node.stock) parts.push(`In ${s.warehouse} (${formatQty(s.qty)})`);
  for (const d of node.deliveries) parts.push(`Shipped to ${d.customer ?? '—'} on ${d.invoice ?? '—'}, ${formatDate(d.date)}${Number(d.returned) ? ` · ${formatQty(d.returned)} returned` : ''}`);
  if (!parts.length) parts.push('Consumed');
  return <span>{parts.join(' · ')}</span>;
}

function NodeRow({ node, depth, onOpen }: { node: Node; depth: number; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(depth < 3);
  const via = node.via ? (node.via.type === 'remnant' ? 'remnant' : node.via.type === 'as_built' ? `as-built · ${node.via.number}` : node.via.number) : null;
  return (
    <li className="py-1">
      <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ paddingLeft: `${depth * 1.25}rem` }}>
        {node.children.length > 0 ? (
          <button type="button" aria-label={open ? 'Collapse' : 'Expand'} className="w-4 text-subtle" onClick={() => setOpen(!open)}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <button type="button" className="font-mono font-medium hover:text-accent" onClick={() => onOpen(node.batchId)}>
          {node.batchNo}
        </button>
        <Badge tone={node.kind === 'serial' ? 'accent' : node.kind === 'remnant' ? 'info' : 'neutral'}>{KIND[node.kind]}</Badge>
        <span className="text-muted">
          <span className="font-mono">{node.itemCode}</span> {node.itemName}
        </span>
        {node.heatNo && node.heatNo !== node.batchNo && <span className="text-subtle">heat {node.heatNo}</span>}
        {node.lengthMm && <span className="text-subtle">{formatQty(node.lengthMm, 0)} mm</span>}
        {via && <span className="text-subtle">via {via}</span>}
        {node.seen && <span className="text-subtle">(shown above)</span>}
      </div>
      <div className="text-[12px] text-subtle" style={{ paddingLeft: `${depth * 1.25 + 1.5}rem` }}>
        {node.receipts.map((r, i) => (
          <span key={i} className="mr-3">
            Received {r.number} from {r.supplier ?? '—'}, {formatDate(r.date)}
          </span>
        ))}
        <Where node={{ ...node, receipts: [] }} />
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <NodeRow key={`${c.batchId}:${c.via?.number}`} node={c} depth={depth + 1} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  );
}
