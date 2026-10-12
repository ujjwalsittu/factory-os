'use client';
// Decision 065: the SMT section of a batch page. For a board serial: its panel, the scans and the reels and paste it
// was placed with. For a component lot: its reels and the boards built from them (recall).
import { Badge, Card, CardHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { type BoardTrace, minutes, PHASE, type TraceBoard } from '@/lib/smt';

export function SmtTrace({ batchId }: { batchId: string }) {
  const ws = useWorkspace();
  const q = useQuery({
    queryKey: ['smt-batch', ws.entityId, batchId],
    queryFn: () => api<{ board: BoardTrace | null; containers: { id: string; code: string; kind: string }[]; boards: TraceBoard[] }>(`/manufacturing/smt/batches/${batchId}`, { scope: ws.scope }),
    enabled: ws.can('manufacturing.smt.read'),
  });
  const d = q.data;
  if (!d || (!d.board && !d.containers.length)) return null;
  return (
    <>
      {d.board && <Board b={d.board} />}
      {d.containers.length > 0 && (
        <Card>
          <CardHeader title="Boards built with this lot" description={`Reels and paste of this lot: ${d.containers.map((c) => c.code).join(', ')}. For a recall, these are the boards placed while one of them was loaded.`} />
          {d.boards.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-muted">No boards placed with it yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Board</Th>
                    <Th>Panel</Th>
                    <Th>Placed</Th>
                    <Th>Via</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.boards.map((b) => (
                    <Tr key={b.serialNo}>
                      <Td className="font-mono text-[13px]">
                        {b.batchId ? <Link className="text-accent" href={`/app/inventory/batches/${b.batchId}`}>{b.serialNo}</Link> : b.serialNo} {b.scrapped && <Badge tone="danger">Scrapped</Badge>}
                      </Td>
                      <Td className="font-mono text-[13px]">
                        {b.panel} <span className="font-sans text-subtle">{b.workOrder}</span>
                      </Td>
                      <Td className="text-[13px] whitespace-nowrap">{formatDateTime(b.placedAt)}</Td>
                      <Td className="font-mono text-[13px]">{b.via}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function Board({ b }: { b: BoardTrace }) {
  return (
    <Card>
      <CardHeader
        title="SMT"
        description={
          <>
            Position {b.position} on panel <span className="font-mono">{b.panel.code}</span>
            {b.workOrder && (
              <>
                {' '}
                of <Link className="text-accent" href={`/app/manufacturing/work-orders/${b.workOrder.id}`}>{b.workOrder.number}</Link>
              </>
            )}
            {b.panel.placedAt && ` · placed ${formatDateTime(b.panel.placedAt)} on ${b.panel.machine}`}
            {b.panel.depaneledAt && ` · depaneled ${formatDateTime(b.panel.depaneledAt)}`}
            {b.scrappedAt && ` · scrapped: ${b.scrapReason}`}
          </>
        }
      />
      {b.reels.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-muted">Not placed yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Slot</Th>
                <Th>Part</Th>
                <Th>Lot</Th>
                <Th>Reel or jar</Th>
                <Th>At placement</Th>
              </tr>
            </thead>
            <tbody>
              {b.reels.map((r) => (
                <Tr key={`${r.slot}-${r.container.id}`}>
                  <Td className="font-mono text-[13px]">{r.slot}</Td>
                  <Td className="text-[13px]">
                    <span className="font-mono">{r.itemCode}</span> {r.itemName}
                  </Td>
                  <Td className="text-[13px]">
                    <Link className="font-mono text-accent" href={`/app/inventory/batches/${r.batchId}`}>
                      {r.batchNo}
                    </Link>
                    {r.supplierBatchNo && <span className="block text-subtle">supplier {r.supplierBatchNo}</span>}
                  </Td>
                  <Td className="font-mono text-[13px]">{r.container.code}</Td>
                  <Td className="text-[13px] whitespace-nowrap">
                    <Badge tone={PHASE[r.atPlacement.phase]?.tone ?? 'neutral'}>{PHASE[r.atPlacement.phase]?.label ?? r.atPlacement.phase}</Badge>
                    {r.atPlacement.clock?.floorMinutes != null && <span className="ml-2 text-subtle">{minutes(r.atPlacement.clock.usedMinutes)} of {minutes(r.atPlacement.clock.floorMinutes)} used</span>}
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
