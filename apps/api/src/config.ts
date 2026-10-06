import { z } from 'zod';
import {loadEmailConfig,type EmailConfig} from '@factoryos/email';

const schema = z.object({
  GSP_CREDENTIAL_KEY_V1: z.preprocess(v=>v===''?undefined:v,z.string().regex(/^[A-Za-z0-9+/]{43}=$/).optional()),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  /** Public URL where /api/auth is reachable by the browser (the web origin when proxied). */
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  WEB_ORIGIN: z.string().url(),
  /** Optional comma-separated extra origins the web app is served from (e.g. a temporary sslip.io host). */
  EXTRA_TRUSTED_ORIGINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean))
    .pipe(z.array(z.string().url())),
  /**
   * One-time bootstrap for hosts where the seed CLI can't be run: at startup, if no SuperAdmin exists
   * yet and a user with this email has signed up, promote them. Does nothing once any SuperAdmin exists.
   */
  BOOTSTRAP_SUPERADMIN_EMAIL: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
  MIGRATE_ON_START: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** When true, any signed-in user can create a tenant (SaaS self-serve). Platform admins always can. */
  ALLOW_SELF_SERVE_TENANTS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof schema> & {email:EmailConfig};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return {...parsed.data,email:loadEmailConfig(env)};
}
