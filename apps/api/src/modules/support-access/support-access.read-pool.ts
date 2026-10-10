// Audited support access (decision 050): the dedicated read pool (max 2 connections, 2-second connection wait,
// READ ONLY transactions with a 5-second deadline). Support data is never read through the ordinary pool.
import { createReadOnlyDb } from '@factoryos/db';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { CONFIG } from '../../common/tokens.js';
import type { AppConfig } from '../../config.js';
import type { SupportExecutor, SupportReadPool } from './support-access.types.js';

export function createSupportReadPool(databaseUrl: string): SupportReadPool {
  return createReadOnlyDb(databaseUrl, { max: 2, connectionTimeoutMillis: 2000, deadlineMs: 5000 });
}

@Injectable()
export class SupportReadPoolService implements SupportReadPool, OnModuleDestroy {
  private readonly pool: SupportReadPool;
  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = createSupportReadPool(config.DATABASE_URL);
  }
  run<T>(fn: (tx: SupportExecutor) => Promise<T>): Promise<T> {
    return this.pool.run(fn);
  }
  close() {
    return this.pool.close();
  }
  onModuleDestroy() {
    return this.pool.close();
  }
}
