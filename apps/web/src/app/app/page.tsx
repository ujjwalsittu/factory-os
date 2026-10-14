'use client';
import { Badge, buttonClass, Button, Card, CardHeader, EmptyState } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';
import { EntityGate } from '@/components/entity-gate';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatINR, fyLabel } from '@/lib/format';
import type { LegalEntity, Member } from '@/lib/types';

interface TileRow {
  label: string;
  detail: string;
  href: string;
}
interface Tile {
  id: string;
  group: 'needs_me' | 'sell' | 'buy' | 'stock' | 'make' | 'quality' | 'machines';
  title: string;
  count: number;
  amountInr?: string;
  rows: TileRow[];
  href: string;
  error?: boolean;
}
interface HomeData {
  needsEntity: boolean;
  asOf: string;
  tiles: Tile[];
}

const GROUPS: { id: Tile['group']; label: string }[] = [
  { id: 'needs_me', label: 'Needs me' },
  { id: 'sell', label: 'Sell & cash' },
  { id: 'buy', label: 'Buy & pay' },
  { id: 'stock', label: 'Stock' },
  { id: 'make', label: 'Make' },
  { id: 'quality', label: 'Quality' },
  { id: 'machines', label: 'Machines' },
];


function TileCard({ tile, onRetry }: { tile: Tile; onRetry: () => void }) {
  const waiting = tile.count > 0;
  return (
    <Card data-tile={tile.id}>
      <CardHeader
        title={tile.title}
        description={waiting && tile.amountInr !== undefined ? formatINR(Number(tile.amountInr)) : undefined}
        actions={tile.error ? undefined : <Badge tone={waiting ? 'warning' : 'neutral'}>{tile.count}</Badge>}
      />
      {tile.error ? (
        <div className="flex items-center justify-between gap-3 px-5 py-4 text-[13px] text-muted">
          <span>Could not load this just now.</span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : !waiting ? (
        <EmptyState size="compact" title="Nothing waiting" />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {tile.rows.map((r, i) => (
              <li key={`${r.href}-${i}`}>
                <Link href={r.href} className="block px-5 py-2.5 hover:bg-surface-2">
                  <span className="block truncate text-[13px] font-medium text-fg">{r.label}</span>
                  <span className="block truncate text-[12px] text-muted">{r.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-5 py-2.5 text-[13px]">
            <Link href={tile.href} className="inline-flex items-center gap-1 text-accent hover:underline">
              {tile.count > tile.rows.length ? `See all ${tile.count}` : 'Open the list'} <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}

function MyWork() {
  const ws = useWorkspace();
  const home = useQuery({
    queryKey: ['home', ws.tenantId, ws.entityId],
    queryFn: () => api<HomeData>('/home', { scope: ws.scope }),
    enabled: !!ws.entityId,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  if (home.isPending)
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading your work">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl border border-line bg-surface-2/60" />
        ))}
      </div>
    );
  if (home.isError)
    return (
      <Card>
        <EmptyState
          title="Could not load your work"
          description={home.error.message}
          action={
            <Button variant="secondary" onClick={() => home.refetch()}>
              Try again
            </Button>
          }
        />
      </Card>
    );
  const tiles = home.data.tiles;
  // Only what has something waiting (or could not load) gets a card; the rest is one quiet list, so Home is not a wall of zeros.
  const shown = tiles.filter((t) => t.count > 0 || t.error);
  const clear = tiles.filter((t) => t.count === 0 && !t.error);
  if (!tiles.length)
    return (
      <Card>
        <EmptyState title="Nothing to show yet" description="Your work appears here as you are given access to orders, stock, quality and machines." />
      </Card>
    );
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted" role="status">
        {shown.length === 0 ? 'Nothing needs you right now.' : `${shown.length} of ${tiles.length} things have something waiting.`}
      </p>
      {GROUPS.map((g) => {
        const group = shown.filter((t) => t.group === g.id);
        if (!group.length) return null;
        return (
          <section key={g.id} aria-label={g.label}>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">{g.label}</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.map((t) => (
                <TileCard key={t.id} tile={t} onRetry={() => home.refetch()} />
              ))}
            </div>
          </section>
        );
      })}
      {clear.length > 0 && (
        <Card aria-label="All clear">
          <CardHeader title="All clear" description="Nothing waiting for you in these" />
          <ul className="grid gap-x-6 gap-y-1.5 px-5 py-4 text-[13px] text-muted sm:grid-cols-2 xl:grid-cols-3">
            {clear.map((t) => (
              <li key={t.id} data-clear={t.id} className="flex items-center gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-success" />
                <Link href={t.href} className="truncate hover:text-fg">
                  {t.title}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

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

        {steps.length > 0 && !stepsLoading && (
          <Card>
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


      <EntityGate what="your work">
        <MyWork />
      </EntityGate>

        {canEntities && (
          <Card>
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
    </div>
  );
}
