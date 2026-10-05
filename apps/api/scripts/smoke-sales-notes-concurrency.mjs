import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {fixture} from './sales-notes-test-helpers.mjs';
const {c,input,inv}=await fixture('Concurrent customer credit ceilings');
const a=await c.req('POST','/sales-notes',input('70'),201),b=await c.req('POST','/sales-notes',input('70'),201);
const db=createDb(process.env.DATABASE_URL),hold=await db.$client.connect();
let pending,results;
try{
 await hold.query('begin');
 await hold.query('select pg_advisory_xact_lock(hashtext($1))',[`accounting:${c.entityId}`]);
 pending=Promise.all([a,b].map(n=>c.raw('POST',`/sales-notes/${n.id}/submit`,{})));
 const deadline=Date.now()+5000;
 let waiting=0;
 while(Date.now()<deadline){
  waiting=(await db.$client.query("select count(*)::int n from pg_locks where locktype='advisory' and not granted and objid::bigint=(hashtext($1)::bigint & 4294967295)",[`accounting:${c.entityId}`])).rows[0].n;
  if(waiting===2)break;
  await new Promise(r=>setTimeout(r,25));
 }
 assert.equal(waiting,2,'Both submissions must wait at the real PostgreSQL entity barrier');
}finally{
 await hold.query('rollback');hold.release();
 if(pending)results=await pending;
 await db.$client.end();
}
assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
assert.equal((await c.req('GET',`/sales-invoices/${inv.id}/balance`)).openAmount,'30.000000');
const winner=results.find(r=>r.status===201).data;
await c.req('POST',`/sales-notes/${winner.id}/cancel`,{reason:'Reverse concurrency winner'},201);
assert.equal((await c.req('GET',`/sales-invoices/${inv.id}/balance`)).openAmount,'100.000000');
const other=await c.req('POST','/entities',{legalName:'Other note entity',shortName:'Other',code:'OTHER'},201);
const originalEntity=c.entityId;c.entityId=other.id;
await c.req('GET',`/sales-notes/${winner.id}`,undefined,404);
c.entityId=originalEntity;
const rows=await c.req('GET','/accounts/trade-reconciliation');assert.ok(rows.every(r=>r.difference==='0.000000'));
console.log('PASS competing credit submissions and scoped note reads',c.checks);
