'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type Scope } from '@/lib/api';
import type { Me, TenantContextData } from '@/lib/types';

interface Workspace {
  me: Me;
  tenantId: string;
  tenantName: string;
  /** null = "All entities" (tenant-level view). */
  entityId: string | null;
  setEntityId: (id: string | null) => void;
  setTenantId: (id: string) => void;
  /** Tenant-level context (tenant-wide grants only). Used by settings screens. */
  tenantCtx: TenantContextData;
  /** Effective permissions in the active entity, or tenant-wide when none is selected. */
  can: (permission: string) => boolean;
  /** Tenant-wide permission (settings and admin screens). */
  canTenant: (permission: string) => boolean;
  /** Scope for API calls on tenant-level screens. */
  tenantScope: Scope;
  /** Scope for API calls on entity-level screens. */
  scope: Scope;
}

const Ctx = createContext<Workspace | null>(null);

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') });
}

export function WorkspaceProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const [tenantId, setTenant] = useState<string | null>(null);
  const [entityId, setEntity] = useState<string | null>(null);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace('/sign-in?next=/app');
    if (!me.data) return;
    if (me.data.tenants.length === 0) {
      router.replace(me.data.platformAdmin ? '/platform' : '/onboarding');
      return;
    }
    const saved = read('fos.tenant');
    const t = me.data.tenants.find((x) => x.id === saved) ?? me.data.tenants[0]!;
    setTenant(t.id);
    setEntity(read(`fos.entity.${t.id}`));
  }, [me.data, me.error, router]);

  const tenantCtx = useQuery({
    queryKey: ['ctx', tenantId],
    queryFn: () => api<TenantContextData>('/me/context', { scope: { tenantId } }),
    enabled: !!tenantId,
  });
  const entityCtx = useQuery({
    queryKey: ['ctx', tenantId, entityId],
    queryFn: () => api<TenantContextData>('/me/context', { scope: { tenantId, entityId } }),
    enabled: !!tenantId && !!entityId,
    retry: false,
  });

  // Members with only entity-scoped roles have no "All entities" view: select their first entity.
  useEffect(() => {
    const data = tenantCtx.data;
    if (data && !data.allEntities && !entityId && data.entities[0] && tenantId) {
      write(`fos.entity.${tenantId}`, data.entities[0].id);
      setEntity(data.entities[0].id);
    }
  }, [tenantCtx.data, entityId, tenantId]);

  // Forget a saved entity the user can no longer access.
  useEffect(() => {
    if (entityCtx.error && tenantId) {
      write(`fos.entity.${tenantId}`, null);
      setEntity(null);
    }
  }, [entityCtx.error, tenantId]);

  const setEntityId = useCallback(
    (id: string | null) => {
      if (tenantId) write(`fos.entity.${tenantId}`, id);
      setEntity(id);
    },
    [tenantId],
  );
  const setTenantId = useCallback(
    (id: string) => {
      write('fos.tenant', id);
      setTenant(id);
      setEntity(read(`fos.entity.${id}`));
      void qc.invalidateQueries();
    },
    [qc],
  );

  const value = useMemo<Workspace | null>(() => {
    if (!me.data || !tenantId || !tenantCtx.data) return null;
    const tenantPerms = new Set(tenantCtx.data.permissions);
    const activePerms = entityId && entityCtx.data ? new Set(entityCtx.data.permissions) : tenantPerms;
    return {
      me: me.data,
      tenantId,
      tenantName: me.data.tenants.find((t) => t.id === tenantId)?.name ?? '',
      entityId: entityId && entityCtx.data ? entityId : null,
      setEntityId,
      setTenantId,
      tenantCtx: tenantCtx.data,
      can: (p) => activePerms.has(p),
      canTenant: (p) => tenantPerms.has(p),
      tenantScope: { tenantId },
      scope: { tenantId, entityId: entityId && entityCtx.data ? entityId : null },
    };
  }, [me.data, tenantId, tenantCtx.data, entityId, entityCtx.data, setEntityId, setTenantId]);

  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): Workspace {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return v;
}
