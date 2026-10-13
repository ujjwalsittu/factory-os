'use client';
import { Alert, Card, EmptyState, Field, Input, PageHeader, Table, Td, Th, Tr, DateInput } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatMoney, today } from '@/lib/format';
import type { Reliability } from '@/lib/maintenance';

const daysBefore = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);
const hours = (h: number | null) => (h == null ? '—' : `${h} h`);

/** Maintenance reports (decision 066): breakdowns, downtime, MTTR, MTBF, availability and cost per machine. */
export default function MaintenanceReportsPage() {
  const ws = useWorkspace();
  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(daysBefore(today(), 29));
  const q = useQuery({
    queryKey: ['maintenance', 'report', ws.entityId, from, to],
    queryFn: () => api<{ machines: Reliability[] }>(`/maintenance/reports?from=${from}&to=${to}`, { scope: ws.scope }),
    enabled: !!ws.entityId && !!from && !!to,
  });
  const rows = q.data?.machines ?? [];
  const total = (k: 'sparesCost' | 'labourCost') => rows.reduce((t, r) => t + Number(r[k]), 0).toFixed(2);
  return (
    <>
      <PageHeader title="Maintenance reports" description="Per machine: breakdowns, downtime, mean time to repair, mean running hours between failures, availability against its calendar, and what maintenance cost." />
      <EntityGate what="maintenance">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Field label="From">{(p) => <DateInput {...p} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
            <Field label="To">{(p) => <DateInput {...p} value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
          </div>
          {q.error && <Alert tone="danger">{q.error.message}</Alert>}
          <Card>
            {q.data && rows.length === 0 ? (
              <EmptyState icon={<BarChart3 className="size-5" />} title="Nothing in this period" description="Machines appear once they have working time on a calendar or maintenance orders." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>Machine</Th>
                      <Th className="text-right">Breakdowns</Th>
                      <Th className="text-right">Downtime</Th>
                      <Th className="text-right">MTTR</Th>
                      <Th className="text-right">MTBF</Th>
                      <Th className="text-right">Availability</Th>
                      <Th className="text-right">Preventive</Th>
                      <Th className="text-right">Spares</Th>
                      <Th className="text-right">Labour</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <Tr key={r.machineId}>
                        <Td className="text-[13px]">
                          <Link className="font-mono font-medium hover:text-accent" href={`/app/machines/${r.machineId}`}>
                            {r.machineCode}
                          </Link>{' '}
                          {r.machineName}
                          <span className="block text-subtle">
                            {r.runHours} running h {r.runHoursSource === 'tap' ? 'from the tap' : 'from job cards'}
                          </span>
                        </Td>
                        <Td className="tabular text-right">{r.breakdowns}</Td>
                        <Td className="tabular text-right">{hours(r.downtimeHours)}</Td>
                        <Td className="tabular text-right">{hours(r.mttrHours)}</Td>
                        <Td className="tabular text-right">{hours(r.mtbfHours)}</Td>
                        <Td className="tabular text-right">{r.availability == null ? '—' : `${(r.availability * 100).toFixed(1)} %`}</Td>
                        <Td className="tabular text-right">{r.preventive}</Td>
                        <Td className="tabular text-right">{formatMoney(r.sparesCost)}</Td>
                        <Td className="tabular text-right">{formatMoney(r.labourCost)}</Td>
                      </Tr>
                    ))}
                    {rows.length > 1 && (
                      <tr className="border-t border-line text-[13px] font-medium">
                        <Td colSpan={7}>Total</Td>
                        <Td className="tabular text-right">{formatMoney(total('sparesCost'))}</Td>
                        <Td className="tabular text-right">{formatMoney(total('labourCost'))}</Td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>
        </div>
      </EntityGate>
    </>
  );
}
