'use client';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { api, type Scope } from '@/lib/api';
import { ALL_ITEMS, AREAS, type AreaId } from './nav-data';
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
 * One pending save per person and workspace for the whole page, whichever part of the menu made the change: the save
 * always sends what the cache holds when it fires, so two writers can never send an older set after a newer one. The key
 * includes the person, so on a shared computer one person's menu is never saved under another's sign-in.
 */
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; qc: QueryClient; scope: Scope; userId: string; tenantId: string }>();
const idOf = (userId: string, tenantId: string) => `${userId}:${tenantId}`;
const keyOf = (userId: string, tenantId: string) => ['preferences', userId, tenantId] as const;

function flush(id: string) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  const data = p.qc.getQueryData<Preferences>(keyOf(p.userId, p.tenantId));
  // keepalive lets the save finish even when it is sent as the tab closes or the page reloads.
  if (data) api('/me/preferences', { method: 'PUT', body: data, scope: p.scope, keepalive: true }).catch(() => undefined);
}

function schedule(userId: string, tenantId: string, qc: QueryClient, scope: Scope) {
  const id = idOf(userId, tenantId);
  const old = pending.get(id);
  if (old) clearTimeout(old.timer);
  pending.set(id, { timer: setTimeout(() => flush(id), SAVE_DELAY_MS), qc, scope, userId, tenantId });
}

/** Drops saves that have not been sent. Called at sign-out, before the session ends, so nothing is sent for the next person. */
export function cancelPendingPreferences() {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
}

/** Restored or fetched choices cleaned against the menu: known links only, no repeats, within the limits. */
function clean(x: Partial<Preferences> | null | undefined): Preferences | null {
  if (!x || !Array.isArray(x.favourites) || !Array.isArray(x.recent) || !Array.isArray(x.collapsed)) return null;
  const known = new Set(ALL_ITEMS.map((i) => i.href));
  const areas = new Set<string>(AREAS.map((a) => a.id));
  const links = (xs: unknown[], max: number) => [...new Set(xs.filter((h): h is string => typeof h === 'string' && known.has(h)))].slice(0, max);
  return {
    favourites: links(x.favourites, MAX_FAVOURITES),
    recent: links(x.recent, MAX_RECENT),
    collapsed: [...new Set(x.collapsed.filter((a): a is AreaId => typeof a === 'string' && areas.has(a)))],
  };
}

/**
 * The person's menu favourites, recent pages and closed areas for this workspace (decision 068). Changes show at once and
 * are saved a moment later; if saving fails the menu keeps working with what the person chose in this tab.
 */
export function usePreferences() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const userId = ws.me.user.id;
  const tenantId = ws.tenantId ?? '';
  const id = idOf(userId, tenantId);
  const key = keyOf(userId, tenantId);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const server = await api<Preferences>('/me/preferences', { scope: ws.tenantScope });
      // A change made while this was loading (from the copy kept in this browser) is waiting to be saved; keep it.
      return (pending.has(id) ? qc.getQueryData<Preferences>(key) : undefined) ?? server;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  // The last values are kept in this browser too, so the menu opens in the right shape before the server answers.
  const storageKey = `factoryos.menu.${userId}.${tenantId}`;
  useEffect(() => {
    try {
      if (qc.getQueryData(key)) return;
      const raw = window.localStorage.getItem(storageKey);
      const saved = clean(raw ? (JSON.parse(raw) as Partial<Preferences>) : null);
      if (saved) qc.setQueryData(key, saved);
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
    const send = () => flush(id);
    window.addEventListener('pagehide', send);
    return () => window.removeEventListener('pagehide', send);
  }, [id]);

  const prefs = query.data ?? EMPTY;
  const update = useCallback(
    (change: (p: Preferences) => Preferences) => {
      // Until the saved choices are known, changing them would overwrite them with a blank set; wait for them.
      const current = qc.getQueryData<Preferences>(key);
      if (!current) return;
      const next = change(current);
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      qc.setQueryData(key, next);
      schedule(userId, tenantId, qc, ws.tenantScope);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, id],
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
