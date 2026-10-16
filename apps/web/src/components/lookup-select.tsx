'use client';
import { Select } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { type ChangeEvent, type ReactNode, type SelectHTMLAttributes, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import type { HsnCode } from '@/lib/types';
import { AccountDialog, CentreDialog, HsnDialog, ItemDialog, PartyDialog, UomDialog, WarehouseDialog } from './master-dialogs';
import { ProjectDialog } from './project-dialog';
import { useWorkspace } from './workspace';

/**
 * Add new from any list. A field that saves a reference to a master record offers "Add new …" when the person may create
 * that record. Filters, search boxes and report selectors never use this: they find records, they do not save one.
 */
export type LookupKind = 'item' | 'party' | 'warehouse' | 'uom' | 'hsn' | 'workCentre' | 'account' | 'project';

const PERMISSION: Record<LookupKind, string> = {
  item: 'masters.item.create',
  party: 'masters.party.create',
  warehouse: 'inventory.warehouse.create',
  uom: 'masters.uom.create',
  hsn: 'masters.hsn.create',
  workCentre: 'manufacturing.work_centre.create',
  account: 'accounts.account.create',
  project: 'services.project.create',
};
/** Records that belong to one legal entity are created in the active one. */
const ENTITY_KINDS = new Set<LookupKind>(['warehouse', 'workCentre', 'account']);

export type Prefill = {
  /** The text typed in a search box, or the name a field suggests. */
  name?: string;
  /** Item type, warehouse type, ledger root: whatever the field needs. */
  type?: string;
  roles?: { isCustomer?: boolean; isSupplier?: boolean; isJobWorker?: boolean };
  groupId?: string;
  root?: string;
  code?: string;
};
/** What a dialog hands back: always an `id`, plus the rest of the saved record. */
export type Created = { id: string } & Record<string, unknown>;

export function useCanAdd(kind: LookupKind): boolean {
  const ws = useWorkspace();
  return ws.can(PERMISSION[kind]) && (!ENTITY_KINDS.has(kind) || !!ws.entityId);
}

/** The dialog for a record kind. The same form the master's own page opens. */
export function CreateDialog({ kind, prefill, onCreated, onClose }: { kind: LookupKind; prefill?: Prefill; onCreated: (r: Created) => void; onClose: () => void }) {
  const done = (r: unknown) => onCreated(r as Created);
  // Dialogs are rendered at the end of the page so a form opened from inside another form is never nested in it.
  const dialog = (() => {
    switch (kind) {
      case 'item':
        return <ItemDialog item={null} onClose={onClose} onSaved={done} prefill={{ ...(prefill?.code && { code: prefill.code }), ...(prefill?.name && { name: prefill.name }), ...(prefill?.type && { type: prefill.type as never }) }} />;
      case 'party':
        return <PartyDialog party={null} onClose={onClose} onSaved={done} prefill={{ ...(prefill?.name && { name: prefill.name }), ...prefill?.roles }} />;
      case 'warehouse':
        return <WarehouseDialog onClose={onClose} onSaved={done} prefill={{ ...(prefill?.name && { name: prefill.name }), ...(prefill?.type && { type: prefill.type }) }} />;
      case 'uom':
        return <UomDialog onClose={onClose} onSaved={done} prefill={{ ...(prefill?.name && { code: prefill.name }) }} />;
      case 'hsn':
        return <HsnDialog onClose={onClose} onSaved={done} prefill={{ ...(prefill?.code && { code: prefill.code }) }} />;
      case 'workCentre':
        return <CentreDialog centre={null} onClose={onClose} onSaved={done} prefill={{ ...(prefill?.name && { name: prefill.name }) }} />;
      case 'account':
        return <AccountDialog onClose={onClose} onSaved={done} prefill={{ ...(prefill?.name && { name: prefill.name }), ...(prefill?.groupId && { groupId: prefill.groupId }), ...(prefill?.root && { root: prefill.root }) }} />;
      case 'project':
        return <ProjectDialog project={null} onClose={onClose} onSaved={(id) => done({ id })} prefill={{ ...(prefill?.name && { title: prefill.name }) }} />;
    }
  })();
  return typeof document === 'undefined' ? null : createPortal(dialog, document.body);
}

const NEW = '__new__';

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>;

/** What a select's onChange handler reads: the new value. */
const asChange = (value: string) => ({ target: { value }, currentTarget: { value } }) as unknown as ChangeEvent<HTMLSelectElement>;

/**
 * A native select whose last choice is "＋ Add new …". Picking it opens the form; on save the new record is selected.
 * Without the permission the choice is not shown. `empty` shows a hint under the field instead of a blank control.
 */
export function LookupSelect({
  kind,
  noun,
  value,
  onChange,
  onValue,
  prefill,
  empty,
  children,
  ...rest
}: SelectProps & {
  kind: LookupKind;
  /** Singular noun for the choice, e.g. "supplier". */
  noun: string;
  value: string;
  /** Same as a select's onChange: used for real choices, and for the new record once it is saved. */
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  /** Alternative to onChange when only the id is needed. */
  onValue?: (id: string, record?: Created) => void;
  prefill?: Prefill;
  empty?: boolean;
  children: ReactNode;
}) {
  const canAdd = useCanAdd(kind);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Select
        {...rest}
        value={value}
        onChange={(e) => {
          if (e.target.value === NEW) return setOpen(true);
          onChange?.(e);
          onValue?.(e.target.value);
        }}
      >
        {children}
        {canAdd && <option value={NEW}>＋ Add new {noun}…</option>}
      </Select>
      {empty &&
        (canAdd ? (
          <button type="button" className="mt-1 text-left text-[12px] text-accent underline-offset-2 hover:underline" onClick={() => setOpen(true)}>
            No {noun}s yet. Add one.
          </button>
        ) : (
          <p className="mt-1 text-[12px] text-muted">No {noun}s yet. Ask an administrator to add it.</p>
        ))}
      {open && (
        <CreateDialog
          kind={kind}
          {...(prefill && { prefill })}
          onClose={() => setOpen(false)}
          onCreated={(r) => {
            onChange?.(asChange(r.id));
            onValue?.(r.id, r);
          }}
        />
      )}
    </>
  );
}

/** Under the HSN/SAC field of the item form: adds the typed code to the list when it is not there yet. */
export function HsnAdd({ code }: { code: string }) {
  const ws = useWorkspace();
  const canAdd = useCanAdd('hsn');
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['hsn', ws.tenantId], queryFn: () => api<HsnCode[]>('/hsn-codes', { scope: ws.scope }), enabled: ws.can('masters.hsn.read') });
  const trimmed = code.trim();
  const known = (list.data ?? []).some((h) => h.code === trimmed);
  if (!canAdd || !trimmed || known || !list.data) return null;
  return (
    <>
      <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => setOpen(true)}>
        Add {trimmed} to the HSN/SAC list
      </button>
      {open && <CreateDialog kind="hsn" prefill={{ code: trimmed }} onCreated={() => undefined} onClose={() => setOpen(false)} />}
    </>
  );
}
