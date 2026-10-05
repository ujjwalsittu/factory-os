'use client';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
} from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { Account, AccountGroup } from '@/lib/accounting';
import { AccountingPage, useAccounts } from './accounting-shared';
import { useWorkspace } from './workspace';
import { fieldErrors, FormDialog } from './form-dialog';
export default function Chart() {
  return (
    <AccountingPage
      title="Chart of accounts"
      permission="accounts.account.read"
    >
      <Content />
    </AccountingPage>
  );
}
function Content() {
  const ws = useWorkspace(),
    qc = useQueryClient(),
    q = useAccounts();
  const [editing, setEditing] = useState<Account | 'new' | null>(null),
    [f, setF] = useState({ code: '', name: '', groupId: '', isActive: true });
  const [editingGroup, setEditingGroup] = useState<AccountGroup | 'new' | null>(
      null,
    ),
    [gf, setGf] = useState({ name: '', root: 'asset', parentId: '' });
  const groups = useQuery({
    queryKey: ['account-groups', ws.tenantId, ws.entityId],
    queryFn: () => api<AccountGroup[]>('/accounts/groups', { scope: ws.scope }),
  });
  const save = useMutation({
    mutationFn: () =>
      editing === 'new'
        ? api('/accounts/accounts', {
            method: 'POST',
            body: { code: f.code, name: f.name, groupId: f.groupId },
            scope: ws.scope,
          })
        : api(`/accounts/accounts/${editing?.id}`, {
            method: 'PUT',
            body: { name: f.name, groupId: f.groupId, isActive: f.isActive },
            scope: ws.scope,
          }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      setEditing(null);
    },
  });
  const saveGroup = useMutation({
    mutationFn: () =>
      editingGroup === 'new'
        ? api('/accounts/groups', {
            method: 'POST',
            body: {
              name: gf.name,
              root: gf.root,
              ...(gf.parentId && { parentId: gf.parentId }),
            },
            scope: ws.scope,
          })
        : api(`/accounts/groups/${editingGroup?.id}`, {
            method: 'PUT',
            body: { name: gf.name, parentId: gf.parentId || null },
            scope: ws.scope,
          }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['account-groups'] });
      setEditingGroup(null);
    },
  });
  const editAccount = (a: Account | 'new') => {
    save.reset();
    setF(
      a === 'new'
        ? { code: '', name: '', groupId: '', isActive: true }
        : {
            code: a.code,
            name: a.name,
            groupId: a.groupId,
            isActive: a.isActive,
          },
    );
    setEditing(a);
  };
  const editGroup = (g: AccountGroup | 'new') => {
    saveGroup.reset();
    setGf(
      g === 'new'
        ? { name: '', root: 'asset', parentId: '' }
        : { name: g.name, root: g.root, parentId: g.parentId ?? '' },
    );
    setEditingGroup(g);
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-3">
        {ws.can('accounts.account.create') && (
          <>
            <Button variant="secondary" onClick={() => editGroup('new')}>
              New group
            </Button>
            <Button onClick={() => editAccount('new')}>New ledger</Button>
          </>
        )}
      </div>
      {(q.error || groups.error) && (
        <Alert tone="danger">{q.error?.message ?? groups.error?.message}</Alert>
      )}
      {q.isLoading && <p>Loading chart…</p>}
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Ledger</Th>
              <Th>Tally group</Th>
              <Th>Control</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((a) => (
              <tr key={a.id}>
                <Td>{a.code}</Td>
                <Td>{a.name}</Td>
                <Td>{groups.data?.find((g) => g.id === a.groupId)?.name}</Td>
                <Td>{a.role ?? '—'}</Td>
                <Td>{a.isActive ? 'Active' : 'Inactive'}</Td>
                <Td>
                  {ws.can('accounts.account.update') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ledger ${a.name}`}
                      onClick={() => editAccount(a)}
                    >
                      Edit
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Group</Th>
              <Th>Root</Th>
              <Th>Parent</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {groups.data?.map((g) => (
              <tr key={g.id}>
                <Td>{g.name}</Td>
                <Td>{g.root}</Td>
                <Td>
                  {groups.data?.find((p) => p.id === g.parentId)?.name ?? '—'}
                </Td>
                <Td>
                  {ws.can('accounts.account.update') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit group ${g.name}`}
                      onClick={() => editGroup(g)}
                    >
                      Edit
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {editing && (
        <FormDialog
          title={editing === 'new' ? 'New ledger' : 'Edit ledger'}
          onClose={() => setEditing(null)}
          onSubmit={() => save.mutate()}
          pending={save.isPending}
          error={save.error}
        >
          <Field label="Ledger code" error={fieldErrors(save.error).code}>
            {(p) => (
              <Input
                {...p}
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value })}
                disabled={editing !== 'new'}
                required
              />
            )}
          </Field>
          <Field label="Ledger name" error={fieldErrors(save.error).name}>
            {(p) => (
              <Input
                {...p}
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
                required
              />
            )}
          </Field>
          <Field label="Account group" error={fieldErrors(save.error).groupId}>
            {(p) => (
              <Select
                {...p}
                value={f.groupId}
                onChange={(e) => setF({ ...f, groupId: e.target.value })}
                required
              >
                <option value="">Choose group</option>
                {groups.data?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} · {g.root}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {editing !== 'new' && (
            <Field label="Ledger status">
              {(p) => (
                <Select
                  {...p}
                  value={String(f.isActive)}
                  onChange={(e) =>
                    setF({ ...f, isActive: e.target.value === 'true' })
                  }
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </Select>
              )}
            </Field>
          )}
        </FormDialog>
      )}
      {editingGroup && (
        <FormDialog
          title={editingGroup === 'new' ? 'New group' : 'Edit group'}
          onClose={() => setEditingGroup(null)}
          onSubmit={() => saveGroup.mutate()}
          pending={saveGroup.isPending}
          error={saveGroup.error}
        >
          <Field label="Group name" error={fieldErrors(saveGroup.error).name}>
            {(p) => (
              <Input
                {...p}
                value={gf.name}
                onChange={(e) => setGf({ ...gf, name: e.target.value })}
                required
              />
            )}
          </Field>
          <Field label="Root classification">
            {(p) => (
              <Select
                {...p}
                value={gf.root}
                onChange={(e) =>
                  setGf({ ...gf, root: e.target.value, parentId: '' })
                }
                disabled={editingGroup !== 'new'}
              >
                {['asset', 'liability', 'equity', 'income', 'expense'].map(
                  (root) => (
                    <option key={root} value={root}>
                      {root}
                    </option>
                  ),
                )}
              </Select>
            )}
          </Field>
          <Field
            label="Parent group"
            error={fieldErrors(saveGroup.error).parentId}
          >
            {(p) => (
              <Select
                {...p}
                value={gf.parentId}
                onChange={(e) => setGf({ ...gf, parentId: e.target.value })}
              >
                <option value="">Root group</option>
                {groups.data
                  ?.filter(
                    (g) =>
                      g.root === gf.root &&
                      (editingGroup === 'new' || g.id !== editingGroup.id),
                  )
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </FormDialog>
      )}
    </div>
  );
}
