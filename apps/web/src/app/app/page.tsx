'use client';
import { Badge, buttonClass, Card, CardHeader, EmptyState } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Circle, Inbox } from 'lucide-react';
import Link from 'next/link';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, fyLabel } from '@/lib/format';
import type { LegalEntity, Member } from '@/lib/types';

const PHASES = [
  { n: 0, title: 'Foundation', body: 'Tenancy, entities, users, roles, audit, design system', done: true },
  { n: 1, title: 'Inventory, buying, selling, GST', body: 'Stock ledger, batches and heat numbers, invoices, e-invoice and e-way bill' },
  { n: 2, title: 'Manufacturing & quality', body: 'BOM, routing, work orders, job cards, genealogy, FAI, NCR' },
  { n: 3, title: 'Services', body: 'Machine-hours, test campaigns, memberships, subscriptions' },
  { n: 4, title: 'Accounts & returns', body: 'GSTR-1/3B, 2B reconciliation, TDS, MSME, Tally sync' },
  { n: 5, title: 'Machines & EHS', body: 'Edge agent, OEE, metering, waste register' },
];

function greeting() {
  const h = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function HomePage() {
  const ws = useWorkspace();
  const canEntities = ws.canTenant('settings.entity.read');
  const canUsers = ws.canTenant('settings.user.read');
  const entities = useQuery({
    queryKey: ['entities', ws.tenantId],
    queryFn: () => api<LegalEntity[]>('/entities', { scope: ws.tenantScope }),
    enabled: canEntities,
  });
  const members = useQuery({
    queryKey: ['members', ws.tenantId],
    queryFn: () => api<Member[]>('/members', { scope: ws.tenantScope }),
    enabled: canUsers,
  });

  const regs = entities.data?.flatMap((e) => e.gstRegistrations.map((r) => ({ ...r, entity: e.shortName }))) ?? [];
  const me = members.data?.find((m) => m.userId === ws.me.user.id);
  const steps = [
    { label: 'Add your legal entities', done: (entities.data?.length ?? 0) > 0, href: '/app/settings/entities', show: canEntities },
    { label: 'Add GST registrations', done: regs.length > 0, href: '/app/settings/entities', show: canEntities },
    { label: 'Invite your team', done: (members.data?.length ?? 0) > 1, href: '/app/settings/users', show: canUsers },
    { label: 'Turn on two-factor authentication', done: !!me?.twoFactorEnabled, href: '/app/settings/security', show: canUsers },
  ].filter((s) => s.show);
  const stepsLoading = (canEntities && entities.isPending) || (canUsers && members.isPending);
  const activeEntity = ws.tenantCtx.entities.find((e) => e.id === ws.entityId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">
          {greeting()}, {ws.me.user.name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {activeEntity ? activeEntity.legalName : `${ws.tenantName} · all entities`} · {fyLabel()}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {steps.length > 0 && !stepsLoading && (
          <Card className="lg:col-span-2">
            <CardHeader
              title="Set up your workspace"
              description={`${steps.filter((s) => s.done).length} of ${steps.length} done`}
            />
            <ul className="divide-y divide-line">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-3 px-5 py-3">
                  {s.done ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-line-strong" />}
                  <span className={s.done ? 'text-muted line-through' : ''}>{s.label}</span>
                  {!s.done && (
                    <Link href={s.href} className={buttonClass('secondary', 'sm', 'ml-auto')}>
                      Start
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title="Waiting on me" />
          <EmptyState icon={<Inbox className="size-5" />} title="Nothing to approve" description="Approvals for POs, payments and GST returns will appear here from Phase 1." />
        </Card>

        {canEntities && (
          <Card className="lg:col-span-2">
            <CardHeader title="E-invoice readiness" description="E-invoicing is date-effective per GST registration" />
            {regs.length === 0 ? (
              <EmptyState icon={<CalendarClock className="size-5" />} title="No GST registrations yet" description="Add a GSTIN to track when e-invoicing applies." />
            ) : (
              <ul className="divide-y divide-line">
                {regs.map((r) => {
                  const from = r.einvoiceApplicableFrom ? new Date(r.einvoiceApplicableFrom) : null;
                  const days = from ? Math.ceil((from.getTime() - Date.now()) / 86_400_000) : null;
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <span className="font-mono text-[13px]">{r.gstin}</span>
                      <span className="text-[13px] text-muted">{r.entity}</span>
                      <span className="ml-auto">
                        {!from ? (
                          <Badge>Not applicable</Badge>
                        ) : days! > 0 ? (
                          <Badge tone="warning" dot>
                            Applies {formatDate(from)} · {days} days
                          </Badge>
                        ) : (
                          <Badge tone="success" dot>
                            Active since {formatDate(from)}
                          </Badge>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        <Card className={canEntities ? '' : 'lg:col-span-3'}>
          <CardHeader title="Roadmap" description="What arrives next" />
          <ol className="space-y-3 px-5 py-4">
            {PHASES.map((p) => (
              <li key={p.n} className="flex gap-3">
                <span
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${p.done ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted'}`}
                >
                  {p.n}
                </span>
                <div>
                  <p className="text-[13px] font-medium">{p.title}</p>
                  <p className="text-[12px] text-muted">{p.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
