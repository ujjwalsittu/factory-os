import {sql} from 'drizzle-orm';
import type {Database} from '@factoryos/db';
import {expireEmailSources,reclaimEmailLeases} from './queue.js';
export async function pruneEmailEvidence(db:Database,now=new Date()){
 await reclaimEmailLeases(db,now);await expireEmailSources(db,now);
 const cutoff=new Date(now.getTime()-30*86400000);
 return db.transaction(async tx=>{
  await tx.execute(sql`select set_config('factoryos.email_cleanup_before',${cutoff.toISOString()},true),set_config('factoryos.email_cleanup_now',${now.toISOString()},true)`);
  const predicate=sql`select id from email_delivery where created_at<=${cutoff} and source_expires_at<=${now} and status not in ('queued','dispatching','retry_scheduled') for update`;
  await tx.execute(sql`delete from email_event where delivery_id in (${predicate})`);await tx.execute(sql`delete from email_attempt where delivery_id in (${predicate})`);
  const result=await tx.execute(sql`delete from email_delivery where id in (${predicate})`);
  await tx.execute(sql`delete from email_rate_limit where expires_at<=${cutoff}`);await tx.execute(sql`delete from email_worker_heartbeat where last_seen_at<=${cutoff}`);return result.rowCount??0;
 });
}
