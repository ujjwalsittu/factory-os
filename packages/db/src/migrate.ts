import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './index.js';

/** Applies SQL migrations from packages/db/drizzle. Used by `db:migrate` and on API start. */
export async function runMigrations(connectionString: string): Promise<void> {
  const db = createDb(connectionString, 1);
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await db.$client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  await runMigrations(url);
  console.log('migrations applied');
}
