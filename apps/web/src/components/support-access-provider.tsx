'use client';
// Audited support access (decision 050): the isolated support workspace state. It owns a dedicated QueryClient (never
// the ordinary workspace cache), keys every query by actor, session, grant and scope, and on any identity or grant
// change first bumps a generation, aborts every support request and drops all support data before asking the server
// for a fresh, authoritative context. Ended access clears everything and never resumes on its own.
import type { SupportArea, SupportPanelResult, SupportQuery, SupportWorkspaceContext } from '@factoryos/auth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { SupportApiError, supportControl, supportWorkspace } from '@/lib/support-access';

export type SupportEnd = 'ended' | 'expired' | 'stopped' | 'signed-out' | 'unavailable';

interface SupportAccessValue {
  context: SupportWorkspaceContext | null;
  ended: SupportEnd | null;
  /** True while the server is re-checking access (entry, focus, navigation); data stays hidden until it answers. */
  verifying: boolean;
  /** Milliseconds left by server time; null before the first context. */
  remainingMs: number | null;
  stop: () => Promise<void>;
  fetchPanel: (query: SupportQuery, signal: AbortSignal) => Promise<SupportPanelResult>;
}

const Ctx = createContext<SupportAccessValue | null>(null);

export function supportQueryKey(context: SupportWorkspaceContext, panel: SupportQuery): readonly unknown[] {
  const g = context.grant;
  return ['support', context.actor.id, context.actorSessionId, g.id, g.subject.id, g.tenantId, g.entityId, panel.area, panel.panel, panel] as const;
}

class StaleSupportResponse extends Error {}

export function SupportAccessProvider({ grantId, children }: { grantId: string; children: ReactNode }) {
  const router = useRouter();
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: 0, gcTime: 60_000 } } }));
  const session = authClient.useSession();
  const userId = session.data?.user.id ?? null;
  const sessionId = session.data?.session.id ?? null;
  const generation = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const known = useRef<{ actor: string; session: string } | null>(null);
  const [context, setContext] = useState<SupportWorkspaceContext | null>(null);
  const [ended, setEnded] = useState<SupportEnd | null>(null);
  const [verifying, setVerifying] = useState(true);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  /** Invalidate first: new generation, abort everything in flight, drop every cached support result. */
  const invalidate = useCallback(() => {
    generation.current++;
    for (const c of controllers.current) c.abort();
    controllers.current.clear();
    void client.cancelQueries();
    client.clear();
  }, [client]);

  const end = useCallback(
    (why: SupportEnd) => {
      invalidate();
      known.current = null;
      setContext(null);
      setVerifying(false);
      setEnded(why);
    },
    [invalidate],
  );

  const tracked = useCallback(<T,>(run: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    outer?.addEventListener('abort', onAbort);
    controllers.current.add(controller);
    return run(controller.signal).finally(() => {
      outer?.removeEventListener('abort', onAbort);
      controllers.current.delete(controller);
    });
  }, []);

  const endFor = useCallback(
    (error: unknown) => {
      // A busy server (503: read pool or deadline) is shown in the panel; authority answers end the workspace.
      if (error instanceof SupportApiError && error.status !== 503) end(error.code === 'SUPPORT_ENDED' ? 'ended' : 'unavailable');
    },
    [end],
  );

  const verify = useCallback(async () => {
    if (ended || !userId || !sessionId) return;
    const g = generation.current;
    setVerifying(true);
    try {
      const ctx = await tracked((signal) => supportWorkspace<SupportWorkspaceContext>(grantId, 'context', undefined, signal));
      if (g !== generation.current) return;
      const same = ctx.grant.id === grantId && ctx.actor.id === userId && ctx.actorSessionId === sessionId;
      const continuing = !known.current || (known.current.actor === ctx.actor.id && known.current.session === ctx.actorSessionId);
      if (!same || !continuing) return end('signed-out');
      known.current = { actor: ctx.actor.id, session: ctx.actorSessionId };
      setOffset(Date.parse(ctx.serverNow) - Date.now());
      setNow(Date.now());
      setContext(ctx);
      setVerifying(false);
    } catch (error) {
      if (g !== generation.current || (error instanceof DOMException && error.name === 'AbortError')) return;
      if (error instanceof SupportApiError) endFor(error);
      setVerifying(false);
    }
  }, [ended, userId, sessionId, grantId, tracked, end, endFor]);

  // Identity or grant change: invalidate before anything else can render, then ask the server again.
  useEffect(() => {
    if (session.isPending) return;
    invalidate();
    setContext(null);
    if (!userId) {
      known.current = null;
      setEnded('signed-out');
      return;
    }
    if (known.current && (known.current.actor !== userId || known.current.session !== sessionId)) {
      end('signed-out');
      return;
    }
    void verify();
    // verify is intentionally not a dependency: it is re-created with `ended`, which must not re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.isPending, userId, sessionId, grantId, invalidate]);

  // Focus and visibility: hide data until the server confirms access again; a native account change ends it.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState !== 'visible') return;
      void session.refetch();
      void verify();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [verify, session]);

  // Countdown by server time; at the deadline everything is dropped.
  useEffect(() => {
    if (!context) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [context]);
  const remainingMs = context ? Date.parse(context.expiresAt) - (now + offset) : null;
  useEffect(() => {
    if (remainingMs !== null && remainingMs <= 0) end('expired');
  }, [remainingMs, end]);

  useEffect(() => () => invalidate(), [invalidate]);

  const fetchPanel = useCallback(
    async (query: SupportQuery, signal: AbortSignal) => {
      const g = generation.current;
      const identity = known.current;
      try {
        const result = await tracked((s) => supportWorkspace<SupportPanelResult>(grantId, query.area as SupportArea, query, s), signal);
        // A late answer from an earlier identity, grant or generation is never shown.
        if (g !== generation.current || !identity || identity.actor !== known.current?.actor || identity.session !== known.current?.session) throw new StaleSupportResponse();
        return result;
      } catch (error) {
        if (g === generation.current && error instanceof SupportApiError && error.code !== 'SUPPORT_INVALID_INPUT') endFor(error);
        throw error;
      }
    },
    [grantId, tracked, endFor],
  );

  const stop = useCallback(async () => {
    try {
      await supportControl(`/operator/grants/${grantId}/stop`, { method: 'POST' });
    } catch {}
    end('stopped');
    router.replace('/support');
  }, [grantId, end, router]);

  const value = useMemo<SupportAccessValue>(
    () => ({ context: ended ? null : context, ended, verifying, remainingMs: ended ? null : remainingMs, stop, fetchPanel }),
    [context, ended, verifying, remainingMs, stop, fetchPanel],
  );
  return (
    <Ctx.Provider value={value}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </Ctx.Provider>
  );
}

export function useSupportAccess(): SupportAccessValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSupportAccess must be used inside SupportAccessProvider');
  return v;
}
