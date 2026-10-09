import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {runWithAdapter,runWithTransaction} from '@better-auth/core/context';
import {startPasskeyFixture} from './passkeys-test-helpers.mjs';
import {withPasskeyTransaction,requirePasskeyTransaction} from '../dist/modules/passkeys/passkeys.adapter.js';
import {withPasskeyAuthority} from '../dist/modules/passkeys/passkeys.scope.js';
const f=await startPasskeyFixture();let n=0;
async function test(name,fn){await fn();n++;console.log('PASS '+name);}
try{
 const ctx=await f.auth.$context,adapter=ctx.adapter,owner=await f.localUser();
 await test('native schema declares all provenance fields private and excludes them from output',async()=>{
  for(const field of ['passkeyCredentialId','passkeyRpId','passkeyPending']){const declared=f.auth.options.session.additionalFields[field];assert.equal(declared?.input,false);assert.equal(declared?.returned,false);}
  for(const field of ['passkeyCredentialId','passkeyRpId','passkeyReturnCipher','passkeyPasswordVersion']){const declared=f.auth.options.plugins.flatMap(p=>p.schema?.verification?.fields?.[field]?[p.schema.verification.fields[field]]:[]);assert(declared.length>0);for(const definition of declared){assert.equal(definition.input,false);assert.equal(definition.returned,false);}}
  const response=await f.request('/get-session',undefined,owner.cookies);assert.equal(response.status,200);for(const field of ['passkeyCredentialId','passkeyRpId','passkeyPending'])assert(!Object.hasOwn(response.data.session,field));
 });
 await test('unrelated native transactions retain pool behavior',async()=>{await runWithTransaction(adapter,async()=>{assert.throws(()=>requirePasskeyTransaction(),/transaction/i);});});
 await f.db.$client.query('create table fixture_pid(source text not null,pid integer not null,txid bigint not null)');
 await f.db.$client.query("create function fixture_write_pid() returns trigger language plpgsql as $$ begin insert into fixture_pid values(TG_TABLE_NAME,pg_backend_pid(),txid_current()); return new; end $$");
 await f.db.$client.query('create trigger fixture_verification_pid after insert or update on verification for each row execute function fixture_write_pid()');
 await f.db.$client.query('create trigger fixture_session_pid after insert on session for each row execute function fixture_write_pid()');
 await test('store SQL, direct native adapter and internal session share PID/transaction despite runWithAdapter reset',async()=>{
  const result=await withPasskeyTransaction(adapter,async()=>{
   const tx=requirePasskeyTransaction(),r=await tx.execute(sql`select pg_backend_pid() pid,txid_current()::text txid`);
   await runWithAdapter(adapter,async()=>{
    await adapter.create({model:'verification',data:{identifier:'same-pid',value:'synthetic',expiresAt:new Date(Date.now()+60000)}});
    await ctx.internalAdapter.createSession(owner.id);
   });return r.rows[0];
  });
  const rows=(await f.db.$client.query('select * from fixture_pid')).rows;assert.equal(rows.length,2);
  for(const row of rows){assert.equal(row.pid,result.pid);assert.equal(String(row.txid),String(result.txid));}
 });
 await test('throw rolls back direct write, native internal session and SQL',async()=>{
  const before=(await f.db.$client.query('select count(*)::int n from session')).rows[0].n;
  await assert.rejects(withPasskeyTransaction(adapter,async()=>{await adapter.create({model:'verification',data:{identifier:'fixture-rollback',value:'synthetic',expiresAt:new Date(Date.now()+60000)}});await ctx.internalAdapter.createSession(owner.id);throw new Error('fixture rollback');}),/fixture rollback/);
  assert.equal(await adapter.findOne({model:'verification',where:[{field:'identifier',value:'fixture-rollback'}]}),null);
  assert.equal((await f.db.$client.query('select count(*)::int n from session')).rows[0].n,before);
 });
 await test('nested native transaction and consume use same SQL transaction',async()=>{
  await withPasskeyTransaction(adapter,async()=>{await adapter.create({model:'verification',data:{identifier:'consume',value:'synthetic',expiresAt:new Date(Date.now()+60000)}});await runWithTransaction(adapter,async()=>{const consumed=await ctx.internalAdapter.consumeVerificationValue('consume');assert.equal(consumed.value,'synthetic');});assert.equal(await adapter.findOne({model:'verification',where:[{field:'identifier',value:'consume'}]}),null);});
 });
 await test('parallel request contexts cannot borrow transactions',async()=>{
  const results=await Promise.all([0,1].map(i=>withPasskeyTransaction(adapter,async()=>{const tx=requirePasskeyTransaction();const result=await tx.execute(sql`select pg_backend_pid() pid`);await new Promise(resolve=>setTimeout(resolve,15));await adapter.create({model:'verification',data:{identifier:'parallel-'+i,value:String(result.rows[0].pid),expiresAt:new Date(Date.now()+60000)}});return result.rows[0].pid;})));
  assert.notEqual(results[0],results[1]);for(let i=0;i<2;i++)assert.equal((await adapter.findOne({model:'verification',where:[{field:'identifier',value:'parallel-'+i}]})).value,String(results[i]));assert.throws(()=>requirePasskeyTransaction(),/transaction/i);
 });
 await test('whole HTTP call rolls back a returned error and strips authority cookies',async()=>{
  const native={...f.auth,handler:async()=>{await adapter.create({model:'verification',data:{identifier:'returned-error',value:'synthetic',expiresAt:new Date(Date.now()+60000)}});await ctx.internalAdapter.createSession(owner.id);return new Response('{}',{status:403,headers:{'set-cookie':'synthetic-authority=must-not-escape'}});}};
  const wrapped=withPasskeyAuthority(native,f.db),before=(await f.db.$client.query('select count(*)::int n from session')).rows[0].n;
  const response=await wrapped.handler(new Request('http://localhost:3000/api/auth/passkey/verify-authentication',{method:'POST'}));assert.equal(response.status,403);assert.deepEqual(response.headers.getSetCookie(),[]);assert.equal(await adapter.findOne({model:'verification',where:[{field:'identifier',value:'returned-error'}]}),null);assert.equal((await f.db.$client.query('select count(*)::int n from session')).rows[0].n,before);
 });
 await test('native API wrapper preserves response envelopes and rolls back evidence failure',async()=>{
  const native={...f.auth,api:{...f.auth.api,verifyPasskeyAuthentication:async()=>{await adapter.create({model:'verification',data:{identifier:'api-evidence-fail',value:'synthetic',expiresAt:new Date(Date.now()+60000)}});await requirePasskeyTransaction().execute(sql`insert into fixture_pid(source,pid,txid) values('required-evidence',null,null)`);throw new Error('required evidence failed');}}};
  await assert.rejects(withPasskeyAuthority(native,f.db).api.verifyPasskeyAuthentication({}),/null|not-null/i);assert.equal(await adapter.findOne({model:'verification',where:[{field:'identifier',value:'api-evidence-fail'}]}),null);
  const ok={...f.auth,api:{...f.auth.api,listPasskeys:async()=>({headers:new Headers({'x-safe-envelope':'preserved'}),response:[]})}};
  const result=await withPasskeyAuthority(ok,f.db).api.listPasskeys({returnHeaders:true});assert(result.headers instanceof Headers);assert.equal(result.headers.get('x-safe-envelope'),'preserved');assert.deepEqual(result.response,[]);
 });
 console.log(`Passkeys adapter ${n} cases PASS`);
}finally{await f.close();}
