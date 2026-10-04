'use client';
import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Talks to /api/auth on the same origin (proxied to the API). */
export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        const next = new URLSearchParams(window.location.search).get('next') ?? '';
        window.location.href = `/sign-in/two-factor${next ? `?next=${encodeURIComponent(next)}` : ''}`;
      },
    }),
  ],
});
