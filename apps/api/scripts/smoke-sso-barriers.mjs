import assert from 'node:assert/strict';
import {createAuth} from '../dist/auth.js';
import {randomUUID,createHmac} from 'node:crypto';
import {startSsoBrowserApi} from './sso-browser-api.mjs';
import {startSsoFixture} from './sso-test-helpers.mjs';
const f=await startSsoFixture();let n=0;
function outcome(result){if(result.location)return new URL(result.location).pathname;assert(result.status>=400);assert(!JSON.stringify(result.data).includes('query'));return '/sso/error';}
const test=async(name,fn)=>{if(!process.env.SSO_FOCUS||name.includes(process.env.SSO_FOCUS)){await fn();n++;console.log('PASS '+name);}};
async function contenders(blocker,count=1){
 const pid=(await blocker.query('select pg_backend_pid() pid')).rows[0].pid;
 for(let i=0;i<250;i++){
  const rows=(await f.db.$client.query("with recursive waiters(pid) as (select $1::int union select a.pid from pg_stat_activity a join waiters w on w.pid=any(pg_blocking_pids(a.pid)) where a.datname=current_database() and a.wait_event_type='Lock') select pid from waiters where pid<>$1",[pid])).rows;
  if(rows.length>=count){assert.equal(new Set([pid,...rows.map(r=>r.pid)]).size,rows.length+1);console.log(`Observed blocker plus ${rows.length} distinct PostgreSQL waiters`);return;}
  await new Promise(r=>setTimeout(r,10));
 }throw new Error('Real PostgreSQL contenders not observed');
}
async function transaction(fn){const c=await f.db.$client.connect();try{await c.query('begin');await fn(c);}finally{await c.query('rollback');c.release();}}
async function link(user,subject){const start=await f.start('google',user),code=f.provider.authorize(start.data.url,{subject,email:user.email});return {...start,cookies:new Map(start.cookies),code};}
async function unlink(user,binding){const proof=await f.service.issueAction(user.ctx,{provider:'google',kind:'unlink',targetAccountId:binding},async()=>true);const result=await f.request('/unlink-account',{providerId:'google',accountId:binding},user.cookies,{'x-factoryos-sso-action':proof.nonce});assert.equal(result.status,200);}
try{
 const owner=await f.localUser();
 for(const provider of ['google','microsoft']){
  const start=await f.start(provider,owner),code=f.provider.authorize(start.data.url,{subject:provider+'-barrier'});assert.equal(new URL((await f.request(code.callback,null,start.cookies)).location).pathname,'/sso/complete');
  await test(provider+' changedClientCannotReuseBinding',async()=>{
   const old=f.config.sso[provider].clientId;f.config.sso[provider].clientId='replacement-'+provider;
   try{const auth=createAuth(f.db,f.config,f.email),cookies=f.jar(),start=await f.request('/sign-in/social',{provider,disableRedirect:true},cookies,{},auth);assert.equal(start.status,200);const code=f.provider.authorize(start.data.url,{subject:provider+'-barrier',claims:{aud:f.config.sso[provider].clientId}}),result=await f.request(code.callback,null,cookies,{},auth);assert.equal(new URL(result.location).pathname,'/sso/error');assert.equal((await f.request('/get-session',null,cookies,{},auth)).data,null);}finally{f.config.sso[provider].clientId=old;}
  });
 }
 await test('legacyBindingCanDisconnectWithLocalProof',async()=>{
  // Model an existing pre-provenance row; it is never allowed to sign in.
  const other=await f.localUser('legacy@example.test');await f.db.$client.query('alter table account disable trigger account_sso_guard');
  try{await f.db.$client.query("insert into account(id,user_id,provider_id,account_id) values('legacy-binding',$1,'google','legacy-subject')",[other.id]);}finally{await f.db.$client.query('alter table account enable trigger account_sso_guard');}
  const start=await f.start('google'),code=f.provider.authorize(start.data.url,{subject:'legacy-subject',email:other.email});assert.equal(new URL((await f.request(code.callback,null,start.cookies)).location).pathname,'/sso/error');
  const proof=await f.service.issueAction(other.ctx,{kind:'unlink',provider:'google',targetAccountId:'legacy-binding'},async()=>true);const result=await f.request('/unlink-account',{providerId:'google',accountId:'legacy-binding'},other.cookies,{'x-factoryos-sso-action':proof.nonce});assert.equal(result.status,200);assert.equal((await f.db.$client.query("select count(*)::int n from account where id='legacy-binding'")).rows[0].n,0);
  const reconnect=await link(other,'legacy-subject');assert.equal(outcome(await f.request(reconnect.code.callback,null,reconnect.cookies)),'/sso/complete');assert.equal((await f.db.$client.query("select sso_client_id from account where account_id='legacy-subject'")).rows[0].sso_client_id,f.config.sso.google.clientId);
 });
 await test('pendingFallbackHasNoNativeOrApiAuthority',async()=>{
  const binding=(await f.db.$client.query("select id from account where account_id='google-barrier'")).rows[0].id,id=randomUUID(),token=randomUUID();
  await f.db.$client.query("insert into session(id,user_id,token,expires_at,sso_account_id,sso_issuer,sso_client_id,sso_pending) values($1,$2,$3,clock_timestamp()+interval '1 hour',$4,'https://accounts.google.com','synthetic-google',true)",[id,owner.id,token,binding]);
  const signature=createHmac('sha256',f.config.BETTER_AUTH_SECRET).update(token).digest('base64'),cookies=new Map([['better-auth.session_token',encodeURIComponent(token+'.'+signature)]]);
  assert.equal((await f.request('/get-session',null,cookies)).data,null);assert.equal((await f.request('/list-sessions',null,cookies)).status,401);assert((await f.request('/update-user',{name:'Forbidden pending mutation',ssoPending:false},cookies)).status>=400);
  const port=Number(new URL(process.env.API??'http://localhost:4000').port),runtime=await startSsoBrowserApi(f,port);
  try{const response=await fetch(`http://localhost:${port}/api/sso/methods`,{headers:{cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}});assert.equal(response.status,401);}finally{await runtime.close();}
  assert.equal((await f.db.$client.query('select name from "user" where id=$1',[owner.id])).rows[0].name,'Local unchanged');assert.equal((await f.db.$client.query('select count(*)::int n from auth_sso_event where session_id=$1',[id])).rows[0].n,0);await f.db.$client.query('delete from session where id=$1',[id]);
 });
 for(const sameOwner of [true,false])await test(sameOwner?'twoCallbacksOneOwner':'twoOwnersCannotReassignIdentity',async()=>{
  const first=await f.localUser('race-first-'+sameOwner+'@example.test'),second=sameOwner?first:await f.localUser('race-second@example.test'),subject='race-identity-'+sameOwner;
  const a=await link(first,subject),b=await link(second,subject);
  await f.db.$client.query("create function fixture_account_barrier() returns trigger language plpgsql as $$begin if NEW.provider_id='google' then perform pg_advisory_xact_lock(701943);end if;return NEW;end$$;create trigger fixture_account_barrier before insert on account for each row execute function fixture_account_barrier()");
  try{await transaction(async c=>{await c.query('select pg_advisory_xact_lock(701943)');const one=f.request(a.code.callback,null,a.cookies),two=f.request(b.code.callback,null,b.cookies);await contenders(c,2);await c.query('commit');const results=await Promise.all([one,two]);assert.deepEqual(results.map(r=>outcome(r)).sort(),['/sso/complete','/sso/error']);});
   const rows=(await f.db.$client.query('select id,user_id from account where account_id=$1',[subject])).rows;assert.equal(rows.length,1);assert([first.id,second.id].includes(rows[0].user_id));assert.equal((await f.db.$client.query("select count(*)::int n from auth_sso_event where account_id=$1 and kind='linked'",[rows[0].id])).rows[0].n,1);
  }finally{await f.db.$client.query('drop trigger fixture_account_barrier on account;drop function fixture_account_barrier()');}
 });
 await test('proofExpiryWhileRowLocked',async()=>{
  const user=await f.localUser('expired-barrier@example.test'),start=await link(user,'expired-barrier'),action=(await f.db.$client.query('select id from auth_sso_action where user_id=$1 and consumed_at is null',[user.id])).rows[0].id;
  await transaction(async c=>{await c.query('select id from auth_sso_action where id=$1 for update',[action]);await c.query("update auth_sso_action set expires_at=clock_timestamp()+interval '200 milliseconds' where id=$1",[action]);const callback=f.request(start.code.callback,null,start.cookies);await contenders(c);await new Promise(r=>setTimeout(r,230));await c.query('commit');assert.equal(outcome(await callback),'/sso/error');});
  assert.equal((await f.db.$client.query("select count(*)::int n from account where account_id='expired-barrier'")).rows[0].n,0);
 });
 await test('sessionRevokedDuringCallback',async()=>{
  const user=await f.localUser('revoked-barrier@example.test'),start=await link(user,'revoked-barrier');
  await transaction(async c=>{await c.query('delete from session where id=$1',[user.ctx.sessionId]);const callback=f.request(start.code.callback,null,start.cookies);await contenders(c);await c.query('commit');assert.equal(outcome(await callback),'/sso/error');});
  assert.equal((await f.db.$client.query("select count(*)::int n from account where account_id='revoked-barrier'")).rows[0].n,0);
 });
 await test('disconnectVersusSessionCreation',async()=>{
  const user=await f.localUser('disconnect-barrier@example.test'),linked=await link(user,'disconnect-barrier');assert.equal(new URL((await f.request(linked.code.callback,null,linked.cookies)).location).pathname,'/sso/complete');const binding=(await f.db.$client.query("select id from account where account_id='disconnect-barrier'")).rows[0].id;
  const proof=await f.service.issueAction(user.ctx,{provider:'google',kind:'unlink',targetAccountId:binding},async()=>true);await f.service.disconnectAction(user.ctx,binding,proof.nonce);
  const start=await f.start('google'),code=f.provider.authorize(start.data.url,{subject:'disconnect-barrier'});
  const action=await f.service.store.validateSsoAction(user.ctx,proof.nonce,{provider:'google',kind:'unlink',targetAccountId:binding});
  await transaction(async c=>{await c.query('update account set sso_action_id=$1 where id=$2',[action.id,binding]);await c.query('delete from account where id=$1',[binding]);const callback=f.request(code.callback,null,start.cookies);await contenders(c);await c.query('commit');assert.equal(outcome(await callback),'/sso/error');});assert.equal((await f.request('/get-session',null,start.cookies)).data,null);
 });
 await test('sessionCommittedBeforeDisconnectRetainsExpiry',async()=>{
  const start=await f.start('google'),code=f.provider.authorize(start.data.url,{subject:'google-barrier'});assert.equal(new URL((await f.request(code.callback,null,start.cookies)).location).pathname,'/sso/complete');const before=(await f.request('/get-session',null,start.cookies)).data;const binding=(await f.db.$client.query("select id from account where account_id='google-barrier'")).rows[0].id;await unlink(owner,binding);const after=(await f.request('/get-session',null,start.cookies)).data;assert.equal(after.session.id,before.session.id);assert.equal(after.session.expiresAt,before.session.expiresAt);
 });
 await test('lateAccountSwitchCannotLink',async()=>{
  const first=await f.localUser('switch-first@example.test'),other=await f.localUser('switch-other@example.test'),start=await link(first,'switch-subject');for(const [key,value] of other.cookies)if(key.includes('session_token'))start.cookies.set(key,value);assert.equal(outcome(await f.request(start.code.callback,null,start.cookies)),'/sso/error');assert.equal((await f.db.$client.query("select count(*)::int n from account where account_id='switch-subject'")).rows[0].n,0);
 });
 await test('eventFailureHasNoAuthorityAndNoSecretDiagnostics',async()=>{
  const user=await f.localUser('audit-barrier@example.test'),start=await link(user,'audit-barrier');await f.db.$client.query("create function fixture_evidence_barrier() returns trigger language plpgsql as $$begin raise exception 'synthetic event unavailable';end$$;create trigger fixture_evidence_barrier before insert on auth_sso_event for each row execute function fixture_evidence_barrier()");
  const logs=[],original=console.error;console.error=(...args)=>logs.push(args.map(String).join(' '));try{assert.equal(outcome(await f.request(start.code.callback,null,start.cookies)),'/sso/error');assert.equal((await f.db.$client.query("select count(*)::int n from account where account_id='audit-barrier'")).rows[0].n,0);assert.equal((await f.db.$client.query('select consumed_at from auth_sso_action where user_id=$1',[user.id])).rows[0].consumed_at,null);assert.equal(logs.length,0);const diagnostic=JSON.stringify(f.diagnostics);for(const canary of [start.code.code,start.code.state,start.code.record.idToken,'synthetic-access-token-canary','synthetic-refresh-token-canary'])assert(!diagnostic.includes(canary));}finally{console.error=original;await f.db.$client.query('drop trigger fixture_evidence_barrier on auth_sso_event;drop function fixture_evidence_barrier()');}
 });
 console.log(`SSO barriers ${n} cases PASS`);
}finally{await f.close();}
