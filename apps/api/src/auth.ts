import type { Database } from '@factoryos/db';
import { account, session, twoFactor, user, verification } from '@factoryos/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor as twoFactorPlugin } from 'better-auth/plugins';
import type { AppConfig } from './config.js';
import {authEmailCallbacks} from './modules/email/auth-email.js';
import type {EmailService} from './modules/email/email.service.js';
import {createAuthMiddleware} from 'better-auth/api';
import {buildSsoOptions} from './modules/sso/sso.policy.js';

export function createAuth(db: Database, config: AppConfig,email:EmailService) {
  const callbacks=authEmailCallbacks(db,config,email);
  const sso=buildSsoOptions(db,config);
  const mutationBefore=sso.hooks!.before!;
  return betterAuth({
    ...sso,
    appName: 'FactoryOS',
    logger:{disabled:true},
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
      resetPasswordTokenExpiresIn:3600,
      revokeSessionsOnPasswordReset:true,
      sendResetPassword:callbacks.sendResetPassword,
    },
    emailVerification:{sendVerificationEmail:callbacks.sendVerificationEmail,sendOnSignUp:config.email.mode==='smtp',sendOnSignIn:false,expiresIn:3600},
    hooks:{...sso.hooks,before:createAuthMiddleware(async ctx=>{const outcome=await callbacks.before({...ctx,returnHeaders:false});if(outcome)return outcome;return mutationBefore({...ctx,returnHeaders:false});})},
    onAPIError:{errorURL:new URL('/sso/error',config.WEB_ORIGIN).href},
    rateLimit: { enabled: config.NODE_ENV !== 'test', window: 60, max: 100 },
    plugins: [twoFactorPlugin({ issuer: 'FactoryOS' })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
