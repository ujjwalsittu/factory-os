"use client";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
} from "@factoryos/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Account, AccountGroup } from "@/lib/accounting";
import { AccountingPage, useAccounts } from "./accounting-shared";
import { AccountDialog } from "./master-dialogs";
import { useWorkspace } from "./workspace";
import { roleLabel, ROOTS } from "@/lib/posting-roles";
import { fieldErrors, FormDialog } from "./form-dialog";
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
  const [editing, setEditing] = useState<Account | "new" | null>(null),
    [f, setF] = useState({ code: "", name: "", groupId: "", isActive: true });
  const [editingGroup, setEditingGroup] = useState<AccountGroup | "new" | null>(
      null,
    ),
    [gf, setGf] = useState({ name: "", root: "asset", parentId: "" });
  const groups = useQuery({
    queryKey: ["account-groups", ws.tenantId, ws.entityId],
    queryFn: () => api<AccountGroup[]>("/accounts/groups", { scope: ws.scope }),
  });
  const save = useMutation({
    mutationFn: () =>
      editing === "new"
        ? api("/accounts/accounts", {
            method: "POST",
            body: { code: f.code, name: f.name, groupId: f.groupId },
            scope: ws.scope,
          })
        : api(`/accounts/accounts/${editing?.id}`, {
            method: "PUT",
            body: { name: f.name, groupId: f.groupId, isActive: f.isActive },
            scope: ws.scope,
          }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      setEditing(null);
    },
  });
  const saveGroup = useMutation({
    mutationFn: () =>
      editingGroup === "new"
        ? api("/accounts/groups", {
            method: "POST",
            body: {
              name: gf.name,
              root: gf.root,
              ...(gf.parentId && { parentId: gf.parentId }),
            },
            scope: ws.scope,
          })
        : api(`/accounts/groups/${editingGroup?.id}`, {
            method: "PUT",
            body: { name: gf.name, parentId: gf.parentId || null },
            scope: ws.scope,
          }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["account-groups"] });
      setEditingGroup(null);
    },
  });
  const editAccount = (a: Account | "new") => {
    save.reset();
    setF(
      a === "new"
        ? { code: "", name: "", groupId: "", isActive: true }
        : {
            code: a.code,
            name: a.name,
            groupId: a.groupId,
            isActive: a.isActive,
          },
    );
    setEditing(a);
  };
  const editGroup = (g: AccountGroup | "new", parent?: AccountGroup) => {
    saveGroup.reset();
    setGf(
      g === "new"
        ? { name: "", root: parent?.root ?? "asset", parentId: parent?.id ?? "" }
        : { name: g.name, root: g.root, parentId: g.parentId ?? "" },
    );
    setEditingGroup(g);
  };
  const [search, setSearch] = useState(""),
    [rootFilter, setRootFilter] = useState<string | null>(null),
    [showInactive, setShowInactive] = useState(false),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [newLedgerGroup, setNewLedgerGroup] = useState<AccountGroup | null>(null);
  const term = search.trim().toLowerCase();
  const all = groups.data ?? [],
    ledgers = (q.data ?? []).filter((a) => showInactive || a.isActive);
  const childrenOf = (id: string | null) =>
    all
      .filter((g) => g.parentId === id)
      .sort((a, b) => a.name.localeCompare(b.name));
  const ledgersOf = (id: string) =>
    ledgers
      .filter((a) => a.groupId === id)
      .sort((a, b) => a.name.localeCompare(b.name));
  const ledgerMatches = (a: Account, g: AccountGroup) =>
    !term ||
    [a.name, a.code, g.name, a.role ? roleLabel(a.role) : ""].some((t) =>
      t.toLowerCase().includes(term),
    );
  /** Ledgers in this group and below that pass the search, used for counts and to hide empty branches. */
  const count = (g: AccountGroup): number =>
    ledgersOf(g.id).filter((a) => ledgerMatches(a, g)).length +
    childrenOf(g.id).reduce((n, c) => n + count(c), 0);
  const visible = (g: AccountGroup) =>
    !term || count(g) > 0 || g.name.toLowerCase().includes(term);
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const canCreate = ws.can("accounts.account.create"),
    canUpdate = ws.can("accounts.account.update");
  const renderGroup = (g: AccountGroup, depth: number): ReactNode => {
    if (!visible(g)) return null;
    // A search keeps every matching path open.
    const open = !!term || !collapsed.has(g.id);
    const own = ledgersOf(g.id).filter(
      (a) => ledgerMatches(a, g) || (!!term && g.name.toLowerCase().includes(term)),
    );
    return (
      <li key={g.id}>
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line py-2"
          style={{ paddingLeft: depth * 16 }}
        >
          <button
            type="button"
            className="flex min-w-0 items-center gap-1 text-left font-medium"
            aria-expanded={open}
            onClick={() => toggle(g.id)}
          >
            <span aria-hidden className="inline-block w-4 text-muted">
              {open ? "▾" : "▸"}
            </span>
            <span className="truncate">{g.name}</span>
          </button>
          <Badge>{count(g)}</Badge>
          <span className="ml-auto flex flex-wrap gap-1">
            {canCreate && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Add ledger to ${g.name}`}
                  onClick={() => setNewLedgerGroup(g)}
                >
                  Add ledger
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Add sub-group to ${g.name}`}
                  onClick={() => editGroup("new", g)}
                >
                  Add sub-group
                </Button>
              </>
            )}
            {canUpdate && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Edit group ${g.name}`}
                onClick={() => editGroup(g)}
              >
                Edit
              </Button>
            )}
          </span>
        </div>
        {open && (
          <ul>
            {own.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line py-2"
                style={{ paddingLeft: depth * 16 + 20 }}
              >
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span>{a.name}</span>
                  <span className="font-mono text-xs text-muted">{a.code}</span>
                </span>
                {a.role && <Badge tone="info">Used for: {roleLabel(a.role)}</Badge>}
                {!a.isActive && <Badge tone="warning">Inactive</Badge>}
                {canUpdate && (
                  <Button
                    className="ml-auto"
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit ledger ${a.name}`}
                    onClick={() => editAccount(a)}
                  >
                    Edit
                  </Button>
                )}
              </li>
            ))}
            {childrenOf(g.id).map((c) => renderGroup(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };
  const roots = ROOTS.filter((r) => !rootFilter || r.key === rootFilter);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <Field label="Search ledgers">
            {(p) => (
              <Input
                {...p}
                type="search"
                placeholder="Name, code or group"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
          </Field>
        </div>
        {canCreate && (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => editGroup("new")}>
              New group
            </Button>
            <Button onClick={() => editAccount("new")}>New ledger</Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Show classification">
        {[{ key: null, label: "All" }, ...ROOTS].map((r) => (
          <Button
            key={r.label}
            size="sm"
            variant={rootFilter === r.key ? "secondary" : "ghost"}
            aria-pressed={rootFilter === r.key}
            onClick={() => setRootFilter(r.key)}
          >
            {r.label}
          </Button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
      </div>
      <p className="text-sm text-muted">
        Ledgers marked “Used for” receive automatic postings from documents.
        Choose which ledger each posting uses in Accounting setup.
      </p>
      {(q.error || groups.error) && (
        <Alert tone="danger">{q.error?.message ?? groups.error?.message}</Alert>
      )}
      {(q.isLoading || groups.isLoading) && <p>Loading chart…</p>}
      {groups.data &&
        roots.map((r) => {
          const top = childrenOf(null).filter((g) => g.root === r.key && visible(g));
          if (term && top.length === 0) return null;
          return (
            <Card key={r.key}>
              <CardHeader
                title={r.label}
                description={(() => {
                  const n = top.reduce((sum, g) => sum + count(g), 0);
                  return `${n} ${n === 1 ? "ledger" : "ledgers"}`;
                })()}
              />
              <ul className="px-5 pb-3">{top.map((g) => renderGroup(g, 0))}</ul>
            </Card>
          );
        })}
      {term && groups.data && roots.every((r) => !childrenOf(null).some((g) => g.root === r.key && visible(g))) && (
        <p className="text-sm text-muted">No ledger or group matches “{search.trim()}”.</p>
      )}
      {editing === "new" && <AccountDialog onClose={() => setEditing(null)} />}
      {newLedgerGroup && (
        <AccountDialog
          prefill={{ groupId: newLedgerGroup.id, root: newLedgerGroup.root }}
          onClose={() => setNewLedgerGroup(null)}
        />
      )}
      {editing && editing !== "new" && (
        <FormDialog
          title="Edit ledger"
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
                disabled
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
          <Field label="Ledger status">
            {(p) => (
              <Select
                {...p}
                value={String(f.isActive)}
                onChange={(e) =>
                  setF({ ...f, isActive: e.target.value === "true" })
                }
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            )}
          </Field>
        </FormDialog>
      )}
      {editingGroup && (
        <FormDialog
          title={editingGroup === "new" ? "New group" : "Edit group"}
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
                  setGf({ ...gf, root: e.target.value, parentId: "" })
                }
                disabled={editingGroup !== "new"}
              >
                {["asset", "liability", "equity", "income", "expense"].map(
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
                      (editingGroup === "new" || g.id !== editingGroup.id),
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
