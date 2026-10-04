import { createHash } from 'node:crypto';
import { auditEvent, type Database } from '@factoryos/db';
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, isNull, sql } from 'drizzle-orm';
import type { RequestContext } from './access.js';
import { DB } from './tokens.js';

export interface AuditInput {
  action: string;
  targetType: string;
  targetId?: string | null;
  tenantId?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Append-only, hash-chained audit log (docs/15 §5). Each tenant (and the platform, tenantId null)
 * has its own chain; an advisory lock serialises writers so the chain never forks.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(ctx: RequestContext | null, input: AuditInput, tx?: Tx): Promise<void> {
    const run = async (t: Tx) => {
      const tenantId = input.tenantId ?? null;
      await t.execute(sql`select pg_advisory_xact_lock(hashtext(${'audit:' + (tenantId ?? 'platform')}))`);
      const [last] = await t
        .select({ hash: auditEvent.hash })
        .from(auditEvent)
        .where(tenantId ? eq(auditEvent.tenantId, tenantId) : isNull(auditEvent.tenantId))
        .orderBy(desc(auditEvent.seq))
        .limit(1);
      const row = {
        occurredAt: new Date(),
        tenantId,
        entityId: input.entityId ?? null,
        actorUserId: ctx?.user.id ?? null,
        impersonatorUserId: null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        before: input.before ?? null,
        after: input.after ?? null,
        reason: input.reason ?? null,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        prevHash: last?.hash ?? null,
      };
      const hash = createHash('sha256')
        .update(JSON.stringify(row))
        .digest('hex');
      await t.insert(auditEvent).values({ ...row, hash });
    };
    if (tx) await run(tx);
    else await this.db.transaction(run);
  }
}
