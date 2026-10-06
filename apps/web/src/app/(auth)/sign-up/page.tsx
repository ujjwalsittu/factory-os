'use client';
import { Alert, Button, Field, Input } from '@factoryos/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import {safeNextPath} from '@/lib/safe-next';

function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const [f, setF] = useState({ name: '', email: params.get('email') ?? '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await authClient.signUp.email(f);
    setBusy(false);
    if (res.error) return setError(res.error.message ?? 'Could not create your account');
    router.replace(safeNextPath(next,'/onboarding'));
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-muted">Joining a team? Use the email your invitation was sent to.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Full name">{(p) => <Input {...p} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />}</Field>
        <Field label="Work email">{(p) => <Input {...p} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />}</Field>
        <Field label="Password" hint="At least 10 characters">
          {(p) => <Input {...p} type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-muted">
        Already have an account?{' '}
        <Link href={`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
