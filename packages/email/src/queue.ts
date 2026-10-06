import {createHash,randomUUID} from 'node:crypto';
import {and,eq,lte,sql} from 'drizzle-orm';
import {emailDelivery,emailAttempt,emailEvent,type Database} from '@factoryos/db';
import {emailAad,sealEmail} from './envelope.js';
import {emailPurposeSchema,emailSourceSchema,redactEmailOutcome,type Tx,type EnqueueEmail,type EmailClaim,type EmailOutcome,type EmailStatus} from './contracts.js';
const delays=[30,120,600,3600,14400];
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
type Delivery=typeof emailDelivery.$inferSelect;
async function event(tx:Tx,d:Delivery,kind:string,now:Date,attemptId:string|null=null,code:string|null=null){await tx.insert(emailEvent).values({deliveryId:d.id,tenantId:d.tenantId,scopeKey:d.scopeKey,attemptId,kind,code,createdAt:now});}
/** Called inside the source transaction. A disabled producer stores no reconstructable payload. */
export async function enqueueEmailIn(tx:Tx,input:EnqueueEmail,key?:Buffer,now=new Date()){
 const purpose=emailPurposeSchema.parse(input.purpose),source=emailSourceSchema.parse(input.source),aad=emailAad(purpose,source);
 if(!Number.isFinite(input.sourceExpiresAt.getTime())||input.templateVersion!=='v1'||!input.dedupeKey||input.dedupeKey.length>256)throw new Error('Invalid email request');
 const tenantId=source.kind==='invitation'?source.tenantId:null,scopeKey=tenantId??'account';
 // Source identity is authoritative: an alternate caller replay key cannot produce another send.
 const dedupeKey=hash(aad);
 const envelope=input.envelope?sealEmail(input.envelope,key??Buffer.alloc(0),aad):null;
 const status=input.sourceExpiresAt<=now?'expired':envelope?'queued':'unconfigured';
 const rows=await tx.insert(emailDelivery).values({tenantId,scopeKey,purpose,source,invitationId:source.kind==='invitation'?source.invitationId:null,sourceUserId:source.kind==='invitation'?null:source.userId,sourceExpiresAt:input.sourceExpiresAt,dedupeKey,templateVersion:input.templateVersion,recipientMasked:input.envelope?'•••@'+input.envelope.recipient.split('@')[1]:'•••',envelope:status==='expired'?null:envelope,status,nextAttemptAt:status==='queued'?now:null,createdAt:now,updatedAt:now}).onConflictDoNothing({target:[emailDelivery.purpose,emailDelivery.scopeKey,emailDelivery.dedupeKey]}).returning();
 const row=rows[0]??(await tx.select().from(emailDelivery).where(and(eq(emailDelivery.purpose,purpose),eq(emailDelivery.scopeKey,scopeKey),eq(emailDelivery.dedupeKey,dedupeKey))))[0];
 if(!row)throw new Error('Email enqueue unavailable');if(rows[0])await event(tx,row,status,now);return {id:row.id,status:row.status as EmailStatus};
}
async function lockedClaim(tx:Tx,claim:EmailClaim,now:Date){
 const row=(await tx.select().from(emailDelivery).where(eq(emailDelivery.id,claim.deliveryId)).for('update'))[0];
 if(!row||row.status!=='dispatching'||row.leaseToken!==claim.leaseToken||!row.leaseExpiresAt||row.leaseExpiresAt<=now)return null;
 const attempt=(await tx.select().from(emailAttempt).where(and(eq(emailAttempt.id,claim.attemptId),eq(emailAttempt.deliveryId,row.id),eq(emailAttempt.leaseToken,claim.leaseToken))))[0];return attempt?row:null;
}
/** Global claim advisory lock bounds network concurrency to two without holding a transaction over SMTP. */
export async function claimEmail(db:Database,workerId:string,now=new Date()):Promise<EmailClaim|null>{
 if(!workerId||workerId.length>128)throw new Error('Invalid email worker');
 return db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(18792341)`);
  const active=await tx.execute<{n:number}>(sql`select count(*)::int n from email_delivery where status='dispatching'`);if((active.rows[0]?.n??0)>=2)return null;
  const row=(await tx.select().from(emailDelivery).where(and(sql`${emailDelivery.status} in ('queued','retry_scheduled')`,lte(emailDelivery.nextAttemptAt,now),sql`${emailDelivery.sourceExpiresAt}>${now}`)).orderBy(emailDelivery.createdAt,emailDelivery.id).limit(1).for('update',{skipLocked:true}))[0];if(!row?.envelope)return null;
  const leaseToken=randomUUID(),attemptId=randomUUID();
  await tx.update(emailDelivery).set({status:'dispatching',leaseToken,leaseExpiresAt:new Date(now.getTime()+120000),workerId,dispatchStartedAt:null,lastAttemptAt:now,nextAttemptAt:null,updatedAt:now}).where(eq(emailDelivery.id,row.id));
  await tx.insert(emailAttempt).values({id:attemptId,deliveryId:row.id,tenantId:row.tenantId,scopeKey:row.scopeKey,leaseToken,workerId,createdAt:now});await event(tx,row,'claimed',now,attemptId);
  return {deliveryId:row.id,leaseToken,attemptId,input:{purpose:emailPurposeSchema.parse(row.purpose),source:emailSourceSchema.parse(row.source),sourceExpiresAt:row.sourceExpiresAt,dedupeKey:row.dedupeKey,templateVersion:'v1',envelope:null},cipher:row.envelope,retryCount:row.retryCount};
 });
}
export async function startEmailDispatch(db:Database,claim:EmailClaim,now=new Date()):Promise<boolean>{return db.transaction(async tx=>{const row=await lockedClaim(tx,claim,now);if(!row||row.dispatchStartedAt||row.sourceExpiresAt<=now)return false;await tx.update(emailDelivery).set({dispatchStartedAt:now,updatedAt:now}).where(eq(emailDelivery.id,row.id));await event(tx,row,'dispatch_started',now,claim.attemptId);return true;});}
export async function finishEmail(db:Database,claim:EmailClaim,outcome:EmailOutcome,now=new Date()):Promise<boolean>{
 return db.transaction(async tx=>{
  const row=await lockedClaim(tx,claim,now);if(!row||!row.dispatchStartedAt)return false;const safe=redactEmailOutcome(outcome);
  let status:EmailStatus=safe.kind==='accepted'?'accepted':safe.kind==='unknown'?'unknown':'failed',nextAttemptAt:Date|null=null,retryCount=row.retryCount;
  if(safe.kind==='temporary'&&retryCount<delays.length){nextAttemptAt=new Date(now.getTime()+delays[retryCount]!*1000);retryCount++;if(nextAttemptAt<row.sourceExpiresAt)status='retry_scheduled';else{status='expired';nextAttemptAt=null;}}
  const purge=['accepted','expired'].includes(status);
  await tx.update(emailDelivery).set({status,nextAttemptAt,retryCount,errorCode:safe.kind==='accepted'?null:safe.code,leaseToken:null,leaseExpiresAt:null,workerId:null,dispatchStartedAt:null,envelope:purge?null:row.envelope,updatedAt:now}).where(eq(emailDelivery.id,row.id));await event(tx,row,status,now,claim.attemptId,safe.kind==='accepted'?null:safe.code);return true;
 });
}
/** Definite stale-source result before network, fenced to the same claim. */
export async function abandonEmail(db:Database,claim:EmailClaim,status:'cancelled'|'expired'|'superseded'|'failed',code:string,now=new Date()){
 return db.transaction(async tx=>{const row=await lockedClaim(tx,claim,now);if(!row||row.dispatchStartedAt)return false;const safe=redactEmailOutcome({kind:'permanent',code});await tx.update(emailDelivery).set({status,errorCode:safe.kind==='accepted'?null:safe.code,envelope:null,nextAttemptAt:null,leaseToken:null,leaseExpiresAt:null,workerId:null,dispatchStartedAt:null,updatedAt:now}).where(eq(emailDelivery.id,row.id));await event(tx,row,status,now,claim.attemptId,safe.kind==='accepted'?null:safe.code);return true;});
}
export async function reclaimEmailLeases(db:Database,now=new Date()){
 return db.transaction(async tx=>{
  const rows=await tx.select().from(emailDelivery).where(and(eq(emailDelivery.status,'dispatching'),lte(emailDelivery.leaseExpiresAt,now))).for('update',{skipLocked:true});
  for(const row of rows){const status:EmailStatus=row.sourceExpiresAt<=now?'expired':row.dispatchStartedAt?'unknown':'queued';const attempt=(await tx.select().from(emailAttempt).where(and(eq(emailAttempt.deliveryId,row.id),eq(emailAttempt.leaseToken,row.leaseToken!))))[0];await tx.update(emailDelivery).set({status,leaseToken:null,leaseExpiresAt:null,workerId:null,dispatchStartedAt:null,nextAttemptAt:status==='queued'?now:null,envelope:status==='expired'?null:row.envelope,errorCode:'lease_expired',updatedAt:now}).where(eq(emailDelivery.id,row.id));await event(tx,row,status,now,attempt?.id??null,'lease_expired');}
  return rows.length;
 });
}
export async function expireEmailSources(db:Database,now=new Date()){
 return db.transaction(async tx=>{const rows=await tx.select().from(emailDelivery).where(and(lte(emailDelivery.sourceExpiresAt,now),sql`${emailDelivery.status} in ('unconfigured','queued','retry_scheduled','failed','unknown')`)).for('update',{skipLocked:true});for(const row of rows){await tx.update(emailDelivery).set({status:'expired',envelope:null,nextAttemptAt:null,errorCode:'source_expired',updatedAt:now}).where(eq(emailDelivery.id,row.id));await event(tx,row,'expired',now,null,'source_expired');}return rows.length;});
}
