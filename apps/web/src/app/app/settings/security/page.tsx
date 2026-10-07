'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader } from '@factoryos/ui';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { type FormEvent, useState } from 'react';
import { useWorkspace } from '@/components/workspace';
import { authClient } from '@/lib/auth-client';
import {VerificationCard} from '@/components/email/verification-card';
import {ConnectionCard} from '@/components/sso/connection-card';

type Step = { kind: 'idle' } | { kind: 'scan'; qr: string; secret: string; backupCodes: string[] } | { kind: 'done'; backupCodes: string[] };

export default function SecurityPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const session = authClient.useSession();
  const enabled = !!(session.data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled;
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (res.error || !res.data) return setError(res.error?.message ?? 'Could not start setup');
    if (res.data.method !== 'totp') return setError('Authenticator-app setup is not available');
    const qr = await QRCode.toDataURL(res.data.totpURI, { margin: 1, width: 200 });
    const secret = new URL(res.data.totpURI).searchParams.get('secret') ?? '';
    setStep({ kind: 'scan', qr, secret, backupCodes: res.data.backupCodes });
    setPassword('');
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (step.kind !== 'scan') return;
    setBusy(true);
    setError(null);
    const res = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') });
    setBusy(false);
    if (res.error) return setError(res.error.message ?? 'That code did not match. Check the time on your phone and try again.');
    setStep({ kind: 'done', backupCodes: step.backupCodes });
    await session.refetch();
    void qc.invalidateQueries({ queryKey: ['members'] });
  };

  const disable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (res.error) return setError(res.error.message ?? 'Could not turn off two-factor');
    setPassword('');
    await session.refetch();
    void qc.invalidateQueries({ queryKey: ['members'] });
  };

  return (
    <>
      <PageHeader title="My security" description={session.data?.user.email?`Signed in as ${session.data.user.email}`:'Loading account…'} />
      {session.data?.user&&<VerificationCard key={session.data.user.id} user={session.data.user} refresh={session.refetch}/>}
      {session.data?.user&&<ConnectionCard key={session.data.user.id+':'+session.data.session.id} user={session.data.user} sessionId={session.data.session.id}/>}
      <Card className="max-w-2xl">
        <CardHeader
          title="Two-factor authentication"
          description="A 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) at every sign-in."
          actions={enabled ? <Badge tone="success" dot>On</Badge> : <Badge tone="warning" dot>Off</Badge>}
        />
        <div className="space-y-4 px-5 py-5">
          {error && <Alert tone="danger">{error}</Alert>}

          {step.kind === 'idle' && !enabled && (
            <form onSubmit={start} className="flex flex-wrap items-end gap-3">
              <Field label="Confirm your password" className="min-w-64 flex-1">
                {(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
              </Field>
              <Button type="submit" loading={busy}>
                <ShieldCheck className="size-4" /> Set up two-factor
              </Button>
            </form>
          )}

          {step.kind === 'scan' && (
            <div className="grid gap-6 sm:grid-cols-[200px_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={step.qr} alt="QR code for your authenticator app" className="rounded-lg border border-line bg-white" width={200} height={200} />
              <form onSubmit={verify} className="space-y-3">
                <p className="text-[13px]">1. Scan the QR code with your authenticator app, or enter this key:</p>
                <code className="block rounded bg-surface-2 px-2 py-1 font-mono text-[12px] break-all">{step.secret}</code>
                <Field label="2. Enter the 6-digit code">
                  {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" className="w-40 font-mono tracking-widest" required />}
                </Field>
                <Button type="submit" loading={busy}>Verify and turn on</Button>
              </form>
            </div>
          )}

          {step.kind === 'done' && (
            <Alert tone="success" title="Two-factor is on">
              Save these backup codes somewhere safe. Each works once if you lose your phone.
              <div className="mt-3 grid grid-cols-2 gap-1 font-mono text-[13px] text-fg sm:grid-cols-5">
                {step.backupCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            </Alert>
          )}

          {enabled && step.kind !== 'done' && (
            <form onSubmit={disable} className="flex flex-wrap items-end gap-3">
              <Field label="Password (to turn off)" className="min-w-64 flex-1">
                {(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
              </Field>
              <Button type="submit" variant="secondary" loading={busy}>
                <KeyRound className="size-4" /> Turn off
              </Button>
            </form>
          )}
        </div>
      </Card>
    </>
  );
}
