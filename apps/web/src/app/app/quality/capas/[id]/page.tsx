'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, DateInput } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { CAPA_ACTION_KIND, CAPA_SOURCE, CAPA_STATUS, type CapaAction, type CapaDetail, type CapaPerson, NCR_STATUS, type NcrRow } from '@/lib/quality';

type Dialog = { kind: 'analysis' } | { kind: 'action'; action?: CapaAction } | { kind: 'done'; action: CapaAction } | { kind: 'cancel-action'; action: CapaAction } | { kind: 'link' } | { kind: 'verify' } | { kind: 'cancel' };

export default function CapaPage() {
  return (
    <EntityGate what="quality">
      <View />
    </EntityGate>
  );
}

function useRefresh(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['capa', id] });
    void qc.invalidateQueries({ queryKey: ['capas'] });
  };
}

function View() {
  const ws = useWorkspace();
  const { id } = useParams<{ id: string }>();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const q = useQuery({ queryKey: ['capa', id, ws.entityId], queryFn: () => api<CapaDetail>(`/quality/capas/${id}`, { scope: ws.scope }) });
  const refresh = useRefresh(id);
  const step = useMutation({ mutationFn: (to: 'start' | 'submit') => api(`/quality/capas/${id}/${to}`, { method: 'POST', scope: ws.scope, body: {} }), onSuccess: refresh });
  const unlink = useMutation({ mutationFn: (ncrId: string) => api(`/quality/capas/${id}/ncrs/${ncrId}`, { method: 'DELETE', scope: ws.scope }), onSuccess: refresh });
  const c = q.data;
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!c) return <p className="text-muted">Loading…</p>;
  const editable = (c.status === 'open' || c.status === 'in_action') && ws.can('quality.capa.update');
  const major = c.severity === 'major';
  const isOwner = c.ownerUserId === ws.me.user.id;
  const close = () => setDialog(null);
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.number}
            <Badge tone={CAPA_STATUS[c.status].tone}>{CAPA_STATUS[c.status].label}</Badge>
            {major && <Badge tone="danger">Major · 8D</Badge>}
          </span>
        }
        description={`${c.title} · ${CAPA_SOURCE[c.source]} · owner ${c.ownerName} · check ${c.verifyAfterDays} days after the actions`}
        actions={
          <div className="flex flex-wrap gap-2">
            {c.status === 'open' && ws.can('quality.capa.update') && (
              <Button loading={step.isPending} onClick={() => step.mutate('start')}>
                Start actions
              </Button>
            )}
            {c.status === 'in_action' && ws.can('quality.capa.update') && (
              <Button loading={step.isPending} onClick={() => step.mutate('submit')}>
                Submit for verification
              </Button>
            )}
            {c.status === 'verifying' && ws.can('quality.capa.approve') && !isOwner && (
              <Button disabled={!c.verificationDue} onClick={() => setDialog({ kind: 'verify' })}>
                Check effectiveness
              </Button>
            )}
            {(c.status === 'open' || c.status === 'in_action') && ws.can('quality.capa.cancel') && (
              <Button variant="ghost" onClick={() => setDialog({ kind: 'cancel' })}>
                Cancel
              </Button>
            )}
          </div>
        }
      />
      {step.error && <Alert tone="danger" className="mb-4">{step.error.message}</Alert>}
      {unlink.error && <Alert tone="danger" className="mb-4">{unlink.error.message}</Alert>}
      {c.status === 'verifying' && c.verifyDueOn && (
        <Alert tone="info" className="mb-4">
          {c.verificationDue
            ? `The effectiveness check is due (since ${formatDate(c.verifyDueOn)}).${isOwner ? ' Someone other than you records it.' : ''}`
            : `All actions are done. The effectiveness check falls due on ${formatDate(c.verifyDueOn)}; someone other than the owner records it.`}
        </Alert>
      )}
      {c.cancelReason && <Alert tone="warning" className="mb-4">Cancelled: {c.cancelReason}</Alert>}

      <Card className="mb-4">
        <CardHeader
          title="Problem (D2)"
          actions={
            editable && (
              <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'link' })}>
                Link NCR
              </Button>
            )
          }
        />
        <div className="space-y-3 px-5 py-4 text-[13px]">
          <p className="whitespace-pre-line">{c.problem}</p>
          {c.ncrs.length > 0 && (
            <ul className="divide-y divide-line rounded-md border border-line">
              {c.ncrs.map((n) => (
                <li key={n.id} className="flex items-start gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <Link className="font-mono font-medium hover:text-accent" href={`/app/quality/ncrs/${n.id}`}>
                      {n.number}
                    </Link>{' '}
                    <Badge tone={NCR_STATUS[n.status].tone}>{NCR_STATUS[n.status].label}</Badge>
                    <p className="text-muted">
                      <span className="font-mono">{n.itemCode}</span> {n.itemName} · {n.description}
                    </p>
                  </div>
                  {editable && (c.source !== 'ncr' || c.ncrs.length > 1) && (
                    <Button size="sm" variant="ghost" aria-label={`Unlink ${n.number}`} loading={unlink.isPending && unlink.variables === n.id} onClick={() => unlink.mutate(n.id)}>
                      <X className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title={major ? 'Root cause and 8D' : 'Root cause'}
          description={major ? 'D1 team, D3 containment, D4 the 5-Why and root cause, D8 recognition.' : 'Ask why until the cause is one you can remove.'}
          actions={
            editable && (
              <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'analysis' })}>
                Edit
              </Button>
            )
          }
        />
        <dl className="grid gap-3 px-5 py-4 text-[13px]">
          {major && <Section label="Team (D1)" value={c.team} />}
          {major && <Section label="Containment (D3)" value={c.containment} />}
          <div>
            <dt className="text-subtle">5-Why (D4)</dt>
            <dd>
              {c.whys.length ? (
                <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                  {c.whys.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ol>
              ) : (
                <span className="text-muted">Not written yet.</span>
              )}
            </dd>
          </div>
          <Section label="Root cause" value={c.rootCause} />
          {major && <Section label="Recognition (D8)" value={c.recognition} />}
        </dl>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title="Actions (D5–D7)"
          description={c.status === 'open' ? 'Plan them now; they are marked done once the CAPA is started.' : undefined}
          actions={
            editable && (
              <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'action' })}>
                <Plus className="size-4" /> Add action
              </Button>
            )
          }
        />
        {c.actions.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-muted">No actions yet. Starting needs at least one corrective action.</p>
        ) : (
          <div className="divide-y divide-line">
          {(Object.keys(CAPA_ACTION_KIND) as CapaAction['kind'][]).map((kind) => {
            const rows = c.actions.filter((a) => a.kind === kind);
            if (!rows.length) return null;
            return (
              <div key={kind}>
                <p className="px-5 pt-2 text-[12px] font-medium text-subtle uppercase">{CAPA_ACTION_KIND[kind]}</p>
                <ul className="divide-y divide-line">
                  {rows.map((a) => (
                    <li key={a.id} className="flex flex-col gap-2 px-5 py-2 text-[13px] sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1">
                        <p className={a.status === 'cancelled' ? 'text-muted line-through' : 'font-medium'}>{a.description}</p>
                        <p className="text-muted">
                          {a.ownerName} · due <span className={a.overdue ? 'font-medium text-danger' : undefined}>{formatDate(a.dueOn)}{a.overdue && ' · overdue'}</span>
                        </p>
                        {a.status === 'done' && (
                          <p className="text-muted">
                            Done {a.doneOn && formatDate(a.doneOn)} by {a.doneByName}: {a.doneNote}
                          </p>
                        )}
                        {a.status === 'cancelled' && <p className="text-muted">Cancelled: {a.cancelReason}</p>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {a.status !== 'open' ? (
                          <Badge tone={a.status === 'done' ? 'success' : 'neutral'}>{a.status === 'done' ? 'Done' : 'Cancelled'}</Badge>
                        ) : (
                          editable && (
                            <>
                              {c.status === 'in_action' && (
                                <Button size="sm" onClick={() => setDialog({ kind: 'done', action: a })}>
                                  Mark done
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'action', action: a })}>
                                Edit
                              </Button>
                              <Button size="sm" variant="ghost" aria-label={`Cancel action: ${a.description}`} onClick={() => setDialog({ kind: 'cancel-action', action: a })}>
                                <Trash2 className="size-4" />
                              </Button>
                            </>
                          )
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          </div>
        )}
      </Card>

      {c.verifications.length > 0 && (
        <Card className="mb-4">
          <CardHeader title="Effectiveness checks" description="Every check is kept; one that wasn’t effective sent the CAPA back to action." />
          <ul className="divide-y divide-line">
            {c.verifications.map((v) => (
              <li key={v.id} className="px-5 py-2 text-[13px]">
                <Badge tone={v.effective ? 'success' : 'danger'}>{v.effective ? 'Effective' : 'Not effective'}</Badge> <span className="text-muted">{v.verifiedByName} · {formatDateTime(v.verifiedAt)}</span>
                <p className="mt-1 whitespace-pre-line">{v.note}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {ws.can('quality.attachment.read') && <AttachmentsPanel ownerType="capa" ownerId={c.id} defaultKind="other" title="8D report and evidence" />}

      {dialog?.kind === 'analysis' && <Analysis c={c} onClose={close} />}
      {dialog?.kind === 'action' && <ActionForm c={c} action={dialog.action} onClose={close} />}
      {dialog?.kind === 'done' && <Done c={c} action={dialog.action} onClose={close} />}
      {dialog?.kind === 'cancel-action' && <Reason title="Cancel action" description={dialog.action.description} path={`/quality/capa-actions/${dialog.action.id}/cancel`} submitLabel="Cancel action" capaId={c.id} onClose={close} />}
      {dialog?.kind === 'cancel' && <Reason title={`Cancel ${c.number}`} description="A cancelled CAPA keeps its record; it can’t be reopened." path={`/quality/capas/${c.id}/cancel`} submitLabel="Cancel CAPA" capaId={c.id} onClose={close} />}
      {dialog?.kind === 'link' && <LinkNcr c={c} onClose={close} />}
      {dialog?.kind === 'verify' && <Verify c={c} onClose={close} />}
    </>
  );
}

function Section({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-subtle">{label}</dt>
      <dd className="whitespace-pre-line">{value || <span className="text-muted">Not written yet.</span>}</dd>
    </div>
  );
}

function usePeople() {
  const ws = useWorkspace();
  return useQuery({ queryKey: ['capa-people', ws.tenantId], queryFn: () => api<CapaPerson[]>('/quality/capa-people', { scope: ws.scope }) });
}

function Analysis({ c, onClose }: { c: CapaDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const refresh = useRefresh(c.id);
  const people = usePeople();
  const major = c.severity === 'major';
  const [f, setF] = useState({ title: c.title, problem: c.problem, ownerUserId: c.ownerUserId, verifyAfterDays: String(c.verifyAfterDays), rootCause: c.rootCause ?? '', team: c.team ?? '', containment: c.containment ?? '', recognition: c.recognition ?? '' });
  const [whys, setWhys] = useState<string[]>(c.whys.length ? c.whys : ['', '']);
  const m = useMutation({
    mutationFn: () =>
      api(`/quality/capas/${c.id}`, {
        method: 'PUT',
        scope: ws.scope,
        body: { ...f, verifyAfterDays: Number(f.verifyAfterDays), whys: whys.map((w) => w.trim()).filter(Boolean), rootCause: f.rootCause || null, team: f.team || null, containment: f.containment || null, recognition: f.recognition || null },
      }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title={major ? 'Root cause and 8D' : 'Root cause'} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" error={err.title}>
          {(p) => <Input {...p} value={f.title} onChange={set('title')} required />}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Owner" error={err.ownerUserId}>
            {(p) => (
              <Select {...p} value={f.ownerUserId} onChange={set('ownerUserId')}>
                {people.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Check after (days)" error={err.verifyAfterDays}>
            {(p) => <Input {...p} type="number" min={30} max={180} value={f.verifyAfterDays} onChange={set('verifyAfterDays')} required />}
          </Field>
        </div>
      </div>
      <Field label="Problem (D2)" error={err.problem}>
        {(p) => <Input {...p} value={f.problem} onChange={set('problem')} required />}
      </Field>
      {major && (
        <>
          <Field label="Team (D1)" error={err.team}>
            {(p) => <Input {...p} value={f.team} onChange={set('team')} placeholder="Who works on it" />}
          </Field>
          <Field label="Containment (D3)" error={err.containment}>
            {(p) => <Input {...p} value={f.containment} onChange={set('containment')} placeholder="What protects the customer until the fix" />}
          </Field>
        </>
      )}
      <div className="space-y-2">
        {whys.map((w, i) => (
          <div key={i} className="flex items-end gap-2">
            <Field label={`Why ${i + 1}`} className="flex-1" error={err[`whys.${i}`]}>
              {(p) => <Input {...p} value={w} onChange={(e) => setWhys(whys.map((x, k) => (k === i ? e.target.value : x)))} />}
            </Field>
            <Button variant="ghost" aria-label={`Remove why ${i + 1}`} disabled={whys.length === 1} onClick={() => setWhys(whys.filter((_, k) => k !== i))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {whys.length < 5 && (
          <Button size="sm" variant="ghost" onClick={() => setWhys([...whys, ''])}>
            <Plus className="size-4" /> Why
          </Button>
        )}
      </div>
      <Field label="Root cause" error={err.rootCause}>
        {(p) => <Input {...p} value={f.rootCause} onChange={set('rootCause')} placeholder="The cause the corrective action removes" />}
      </Field>
      {major && (
        <Field label="Recognition (D8)" error={err.recognition} hint="Needed to close; it may say none.">
          {(p) => <Input {...p} value={f.recognition} onChange={set('recognition')} />}
        </Field>
      )}
    </FormDialog>
  );
}

function ActionForm({ c, action, onClose }: { c: CapaDetail; action?: CapaAction; onClose: () => void }) {
  const ws = useWorkspace();
  const refresh = useRefresh(c.id);
  const people = usePeople();
  const [f, setF] = useState({ kind: action?.kind ?? (c.actions.some((a) => a.kind === 'corrective') ? 'preventive' : 'corrective'), description: action?.description ?? '', ownerUserId: action?.ownerUserId ?? c.ownerUserId, dueOn: action?.dueOn ?? '' });
  const m = useMutation({
    mutationFn: () => api(action ? `/quality/capa-actions/${action.id}` : `/quality/capas/${c.id}/actions`, { method: action ? 'PUT' : 'POST', scope: ws.scope, body: f }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title={action ? 'Change action' : 'Add action'} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel={action ? 'Save' : 'Add action'}>
      <Field label="Kind" error={err.kind}>
        {(p) => (
          <Select {...p} value={f.kind} onChange={set('kind')}>
            {Object.entries(CAPA_ACTION_KIND).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="What will be done" error={err.description}>
        {(p) => <Input {...p} value={f.description} onChange={set('description')} required autoFocus />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Owner" error={err.ownerUserId}>
          {(p) => (
            <Select {...p} value={f.ownerUserId} onChange={set('ownerUserId')}>
              {people.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Due" error={err.dueOn}>
          {(p) => <DateInput {...p} value={f.dueOn} onChange={set('dueOn')} required />}
        </Field>
      </div>
    </FormDialog>
  );
}

function Done({ c, action, onClose }: { c: CapaDetail; action: CapaAction; onClose: () => void }) {
  const ws = useWorkspace();
  const refresh = useRefresh(c.id);
  const [f, setF] = useState({ note: '', doneOn: c.today });
  const m = useMutation({
    mutationFn: () => api(`/quality/capa-actions/${action.id}/done`, { method: 'POST', scope: ws.scope, body: f }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Mark action done" description={action.description} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Mark done">
      <Field label="What was done" error={err.note}>
        {(p) => <Input {...p} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required autoFocus placeholder="Evidence or reference" />}
      </Field>
      <Field label="Done on" error={err.doneOn}>
        {(p) => <DateInput {...p} max={c.today} value={f.doneOn} onChange={(e) => setF({ ...f, doneOn: e.target.value })} required />}
      </Field>
    </FormDialog>
  );
}

function Reason({ title, description, path, submitLabel, capaId, onClose }: { title: string; description: string; path: string; submitLabel: string; capaId: string; onClose: () => void }) {
  const ws = useWorkspace();
  const refresh = useRefresh(capaId);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(path, { method: 'POST', scope: ws.scope, body: { reason } }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <FormDialog title={title} description={description} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel={submitLabel}>
      <Field label="Reason" error={fieldErrors(m.error).reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}
      </Field>
    </FormDialog>
  );
}

function LinkNcr({ c, onClose }: { c: CapaDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const refresh = useRefresh(c.id);
  const ncrs = useQuery({ queryKey: ['ncrs', ws.entityId, 'all'], queryFn: () => api<NcrRow[]>('/quality/ncrs', { scope: ws.scope }) });
  const [ncrId, setNcrId] = useState('');
  const linked = new Set(c.ncrs.map((n) => n.id));
  const m = useMutation({
    mutationFn: () => api(`/quality/capas/${c.id}/ncrs`, { method: 'POST', scope: ws.scope, body: { ncrId } }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <FormDialog title="Link NCR" description="Repeat occurrences of the same problem belong to one CAPA." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Link">
      <Field label="NCR" error={fieldErrors(m.error).ncrId}>
        {(p) => (
          <Select {...p} value={ncrId} onChange={(e) => setNcrId(e.target.value)} required>
            <option value="">Choose…</option>
            {ncrs.data
              ?.filter((n) => !linked.has(n.id) && n.status !== 'cancelled')
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.number} · {n.itemCode} · {n.description}
                </option>
              ))}
          </Select>
        )}
      </Field>
    </FormDialog>
  );
}

function Verify({ c, onClose }: { c: CapaDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const refresh = useRefresh(c.id);
  const [f, setF] = useState({ effective: 'yes', note: '', recognition: c.recognition ?? '' });
  const effective = f.effective === 'yes';
  const m = useMutation({
    mutationFn: () => api(`/quality/capas/${c.id}/verify`, { method: 'POST', scope: ws.scope, body: { effective, note: f.note, recognition: effective && c.severity === 'major' ? f.recognition || null : null } }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog
      title="Check effectiveness"
      description="Did the problem stay away? Effective closes the CAPA; not effective sends it back for more actions."
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel={effective ? 'Effective, close' : 'Not effective, reopen'}
    >
      <Field label="Result">
        {(p) => (
          <Select {...p} value={f.effective} onChange={(e) => setF({ ...f, effective: e.target.value })}>
            <option value="yes">Effective</option>
            <option value="no">Not effective</option>
          </Select>
        )}
      </Field>
      <Field label="Evidence" error={err.note}>
        {(p) => <Input {...p} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required autoFocus placeholder="What you checked and what you found" />}
      </Field>
      {effective && c.severity === 'major' && (
        <Field label="Recognition (D8)" error={err.recognition} hint="It may say none.">
          {(p) => <Input {...p} value={f.recognition} onChange={(e) => setF({ ...f, recognition: e.target.value })} required />}
        </Field>
      )}
    </FormDialog>
  );
}
