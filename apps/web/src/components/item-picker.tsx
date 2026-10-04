'use client';
import { cn } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Item } from '@/lib/types';
import { useWorkspace } from './workspace';

/** Type-ahead item search (code, name or drawing number). Keyboard: ↑ ↓ Enter Esc. */
export function ItemPicker({
  value,
  onChange,
  invalid,
  stockOnly = true,
  autoFocus,
}: {
  value: Pick<Item, 'id' | 'code' | 'name'> | null;
  onChange: (item: Item) => void;
  invalid?: boolean;
  stockOnly?: boolean;
  autoFocus?: boolean;
}) {
  const ws = useWorkspace();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const results = useQuery({
    queryKey: ['items', 'pick', ws.tenantId, q, stockOnly],
    queryFn: () => api<Item[]>(`/items?limit=20${stockOnly ? '&stockOnly=true' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { scope: ws.scope }),
    enabled: open,
  });
  const list = (results.data ?? []).filter((i) => i.isActive);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => setIndex(0), [q]);

  const pick = (it: Item) => {
    onChange(it);
    setOpen(false);
    setQ('');
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <div
        className={cn(
          'flex h-9 w-full items-center rounded-lg border bg-surface px-2.5 text-sm shadow-card focus-within:border-accent focus-within:ring-3 focus-within:ring-ring',
          invalid ? 'border-danger' : 'border-line',
        )}
      >
        <input
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle"
          placeholder={value ? `${value.code} · ${value.name}` : 'Search items…'}
          value={open ? q : value ? `${value.code} · ${value.name}` : ''}
          onFocus={() => setOpen(true)}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setIndex((i) => Math.min(i + 1, list.length - 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setIndex((i) => Math.max(i - 1, 0)));
            if (e.key === 'Enter' && open && list[index]) (e.preventDefault(), pick(list[index]!));
            if (e.key === 'Escape') setOpen(false);
          }}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-label="Item"
          aria-invalid={invalid || undefined}
          autoFocus={autoFocus}
        />
        <ChevronsUpDown className="size-3.5 shrink-0 text-subtle" />
      </div>
      {open && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full min-w-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
          {results.isLoading && <li className="px-3 py-2 text-[13px] text-muted">Searching…</li>}
          {!results.isLoading && list.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">No items found</li>}
          {list.map((it, i) => (
            <li
              key={it.id}
              role="option"
              aria-selected={i === index}
              onMouseDown={(e) => (e.preventDefault(), pick(it))}
              onMouseEnter={() => setIndex(i)}
              className={cn('cursor-pointer rounded-lg px-3 py-1.5', i === index && 'bg-accent-soft')}
            >
              <div className="flex items-center gap-2 text-[13px]">
                <span className="font-mono font-medium">{it.code}</span>
                <span className="truncate text-muted">{it.name}</span>
                <span className="ml-auto shrink-0 text-[11px] text-subtle">
                  {it.uomCode}
                  {it.tracking === 'batch' ? ' · batch' : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
