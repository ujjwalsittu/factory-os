import assert from 'node:assert/strict';
import { createDb } from '../../../packages/db/dist/index.js';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const db = createDb(process.env.DATABASE_URL);
const p = await db.$client.connect();
const path = new URL('../../../packages/db/drizzle/', import.meta.url);
const files = (await readdir(path)).filter(x => /^(001[1-9])_.*\.sql$/.test(x)).sort();
const hashes = Object.fromEntries(await Promise.all(files.map(async name => [name, createHash('sha256').update(await readFile(new URL(name,path))).digest('hex')])));
const activation = (await p.query('select entity_id,active,cutover_date,activated_at,activated_by,opening_voucher_id from accounting_settings order by entity_id')).rows;
const legacyGL = (await p.query('select * from gl_entry order by id')).rows;
const legacySettlement = (await p.query('select * from party_settlement order by id')).rows;
if (process.env.BANK_SCHEMA_BASELINE) {
 const baseline = JSON.parse(JSON.stringify({ hashes, activation }));
 if (process.env.CAPTURE_BANK_BASELINE === '1') await writeFile(process.env.BANK_SCHEMA_BASELINE,JSON.stringify(baseline));
 else assert.deepEqual(baseline, JSON.parse(await readFile(process.env.BANK_SCHEMA_BASELINE,'utf8')), 'prior migration hashes and original book activation states unchanged');
}
try {
 await p.query('begin');
 for (const table of ['bank_reconciliation_profile','bank_mapping_revision','bank_reconciliation_baseline','bank_opening_item','bank_statement_import','bank_statement_movement','bank_statement_membership','bank_duplicate_decision','bank_match_group','bank_match_edge','bank_net_vector','bank_reconciliation_event','bank_adjustment_link','bank_reconciliation_period']) assert.equal((await p.query('select to_regclass($1)::text name',[table])).rows[0].name,table);
 async function refuses(query,args,code) { await p.query('savepoint invalid');await assert.rejects(p.query(query,args),e=>e.code===code);await p.query('rollback to savepoint invalid'); }
 const uid=(await p.query('select id from "user" limit 1')).rows[0].id;
 const tid=(await p.query('insert into tenant (name,slug) values ($1,$2) returning id',['Bank schema fixture',randomUUID()])).rows[0].id;
 const entities=[];
 for (const code of ['BR1','BR2']) entities.push((await p.query('insert into legal_entity (tenant_id,legal_name,short_name,code) values ($1,$2,$2,$2) returning id',[tid,code])).rows[0].id);
 const [eid,other]=entities;
 const group=(await p.query("insert into account_group (tenant_id,entity_id,key,name,root) values ($1,$2,'bank','Bank Accounts','asset') returning id",[tid,eid])).rows[0].id;
 const account=(await p.query("insert into gl_account (tenant_id,entity_id,code,name,group_id) values ($1,$2,'B1','Bank',$3) returning id",[tid,eid,group])).rows[0].id;
 const profileArgs=[tid,eid,account,uid];
 const profile=(await p.query("insert into bank_reconciliation_profile (tenant_id,entity_id,account_id,masked_identifier,created_by) values ($1,$2,$3,'••1234',$4) returning id",profileArgs)).rows[0].id;
 await refuses("insert into bank_reconciliation_profile (tenant_id,entity_id,account_id,masked_identifier,created_by) values ($1,$2,$3,'••1234',$4)",profileArgs,'23505');
 await refuses("insert into bank_reconciliation_profile (tenant_id,entity_id,account_id,masked_identifier,created_by) values ($1,$2,$3,'••1234',$4)",[tid,other,account,uid],'23503');
 const mapping=(await p.query("insert into bank_mapping_revision (tenant_id,entity_id,profile_id,revision,mapping,created_by) values ($1,$2,$3,1,'{}',$4) returning id",[tid,eid,profile,uid])).rows[0].id;
 await refuses('update bank_mapping_revision set mapping=$1 where id=$2',['{"delimiter":";"}',mapping],'P0001');
 const baseline=(await p.query("insert into bank_reconciliation_baseline (tenant_id,entity_id,profile_id,baseline_date,book_balance,bank_balance,reference,evidence,preview_hash,created_by) values ($1,$2,$3,'2026-09-30',0,0,'schema','{}','schema',$4) returning id",[tid,eid,profile,uid])).rows[0].id;
 await refuses('delete from bank_reconciliation_baseline where id=$1',[baseline],'P0001');
 const batch=(await p.query("insert into bank_statement_import (tenant_id,entity_id,profile_id,mapping_id,start_date,end_date,opening_balance,closing_balance,file_hash,raw_csv,parsed,preview_hash,created_by) values ($1,$2,$3,$4,'2026-10-01','2026-10-02',0,100,'file','header','{}','hash',$5) returning id",[tid,eid,profile,mapping,uid])).rows[0].id;
 await p.query("update bank_statement_import set status='submitted' where id=$1",[batch]);
 await refuses("update bank_statement_import set file_hash='changed' where id=$1",[batch],'P0001');
 const movementArgs=[tid,eid,profile,batch,uid];
 const movement=(await p.query("insert into bank_statement_movement (tenant_id,entity_id,profile_id,original_import_id,ordinal,transaction_id,transaction_date,signed_amount,reference,description,signature,created_by) values ($1,$2,$3,$4,2,'TX1','2026-10-01',100,'R','D','sig',$5) returning id",movementArgs)).rows[0].id;
 await refuses("insert into bank_statement_movement (tenant_id,entity_id,profile_id,original_import_id,ordinal,transaction_id,transaction_date,signed_amount,reference,description,signature,created_by) values ($1,$2,$3,$4,3,'TX1','2026-10-01',100,'R','D','sig',$5)",movementArgs,'23505');
 await refuses('update bank_statement_movement set signed_amount=101 where id=$1',[movement],'P0001');
 await refuses("insert into bank_statement_membership (tenant_id,entity_id,profile_id,import_id,movement_id,ordinal,created_by) values ($1,$2,$3,$4,$5,2,$6)",[tid,other,profile,batch,movement,uid],'23503');
 const match=(await p.query("insert into bank_match_group (tenant_id,entity_id,profile_id,kind,evidence,preview_hash,created_by) values ($1,$2,$3,'ordinary','{}','hash',$4) returning id",[tid,eid,profile,uid])).rows[0].id;
 await refuses("update bank_match_group set evidence='{}' where id=$1",[match],'P0001');
 const eventArgs=[tid,eid,profile,match,uid];
 await p.query("insert into bank_reconciliation_event (tenant_id,entity_id,profile_id,match_id,kind,reason,created_by) values ($1,$2,$3,$4,'match_reversal','fixture',$5)",eventArgs);
 await refuses("insert into bank_reconciliation_event (tenant_id,entity_id,profile_id,match_id,kind,reason,created_by) values ($1,$2,$3,$4,'match_reversal','fixture',$5)",eventArgs,'23505');
 const period=(await p.query("insert into bank_reconciliation_period (tenant_id,entity_id,profile_id,baseline_id,start_date,end_date,snapshot,preview_hash,created_by) values ($1,$2,$3,$4,'2026-10-01','2026-10-02','{}','hash',$5) returning id",[tid,eid,profile,baseline,uid])).rows[0].id;
 await refuses("update bank_reconciliation_period set snapshot='{}' where id=$1",[period],'P0001');
 assert.deepEqual((await p.query('select * from gl_entry order by id')).rows,legacyGL,'original GL unchanged');
 assert.deepEqual((await p.query('select * from party_settlement order by id')).rows,legacySettlement,'original settlements unchanged');
 console.log('PASS scoped bank evidence, unique identities/reversals, immutable submitted evidence and unchanged legacy ledgers');
} finally { await p.query('rollback');p.release();await db.$client.end(); }
