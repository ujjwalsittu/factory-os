import type { Database } from '@factoryos/db';
import { account, session, twoFactor, user, verification } from '@factoryos/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor as twoFactorPlugin } from 'better-auth/plugins';
import type { AppConfig } from './config.js';

export function createAuth(db: Database, config: AppConfig) {
  return betterAuth({
    appName: 'FactoryOS',
    baseURL: config.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.WEB_ORIGIN, ...config.EXTRA_TRUSTED_ORIGINS],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification, twoFactor },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // TODO(phase-1): send through the mail service. Until then links are logged in development.
      sendResetPassword: async ({ user: u, url }) => {
        console.info(`[auth] password reset for ${u.email}: ${url}`);
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: config.NODE_ENV !== 'test', window: 60, max: 100 },
    plugins: [twoFactorPlugin({ issuer: 'FactoryOS' })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
