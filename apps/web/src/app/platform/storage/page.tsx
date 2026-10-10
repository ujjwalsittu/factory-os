'use client';
// Platform → Storage (decision 051): the deployment's Cloudflare R2 bucket for certificates and attachments.
import { Alert, Badge, Button, Card, Field, Input, PageHeader, buttonClass } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { useMe } from '@/components/workspace';
import { ApiError, api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { formatDateTime } from '@/lib/format';

interface StorageView {
  source: 'env' | 'saved';
  envDriver: string | null;
  keyConfigured: boolean;
  saved: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretSet: boolean; updatedAt: string; updatedBy: string | null } | null;
  active: { kind: 's3' | 'local' | 'disabled'; reason: string | null; bucket: string | null };
}

const empty = { endpoint: '', region: 'auto', bucket: '', accessKeyId: '', secretAccessKey: '' };

export default function PlatformStoragePage() {
  const me = useMe();
  const session = authClient.useSession();
  const userId = session.data?.user.id;
  const allowed = !!userId && me.data?.user.id === userId && me.data.platformAdmin === 'superadmin';
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ['platform-storage', userId], queryFn: () => api<StorageView>('/platform/storage'), enabled: allowed });
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    const s = view.data?.saved;
    if (s) setForm({ endpoint: s.endpoint, region: s.region, bucket: s.bucket, accessKeyId: s.accessKeyId, secretAccessKey: '' });
  }, [view.data?.saved]);

  const body = () => ({ ...form, secretAccessKey: form.secretAccessKey || undefined });
  const onError = (e: unknown) => {
    setErrors(e instanceof ApiError ? e.fieldErrors : {});
    setResult({ tone: 'danger', text: e instanceof Error ? e.message : 'Something went wrong' });
  };
  const test = useMutation({
    mutationFn: () => api<{ ok: true; ms: number }>('/platform/storage/test', { method: 'POST', body: body() }),
    onMutate: () => (setErrors({}), setResult(null)),
    onSuccess: (r) => setResult({ tone: 'success', text: `Connection works: a test file was written, read back and deleted in ${r.ms} ms.` }),
    onError,
  });
  const save = useMutation({
    mutationFn: () => api<StorageView>('/platform/storage', { method: 'PUT', body: body() }),
    onMutate: () => (setErrors({}), setResult(null)),
    onSuccess: (v) => {
      qc.setQueryData(['platform-storage', userId], v);
      setForm((f) => ({ ...f, secretAccessKey: '' }));
      setResult({ tone: 'success', text: 'Saved. Uploads now go to this bucket.' });
    },
    onError,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const v = view.data;
  const busy = test.isPending || save.isPending;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="Storage" description="Where certificates, reports and other attachments are kept: one Cloudflare R2 bucket for the whole installation." />
      <Link className={buttonClass('secondary', 'sm', 'mb-5')} href="/platform">
        Back to platform
      </Link>
      {!allowed ? (
        <Alert tone="danger">{me.isLoading || session.isPending ? 'Loading access…' : 'Platform administrators only'}</Alert>
      ) : view.error ? (
        <Alert tone="danger">Could not load storage settings.</Alert>
      ) : !v ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="space-y-5">
          <Card className="space-y-2 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Status</span>
              {v.active.kind === 'disabled' ? <Badge tone="danger">Off</Badge> : <Badge tone="success">On</Badge>}
              {v.active.kind === 's3' && <span className="text-muted">bucket {v.active.bucket}</span>}
              {v.active.kind === 'local' && <span className="text-muted">local folder (development only)</span>}
            </div>
            {v.active.reason && <p className="text-[13px] text-muted">Uploads are refused: {v.active.reason}.</p>}
            {v.source === 'env' && (
              <Alert tone="warning">
                STORAGE_DRIVER={v.envDriver} is set in the deployment environment, so it overrides the settings below. Remove it in Coolify to use them.
              </Alert>
            )}
            {!v.keyConfigured && (
              <Alert tone="warning">
                Set STORAGE_CREDENTIAL_KEY_V1 in the deployment environment (base64 of 32 random bytes, e.g. <code>openssl rand -base64 32</code>) before saving. It encrypts the secret below.
              </Alert>
            )}
            {v.saved && (
              <p className="text-[13px] text-muted">
                Last saved {formatDateTime(v.saved.updatedAt)}
                {v.saved.updatedBy ? ` by ${v.saved.updatedBy}` : ''}.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <form className="space-y-4" onSubmit={submit}>
              <Field label="Endpoint" hint="https://<account id>.r2.cloudflarestorage.com" error={errors.endpoint}>
                {(p) => <Input {...p} value={form.endpoint} onChange={set('endpoint')} placeholder="https://…r2.cloudflarestorage.com" required />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Bucket" error={errors.bucket}>
                  {(p) => <Input {...p} value={form.bucket} onChange={set('bucket')} required />}
                </Field>
                <Field label="Region" hint="auto for R2" error={errors.region}>
                  {(p) => <Input {...p} value={form.region} onChange={set('region')} required />}
                </Field>
              </div>
              <Field label="Access key ID" hint="From an R2 API token with Object Read & Write on this bucket" error={errors.accessKeyId}>
                {(p) => <Input {...p} value={form.accessKeyId} onChange={set('accessKeyId')} autoComplete="off" required />}
              </Field>
              <Field
                label="Secret access key"
                hint={v.saved ? 'Leave blank to keep the saved secret. It is never shown again.' : 'Stored encrypted and never shown again.'}
                error={errors.secretAccessKey}
              >
                {(p) => <Input {...p} type="password" value={form.secretAccessKey} onChange={set('secretAccessKey')} autoComplete="new-password" required={!v.saved} />}
              </Field>
              {result && <Alert tone={result.tone}>{result.text}</Alert>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => test.mutate()} disabled={busy}>
                  {test.isPending ? 'Testing…' : 'Test connection'}
                </Button>
                <Button type="submit" disabled={busy || !v.keyConfigured}>
                  {save.isPending ? 'Testing and saving…' : 'Save'}
                </Button>
              </div>
              <p className="text-[12px] text-muted">Saving tests the bucket first: a small file is written, read back and deleted. Every change is recorded in the platform audit log.</p>
            </form>
          </Card>
        </div>
      )}
    </main>
  );
}
