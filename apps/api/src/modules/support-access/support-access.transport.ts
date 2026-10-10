// Audited support access (decision 050): the boundary in front of every route, including native auth.
// The support header is only an untrusted grant selector. It is accepted on exactly two kinds of request — a GET of
// the workspace context or of one catalogued area — and refused everywhere else before any handler (native auth,
// public routes, ordinary APIs, exports, mutations) runs. Origins are compared to configuration, never to Host.
import { SUPPORT_AREAS, SUPPORT_HEADER } from '@factoryos/auth';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { SupportConfig } from './support-access.types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORKSPACE = new RegExp(`^/api/support-access/workspace/(context|${SUPPORT_AREAS.join('|')})$`);
const CONTROL = /^\/api\/support-access(\/|$)/;

const refuse = (res: Response, status = 403, code = 'SUPPORT_UNAVAILABLE') => res.status(status).json({ code });

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Exact configured origin; when a browser omits Origin on a GET, same-origin Fetch Metadata plus an exact Referer. */
export function allowedOrigin(req: Request, origins: string[], method: 'GET' | 'WRITE'): boolean {
  const origin = req.get('origin');
  if (origin !== undefined) return origins.includes(origin);
  if (method !== 'GET') return false;
  const referer = originOf(req.get('referer'));
  return req.get('sec-fetch-site') === 'same-origin' && referer !== null && origins.includes(referer);
}

export function supportTransport(config: SupportConfig): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.originalUrl.split('?')[0]!;
    const selector = req.headers[SUPPORT_HEADER];
    if (selector !== undefined) {
      // Exactly one well-formed selector, only on a workspace GET, never with tenant/entity selection.
      if (typeof selector !== 'string' || !UUID.test(selector)) return refuse(res, 400, 'SUPPORT_INVALID_INPUT');
      if (req.method !== 'GET' || !WORKSPACE.test(path)) return refuse(res);
      if (req.headers['x-tenant-id'] !== undefined || req.headers['x-entity-id'] !== undefined) return refuse(res, 400, 'SUPPORT_INVALID_INPUT');
      if (!config.enabled) return refuse(res);
      if (!allowedOrigin(req, config.origins, 'GET')) return refuse(res);
      return next();
    }
    if (WORKSPACE.test(path) || path.startsWith('/api/support-access/workspace')) return refuse(res, 400, 'SUPPORT_INVALID_INPUT');
    // Support controls change consent; they need the exact web origin, not just a cookie.
    if (CONTROL.test(path) && req.method !== 'GET' && !allowedOrigin(req, config.origins, 'WRITE')) return refuse(res);
    return next();
  };
}
