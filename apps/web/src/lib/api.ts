'use client';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
  /** Field errors keyed by path, for forms. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.issues.map((i) => [i.path, i.message]));
  }
}

export interface Scope {
  tenantId?: string | null;
  entityId?: string | null;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; scope?: Scope } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.scope?.tenantId) headers['x-tenant-id'] = init.scope.tenantId;
  if (init.scope?.entityId) headers['x-entity-id'] = init.scope.entityId;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'include',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = typeof data?.message === 'string' ? data.message : Array.isArray(data?.message) ? data.message.join(', ') : res.statusText;
    throw new ApiError(res.status, msg, data?.issues ?? []);
  }
  return data as T;
}
