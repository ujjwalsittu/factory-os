'use client';
// Audited support access (decision 050): tenant policy, approval and history. Tenant-wide controls only (no entity
// header); every consent change is confirmed with the approver's own password and a recent sign-in.
import { SUPPORT_AREAS, SUPPORT_MAX_DURATION_SECONDS, SUPPORT_MIN_DURATION_SECONDS, type SupportArea, type SupportGrantPage, type SupportGrantSummary, type SupportHistoryEntry, type SupportPolicy } from '@factoryos/auth';
import { Alert, Badge, Button, buttonClass, Card, CardHeader, EmptyState, Field, Input, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { formatDateTime } from '@/lib/format';
import { AREA_LABELS, needsSignIn, STATE_TONE, supportControl, supportErrorText } from '@/lib/support-access';
import type { Member } from '@/lib/types';

export function ReadOnlyNotice({ children }: { children?: ReactNode }) {
  return (
    <Alert tone="info" title="Read-only support" className="mb-5">
      {children ??
        'A FactoryOS support operator can view the areas you approve, for one entity, as the member you choose, for up to 30 minutes. They cannot change, export or download anything, and every view is recorded.'}
    </Alert>
  );
}

/** Sends the user through normal sign-in (password, two-factor, passkey or SSO) and back to this page. */
export function SignInAgain() {
  const router = useRouter();
  const path = usePathname();
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={async () => {
        await authClient.signOut();
        router.replace(`/sign-in?next=${encodeURIComponent(path)}`);
      }}
    >
      Sign in again
    </Button>
  );
}

export function SupportError({ error }: { error: unknown }) {
  return (
    <Alert tone="danger">
      <div className="flex flex-wrap items-center gap-3">
        <span>{supportErrorText(error)}</span>
        {needsSignIn(error) && <SignInAgain />}
      </div>
    </Alert>
  );
}

const minutes = (seconds: number) => `${Math.round(seconds / 60)} min`;

export function SupportAccessControls({ tenantId }: { tenantId: string }) {
  const ws = useWorkspace();
  const can = (p: 'read' | 'configure' | 'approve' | 'cancel') => ws.canTenant(`settings.support_access.${p}`);
  const policy = useQuery({ queryKey: ['support-policy', tenantId, ws.me.user.id], queryFn: ({ signal }) => supportControl<SupportPolicy>('/policy', { tenantId, signal }), enabled: can('read') });

  if (!can('read')) return <Alert tone="danger">You do not have access to support access settings.</Alert>;
  if (policy.error) return <SupportError error={policy.error} />;
  if (!policy.data) return <p className="text-muted">Loading…</p>;
  return (
    <div className="space-y-6">
      <PolicyCard tenantId={tenantId} policy={policy.data} editable={can('configure')} />
      {can('approve') && policy.data.enabled && <ApproveCard tenantId={tenantId} policy={policy.data} />}
      <History tenantId={tenantId} canRevoke={can('cancel')} />
    </div>
  );
}

function PolicyCard({ tenantId, policy, editable }: { tenantId: string; policy: SupportPolicy; editable: boolean }) {
  const qc = useQueryClient();
  const ws = useWorkspace();
  const [form, setForm] = useState(policy);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => setForm(policy), [policy]);
  useEffect(() => () => setPassword(''), []);
  const save = useMutation({
    mutationFn: () => supportControl<SupportPolicy>('/policy', { method: 'PATCH', tenantId, body: { ...form, ...(form.enabled ? { password } : {}) } }),
    onMutate: () => setDone(false),
    onSuccess: (p) => {
      qc.setQueryData(['support-policy', tenantId, ws.me.user.id], p);
      setDone(true);
    },
    onSettled: () => setPassword(''),
  });
  const toggle = (a: SupportArea) => setForm((f) => ({ ...f, allowedAreas: f.allowedAreas.includes(a) ? f.allowedAreas.filter((x) => x !== a) : SUPPORT_AREAS.filter((x) => x === a || f.allowedAreas.includes(x)) }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Card>
      <CardHeader title="Policy" description="Support access is off until a tenant administrator turns it on. Each request still needs its own approval." />
      <form onSubmit={submit} className="space-y-4 p-5">
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={form.enabled} disabled={!editable} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Allow support access for this tenant
          {policy.enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Longest approval (minutes)" hint="5 to 30 minutes">
            {(p) => (
              <Input
                {...p}
                type="number"
                min={SUPPORT_MIN_DURATION_SECONDS / 60}
                max={SUPPORT_MAX_DURATION_SECONDS / 60}
                value={form.maxDurationSeconds / 60}
                disabled={!editable}
                onChange={(e) => setForm({ ...form, maxDurationSeconds: Math.round(Number(e.target.value) * 60) })}
                required
              />
            )}
          </Field>
        </div>
        <fieldset>
          <legend className="text-[13px] font-medium">Areas support may be shown</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {SUPPORT_AREAS.map((a) => (
              <label key={a} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={form.allowedAreas.includes(a)} disabled={!editable} onChange={() => toggle(a)} />
                {AREA_LABELS[a]}
              </label>
            ))}
          </div>
        </fieldset>
        {editable && (
          <>
            {form.enabled && (
              <Field label="Your password" hint="Confirms this change. Needs a sign-in from the last five minutes with two-factor.">
                {(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
              </Field>
            )}
            {save.error && <SupportError error={save.error} />}
            {done && <Alert tone="success">Policy saved.</Alert>}
            <Button type="submit" loading={save.isPending}>
              Save policy
            </Button>
          </>
        )}
      </form>
    </Card>
  );
}

const blank = { operatorEmail: '', targetMembershipId: '', entityId: '', areas: [] as SupportArea[], minutes: 15, reason: '', password: '' };

function ApproveCard({ tenantId, policy }: { tenantId: string; policy: SupportPolicy }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const canListMembers = ws.canTenant('settings.user.read');
  const members = useQuery({ queryKey: ['members', tenantId, ws.me.user.id], queryFn: () => api<Member[]>('/members', { scope: { tenantId } }), enabled: canListMembers });
  const [form, setForm] = useState(blank);
  const [approved, setApproved] = useState<SupportGrantSummary | null>(null);
  useEffect(() => () => setForm(blank), []);
  const approve = useMutation({
    mutationFn: () =>
      supportControl<SupportGrantSummary>('/grants', {
        method: 'POST',
        tenantId,
        body: { operatorEmail: form.operatorEmail, targetMembershipId: form.targetMembershipId, entityId: form.entityId, areas: form.areas, durationSeconds: form.minutes * 60, reason: form.reason, password: form.password },
      }),
    onMutate: () => setApproved(null),
    onSuccess: (g) => {
      setApproved(g);
      setForm(blank);
      void qc.invalidateQueries({ queryKey: ['support-grants', tenantId] });
    },
    onError: () => setForm((f) => ({ ...f, password: '' })),
  });
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const targets = (members.data ?? []).filter((m) => m.status === 'active' && m.userId !== ws.me.user.id);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    approve.mutate();
  };

  return (
    <Card>
      <CardHeader title="Approve support access" description="The operator must start within 10 minutes. Access ends when the time runs out, or earlier if you revoke it." />
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Operator email" hint="The FactoryOS support person you are working with">
            {(p) => <Input {...p} type="email" autoComplete="off" value={form.operatorEmail} onChange={(e) => set('operatorEmail', e.target.value)} required />}
          </Field>
          <Field label="Show data as" hint={canListMembers ? 'They see what this member can see, never more' : 'Choosing a member needs permission to view users'}>
            {(p) => (
              <Select {...p} value={form.targetMembershipId} onChange={(e) => set('targetMembershipId', e.target.value)} required disabled={!canListMembers}>
                <option value="">Choose a member</option>
                {targets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.email})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Entity">
            {(p) => (
              <Select {...p} value={form.entityId} onChange={(e) => set('entityId', e.target.value)} required>
                <option value="">Choose an entity</option>
                {ws.tenantCtx.entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.shortName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Duration (minutes)" hint={`5 to ${policy.maxDurationSeconds / 60} minutes`}>
            {(p) => <Input {...p} type="number" min={5} max={policy.maxDurationSeconds / 60} value={form.minutes} onChange={(e) => set('minutes', Number(e.target.value))} required />}
          </Field>
        </div>
        <fieldset>
          <legend className="text-[13px] font-medium">Areas</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {policy.allowedAreas.map((a) => (
              <label key={a} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={form.areas.includes(a)} onChange={() => set('areas', form.areas.includes(a) ? form.areas.filter((x) => x !== a) : policy.allowedAreas.filter((x) => x === a || form.areas.includes(x)))} />
                {AREA_LABELS[a]}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Reason" hint="Visible to the operator and kept in the history">
          {(p) => <Input {...p} value={form.reason} onChange={(e) => set('reason', e.target.value)} minLength={3} maxLength={500} required />}
        </Field>
        <Field label="Your password" hint="Needs a sign-in from the last five minutes with two-factor">
          {(p) => <Input {...p} type="password" autoComplete="current-password" value={form.password} onChange={(e) => set('password', e.target.value)} required />}
        </Field>
        {approve.error && <SupportError error={approve.error} />}
        {approved && (
          <Alert tone="success">
            Approved for {approved.operator.email}, as {approved.subject.name}, until they start or {formatDateTime(approved.startBy)}.
          </Alert>
        )}
        <Button type="submit" loading={approve.isPending} disabled={form.areas.length === 0}>
          Approve
        </Button>
      </form>
    </Card>
  );
}

const EVENT_LABELS: Record<SupportHistoryEntry['kind'], string> = {
  approved: 'Approved',
  started: 'Started',
  stopped: 'Stopped',
  revoked: 'Revoked',
  expired: 'Expired',
  invalidated: 'Ended by a change',
  read: 'Viewed',
  denied: 'Refused',
  'policy-changed': 'Policy changed',
};

function History({ tenantId, canRevoke }: { tenantId: string; canRevoke: boolean }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const pages = useInfiniteQuery({
    queryKey: ['support-grants', tenantId, ws.me.user.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => supportControl<SupportGrantPage>(`/grants?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, { tenantId, signal }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => supportControl(`/grants/${id}/revoke`, { method: 'POST', tenantId }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['support-grants', tenantId] }),
  });
  const grants = pages.data?.pages.flatMap((p) => p.grants) ?? [];
  const events = pages.data?.pages.flatMap((p) => p.events) ?? [];
  const people = new Map<string, string>();
  for (const g of grants) for (const i of [g.operator, g.subject, g.approver]) people.set(i.id, i.name);
  const who = (id: string | null) => (id ? (people.get(id) ?? 'Someone') : '—');

  return (
    <Card>
      <CardHeader title="History" description="Every approval, start, view and end. Ended access never comes back; approve again if needed." />
      {pages.error ? (
        <div className="px-5 pb-5">
          <SupportError error={pages.error} />
        </div>
      ) : grants.length === 0 && !pages.isPending ? (
        <EmptyState icon={<ShieldCheck className="size-5" />} title="No support access yet" description="Approvals and their history appear here." />
      ) : (
        <>
          <Table className="min-w-[760px]">
            <thead>
              <tr>
                <Th>Operator</Th>
                <Th>Shown as</Th>
                <Th>Entity and areas</Th>
                <Th>Time</Th>
                <Th>State</Th>
                <Th className="w-0" />
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <Tr key={g.id}>
                  <Td>
                    <p className="font-medium">{g.operator.name}</p>
                    <p className="text-[12px] text-muted">{g.operator.email}</p>
                  </Td>
                  <Td>
                    <p>{g.subject.name}</p>
                    <p className="text-[12px] text-muted">approved by {g.approver.name}</p>
                  </Td>
                  <Td>
                    <p>{g.entityName}</p>
                    <p className="text-[12px] text-muted">{g.areas.map((a) => AREA_LABELS[a]).join(', ')}</p>
                    <p className="text-[12px] text-muted">“{g.reason}”</p>
                  </Td>
                  <Td className="text-[12px] whitespace-nowrap">
                    <p>Approved {formatDateTime(g.approvedAt)}</p>
                    <p>{g.startedAt ? `Started ${formatDateTime(g.startedAt)}` : `Start by ${formatDateTime(g.startBy)}`}</p>
                    {g.expiresAt && <p>Ends {formatDateTime(g.expiresAt)}</p>}
                    <p className="text-muted">{minutes(g.durationSeconds)}</p>
                  </Td>
                  <Td>
                    <Badge tone={STATE_TONE[g.state]}>{g.state[0]!.toUpperCase() + g.state.slice(1)}</Badge>
                  </Td>
                  <Td>
                    {canRevoke && (g.state === 'approved' || g.state === 'active') && (
                      <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === g.id} onClick={() => revoke.mutate(g.id)}>
                        Revoke
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {revoke.error && (
            <div className="px-5 pt-3">
              <SupportError error={revoke.error} />
            </div>
          )}
          {events.length > 0 && (
            <div className="px-5 py-4">
              <h3 className="mb-2 text-[13px] font-semibold">Activity</h3>
              <ul className="space-y-1 text-[12px]">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-wrap gap-x-3">
                    <span className="text-muted">{formatDateTime(e.occurredAt)}</span>
                    <span className="font-medium">{EVENT_LABELS[e.kind]}</span>
                    {e.area && <span>{AREA_LABELS[e.area]}</span>}
                    {e.actorUserId && <span>by {who(e.actorUserId)}</span>}
                    {e.operatorUserId && e.operatorUserId !== e.actorUserId && <span>operator {who(e.operatorUserId)}</span>}
                    {e.subjectUserId && <span>shown as {who(e.subjectUserId)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pages.hasNextPage && (
            <div className="px-5 pb-5">
              <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => pages.fetchNextPage()} disabled={pages.isFetchingNextPage}>
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
