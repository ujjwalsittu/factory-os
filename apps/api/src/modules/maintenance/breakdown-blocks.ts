// Decision 066: an open breakdown keeps its machine blocked on the schedule until the order is done. The block is
// stored ending a day ahead and pushed forward whenever the schedule or maintenance lists are read.
import type { Database } from '@factoryos/db';
import { sql } from 'drizzle-orm';
import type { Tx } from '../accounting/accounting-lock.js';

export async function extendOpenBreakdowns(db: Database | Tx, entityId: string) {
  await db.execute(sql`
    update machine_block b set ends_at = now() + interval '1 day'
    from maintenance_order o
    where o.block_id = b.id and o.entity_id = ${entityId} and o.kind = 'breakdown' and o.status in ('open', 'in_progress')
      and b.ends_at < now() + interval '12 hours'`);
}
