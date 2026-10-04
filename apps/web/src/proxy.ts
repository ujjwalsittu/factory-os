import { type NextRequest, NextResponse } from 'next/server';

/**
 * Optimistic check only (no DB call): bounce visitors without a session cookie to sign-in.
 * The API remains the authority on every request.
 */
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.getAll().some((c) => c.name.endsWith('better-auth.session_token'));
  if (!hasSession) {
    const url = new URL('/sign-in', req.url);
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/app/:path*', '/platform/:path*', '/onboarding'] };
