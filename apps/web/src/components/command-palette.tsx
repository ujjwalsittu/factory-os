'use client';
import { cn } from '@factoryos/ui';
import { CornerDownLeft, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { NAV } from './app-shell';
import { useWorkspace } from './workspace';

interface Command {
  id: string;
  label: string;
  group: string;
  run: () => void;
}

/**
 * ⌘K palette (docs/13 X2). Phase 0 covers navigation and actions; document search
 * (numbers, parties, serials, heat numbers) plugs in here in Phase 1.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      router.push(href);
      onClose();
    };
    const nav = NAV.flatMap((g) =>
      g.items
        .filter((i) => !i.phase && (!i.permission || (i.entityScoped ? ws.can(i.permission) : ws.canTenant(i.permission))))
        .map((i) => ({ id: i.href, label: i.label, group: g.section ?? 'Go to', run: go(i.href) })),
    );
    const actions: Command[] = [];
    for (const [resource, path, label] of [['quotation', 'quotations', 'quotation'], ['sales_order', 'orders', 'sales order'], ['sales_invoice', 'invoices', 'sales invoice']] as const) {
      if (ws.can(`selling.${resource}.create`)) actions.push({ id: resource, label: `New ${label}`, group: 'Actions', run: go(`/app/selling/${path}/new`) });
    }
    if (ws.canTenant('settings.user.create')) actions.push({ id: 'invite', label: 'Invite a user', group: 'Actions', run: go('/app/settings/users?invite=1') });
    if (ws.canTenant('settings.entity.create')) actions.push({ id: 'entity', label: 'Add a legal entity', group: 'Actions', run: go('/app/settings/entities?new=1') });
    if (ws.canTenant('settings.role.create')) actions.push({ id: 'role', label: 'Create a role', group: 'Actions', run: go('/app/settings/roles?new=1') });
    if (ws.can('inventory.stock_entry.create')) {
      for (const p of ['receipt', 'issue', 'transfer'] as const) {
        actions.push({ id: `se-${p}`, label: `New stock ${p}`, group: 'Actions', run: go(`/app/inventory/entries/new?purpose=${p}`) });
      }
    }
    if (ws.can('accounts.settlement.create')) {
      actions.push({ id: 'rct', label: 'New customer receipt', group: 'Actions', run: go('/app/accounts/settlements/new?direction=receipt') });
      actions.push({ id: 'pay', label: 'New supplier payment', group: 'Actions', run: go('/app/accounts/settlements/new?direction=payment') });
    }
    if (ws.can('buying.purchase_order.create')) actions.push({ id: 'po', label: 'New purchase order', group: 'Actions', run: go('/app/buying/orders/new') });
    if (ws.can('accounts.voucher.create')) actions.push({ id: 'journal', label: 'New journal', group: 'Actions', run: go('/app/accounts/journals/new') });
    if (ws.can('buying.return_claim.create')) actions.push({ id: 'supplier-return', label: 'New purchase return claim', group: 'Actions', run: go('/app/buying/return-claims/new') });
    if (ws.can('buying.supplier_note.create')) actions.push({ id: 'supplier-note', label: 'Record supplier note', group: 'Actions', run: go('/app/buying/supplier-notes/new') });
    if (ws.can('buying.purchase_invoice.create')) actions.push({ id: 'pi', label: 'New purchase invoice', group: 'Actions', run: go('/app/buying/invoices/new') });
    if (ws.can('buying.landed_cost.create')) actions.push({ id: 'lcv', label: 'New landed cost (Bill of Entry)', group: 'Actions', run: go('/app/buying/landed-costs/new') });
    if (ws.can('masters.item.create')) actions.push({ id: 'item', label: 'New item', group: 'Actions', run: go('/app/masters/items?new=1') });
    if (ws.can('masters.party.create')) actions.push({ id: 'party', label: 'New customer or supplier', group: 'Actions', run: go('/app/masters/parties?new=1') });
    for (const e of ws.tenantCtx.entities) {
      actions.push({ id: `entity:${e.id}`, label: `Switch to ${e.shortName}`, group: 'Entities', run: () => (ws.setEntityId(e.id), onClose()) });
    }
    if (ws.me.platformAdmin === 'superadmin') actions.push({ id: 'platform', label: 'Platform console', group: 'Platform', run: go('/platform') });
    return [...actions, ...nav];
  }, [ws, router, onClose]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? commands.filter((c) => c.label.toLowerCase().includes(needle) || c.group.toLowerCase().includes(needle)) : commands;
  }, [q, commands]);

  useEffect(() => {
    if (open) {
      setQ('');
      setIndex(0);
    }
  }, [open]);
  useEffect(() => setIndex(0), [q]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-subtle" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') (e.preventDefault(), setIndex((i) => Math.min(i + 1, results.length - 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setIndex((i) => Math.max(i - 1, 0)));
              if (e.key === 'Enter') results[index]?.run();
            }}
            placeholder="Type a command or page…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-subtle"
            role="combobox"
            aria-expanded
            aria-controls="cmdk-list"
            aria-activedescendant={results[index] ? `cmdk-${results[index].id}` : undefined}
          />
          <kbd className="rounded border border-line px-1.5 font-mono text-[11px] text-subtle">Esc</kbd>
        </div>
        <ul id="cmdk-list" role="listbox" className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">No matches</li>}
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`cmdk-${c.id}`}
              role="option"
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={c.run}
              className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[13px]', i === index && 'bg-accent-soft text-accent')}
            >
              <span className="w-20 shrink-0 text-[11px] text-subtle">{c.group}</span>
              <span className="truncate">{c.label}</span>
              {i === index && <CornerDownLeft className="ml-auto size-3.5" />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
