'use client';
import { Badge, Button, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link2, ScrollText } from 'lucide-react';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { AuditEvent, Member } from '@/lib/types';

const PAGE = 50;

export default function AuditPage() {
  const ws = useWorkspace();
  const scope = ws.tenantScope;
  const members = useQuery({ queryKey: ['members', ws.tenantId], queryFn: () => api<Member[]>('/members', { scope }), enabled: ws.canTenant('settings.user.read') });
  const q = useInfiniteQuery({
    queryKey: ['audit', ws.tenantId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<AuditEvent[]>(`/audit?limit=${PAGE}${pageParam ? `&before=${pageParam}` : ''}`, { scope }),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.seq : undefined),
  });
  const events = q.data?.pages.flat() ?? [];
  const actor = (id: string | null) => (id ? (members.data?.find((m) => m.userId === id)?.name ?? 'Platform admin') : 'System');
  // Each event stores the previous event's hash; a mismatch means a row was altered or removed.
  const broken = events.findIndex((e, i) => i < events.length - 1 && e.prevHash !== events[i + 1]!.hash);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change, append-only and hash-chained. Required under the Companies (Accounts) Rules audit-trail provision."
        actions={
          events.length > 1 &&
          (broken === -1 ? (
            <Badge tone="success"><Link2 className="size-3" /> Chain intact ({events.length} loaded)</Badge>
          ) : (
            <Badge tone="danger">Chain broken at #{events[broken]!.seq}</Badge>
          ))
        }
      />
      <Card>
        {events.length === 0 && !q.isLoading ? (
          <EmptyState icon={<ScrollText className="size-5" />} title="No events yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>When (IST)</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Hash</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <Tr key={e.seq}>
                  <Td className="tabular font-mono text-[12px] text-subtle">{e.seq}</Td>
                  <Td className="tabular whitespace-nowrap text-[13px]">{formatDateTime(e.occurredAt)}</Td>
                  <Td className="text-[13px]">{actor(e.actorUserId)}</Td>
                  <Td>
                    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px]">{e.action}</code>
                    {e.reason && <p className="mt-1 text-[12px] text-muted">Reason: {e.reason}</p>}
                  </Td>
                  <Td className="text-[13px] text-muted">{e.targetType}</Td>
                  <Td className="font-mono text-[11px] text-subtle">{e.hash.slice(0, 10)}…</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {q.hasNextPage && (
          <div className="flex justify-center border-t border-line p-3">
            <Button variant="secondary" size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
              Load older events
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
