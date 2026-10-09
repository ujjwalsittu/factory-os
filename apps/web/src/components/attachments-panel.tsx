'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip } from 'lucide-react';
import { useRef, useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { type Attachment, ATTACHMENT_KIND } from '@/lib/quality';

type OwnerType = 'batch' | 'inspection_record' | 'quality_inspection' | 'fai' | 'ncr' | 'gauge' | 'calibration_event' | 'job_work_receipt';

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Certificates and files on a document (decision 048): upload, download, withdraw with a reason. */
export function AttachmentsPanel({ ownerType, ownerId, defaultKind = 'other', title = 'Certificates and files' }: { ownerType: OwnerType; ownerId: string; defaultKind?: Attachment['kind']; title?: string }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Attachment['kind']>(defaultKind);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<Attachment | null>(null);
  const q = useQuery({ queryKey: ['attachments', ws.entityId, ownerType, ownerId], queryFn: () => api<{ storage: boolean; rows: Attachment[] }>(`/attachments?ownerType=${ownerType}&ownerId=${ownerId}`, { scope: ws.scope }) });
  const headers = () => ({ ...(ws.tenantId ? { 'x-tenant-id': ws.tenantId } : {}), ...(ws.entityId ? { 'x-entity-id': ws.entityId } : {}) });
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const res = await fetch(`/api/attachments?${new URLSearchParams({ ownerType, ownerId, kind, fileName: f.name })}`, { method: 'POST', headers: { ...headers(), 'Content-Type': f.type || 'application/octet-stream' }, body: f, credentials: 'include' });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Upload failed (${res.status})`);
    },
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['attachments', ws.entityId, ownerType, ownerId] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const download = async (a: Attachment) => {
    setError(null);
    const res = await fetch(`/api/attachments/${a.id}/download`, { headers: headers(), credentials: 'include' });
    if (!res.ok) return setError(`Download failed (${res.status})`);
    if (res.headers.get('content-type')?.includes('application/json')) {
      window.location.href = ((await res.json()) as { url: string }).url;
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await res.blob());
    link.download = a.fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const can = ws.can('quality.attachment.create');
  return (
    <Card>
      <CardHeader
        title={title}
        description="PDF, images, CSV, XML, XLSX or ZIP up to 25 MB. Files are kept; a wrong one is withdrawn with a reason."
        actions={
          can &&
          q.data?.storage && (
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="File kind" value={kind} onChange={(e) => setKind(e.target.value as Attachment['kind'])}>
                {Object.entries(ATTACHMENT_KIND).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
              <input
                ref={file}
                type="file"
                aria-label="Attach file"
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xml,.xlsx,.zip"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                  e.target.value = '';
                }}
              />
              <Button size="sm" variant="secondary" loading={upload.isPending} onClick={() => file.current?.click()}>
                <Paperclip className="size-4" /> Attach
              </Button>
            </div>
          )
        }
      />
      {q.data && !q.data.storage && <Alert className="m-4">File storage is not set up for this environment yet. Ask an administrator to configure Cloudflare R2.</Alert>}
      {error && <Alert tone="danger" className="m-4">{error}</Alert>}
      {q.data?.rows.length === 0 ? (
        <p className="p-4 text-[13px] text-muted">No files yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {q.data?.rows.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-center gap-2 px-4 py-2 text-[13px] ${a.withdrawnAt ? 'opacity-60' : ''}`}>
              <Badge tone="neutral">{ATTACHMENT_KIND[a.kind]}</Badge>
              <span className={a.withdrawnAt ? 'line-through' : 'font-medium'}>{a.fileName}</span>
              <span className="text-subtle">
                {size(a.size)} · {formatDateTime(a.createdAt)}
              </span>
              {a.withdrawnAt && <span className="text-subtle">withdrawn: {a.withdrawReason}</span>}
              {!a.withdrawnAt && (
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Download ${a.fileName}`} onClick={() => void download(a)}>
                    <Download className="size-4" />
                  </Button>
                  {ws.can('quality.attachment.cancel') && (
                    <Button size="sm" variant="ghost" onClick={() => setWithdrawing(a)}>
                      Withdraw…
                    </Button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {withdrawing && <Withdraw a={withdrawing} onDone={() => void qc.invalidateQueries({ queryKey: ['attachments', ws.entityId, ownerType, ownerId] })} onClose={() => setWithdrawing(null)} />}
    </Card>
  );
}

function Withdraw({ a, onDone, onClose }: { a: Attachment; onDone: () => void; onClose: () => void }) {
  const ws = useWorkspace();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/attachments/${a.id}/withdraw`, { method: 'POST', scope: ws.scope, body: { reason } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <FormDialog title={`Withdraw ${a.fileName}`} description="The file stays on record but can no longer be downloaded or packed." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Withdraw">
      <Field label="Reason" error={fieldErrors(m.error).reason}>
        {(f) => <Input {...f} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
