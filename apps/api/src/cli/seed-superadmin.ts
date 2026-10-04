/**
 * Creates (or promotes) the first platform SuperAdmin. There is deliberately no HTTP endpoint for this.
 * Usage: pnpm --filter @factoryos/api seed:superadmin -- --email you@example.com --name "Your Name" [--password ...]
 */
import { parseArgs } from 'node:util';
import { createDb, platformAdmin, user } from '@factoryos/db';
import { eq } from 'drizzle-orm';
import { createAuth } from '../auth.js';
import { loadConfig } from '../config.js';

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' }, password: { type: 'string' } },
});
if (!values.email) throw new Error('--email is required');

const config = loadConfig();
const db = createDb(config.DATABASE_URL, 2);
const auth = createAuth(db, config);
const email = values.email.toLowerCase();

let [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
if (!u) {
  if (!values.password) throw new Error('User does not exist yet: pass --password (and --name) to create it');
  const res = await auth.api.signUpEmail({ body: { email, password: values.password, name: values.name ?? email } });
  u = { id: res.user.id };
  console.log(`created user ${email}`);
}
await db.insert(platformAdmin).values({ userId: u.id, level: 'superadmin' }).onConflictDoUpdate({ target: platformAdmin.userId, set: { level: 'superadmin' } });
console.log(`${email} is now a platform SuperAdmin`);
await db.$client.end();
