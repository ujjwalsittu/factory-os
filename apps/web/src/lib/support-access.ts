'use client';
// Audited support access (decision 050): the explicit support transport. Controls use the ordinary native session and
// tenant header only; the support selector header is sent solely on workspace GETs, never by the global API client.
import { SUPPORT_HEADER, type SupportArea, type SupportErrorCode, type SupportQuery } from '@factoryos/auth';

export class SupportApiError extends Error {
  constructor(
    public status: number,
    public code: SupportErrorCode,
    public reason: string | null,
  ) {
    super(code);
  }
}

const CODES: SupportErrorCode[] = ['SUPPORT_UNAVAILABLE', 'SUPPORT_REAUTHENTICATE', 'SUPPORT_ENDED', 'SUPPORT_INVALID_INPUT'];

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, credentials: 'include', cache: 'no-store' });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const body = (data ?? {}) as { code?: unknown; reason?: unknown };
    const code = CODES.includes(body.code as SupportErrorCode) ? (body.code as SupportErrorCode) : res.status === 401 ? 'SUPPORT_REAUTHENTICATE' : 'SUPPORT_UNAVAILABLE';
    throw new SupportApiError(res.status, code, typeof body.reason === 'string' ? body.reason : null);
  }
  return data as T;
}

/** Fixed control paths under /api/support-access (policy, grants, operator inbox). */
export function supportControl<T>(path: string, options: { method?: 'GET' | 'POST' | 'PATCH'; body?: object; tenantId?: string; signal?: AbortSignal } = {}): Promise<T> {
  if (!/^\/(policy|grants|operator\/grants)(\/[0-9a-f-]{36}\/(revoke|stop|start))?(\?[\w=&%.-]*)?$/.test(path)) throw new Error('Unknown support control path');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body) headers['content-type'] = 'application/json';
  if (options.tenantId) headers['x-tenant-id'] = options.tenantId;
  return send<T>(`/api/support-access${path}`, { method: options.method ?? 'GET', headers, body: options.body ? JSON.stringify(options.body) : undefined, signal: options.signal });
}

/** Workspace GETs only: the grant selector header plus strict panel parameters (the area is in the path). */
export function supportWorkspace<T>(grantId: string, path: 'context' | SupportArea, query?: SupportQuery, signal?: AbortSignal): Promise<T> {
  const params = new URLSearchParams();
  if (query) for (const [k, v] of Object.entries(query)) if (k !== 'area' && v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const qs = params.toString() ? `?${params}` : '';
  return send<T>(`/api/support-access/workspace/${path}${qs}`, { method: 'GET', headers: { accept: 'application/json', [SUPPORT_HEADER]: grantId }, signal });
}

const REASONS: Record<string, string> = {
  'sign-in-again': 'Sign in again: confirming support access needs a sign-in from the last five minutes.',
  'email-unverified': 'Verify your email address first.',
  'totp-required': 'Turn on authenticator-app two-factor first.',
  'no-password': 'Set a password for your account first.',
  password: 'That password is not correct.',
  'credentials-changed': 'Your password or two-factor changed while confirming. Sign in again.',
  'session-mismatch': 'Your session changed. Sign in again.',
  'no-session': 'Sign in again.',
};

export function supportErrorText(error: unknown): string {
  if (!(error instanceof SupportApiError)) return 'Support access is unavailable right now.';
  if (error.code === 'SUPPORT_REAUTHENTICATE') return REASONS[error.reason ?? ''] ?? 'Sign in again to continue.';
  if (error.code === 'SUPPORT_INVALID_INPUT') return 'Some details are not valid. Check them and try again.';
  if (error.code === 'SUPPORT_ENDED') return 'This support access has ended.';
  return 'Support access is unavailable for this request.';
}

/** Re-authentication goes through the normal sign-in (password, two-factor, passkey or SSO) and returns here. */
export function needsSignIn(error: unknown): boolean {
  return error instanceof SupportApiError && error.code === 'SUPPORT_REAUTHENTICATE' && ['sign-in-again', 'credentials-changed', 'session-mismatch', 'no-session'].includes(error.reason ?? 'no-session');
}

export const AREA_LABELS: Record<SupportArea, string> = {
  inventory: 'Inventory',
  'sales-invoices': 'Sales invoices',
  'purchase-invoices': 'Purchase invoices',
  'work-orders': 'Work orders',
  accounting: 'Accounting reports',
};

export const STATE_TONE = { approved: 'accent', active: 'success', expired: 'neutral', invalidated: 'warning', stopped: 'neutral', revoked: 'danger' } as const;
