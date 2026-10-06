import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createDb} from '../../../packages/db/dist/index.js';
import {emailFixture,fixtureClock as now} from './email-test-helpers.mjs';
const migrationRoot=new URL('../../../packages/db/drizzle/',import.meta.url);
const baselinePath=new URL('../../../.superpowers/sdd/2026-10-06-email-delivery/upgrade-baseline.json',import.meta.url);
const db=createDb(process.env.DATABASE_URL);
const hashes=Object.fromEntries(await Promise.all((await readdir(migrationRoot)).filter(n=>/^(001[1-9]|002[01])_.*\.sql$/.test(n)).sort().map(async n=>[n,createHash('sha256').update(await readFile(new URL(n,migrationRoot))).digest('hex')])));
const activation=(await db.$client.query('select entity_id,active,cutover_date,activated_at,activated_by,opening_voucher_id from accounting_settings order by entity_id')).rows;
if(process.env.CAPTURE_EMAIL_BASELINE==='1'){await writeFile(baselinePath,JSON.stringify({hashes,activation}),{flag:'wx'});await db.$client.end();console.log('Captured original email upgrade baseline once');process.exit(0);}
const baseline=JSON.parse(await readFile(baselinePath,'utf8'));assert.deepEqual(hashes,baseline.hashes);for(const original of baseline.activation)assert.deepEqual(JSON.parse(JSON.stringify(activation.find(r=>r.entity_id===original.entity_id))),original);await db.$client.end();
const {enqueueEmailIn,claimEmail,startEmailDispatch,finishEmail,reclaimEmailLeases,pruneEmailEvidence}=await import('../../../packages/email/dist/index.js');
const admin=createDb(process.env.DATABASE_URL),databaseName='email_schema_'+randomUUID().replaceAll('-','');await admin.$client.query(`create database ${databaseName}`);const isolatedUrl=new URL(process.env.DATABASE_URL);isolatedUrl.pathname='/'+databaseName;process.env.DATABASE_URL=isolatedUrl.toString();const {runMigrations}=await import('../../../packages/db/dist/migrate.js');await runMigrations(process.env.DATABASE_URL);
const f=await emailFixture(),key=randomBytes(32);
const input={purpose:'member_invitation',source:{kind:'invitation',tenantId:f.tenantId,invitationId:f.invitationId},sourceExpiresAt:new Date(now.getTime()+86400000),dedupeKey:'source',templateVersion:'v1',envelope:{recipient:'fixture@example.test',sender:{address:'sender@example.test',name:'FactoryOS'},subject:'Invitation',text:'text',html:'<p>text</p>',actionUrl:'http://localhost:3000/invite/token'}};
async function enqueue(value=input){return f.db.transaction(tx=>enqueueEmailIn(tx,value,key,now));}
async function refuses(query,args){await assert.rejects(f.db.$client.query(query,args));}
try{
 const first=await enqueue(),repeated=await enqueue();assert.equal(first.id,repeated.id);assert.equal((await enqueue({...input,dedupeKey:'alternate'})).id,first.id);
 await refuses("insert into email_delivery (scope_key,purpose,source,source_user_id,source_expires_at,dedupe_key,template_version,recipient_masked,status) values ('account','password_reset','{}','test-user',$1,'bad-source','v1','•••','unconfigured')",[input.sourceExpiresAt]);
 const other=await emailFixture();try{await refuses('update email_delivery set tenant_id=$1 where id=$2',[other.tenantId,first.id]);await assert.rejects(enqueue({...input,source:{...input.source,tenantId:other.tenantId},dedupeKey:'invalid'}));}finally{await other.close();}
 await refuses('update email_delivery set envelope=$1 where id=$2',['{}',first.id]);
 const claim=await claimEmail(f.db,'first',now);assert.equal(claim.deliveryId,first.id);assert.equal(await claimEmail(f.db,'second',now),null);
 assert.equal(await finishEmail(f.db,{...claim,leaseToken:randomUUID()},{kind:'accepted'},now),false);
 await reclaimEmailLeases(f.db,new Date(now.getTime()+121000));
 const retried=await claimEmail(f.db,'second',new Date(now.getTime()+122000));assert.equal(retried.deliveryId,first.id);
 assert.equal(await startEmailDispatch(f.db,claim,now),false);
 assert.equal(await startEmailDispatch(f.db,retried,new Date(now.getTime()+122000)),true);
 await reclaimEmailLeases(f.db,new Date(now.getTime()+243000));
 assert.equal((await f.db.$client.query('select status,next_attempt_at from email_delivery where id=$1',[first.id])).rows[0].status,'unknown');
 assert.equal(await claimEmail(f.db,'third',new Date(now.getTime()+244000)),null);
 assert.equal(await finishEmail(f.db,retried,{kind:'accepted'},new Date(now.getTime()+244000)),false);
 const fresh=async()=>{const id=(await f.db.$client.query("insert into invitation (tenant_id,email,token_hash,roles,invited_by,expires_at) values ($1,'fixture@example.test',$2,'[]',$3,$4) returning id",[f.tenantId,randomUUID(),f.userId,input.sourceExpiresAt])).rows[0].id;return {...input,source:{...input.source,invitationId:id}};};
 const unconfigured=await enqueue({...await fresh(),dedupeKey:'unconfigured',envelope:null});assert.equal(unconfigured.status,'unconfigured');assert.equal(await claimEmail(f.db,'third',now),null);
 const accepted=await enqueue({...await fresh(),dedupeKey:'accepted'}),c=await claimEmail(f.db,'third',now);await startEmailDispatch(f.db,c,now);await finishEmail(f.db,c,{kind:'accepted'},now);
 assert.equal((await f.db.$client.query('select envelope from email_delivery where id=$1',[accepted.id])).rows[0].envelope,null);
 await refuses("update email_attempt set outcome='changed' where delivery_id=$1",[accepted.id]);await refuses("update email_event set kind='changed' where delivery_id=$1",[accepted.id]);await refuses('delete from email_delivery where id=$1',[accepted.id]);
 await pruneEmailEvidence(f.db,new Date(now.getTime()+29*86400000));assert.equal((await f.db.$client.query('select count(*)::int n from email_delivery where id=$1',[accepted.id])).rows[0].n,1);
 await pruneEmailEvidence(f.db,new Date(now.getTime()+32*86400000));assert.equal((await f.db.$client.query('select count(*)::int n from email_delivery where tenant_id=$1',[f.tenantId])).rows[0].n,0);
 const retry=await enqueue({...await fresh(),dedupeKey:'retry'});const rc=await claimEmail(f.db,'retry',now);await startEmailDispatch(f.db,rc,now);await finishEmail(f.db,rc,{kind:'temporary',code:'temporary_refusal'},now);const rd=(await f.db.$client.query('select * from email_delivery where id=$1',[retry.id])).rows[0];assert.equal(rd.status,'retry_scheduled');assert.equal(rd.next_attempt_at.getTime(),now.getTime()+30000);assert.equal(await claimEmail(f.db,'retry',new Date(now.getTime()+29000)),null);const due=await claimEmail(f.db,'retry',new Date(now.getTime()+30000));await startEmailDispatch(f.db,due,new Date(now.getTime()+30000));await finishEmail(f.db,due,{kind:'permanent',code:'server raw fixture@example.test'},new Date(now.getTime()+30000));assert.equal((await f.db.$client.query('select error_code from email_delivery where id=$1',[retry.id])).rows[0].error_code,'transport_unknown');
 const accountSource={...input,purpose:'password_reset',source:{kind:'password_reset',userId:randomUUID(),verificationId:randomUUID()},envelope:null};const account=await enqueue(accountSource);const ar=(await f.db.$client.query('select tenant_id,source_user_id from email_delivery where id=$1',[account.id])).rows[0];assert.equal(ar.tenant_id,null);assert.equal(ar.source_user_id,accountSource.source.userId);
 const bounded=await enqueue({...await fresh(),dedupeKey:'bounded'});let retryNow=now;
 for(const delay of [30,120,600,3600,14400]){const claim=await claimEmail(f.db,'bounded',retryNow);assert.equal(claim.deliveryId,bounded.id);await startEmailDispatch(f.db,claim,retryNow);await finishEmail(f.db,claim,{kind:'temporary',code:'temporary_refusal'},retryNow);const evidence=(await f.db.$client.query('select status,next_attempt_at from email_delivery where id=$1',[bounded.id])).rows[0];assert.equal(evidence.status,'retry_scheduled');assert.equal(evidence.next_attempt_at.getTime()-retryNow.getTime(),delay*1000);retryNow=evidence.next_attempt_at;}
 const lastClaim=await claimEmail(f.db,'bounded',retryNow);await startEmailDispatch(f.db,lastClaim,retryNow);await finishEmail(f.db,lastClaim,{kind:'temporary',code:'temporary_refusal'},retryNow);assert.equal((await f.db.$client.query('select status,retry_count from email_delivery where id=$1',[bounded.id])).rows[0].status,'failed');assert.equal(await claimEmail(f.db,'bounded',retryNow),null);
 const nearExpiry=await enqueue({...await fresh(),sourceExpiresAt:new Date(now.getTime()+20000)}),expiringClaim=await claimEmail(f.db,'expiry',now);assert.equal(expiringClaim.deliveryId,nearExpiry.id);await startEmailDispatch(f.db,expiringClaim,now);await finishEmail(f.db,expiringClaim,{kind:'temporary',code:'temporary_refusal'},now);assert.equal((await f.db.$client.query('select status,envelope from email_delivery where id=$1',[nearExpiry.id])).rows[0].status,'expired');
 console.log('Email schema/queue: scope, dedupe, unconfigured, lease, fencing, ambiguity, purge and retention PASS');
}finally{await f.close();await admin.$client.query(`drop database ${databaseName} with (force)`);await admin.$client.end();}
