'use client';
// Support inbox (decision 050): only the approvals addressed to the signed-in operator. Starting one needs the
// operator's own password and a recent sign-in; it opens the read-only support workspace.
import type { SupportGrantPage, SupportGrantSummary, SupportWorkspaceContext } from '@factoryos/auth';
import { Alert, Badge, Button, buttonClass, Card, EmptyState, Field, Input, PageHeader } from '@factoryos/ui';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { ReadOnlyNotice, SupportError } from '@/components/support-access-controls';
import { useMe } from '@/components/workspace';
import { authClient } from '@/lib/auth-client';
import { formatDateTime } from '@/lib/format';
import { AREA_LABELS, STATE_TONE, supportControl } from '@/lib/support-access';

export default function SupportInboxPage() {
  const me = useMe();
  const session = authClient.useSession();
  const userId = session.data?.user.id;
  if (me.isLoading || session.isPending) return <p className="text-muted">Loading…</p>;
  if (!userId) {
    return (
      <Alert tone="danger">
        Sign in first. <Link href="/sign-in?next=/support" className="font-medium underline">Sign in</Link>
      </Alert>
    );
  }
  if (me.data?.user.id !== userId || (me.data.platformAdmin !== 'superadmin' && me.data.platformAdmin !== 'support')) {
    return <Alert tone="danger" title="FactoryOS support only">This inbox is for FactoryOS support operators.</Alert>;
  }
  return <OperatorInbox key={userId} userId={userId} />;
}

function OperatorInbox({ userId }: { userId: string }) {
  const pages = useInfiniteQuery({
    queryKey: ['support-inbox', userId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => supportControl<SupportGrantPage>(`/operator/grants?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal }),
    getNextPageParam: (last) => last.nextCursor,
    // Grant states change elsewhere (workspace, tenant, expiry): always ask the server when the inbox is shown.
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const grants = pages.data?.pages.flatMap((p) => p.grants) ?? [];
  return (
    <>
      <PageHeader title="Support inbox" description="Approvals customers have addressed to you. Each one can be started once, within 10 minutes of approval." />
      <ReadOnlyNotice>You can only view the approved areas, as the member the customer chose. Nothing can be changed, exported or downloaded, and every view is recorded for the customer.</ReadOnlyNotice>
      {pages.error ? (
        <SupportError error={pages.error} />
      ) : grants.length === 0 && !pages.isPending ? (
        <Card>
          <EmptyState icon={<Inbox className="size-5" />} title="Nothing approved for you" description="Ask the customer to approve support access for your email in their Settings." />
        </Card>
      ) : (
        <div className="space-y-4">
          {grants.map((g) => (
            <GrantCard key={g.id} grant={g} userId={userId} />
          ))}
          {pages.hasNextPage && (
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => pages.fetchNextPage()} disabled={pages.isFetchingNextPage}>
              Load more
            </button>
          )}
        </div>
      )}
    </>
  );
}

function GrantCard({ grant: g, userId }: { grant: SupportGrantSummary; userId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  useEffect(() => () => setPassword(''), []);
  const start = useMutation({
    mutationFn: () => supportControl<SupportWorkspaceContext>(`/operator/grants/${g.id}/start`, { method: 'POST', body: { password } }),
    onSuccess: () => router.push(`/support/workspace/${g.id}`),
    onSettled: () => setPassword(''),
  });
  const stop = useMutation({
    mutationFn: () => supportControl(`/operator/grants/${g.id}/stop`, { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['support-inbox', userId] }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    start.mutate();
  };
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{g.tenantName}</span>
        <span className="text-muted">· {g.entityName}</span>
        <Badge tone={STATE_TONE[g.state]}>{g.state[0]!.toUpperCase() + g.state.slice(1)}</Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="inline text-muted">Shown as </dt>
          <dd className="inline">{g.subject.name}</dd>
        </div>
        <div>
          <dt className="inline text-muted">Approved by </dt>
          <dd className="inline">{g.approver.name}</dd>
        </div>
        <div>
          <dt className="inline text-muted">Areas </dt>
          <dd className="inline">{g.areas.map((a) => AREA_LABELS[a]).join(', ')}</dd>
        </div>
        <div>
          <dt className="inline text-muted">Duration </dt>
          <dd className="inline">{Math.round(g.durationSeconds / 60)} min</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="inline text-muted">Reason </dt>
          <dd className="inline">{g.reason}</dd>
        </div>
        <div className="sm:col-span-2 text-muted">
          {g.state === 'approved' ? `Start by ${formatDateTime(g.startBy)}` : g.expiresAt ? `Ends ${formatDateTime(g.expiresAt)}` : `Approved ${formatDateTime(g.approvedAt)}`}
        </div>
      </dl>
      {g.state === 'approved' && (
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Your password" hint="Needs a sign-in from the last five minutes with two-factor" className="sm:max-w-xs sm:flex-1">
            {(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
          </Field>
          <Button type="submit" loading={start.isPending}>
            Start read-only support
          </Button>
        </form>
      )}
      {g.state === 'active' && (
        <div className="flex flex-wrap gap-2">
          <Link href={`/support/workspace/${g.id}`} className={buttonClass('primary', 'sm')}>
            Open workspace
          </Link>
          <Button size="sm" variant="secondary" loading={stop.isPending} onClick={() => stop.mutate()}>
            Stop
          </Button>
        </div>
      )}
      {start.error && <SupportError error={start.error} />}
      {stop.error && <SupportError error={stop.error} />}
    </Card>
  );
}
