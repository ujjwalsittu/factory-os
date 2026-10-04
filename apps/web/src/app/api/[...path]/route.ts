/**
 * Same-origin proxy to the NestJS API, resolved at runtime (API_INTERNAL_URL), so cookies are
 * first-party and the API URL can change in Coolify without rebuilding the web image.
 */
import type { NextRequest } from 'next/server';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'content-length']);

async function forward(req: NextRequest): Promise<Response> {
  const url = new URL(req.nextUrl.pathname + req.nextUrl.search, API);
  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k)) headers.set(k, v);
  });
  headers.set('x-forwarded-host', req.headers.get('host') ?? '');
  headers.set('x-forwarded-proto', req.nextUrl.protocol.replace(':', ''));

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });

  const out = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k) && k !== 'set-cookie' && k !== 'content-encoding') out.set(k, v);
  });
  for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST, forward as PUT };
