'use client';
import { Alert, Badge, type BadgeTone, Button, Card, CardHeader } from '@factoryos/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useWorkspace } from './workspace';

/** Mirrors the API's `GET /connections` (decision 068). */
export interface Connection {
  key: 'gst' | 'email' | 'storage' | 'devices' | 'printers' | 'support' | 'tally';
  title: string;
  status: 'ok' | 'attention' | 'off' | 'setup';
  summary: string;
  lastActivityAt: string | null;
  href: string | null;
  setupBy: string | null;
}

const STATUS: Record<Connection['status'], { label: string; tone: BadgeTone }> = {
  ok: { label: 'Working', tone: 'success' },
  attention: { label: 'Needs a look', tone: 'warning' },
  off: { label: 'Off', tone: 'neutral' },
  setup: { label: 'Not set up', tone: 'neutral' },
};

export function Connections() {
  const ws = useWorkspace();
  const q = useQuery({
    queryKey: ['connections', ws.tenantId, ws.entityId],
    queryFn: () => api<{ connections: Connection[] }>('/connections', { scope: ws.scope }),
  });
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!q.data) return <p>Loading connections…</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {q.data.connections.map((c) => (
        <ConnectionCard key={c.key} c={c} />
      ))}
    </div>
  );
}

function ConnectionCard({ c }: { c: Connection }) {
  const ws = useWorkspace();
  const test = useMutation({ mutationFn: () => api<{ ok: boolean; message: string }>('/connections/storage/test', { method: 'POST', scope: ws.scope }) });
  const s = STATUS[c.status];
  return (
    <Card>
      <CardHeader title={c.title} actions={<Badge tone={s.tone}>{s.label}</Badge>} />
      <div className="space-y-3 px-5 pb-5 text-sm">
        <p>{c.summary}</p>
        {c.lastActivityAt && <p className="text-muted">Last activity {formatDateTime(c.lastActivityAt)}</p>}
        {c.setupBy && <p className="text-muted">Set up by: {c.setupBy}</p>}
        <div className="flex flex-wrap items-center gap-3">
          {c.href && (
            <Link href={c.href} className="text-accent hover:underline">
              {c.status === 'setup' ? 'Set up' : 'Open'}
            </Link>
          )}
          {c.key === 'storage' && c.status === 'ok' && ws.can('settings.integration.manage') && (
            <Button size="sm" variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? 'Testing…' : 'Test storage'}
            </Button>
          )}
        </div>
        {test.data && <Alert tone={test.data.ok ? 'success' : 'danger'}>{test.data.message}</Alert>}
        {test.error && <Alert tone="danger">{test.error.message}</Alert>}
      </div>
    </Card>
  );
}
