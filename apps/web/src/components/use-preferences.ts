'use client';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { api, type Scope } from '@/lib/api';
import type { AreaId } from './nav-data';
import { useWorkspace } from './workspace';

export interface Preferences {
  favourites: string[];
  recent: string[];
  collapsed: AreaId[];
}

const EMPTY: Preferences = { favourites: [], recent: [], collapsed: [] };
export const MAX_FAVOURITES = 12;
export const MAX_RECENT = 5;
/** Changes are sent together once the person pauses, so clicking around does not write on every click. */
const SAVE_DELAY_MS = 1500;

/**
 * One pending save per workspace for the whole page, whichever part of the menu made the change: the save always sends
 * what the cache holds when it fires, so two writers can never send an older set after a newer one.
 */
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; qc: QueryClient; scope: Scope }>();

function flush(tenantId: string) {
  const p = pending.get(tenantId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(tenantId);
  const data = p.qc.getQueryData<Preferences>(['preferences', tenantId]);
  // keepalive lets the save finish even when it is sent as the tab closes or the page reloads.
  if (data) api('/me/preferences', { method: 'PUT', body: data, scope: p.scope, keepalive: true }).catch(() => undefined);
}

function schedule(tenantId: string, qc: QueryClient, scope: Scope) {
  const old = pending.get(tenantId);
  if (old) clearTimeout(old.timer);
  pending.set(tenantId, { timer: setTimeout(() => flush(tenantId), SAVE_DELAY_MS), qc, scope });
}

/**
 * The person's menu favourites, recent pages and closed areas for this workspace (decision 068). Changes show at once and
 * are saved a moment later; if saving fails the menu keeps working with what the person chose in this tab.
 */
export function usePreferences() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const key = ['preferences', ws.tenantId];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const server = await api<Preferences>('/me/preferences', { scope: ws.tenantScope });
      // A change made while this was loading (from the copy kept in this browser) is waiting to be saved; keep it.
      return (pending.has(ws.tenantId ?? '') ? qc.getQueryData<Preferences>(key) : undefined) ?? server;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  // The last values are kept in this browser too, so the menu opens in the right shape before the server answers.
  const storageKey = `factoryos.menu.${ws.tenantId}`;
  useEffect(() => {
    try {
      if (qc.getQueryData(key)) return;
      const raw = window.localStorage.getItem(storageKey);
      const saved = raw ? (JSON.parse(raw) as Partial<Preferences>) : null;
      if (saved && Array.isArray(saved.favourites) && Array.isArray(saved.recent) && Array.isArray(saved.collapsed)) qc.setQueryData(key, saved as Preferences);
    } catch {
      /* storage unavailable: the menu waits for the server */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (!query.data) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(query.data));
    } catch {
      /* storage unavailable or full: nothing is lost, the server has it */
    }
  }, [query.data, storageKey]);
  // Leaving the page sends what is waiting.
  useEffect(() => {
    const send = () => flush(ws.tenantId ?? '');
    window.addEventListener('pagehide', send);
    return () => window.removeEventListener('pagehide', send);
  }, [ws.tenantId]);

  const prefs = query.data ?? EMPTY;
  const update = useCallback(
    (change: (p: Preferences) => Preferences) => {
      // Until the saved choices are known, changing them would overwrite them with a blank set; wait for them.
      const current = qc.getQueryData<Preferences>(key);
      if (!current) return;
      const next = change(current);
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      qc.setQueryData(key, next);
      schedule(ws.tenantId ?? '', qc, ws.tenantScope);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, ws.tenantId],
  );

  return {
    prefs,
    settled: !query.isPending,
    toggleFavourite: (href: string) =>
      update((p) =>
        p.favourites.includes(href)
          ? { ...p, favourites: p.favourites.filter((h) => h !== href) }
          : { ...p, favourites: [...p.favourites, href].slice(-MAX_FAVOURITES) },
      ),
    toggleArea: (id: AreaId) => update((p) => ({ ...p, collapsed: p.collapsed.includes(id) ? p.collapsed.filter((a) => a !== id) : [...p.collapsed, id] })),
    openArea: (id: AreaId) => update((p) => (p.collapsed.includes(id) ? { ...p, collapsed: p.collapsed.filter((a) => a !== id) } : p)),
    visit: (href: string) => update((p) => (p.recent[0] === href ? p : { ...p, recent: [href, ...p.recent.filter((h) => h !== href)].slice(0, MAX_RECENT) })),
  };
}
