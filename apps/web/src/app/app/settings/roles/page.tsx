'use client';
import { Badge, Button, Card, Field, Input, PageHeader, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Lock, Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { ResourceDef, Role } from '@/lib/types';

const ACTIONS = ['read', 'create', 'update', 'submit', 'cancel', 'approve', 'delete', 'export', 'file', 'manage'];

type Draft = { id?: string; name: string; description: string; permissions: string[] };

export default function RolesPage() {
  const ws = useWorkspace();
  const params = useSearchParams();
  const scope = ws.tenantScope;
  const roles = useQuery({ queryKey: ['roles', ws.tenantId], queryFn: () => api<Role[]>('/roles', { scope }) });
  const catalog = useQuery({ queryKey: ['permissions'], queryFn: () => api<ResourceDef[]>('/permissions', { scope }) });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(params.get('new') ? { name: '', description: '', permissions: [] } : null);
  const role = roles.data?.find((r) => r.id === selected) ?? roles.data?.[0];

  return (
    <>
      <PageHeader
        title="Roles"
        description="System roles are maintained by FactoryOS and can be copied. Custom roles are yours to edit."
        actions={
          ws.canTenant('settings.role.create') && (
            <Button onClick={() => setDraft({ name: '', description: '', permissions: [] })}>
              <Plus className="size-4" /> New role
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit p-1.5">
          {roles.data?.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] ${role?.id === r.id ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2'}`}
            >
              {r.isSystem && <Lock className="size-3.5 shrink-0 text-subtle" aria-label="System role" />}
              <span className="truncate font-medium">{r.name}</span>
              <span className="ml-auto text-[11px] text-subtle">{r.memberCount}</span>
            </button>
          ))}
        </Card>

        {role && catalog.data && (
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                  {role.name} {role.isSystem && <Badge>System</Badge>}
                </h2>
                <p className="mt-0.5 text-[13px] text-muted">{role.description}</p>
              </div>
              <div className="flex gap-2">
                {ws.canTenant('settings.role.create') && (
                  <Button variant="secondary" size="sm" onClick={() => setDraft({ name: `${role.name} (copy)`, description: role.description ?? '', permissions: role.permissions })}>
                    <Copy className="size-3.5" /> Copy
                  </Button>
                )}
                {!role.isSystem && ws.canTenant('settings.role.update') && (
                  <Button size="sm" onClick={() => setDraft({ id: role.id, name: role.name, description: role.description ?? '', permissions: role.permissions })}>
                    Edit
                  </Button>
                )}
              </div>
            </div>
            <Matrix catalog={catalog.data} value={role.permissions} />
          </Card>
        )}
      </div>
      {draft && catalog.data && <RoleDialog draft={draft} catalog={catalog.data} onClose={() => setDraft(null)} onSaved={(id) => setSelected(id)} />}
    </>
  );
}

/** Permission matrix generated from the catalog (docs/15 §3). Read-only unless onChange is given. */
function Matrix({ catalog, value, onChange }: { catalog: ResourceDef[]; value: string[]; onChange?: (v: string[]) => void }) {
  const has = new Set(value);
  const toggle = (p: string) => onChange?.(has.has(p) ? value.filter((x) => x !== p) : [...value, p]);
  const modules = [...new Set(catalog.map((r) => r.module))];
  return (
    <Table>
      <thead>
        <tr>
          <Th>Resource</Th>
          {ACTIONS.map((a) => (
            <Th key={a} className="px-2 text-center">{a}</Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {modules.map((mod) => [
          <tr key={mod}>
            <td colSpan={ACTIONS.length + 1} className="bg-surface-2/40 px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">
              {mod}
            </td>
          </tr>,
          ...catalog
            .filter((r) => r.module === mod)
            .map((r) => (
              <Tr key={`${r.module}.${r.resource}`}>
                <Td className="text-[13px]">{r.label}</Td>
                {ACTIONS.map((a) => {
                  const key = `${r.module}.${r.resource}.${a}`;
                  if (!r.actions.includes(a)) return <Td key={a} className="px-2 text-center text-line-strong">·</Td>;
                  return (
                    <Td key={a} className="px-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={key}
                        className="size-4 accent-[var(--accent)]"
                        checked={has.has(key)}
                        readOnly={!onChange}
                        disabled={!onChange}
                        onChange={() => toggle(key)}
                      />
                    </Td>
                  );
                })}
              </Tr>
            )),
        ])}
      </tbody>
    </Table>
  );
}

function RoleDialog({ draft, catalog, onClose, onSaved }: { draft: Draft; catalog: ResourceDef[]; onClose: () => void; onSaved: (id: string) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState(draft);
  const m = useMutation({
    mutationFn: () =>
      api<Role>(f.id ? `/roles/${f.id}` : '/roles', {
        method: f.id ? 'PATCH' : 'POST',
        body: { name: f.name, description: f.description || undefined, permissions: f.permissions },
        scope: ws.tenantScope,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['roles'] });
      onSaved(r.id);
      onClose();
    },
  });
  const e = fieldErrors(m.error);
  return (
    <FormDialog title={f.id ? `Edit ${draft.name}` : 'New role'} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={e.name}>{(p) => <Input {...p} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} required />}</Field>
        <Field label="Description" error={e.description}>{(p) => <Input {...p} value={f.description} onChange={(ev) => setF({ ...f, description: ev.target.value })} />}</Field>
      </div>
      {e.permissions && <p className="text-[12px] text-danger">{e.permissions}</p>}
      <div className="-mx-6 border-y border-line">
        <Matrix catalog={catalog} value={f.permissions} onChange={(permissions) => setF({ ...f, permissions })} />
      </div>
      <p className="text-[12px] text-muted">You can only grant permissions you hold yourself (owners excepted).</p>
    </FormDialog>
  );
}
