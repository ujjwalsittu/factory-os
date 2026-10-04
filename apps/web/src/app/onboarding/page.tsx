'use client';
import { Alert, Button, buttonClass, Card, Field, Input, Logo } from '@factoryos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fieldErrors } from '@/components/form-dialog';
import { FullPageLoading } from '@/components/loading';
import { useMe } from '@/components/workspace';
import { api, ApiError } from '@/lib/api';

export default function OnboardingPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const [f, setF] = useState({ name: '', legalName: '', shortName: '', code: '', pan: '' });
  const m = useMutation({
    mutationFn: () =>
      api<{ tenant: { id: string } }>('/tenants', {
        method: 'POST',
        body: { name: f.name, entity: { legalName: f.legalName, shortName: f.shortName, code: f.code, pan: f.pan || undefined } },
      }),
    onSuccess: async ({ tenant }) => {
      try {
        localStorage.setItem('fos.tenant', tenant.id);
      } catch {}
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/app');
    },
  });
  const e = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });

  if (me.isLoading) return <FullPageLoading />;
  if (me.error instanceof ApiError && me.error.status === 401) {
    router.replace('/sign-in?next=/onboarding');
    return <FullPageLoading />;
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-xl p-8">
        <Logo />
        {me.data && !me.data.canCreateTenant ? (
          <>
            <h1 className="mt-6 text-xl font-semibold">You're not part of a workspace yet</h1>
            <p className="mt-2 text-sm text-muted">Ask your administrator to invite {me.data.user.email}, then open the link in the invitation.</p>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-xl font-semibold">Set up your workspace</h1>
            <p className="mt-1 text-sm text-muted">Start with your company group and its main legal entity. You can add subsidiaries, GSTINs and plants next.</p>
            {me.data && me.data.tenants.length > 0 && (
              <Alert tone="info" className="mt-4">
                You already belong to {me.data.tenants.map((t) => t.name).join(', ')}.{' '}
                <Link href="/app" className="font-medium underline">
                  Go to the app
                </Link>
              </Alert>
            )}
            <form
              className="mt-6 space-y-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                m.mutate();
              }}
            >
              {m.error instanceof ApiError && !m.error.issues.length && <Alert tone="danger">{m.error.message}</Alert>}
              <Field label="Workspace (company group) name" hint="e.g. Azeonics Group" error={e.name}>
                {(p) => <Input {...p} value={f.name} onChange={set('name')} required autoFocus />}
              </Field>
              <div className="rounded-xl border border-line p-4">
                <p className="mb-3 text-[13px] font-medium">Main legal entity</p>
                <div className="space-y-4">
                  <Field label="Legal name" error={e['entity.legalName']}>{(p) => <Input {...p} value={f.legalName} onChange={set('legalName')} placeholder="Azeonics Private Limited" required />}</Field>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Short name" error={e['entity.shortName']}>{(p) => <Input {...p} value={f.shortName} onChange={set('shortName')} placeholder="Azeonics" required />}</Field>
                    <Field label="Code" error={e['entity.code']}>{(p) => <Input {...p} value={f.code} onChange={set('code')} placeholder="AZ" className="font-mono uppercase" required />}</Field>
                    <Field label="PAN" error={e['entity.pan']}>{(p) => <Input {...p} value={f.pan} onChange={set('pan')} className="font-mono uppercase" />}</Field>
                  </div>
                </div>
              </div>
              <Button type="submit" size="lg" className="w-full" loading={m.isPending}>
                Create workspace
              </Button>
              {me.data?.platformAdmin && (
                <Link href="/platform" className={buttonClass('link', 'sm', 'w-full')}>
                  Or open the platform console
                </Link>
              )}
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
