'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, ShieldAlert, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import {authClient} from '@/lib/auth-client';
import {DeliveryTable} from '@/components/email/delivery-table';
import { formatDate, initials } from '@/lib/format';
import type { Invitation, Member, Role } from '@/lib/types';

type Assignment = { roleId: string; entityIds: string[] | null };

export default function UsersPage(){const ws=useWorkspace(),session=authClient.useSession();if(!session.data?.user||session.data.user.id!==ws.me.user.id)return null;return <UsersContent key={`${session.data.user.id}:${ws.tenantId}`}/>;}

function UsersContent() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [inviting, setInviting] = useState(!!params.get('invite'));
  const [editing, setEditing] = useState<Member | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const scope = ws.tenantScope;

  const members = useQuery({ queryKey: ['members', ws.tenantId,ws.me.user.id], queryFn: () => api<Member[]>('/members', { scope }) });
  const invites = useQuery({ queryKey: ['invitations', ws.tenantId,ws.me.user.id], queryFn: () => api<Invitation[]>('/invitations', { scope }) });
  const roles = useQuery({ queryKey: ['roles', ws.tenantId,ws.me.user.id], queryFn: () => api<Role[]>('/roles', { scope }), enabled: ws.canTenant('settings.role.read') });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api(`/members/${id}`, { method: 'PATCH', body: { status }, scope }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/invitations/${id}`, { method: 'DELETE', scope }),
    onSuccess: () => {void qc.invalidateQueries({queryKey:['invitations']});void qc.invalidateQueries({queryKey:['email-deliveries']});},
  });

  const entityName = (id: string) => ws.tenantCtx.entities.find((e) => e.id === id)?.shortName ?? 'Unknown';
  const scopeText = (ids: string[] | null) => (ids === null ? 'all entities' : ids.map(entityName).join(', '));
  const roleName = (id: string) => roles.data?.find((r) => r.id === id)?.name ?? 'Role';
  const pending = invites.data?.filter((i) => i.status === 'pending') ?? [];

  return (
    <>
      <PageHeader
        title="Users"
        description="People in this tenant, their roles, and which entities each role covers."
        actions={
          ws.canTenant('settings.user.create') && (
            <Button onClick={() => setInviting(true)}>
              <UserPlus className="size-4" /> Invite user
            </Button>
          )
        }
      />

      {inviteUrl && (
        <Alert tone="success" title="Invitation created" className="mb-4">
          Delivery status is shown below. You can also copy this one-time invitation link:
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 font-mono text-[12px] text-fg">{inviteUrl}</code>
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(inviteUrl)}>
              <Copy className="size-3.5" /> Copy
            </Button>
          </div>
        </Alert>
      )}

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Roles (scope)</Th>
              <Th>Two-factor</Th>
              <Th>Status</Th>
              <Th className="w-0" />
            </tr>
          </thead>
          <tbody>
            {members.data?.map((m) => (
              <Tr key={m.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">{initials(m.name)}</span>
                    <div className="min-w-0">
                      <p className="font-medium">
                        {m.name} {m.isOwner && <Badge tone="accent" className="ml-1">Owner</Badge>}
                      </p>
                      <p className="truncate text-[12px] text-muted">{m.email}</p>
                    </div>
                  </div>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {m.roles.length === 0 && <span className="text-[13px] text-subtle">No roles</span>}
                    {m.roles.map((r, i) => (
                      <Badge key={i}>
                        {r.roleName} <span className="text-subtle">· {scopeText(r.entityIds)}</span>
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td>
                  {m.twoFactorEnabled ? (
                    <Badge tone="success"><ShieldCheck className="size-3" /> On</Badge>
                  ) : (
                    <Badge tone="warning"><ShieldAlert className="size-3" /> Off</Badge>
                  )}
                </Td>
                <Td>
                  <Badge tone={m.status === 'active' ? 'success' : 'neutral'} dot>
                    {m.status === 'active' ? 'Active' : 'Disabled'}
                  </Badge>
                </Td>
                <Td className="whitespace-nowrap">
                  {ws.canTenant('settings.user.update') && m.userId !== ws.me.user.id && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(m)} disabled={!roles.data}>
                        Edit roles
                      </Button>
                      {!m.isOwner && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setStatus.mutate({ id: m.id, status: m.status === 'active' ? 'disabled' : 'active' })}
                        >
                          {m.status === 'active' ? 'Disable' : 'Enable'}
                        </Button>
                      )}
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {pending.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Pending invitations" />
          <ul className="divide-y divide-line">
            {pending.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]">
                <span className="font-medium">{i.email}</span>
                <span className="text-muted">{i.roles.map((r) => `${roleName(r.roleId)} (${scopeText(r.entityIds)})`).join(', ')}</span>
                <span className="ml-auto text-[12px] text-subtle">expires {formatDate(i.expiresAt)}</span>
                {ws.canTenant('settings.user.delete') && (
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)} aria-label={`Revoke invitation for ${i.email}`}>
                    <Trash2 className="size-3.5" /> Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {ws.canTenant('settings.email.read')&&<DeliveryTable userId={ws.me.user.id} tenantId={ws.tenantId}/>}

      {inviting && roles.data && (
        <InviteDialog
          roles={roles.data}
          onClose={() => setInviting(false)}
          onCreated={(url) => {
            setInviteUrl(url);
            setInviting(false);
          }}
        />
      )}
      {editing && roles.data && <EditRolesDialog member={editing} roles={roles.data} onClose={() => setEditing(null)} />}
    </>
  );
}

function InviteDialog({ roles, onClose, onCreated }: { roles: Role[]; onClose: () => void; onCreated: (url: string) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [assignments, setAssignments] = useState<Assignment[]>([{ roleId: roles.find((r) => r.systemKey === 'accountant')?.id ?? roles[0]!.id, entityIds: null }]);
  const m = useMutation({
    mutationFn: () => api<{ inviteUrl: string }>('/invitations', { method: 'POST', body: { email, roles: assignments }, scope: ws.tenantScope }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['invitations'] });void qc.invalidateQueries({queryKey:['email-deliveries']});
      onCreated(r.inviteUrl);
    },
  });
  return (
    <FormDialog title="Invite user" description="They'll create an account (or sign in) with this email to join." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Create invitation" wide>
      <Field label="Email" error={fieldErrors(m.error).email}>{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}</Field>
      <AssignmentsEditor roles={roles} value={assignments} onChange={setAssignments} />
    </FormDialog>
  );
}

function EditRolesDialog({ member, roles, onClose }: { member: Member; roles: Role[]; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [assignments, setAssignments] = useState<Assignment[]>(member.roles.map((r) => ({ roleId: r.roleId, entityIds: r.entityIds })));
  const m = useMutation({
    mutationFn: () => api(`/members/${member.id}/roles`, { method: 'PUT', body: assignments, scope: ws.tenantScope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['members'] });
      onClose();
    },
  });
  return (
    <FormDialog title={`Roles for ${member.name}`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} wide>
      <AssignmentsEditor roles={roles} value={assignments} onChange={setAssignments} />
    </FormDialog>
  );
}

/** Role + scope rows. Scope is "all entities" or a chosen set of entities. */
function AssignmentsEditor({ roles, value, onChange }: { roles: Role[]; value: Assignment[]; onChange: (v: Assignment[]) => void }) {
  const ws = useWorkspace();
  const entities = ws.tenantCtx.entities;
  const update = (i: number, patch: Partial<Assignment>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium">Roles</p>
      <div className="space-y-3">
        {value.map((a, i) => (
          <div key={i} className="rounded-lg border border-line p-3">
            <div className="flex gap-2">
              <Select value={a.roleId} onChange={(e) => update(i, { roleId: e.target.value })} aria-label="Role">
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
              <Select
                value={a.entityIds === null ? 'all' : 'some'}
                onChange={(e) => update(i, { entityIds: e.target.value === 'all' ? null : entities[0] ? [entities[0].id] : [] })}
                aria-label="Scope"
                className="w-48"
              >
                <option value="all">All entities</option>
                <option value="some" disabled={entities.length === 0}>Selected entities</option>
              </Select>
              <Button variant="ghost" size="icon" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove role" disabled={value.length === 1}>
                <Trash2 className="size-4" />
              </Button>
            </div>
            {a.entityIds !== null && (
              <div className="mt-3 flex flex-wrap gap-3">
                {entities.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--accent)]"
                      checked={a.entityIds!.includes(e.id)}
                      onChange={(ev) =>
                        update(i, { entityIds: ev.target.checked ? [...a.entityIds!, e.id] : a.entityIds!.filter((x) => x !== e.id) })
                      }
                    />
                    {e.shortName}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-2 text-[12px] text-muted">{roles.find((r) => r.id === a.roleId)?.description}</p>
          </div>
        ))}
      </div>
      <Button variant="link" size="sm" className="mt-2" onClick={() => onChange([...value, { roleId: roles[0]!.id, entityIds: null }])}>
        <Plus className="size-3.5" /> Add another role
      </Button>
    </div>
  );
}
