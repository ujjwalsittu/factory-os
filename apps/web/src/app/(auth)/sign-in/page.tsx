'use client';
import { Alert, Button, Field, Input } from '@factoryos/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import {safeNextPath} from '@/lib/safe-next';
import {ProviderButtons} from '@/components/sso/provider-buttons';

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/app';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (res.error) return setError(res.error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'Email or password is incorrect.');
    // When two-factor is on, the client plugin redirects to /sign-in/two-factor instead.
    if (!(res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) router.replace(safeNextPath(next));
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Welcome back. Use your work email.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email">{(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}</Field>
        <Field label="Password">{(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      <ProviderButtons next={next}/>
      <p className="mt-6 text-center text-[13px] text-muted">
        New to FactoryOS?{' '}
        <Link href={`/sign-up${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
      <p className="mt-2 text-center text-[12px] text-subtle"><Link href="/forgot-password" className="text-accent hover:underline">Forgot your password?</Link></p>
    </>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
