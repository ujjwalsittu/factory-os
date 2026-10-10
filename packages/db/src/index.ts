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
/**
 * A separate, small pool whose every unit of work runs inside `BEGIN READ ONLY` (support access, decision 050).
 * Writes are refused by PostgreSQL itself (SQLSTATE 25006). Each statement is bounded, and an overall deadline
 * cancels whatever is still running on its own short-lived connection, so the transaction is rolled back before the
 * pooled connection is reused.
 */
export function createReadOnlyDb(connectionString: string, opts: { max?: number; connectionTimeoutMillis?: number; deadlineMs?: number } = {}) {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 2, connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 2000 });
  const deadlineMs = opts.deadlineMs ?? 5000;
  return {
    async run<T>(fn: (tx: Pick<Database, 'select' | 'execute'>) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      let timer: NodeJS.Timeout | undefined;
      let cancelling: Promise<void> | null = null;
      try {
        const pid = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
        await client.query(`begin transaction read only; set local statement_timeout = ${deadlineMs}; set local lock_timeout = ${deadlineMs}; set local idle_in_transaction_session_timeout = ${deadlineMs}`);
        timer = setTimeout(() => {
          const canceller = new pg.Client({ connectionString });
          cancelling = canceller
            .connect()
            .then(() => canceller.query('select pg_cancel_backend($1)', [pid]))
            .then(() => undefined, () => undefined)
            .finally(() => canceller.end().catch(() => undefined));
        }, deadlineMs);
        const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;
        const result = await fn(db);
        if (cancelling) throw new Error('Read deadline exceeded');
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        // A cancel that is still in flight must never reach a later borrower: wait for it, then discard the
        // connection instead of returning it to the pool.
        if (cancelling) {
          await cancelling;
          client.release(true);
        } else client.release();
      }
    },
    close: () => pool.end(),
  };
}
export type ReadOnlyDb = ReturnType<typeof createReadOnlyDb>;
export * from './gst-sandbox-outbox.js';
export * from './gst-sandbox-source-guards.js';
