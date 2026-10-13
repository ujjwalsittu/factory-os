'use client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr, DateInput } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { type Skill, type SkillCertification, type SkillLevel, SKILL_LEVEL, type SkillMatrix } from '@/lib/quality';

/** Skill matrix (decision 062): who is certified for what, until when; and the skill catalogue. */
export default function SkillsPage() {
  const ws = useWorkspace();
  const [tab, setTab] = useState<'matrix' | 'skills'>('matrix');
  const [certify, setCertify] = useState<{ userId?: string; skillId?: string } | null>(null);
  const [editing, setEditing] = useState<Skill | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Skill matrix"
        description="Machines and work centres name the skills they need; people hold certifications as trainee, qualified or trainer until they expire. Job cards and skill-gated inspections check them."
        actions={
          ws.entityId &&
          (tab === 'matrix'
            ? ws.can('quality.skill.approve') && <Button onClick={() => setCertify({})}>Certify</Button>
            : ws.can('quality.skill.create') && <Button onClick={() => setEditing('new')}>New skill</Button>)
        }
      />
      <EntityGate what="quality">
        <div className="mb-4 flex gap-1" role="tablist" aria-label="View">
          <Button role="tab" aria-selected={tab === 'matrix'} size="sm" variant={tab === 'matrix' ? 'secondary' : 'ghost'} onClick={() => setTab('matrix')}>
            Matrix
          </Button>
          <Button role="tab" aria-selected={tab === 'skills'} size="sm" variant={tab === 'skills' ? 'secondary' : 'ghost'} onClick={() => setTab('skills')}>
            Skills
          </Button>
        </div>
        {tab === 'matrix' ? <Matrix onCertify={setCertify} /> : <Catalogue onEdit={setEditing} />}
      </EntityGate>
      {certify && <Certify initial={certify} onClose={() => setCertify(null)} />}
      {editing && <SkillForm skill={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const TONE = { valid: undefined, expiring: 'text-warning', expired: 'text-danger' } as const;

function Matrix({ onCertify }: { onCertify: (x: { userId?: string; skillId?: string }) => void }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState<{ userId: string; skillId: string } | null>(null);
  const q = useQuery({ queryKey: ['skill-matrix', ws.entityId], queryFn: () => api<SkillMatrix>('/quality/skill-matrix', { scope: ws.scope }) });
  const m = q.data;
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (!m) return <p className="text-muted">Loading…</p>;
  if (!m.skills.length)
    return (
      <Card>
        <EmptyState icon={<GraduationCap className="size-5" />} title="No skills yet" description="Add skills such as 5-axis milling under Skills, then name them on machines or work centres." />
      </Card>
    );
  const cell = (userId: string, skillId: string) => m.cells.find((c) => c.userId === userId && c.skillId === skillId);
  return (
    <div className="space-y-4">
      {m.expiring.length > 0 && (
        <Card>
          <CardHeader title="Expiring within 30 days" description="Re-certify before the date or the person stops counting for that skill." />
          <ul className="divide-y divide-line">
            {m.expiring.map((x) => (
              <li key={x.certificationId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-[13px]">
                <span>
                  <span className="font-medium">{x.userName}</span> · {x.skillName} <Badge tone={SKILL_LEVEL[x.level].tone}>{SKILL_LEVEL[x.level].label}</Badge>
                </span>
                <span className="text-warning">expires {formatDate(x.expiresOn)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th className="sticky left-0 bg-surface">Person</Th>
                {m.skills.map((s) => (
                  <Th key={s.id} title={s.name} className="whitespace-nowrap">
                    <span className="font-mono">{s.code}</span>
                    <span className="block text-[11px] font-normal normal-case text-subtle">{s.name}</span>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.people.map((p) => (
                <Tr key={p.id}>
                  <Td className="sticky left-0 bg-surface text-[13px] font-medium whitespace-nowrap">{p.name}</Td>
                  {m.skills.map((s) => {
                    const c = cell(p.id, s.id);
                    const can = ws.can('quality.skill.approve') && p.id !== ws.me.user.id;
                    return (
                      <Td key={s.id} className="text-[13px] whitespace-nowrap">
                        {c ? (
                          <button type="button" className="text-left hover:underline" aria-label={`${p.name} · ${s.name}`} onClick={() => setOpen({ userId: p.id, skillId: s.id })}>
                            <Badge tone={c.state === 'expired' ? 'neutral' : SKILL_LEVEL[c.level].tone}>{SKILL_LEVEL[c.level].label}</Badge>
                            <span className={`block text-[12px] ${TONE[c.state] ?? 'text-subtle'}`}>
                              {c.state === 'expired' ? 'expired ' : 'to '}
                              {formatDate(c.expiresOn)}
                            </span>
                          </button>
                        ) : can ? (
                          <button type="button" className="text-subtle hover:text-accent" aria-label={`Certify ${p.name} in ${s.name}`} onClick={() => onCertify({ userId: p.id, skillId: s.id })}>
                            + certify
                          </button>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
      {open && <History matrix={m} {...open} onClose={() => setOpen(null)} onCertify={() => onCertify(open)} />}
    </div>
  );
}

function History({ matrix, userId, skillId, onClose, onCertify }: { matrix: SkillMatrix; userId: string; skillId: string; onClose: () => void; onCertify: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const person = matrix.people.find((p) => p.id === userId)!;
  const sk = matrix.skills.find((s) => s.id === skillId)!;
  const q = useQuery({ queryKey: ['skill-history', ws.entityId, userId, skillId], queryFn: () => api<SkillCertification[]>(`/quality/skill-certifications?userId=${userId}&skillId=${skillId}`, { scope: ws.scope }) });
  const [reason, setReason] = useState('');
  const [revoking, setRevoking] = useState(false);
  const current = q.data?.[0];
  const revoke = useMutation({
    mutationFn: () => api(`/quality/skill-certifications/${current!.id}/revoke`, { method: 'POST', scope: ws.scope, body: { reason } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skill-history'] });
      void qc.invalidateQueries({ queryKey: ['skill-matrix'] });
      setRevoking(false);
    },
  });
  const canApprove = ws.can('quality.skill.approve') && userId !== ws.me.user.id;
  return (
    <FormDialog title={`${person.name} · ${sk.name}`} description={`Re-certify every ${sk.recertifyMonths} months. Records are kept; a new level or date is a new record.`} onClose={onClose} onSubmit={() => (revoking ? revoke.mutate() : onClose())} pending={revoke.isPending} error={revoke.error} submitLabel={revoking ? 'Revoke' : 'Done'} wide>
      {canApprove && !revoking && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => { onClose(); onCertify(); }}>
            Re-certify or change level
          </Button>
          {current && !current.revokedAt && (
            <Button size="sm" variant="ghost" onClick={() => setRevoking(true)}>
              Revoke
            </Button>
          )}
        </div>
      )}
      {revoking && (
        <Field label="Why is it revoked" error={fieldErrors(revoke.error).reason}>
          {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}
        </Field>
      )}
      <ul className="divide-y divide-line rounded-md border border-line text-[13px]">
        {q.data?.map((c) => (
          <li key={c.id} className="px-3 py-2">
            <Badge tone={c.revokedAt ? 'neutral' : SKILL_LEVEL[c.level].tone}>{SKILL_LEVEL[c.level].label}</Badge>{' '}
            <span className={c.revokedAt ? 'text-muted line-through' : undefined}>
              {formatDate(c.certifiedOn)} to {formatDate(c.expiresOn)}
            </span>{' '}
            <span className="text-muted">by {c.certifiedByName}</span>
            {c.note && <p className="text-muted">{c.note}</p>}
            {c.revokedAt && (
              <p className="text-danger">
                Revoked by {c.revokedByName}: {c.revokeReason}
              </p>
            )}
          </li>
        ))}
      </ul>
      {current && ws.can('quality.attachment.read') && <AttachmentsPanel ownerType="skill_certification" ownerId={current.id} defaultKind="other" title="Training records and evidence" />}
    </FormDialog>
  );
}

function Certify({ initial, onClose }: { initial: { userId?: string; skillId?: string }; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const m = useQuery({ queryKey: ['skill-matrix', ws.entityId], queryFn: () => api<SkillMatrix>('/quality/skill-matrix', { scope: ws.scope }) });
  const [f, setF] = useState({ userId: initial.userId ?? '', skillId: initial.skillId ?? '', level: 'qualified' as SkillLevel, certifiedOn: '', note: '' });
  const save = useMutation({
    mutationFn: () => api('/quality/skill-certifications', { method: 'POST', scope: ws.scope, body: { ...f, certifiedOn: f.certifiedOn || undefined, note: f.note || null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skill-matrix'] });
      void qc.invalidateQueries({ queryKey: ['skill-history'] });
      onClose();
    },
  });
  const err = fieldErrors(save.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const sk = m.data?.skills.find((s) => s.id === f.skillId);
  return (
    <FormDialog title="Certify" description="You can't certify yourself. Making someone a trainer needs a trainer of that skill, once it has one." onClose={onClose} onSubmit={() => save.mutate()} pending={save.isPending} error={save.error} submitLabel="Certify">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Person" error={err.userId}>
          {(p) => (
            <Select {...p} value={f.userId} onChange={set('userId')} required>
              <option value="">Choose…</option>
              {m.data?.people
                .filter((x) => x.id !== ws.me.user.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Skill" error={err.skillId}>
          {(p) => (
            <Select {...p} value={f.skillId} onChange={set('skillId')} required>
              <option value="">Choose…</option>
              {m.data?.skills.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} · {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Level" error={err.level} hint={f.level === 'trainee' ? 'A trainee runs a card only with a qualified co-signer.' : undefined}>
          {(p) => (
            <Select {...p} value={f.level} onChange={set('level')}>
              {(Object.keys(SKILL_LEVEL) as SkillLevel[]).map((l) => (
                <option key={l} value={l}>
                  {SKILL_LEVEL[l].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Certified on" error={err.certifiedOn} hint={sk ? `Expires ${sk.recertifyMonths} months later.` : 'Blank for today.'}>
          {(p) => <DateInput {...p} max={m.data?.today} value={f.certifiedOn} onChange={set('certifiedOn')} />}
        </Field>
      </div>
      <Field label="Note" error={err.note}>
        {(p) => <Input {...p} value={f.note} onChange={set('note')} placeholder="Course, assessment or test piece" />}
      </Field>
    </FormDialog>
  );
}

function Catalogue({ onEdit }: { onEdit: (s: Skill) => void }) {
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['skills', ws.entityId], queryFn: () => api<Skill[]>('/quality/skills', { scope: ws.scope }) });
  if (q.data?.length === 0)
    return (
      <Card>
        <EmptyState icon={<GraduationCap className="size-5" />} title="No skills yet" description="A skill is something a machine or work centre needs, such as 5-axis milling or vacuum brazing." />
      </Card>
    );
  return (
    <Card>
      <div className="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <Th>Skill</Th>
              <Th>Re-certify</Th>
              <Th>Needed by</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((s) => (
              <Tr key={s.id}>
                <Td className="text-[13px]">
                  <span className="font-mono font-medium">{s.code}</span> {s.name} {!s.isActive && <Badge tone="neutral">Inactive</Badge>}
                  {s.description && <span className="block text-muted">{s.description}</span>}
                </Td>
                <Td className="text-[13px] whitespace-nowrap">every {s.recertifyMonths} months</Td>
                <Td className="text-[13px]">
                  {[...s.workCentres.map((w) => `${w.code} (centre)`), ...s.machines.map((m) => m.code)].join(', ') || <span className="text-subtle">Not required yet</span>}
                </Td>
                <Td className="text-right">
                  {ws.can('quality.skill.update') && (
                    <Button size="sm" variant="ghost" onClick={() => onEdit(s)}>
                      Edit
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}

function SkillForm({ skill, onClose }: { skill: Skill | null; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ code: skill?.code ?? '', name: skill?.name ?? '', description: skill?.description ?? '', recertifyMonths: String(skill?.recertifyMonths ?? 12), isActive: skill?.isActive ?? true });
  const save = useMutation({
    mutationFn: () => api(skill ? `/quality/skills/${skill.id}` : '/quality/skills', { method: skill ? 'PUT' : 'POST', scope: ws.scope, body: { ...f, description: f.description || null, recertifyMonths: Number(f.recertifyMonths) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skills'] });
      void qc.invalidateQueries({ queryKey: ['skill-matrix'] });
      onClose();
    },
  });
  const err = fieldErrors(save.error);
  const set = (k: 'code' | 'name' | 'description' | 'recertifyMonths') => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title={skill ? `Edit ${skill.code}` : 'New skill'} description="A changed interval applies to certifications given from now on." onClose={onClose} onSubmit={() => save.mutate()} pending={save.isPending} error={save.error} submitLabel={skill ? 'Save' : 'Add skill'}>
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <Field label="Code" error={err.code}>
          {(p) => <Input {...p} value={f.code} onChange={set('code')} required autoFocus />}
        </Field>
        <Field label="Name" error={err.name}>
          {(p) => <Input {...p} value={f.name} onChange={set('name')} required />}
        </Field>
      </div>
      <Field label="Re-certify every (months)" error={err.recertifyMonths}>
        {(p) => <Input {...p} type="number" min={1} max={60} value={f.recertifyMonths} onChange={set('recertifyMonths')} required />}
      </Field>
      <Field label="Description" error={err.description}>
        {(p) => <Input {...p} value={f.description} onChange={set('description')} />}
      </Field>
      {skill && (
        <Field label="Status">
          {(p) => (
            <Select {...p} value={f.isActive ? 'active' : 'inactive'} onChange={(e) => setF({ ...f, isActive: e.target.value === 'active' })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive (no longer required or certified)</option>
            </Select>
          )}
        </Field>
      )}
    </FormDialog>
  );
}
