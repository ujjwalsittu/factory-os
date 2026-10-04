'use client';
import { Alert, Badge, Button, buttonClass, Card, cn, EmptyState, Field, Input, Logo, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building, Copy, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { FullPageLoading } from '@/components/loading';
import { ThemeToggle } from '@/components/theme';
import { useMe } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import type { AuditEvent } from '@/lib/types';

interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  plan: string;
  members: number;
  entities: number;
  createdAt: string;
}
interface PlatformAdmin {
  userId: string;
  level: string;
  name: string;
  email: string;
  createdAt: string;
}

const TABS = ['Tenants', 'Platform admins', 'Audit log'] as const;

export default function PlatformPage() {
  const me = useMe();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Tenants');
  if (me.isLoading) return <FullPageLoading label="Loading platform console…" />;
  if (me.data?.platformAdmin !== 'superadmin') {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <Card className="max-w-md p-8">
          <Alert tone="danger" title="Platform administrators only">
            This console manages all tenants on this FactoryOS installation.
          </Alert>
          <Link href="/app" className={buttonClass('secondary', 'md', 'mt-4')}>
            Back to the app
          </Link>
        </Card>
      </div>
    );
  }
  return (
    <div className="min-h-dvh">
      <header className="flex h-14 items-center gap-3 border-b border-line bg-surface px-4 md:px-8">
        <Logo />
        <Badge tone="danger">
          <ShieldCheck className="size-3" /> Platform
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          {me.data.tenants.length > 0 && (
            <Link href="/app" className={buttonClass('ghost', 'sm')}>
              <ArrowLeft className="size-3.5" /> Back to app
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        <PageHeader title="Platform console" description="Tenants, plans and platform administrators. Every action here is audited." />
        <Overview />
        <div className="mt-8 mb-4 flex gap-1 border-b border-line" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn('-mb-px border-b-2 px-4 py-2 text-[13px] font-medium', tab === t ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg')}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'Tenants' && <Tenants />}
        {tab === 'Platform admins' && <Admins selfId={me.data.user.id} />}
        {tab === 'Audit log' && <PlatformAudit />}
      </main>
    </div>
  );
}

function Overview() {
  const q = useQuery({ queryKey: ['platform', 'overview'], queryFn: () => api<{ tenants: number; users: number; entities: number }>('/platform/overview') });
  const stats = [
    ['Tenants', q.data?.tenants],
    ['Users', q.data?.users],
    ['Legal entities', q.data?.entities],
  ] as const;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {stats.map(([label, n]) => (
        <Card key={label} className="px-5 py-4">
          <p className="text-[13px] text-muted">{label}</p>
          <p className="tabular mt-1 text-2xl font-semibold">{n ?? '—'}</p>
        </Card>
      ))}
    </div>
  );
}

function Tenants() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'tenants'], queryFn: () => api<PlatformTenant[]>('/platform/tenants') });
  const [creating, setCreating] = useState(false);
  const [statusFor, setStatusFor] = useState<PlatformTenant | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  return (
    <>
      {inviteUrl && (
        <Alert tone="success" title="Tenant created" className="mb-4">
          Send the owner this invitation link:
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 font-mono text-[12px] text-fg">{inviteUrl}</code>
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(inviteUrl)}>
              <Copy className="size-3.5" /> Copy
            </Button>
          </div>
        </Alert>
      )}
      <Card>
        <div className="flex justify-end border-b border-line px-5 py-3">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" /> New tenant
          </Button>
        </div>
        {q.data?.length === 0 ? (
          <EmptyState icon={<Building className="size-5" />} title="No tenants yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Tenant</Th>
                <Th>Plan</Th>
                <Th className="text-right">Users</Th>
                <Th className="text-right">Entities</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th className="w-0" />
              </tr>
            </thead>
            <tbody>
              {q.data?.map((t) => (
                <Tr key={t.id}>
                  <Td>
                    <p className="font-medium">{t.name}</p>
                    <p className="font-mono text-[12px] text-subtle">{t.slug}</p>
                  </Td>
                  <Td><Badge>{t.plan}</Badge></Td>
                  <Td className="tabular text-right">{t.members}</Td>
                  <Td className="tabular text-right">{t.entities}</Td>
                  <Td>
                    <Badge tone={t.status === 'active' ? 'success' : 'danger'} dot>
                      {t.status === 'active' ? 'Active' : 'Suspended'}
                    </Badge>
                  </Td>
                  <Td className="text-[13px] text-muted">{formatDate(t.createdAt)}</Td>
                  <Td>
                    <Button size="sm" variant="ghost" onClick={() => setStatusFor(t)}>
                      {t.status === 'active' ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-[12px] text-subtle">Impersonation (time-boxed, reason required, fully audited) is planned. See docs/15 §4.</p>
      {creating && (
        <CreateTenantDialog
          onClose={() => setCreating(false)}
          onCreated={(url) => {
            setInviteUrl(url);
            setCreating(false);
            void qc.invalidateQueries({ queryKey: ['platform'] });
          }}
        />
      )}
      {statusFor && <StatusDialog tenant={statusFor} onClose={() => setStatusFor(null)} />}
    </>
  );
}

function CreateTenantDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (url: string) => void }) {
  const [f, setF] = useState({ name: '', ownerEmail: '' });
  const m = useMutation({
    mutationFn: () => api<{ ownerInviteUrl: string }>('/platform/tenants', { method: 'POST', body: f }),
    onSuccess: (r) => onCreated(r.ownerInviteUrl),
  });
  const e = fieldErrors(m.error);
  return (
    <FormDialog title="New tenant" description="Creates the tenant with system roles and invites its first owner." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Create tenant">
      <Field label="Tenant name" error={e.name}>{(p) => <Input {...p} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} required autoFocus />}</Field>
      <Field label="Owner email" error={e.ownerEmail}>{(p) => <Input {...p} type="email" value={f.ownerEmail} onChange={(ev) => setF({ ...f, ownerEmail: ev.target.value })} required />}</Field>
    </FormDialog>
  );
}

function StatusDialog({ tenant, onClose }: { tenant: PlatformTenant; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const next = tenant.status === 'active' ? 'suspended' : 'active';
  const m = useMutation({
    mutationFn: () => api(`/platform/tenants/${tenant.id}`, { method: 'PATCH', body: { status: next, reason } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform'] });
      onClose();
    },
  });
  return (
    <FormDialog
      title={`${next === 'suspended' ? 'Suspend' : 'Reactivate'} ${tenant.name}`}
      description={next === 'suspended' ? 'Members lose access immediately. Data is kept.' : 'Members regain access.'}
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel={next === 'suspended' ? 'Suspend tenant' : 'Reactivate'}
    >
      <Field label="Reason (recorded in both audit logs)" error={fieldErrors(m.error).reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required autoFocus />}
      </Field>
    </FormDialog>
  );
}

function Admins({ selfId }: { selfId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'admins'], queryFn: () => api<PlatformAdmin[]>('/platform/admins') });
  const [email, setEmail] = useState('');
  const add = useMutation({
    mutationFn: () => api('/platform/admins', { method: 'POST', body: { email } }),
    onSuccess: () => {
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['platform', 'admins'] });
    },
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api(`/platform/admins/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'admins'] }),
  });
  return (
    <Card>
      <form
        className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Grant SuperAdmin to (existing user's email)" className="min-w-72 flex-1">
          {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        </Field>
        <Button type="submit" loading={add.isPending}>Grant</Button>
      </form>
      {(add.error || remove.error) && <Alert tone="danger" className="m-4">{(add.error ?? remove.error)!.message}</Alert>}
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Level</Th>
            <Th>Since</Th>
            <Th className="w-0" />
          </tr>
        </thead>
        <tbody>
          {q.data?.map((a) => (
            <Tr key={a.userId}>
              <Td>
                <p className="font-medium">{a.name}</p>
                <p className="text-[12px] text-muted">{a.email}</p>
              </Td>
              <Td><Badge tone="danger">{a.level}</Badge></Td>
              <Td className="text-[13px] text-muted">{formatDate(a.createdAt)}</Td>
              <Td>
                {a.userId !== selfId && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(a.userId)} aria-label={`Revoke ${a.email}`}>
                    <Trash2 className="size-3.5" /> Revoke
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function PlatformAudit() {
  const q = useQuery({ queryKey: ['platform', 'audit'], queryFn: () => api<AuditEvent[]>('/platform/audit') });
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>When (IST)</Th>
            <Th>Action</Th>
            <Th>Target</Th>
            <Th>Reason</Th>
          </tr>
        </thead>
        <tbody>
          {q.data?.map((e) => (
            <Tr key={e.seq}>
              <Td className="font-mono text-[12px] text-subtle">{e.seq}</Td>
              <Td className="text-[13px] whitespace-nowrap">{formatDateTime(e.occurredAt)}</Td>
              <Td><code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px]">{e.action}</code></Td>
              <Td className="text-[13px] text-muted">{e.targetType}</Td>
              <Td className="text-[13px] text-muted">{e.reason ?? '—'}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {q.data?.length === 0 && <EmptyState title="No platform events yet" />}
    </Card>
  );
}
