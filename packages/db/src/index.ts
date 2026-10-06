import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export * as schema from './schema/index.js';
export * from './schema/index.js';

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };

export function createDb(connectionString: string, max = 10): Database {
  const pool = new pg.Pool({ connectionString, max });
  return drizzle(pool, { schema, casing: 'snake_case' }) as Database;
}
export * from './gst-sandbox-outbox.js';
