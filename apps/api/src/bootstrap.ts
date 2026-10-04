import { createDb, platformAdmin, user } from '@factoryos/db';
import { Logger } from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
import type { AppConfig } from './config.js';

/** See BOOTSTRAP_SUPERADMIN_EMAIL in config.ts. Safe to run on every start. */
export async function bootstrapSuperadmin(config: AppConfig): Promise<void> {
  const email = config.BOOTSTRAP_SUPERADMIN_EMAIL?.toLowerCase();
  if (!email) return;
  const log = new Logger('Bootstrap');
  const db = createDb(config.DATABASE_URL, 1);
  try {
    const [existing] = await db.select({ n: count() }).from(platformAdmin);
    if ((existing?.n ?? 0) > 0) return;
    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (!u) {
      log.warn(`No SuperAdmin yet. Sign up as ${email}, then restart the API to promote that account.`);
      return;
    }
    await db.insert(platformAdmin).values({ userId: u.id, level: 'superadmin' }).onConflictDoNothing();
    log.log(`${email} promoted to platform SuperAdmin (first-run bootstrap).`);
  } finally {
    await db.$client.end();
  }
}
