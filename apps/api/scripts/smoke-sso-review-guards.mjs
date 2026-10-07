import assert from 'node:assert/strict';
import {startSsoFixture} from './sso-test-helpers.mjs';
let n=0;
async function test(name,fn){if(!process.env.SSO_FOCUS||name.includes(process.env.SSO_FOCUS)){await fn();n++;console.log('PASS '+name);}}
await test('ordinarySessionRenewalKeepsCookieHeadersWhenProvidersDisabled',async()=>{
 const f=await startSsoFixture({SSO_GOOGLE_ENABLED:'false',SSO_MICROSOFT_ENABLED:'false'});
 try{const owner=await f.localUser();await f.db.$client.query("update session set expires_at=clock_timestamp()+interval '5 days' where id=$1",[owner.ctx.sessionId]);const before=(await f.db.$client.query('select expires_at from session where id=$1',[owner.ctx.sessionId])).rows[0].expires_at;
  const response=await f.request('/get-session',null,owner.cookies);assert.equal(response.status,200);assert.equal(response.data.user.id,owner.id);assert((await f.db.$client.query('select expires_at from session where id=$1',[owner.ctx.sessionId])).rows[0].expires_at>before);assert(response.response.headers.getSetCookie().some(cookie=>cookie.startsWith('better-auth.session_token=')),'renewed database session must also renew browser cookie');
 }finally{await f.close();}
});
await test('revokedDisconnectCannotBorrowAnotherSessionsConsent',async()=>{
 const f=await startSsoFixture();let release;
 try{
  const owner=await f.localUser(),link=await f.start('google',owner),code=f.provider.authorize(link.data.url,{subject:'review-disconnect'});assert.equal(new URL((await f.request(code.callback,null,link.cookies)).location).pathname,'/sso/complete');const binding=(await f.db.$client.query("select id from account where account_id='review-disconnect'")).rows[0].id;
  const cookiesB=f.jar();assert.equal((await f.request('/sign-in/email',{email:owner.email,password:'Synthetic-password-123'},cookiesB)).status,200);const b=(await f.request('/get-session',null,cookiesB)).data,ctxB={...owner.ctx,sessionId:b.session.id};
  const proof=async(ctx,cookies)=>f.service.issueAction(ctx,{provider:'google',kind:'unlink',targetAccountId:binding},async()=>(await f.request('/verify-password',{password:'Synthetic-password-123'},cookies)).data.status);
  const a=await proof(owner.ctx,owner.cookies),second=await proof(ctxB,cookiesB);let enter;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),original=f.auth.options.databaseHooks.account.delete?.before;
  f.auth.options.databaseHooks.account.delete={...f.auth.options.databaseHooks.account.delete,before:async(data,ctx)=>{if(ctx?.headers?.get('x-factoryos-sso-action')===a.nonce){enter();await gate;}return original?.(data,ctx);}};
  const pending=f.request('/unlink-account',{accountId:binding},owner.cookies,{'x-factoryos-sso-action':a.nonce});await entered;
  await f.service.disconnectAction(ctxB,binding,second.nonce);await f.db.$client.query('delete from session where id=$1',[owner.ctx.sessionId]);release();const response=await pending;assert(response.status>=400,'revoked disconnect must fail even when another grant is live');assert.equal((await f.db.$client.query('select count(*)::int n from account where id=$1',[binding])).rows[0].n,1);assert.equal((await f.db.$client.query("select count(*)::int n from auth_sso_action where target_account_id=$1 and consumed_at is not null",[binding])).rows[0].n,0);
  assert.equal((await f.request('/unlink-account',{accountId:binding},cookiesB,{'x-factoryos-sso-action':second.nonce})).status,200);assert.equal((await f.db.$client.query('select count(*)::int n from account where id=$1',[binding])).rows[0].n,0);assert.equal((await f.db.$client.query("select count(*)::int n from auth_sso_event where account_id=$1 and kind='unlinked'",[binding])).rows[0].n,1);
  const rows=(await f.db.$client.query('select session_id,consumed_at from auth_sso_action where target_account_id=$1',[binding])).rows;assert.equal(rows.find(r=>r.session_id===owner.ctx.sessionId).consumed_at,null);assert(rows.find(r=>r.session_id===ctxB.sessionId).consumed_at);
 }finally{release?.();await f.close();}
});
await test('twoDisconnectsConsumeOnlyCommittingRequestsGrant',async()=>{
 const f=await startSsoFixture();let blocker;
 try{
  const owner=await f.localUser(),link=await f.start('google',owner),code=f.provider.authorize(link.data.url,{subject:'review-atomic'});assert.equal(new URL((await f.request(code.callback,null,link.cookies)).location).pathname,'/sso/complete');const binding=(await f.db.$client.query("select id from account where account_id='review-atomic'")).rows[0].id,cookiesB=f.jar();assert.equal((await f.request('/sign-in/email',{email:owner.email,password:'Synthetic-password-123'},cookiesB)).status,200);const ctxB={...owner.ctx,sessionId:(await f.request('/get-session',null,cookiesB)).data.session.id};
  const a=await f.service.issueAction(owner.ctx,{provider:'google',kind:'unlink',targetAccountId:binding},async()=>true),b=await f.service.issueAction(ctxB,{provider:'google',kind:'unlink',targetAccountId:binding},async()=>true);
  await f.db.$client.query("create function fixture_unlink_wait() returns trigger language plpgsql as $$begin if OLD.provider_id='google' then perform pg_advisory_xact_lock(701975);end if;return OLD;end$$;create trigger fixture_unlink_wait before delete on account for each row execute function fixture_unlink_wait()");
  blocker=await f.db.$client.connect();await blocker.query('begin');await blocker.query('select pg_advisory_xact_lock(701975)');const pid=(await blocker.query('select pg_backend_pid() pid')).rows[0].pid;
  async function waiting(count){for(let i=0;i<250;i++){const rows=(await f.db.$client.query("with recursive waiters(pid) as(select $1::int union select a.pid from pg_stat_activity a join waiters w on w.pid=any(pg_blocking_pids(a.pid)) where a.datname=current_database() and a.wait_event_type='Lock') select pid from waiters where pid<>$1",[pid])).rows;if(rows.length>=count){assert.equal(new Set([pid,...rows.map(r=>r.pid)]).size,rows.length+1);return;}await new Promise(r=>setTimeout(r,10));}throw new Error('Actual serialized unlink contenders missing');}
  const first=f.request('/unlink-account',{accountId:binding},owner.cookies,{'x-factoryos-sso-action':a.nonce});await waiting(1);const second=f.request('/unlink-account',{accountId:binding},cookiesB,{'x-factoryos-sso-action':b.nonce});await waiting(2);await blocker.query('commit');assert.equal((await first).status,200);assert((await second).status>=400);
  const rows=(await f.db.$client.query('select session_id,consumed_at from auth_sso_action where target_account_id=$1',[binding])).rows;assert(rows.find(r=>r.session_id===owner.ctx.sessionId).consumed_at);assert.equal(rows.find(r=>r.session_id===ctxB.sessionId).consumed_at,null);assert.equal((await f.db.$client.query("select count(*)::int n from auth_sso_event where account_id=$1 and kind='unlinked'",[binding])).rows[0].n,1);
 }finally{if(blocker){await blocker.query('rollback');blocker.release();}await f.close();}
});
console.log(`SSO independent-review guards ${n} cases PASS`);
