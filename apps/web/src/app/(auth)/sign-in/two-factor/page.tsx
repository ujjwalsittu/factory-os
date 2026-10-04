'use client';
import { Alert, Button, Field, Input } from '@factoryos/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { authClient } from '@/lib/auth-client';

function TwoFactorForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/app';
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const clean = code.replace(/\s/g, '');
    const res =
      mode === 'totp'
        ? await authClient.twoFactor.verifyTotp({ code: clean, trustDevice: trust })
        : await authClient.twoFactor.verifyBackupCode({ code: clean, trustDevice: trust });
    setBusy(false);
    if (res.error) return setError(mode === 'totp' ? 'That code did not match. Codes change every 30 seconds.' : 'That backup code is not valid or was already used.');
    router.replace(next.startsWith('/') ? next : '/app');
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Two-factor verification</h1>
      <p className="mt-1 text-sm text-muted">
        {mode === 'totp' ? 'Enter the 6-digit code from your authenticator app.' : 'Enter one of your backup codes.'}
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={mode === 'totp' ? 'Authentication code' : 'Backup code'}>
          {(p) => (
            <Input
              {...p}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode={mode === 'totp' ? 'numeric' : 'text'}
              autoComplete="one-time-code"
              className="h-11 text-center font-mono text-lg tracking-[0.4em]"
              autoFocus
              required
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
          Trust this device for 30 days
        </label>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Verify
        </Button>
      </form>
      <Button variant="link" size="sm" className="mt-4" onClick={() => (setMode(mode === 'totp' ? 'backup' : 'totp'), setCode(''), setError(null))}>
        {mode === 'totp' ? 'Use a backup code instead' : 'Use your authenticator app'}
      </Button>
    </>
  );
}

export default function TwoFactorPage() {
  return (
    <Suspense>
      <TwoFactorForm />
    </Suspense>
  );
}
