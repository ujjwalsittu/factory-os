'use client';
import { Alert, Card, CardHeader, PageHeader } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { EntityGate } from '@/components/entity-gate';
import { StateStrip } from '@/components/state-strip';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { Meter } from '@/lib/iot';
import { formatMinutes } from '@/lib/services';

/** One machine's states today from its tap (decision 063). */
export default function MachinePage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const q = useQuery({
    queryKey: ['machine-timeline', ws.entityId, id],
    queryFn: () => api<{ machine: { id: string; code: string; name: string }; meter: Meter | null }>(`/plant/machines/${id}/timeline`, { scope: ws.scope }),
    enabled: !!ws.entityId,
    refetchInterval: 60_000,
  });
  const d = q.data;
  return (
    <>
      <PageHeader title={d ? `${d.machine.code} · ${d.machine.name}` : 'Machine'} description={d?.meter ? `Tap ${d.meter.device.code}, heartbeat ${d.meter.device.heartbeatSeconds} s` : undefined} />
      <EntityGate what="plant">
        {q.error && <Alert tone="danger">{q.error.message}</Alert>}
        {d && (
          <Card>
            <CardHeader title="Today" description={d.meter ? `${formatMinutes(d.meter.minutes)} occupied${d.meter.covered ? '' : '; some of the day has no data'}` : 'This machine has no tap.'} />
            {d.meter && (
              <div className="px-5 py-4">
                <StateStrip segments={d.meter.segments} label={`${d.machine.code} states today`} />
              </div>
            )}
          </Card>
        )}
      </EntityGate>
    </>
  );
}
