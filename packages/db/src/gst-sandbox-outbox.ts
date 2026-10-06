import {randomUUID} from 'node:crypto';
import {and,eq,sql,lt} from 'drizzle-orm';
import type {Database} from './index.js';
import {gstSandboxOperation as op,gstSandboxAttempt,gstSandboxEvent,gstSandboxConnection} from './schema/gst-sandbox.js';
export type LeasedOperation=typeof op.$inferSelect & {leaseToken:string};
const scope=(r:typeof op.$inferSelect)=>({tenantId:r.tenantId,entityId:r.entityId,registrationId:r.registrationId});
export async function claimOperation(db:Database,workerId:string,now=new Date()):Promise<LeasedOperation|null>{
 return db.transaction(async tx=>{
  const rows=await tx.select().from(op).where(and(eq(op.status,'queued'),eq(op.provider,'mock'))).orderBy(op.createdAt).limit(1).for('update',{skipLocked:true});const r=rows[0];if(!r)return null;
  if(r.environment!=='sandbox')throw new Error('Sandbox worker refuses production');
  if(r.parentId){const [p]=await tx.select().from(op).where(and(eq(op.id,r.parentId),eq(op.tenantId,r.tenantId),eq(op.entityId,r.entityId),eq(op.registrationId,r.registrationId))).for('update');if(!p||p.detachedAt)throw new Error('Invalid parent sandbox operation');}
  const [connection]=await tx.select().from(gstSandboxConnection).where(and(eq(gstSandboxConnection.id,r.connectionId),eq(gstSandboxConnection.tenantId,r.tenantId),eq(gstSandboxConnection.entityId,r.entityId),eq(gstSandboxConnection.registrationId,r.registrationId)));if(!connection||connection.environment!=='sandbox')throw new Error('Sandbox connection unavailable');
  const token=randomUUID(),sequence=r.attemptSequence+1;const [leased]=await tx.update(op).set({status:'sending',leaseToken:token,leaseExpiresAt:new Date(now.getTime()+60000),attemptSequence:sequence}).where(eq(op.id,r.id)).returning();
  await tx.insert(gstSandboxAttempt).values({...scope(r),operationId:r.id,sequence,leaseToken:token,credentialRevision:connection.credentialRevision});await tx.insert(gstSandboxEvent).values({...scope(r),operationId:r.id,kind:'sending',actorId:workerId,evidence:{sequence}});return {...leased!,leaseToken:token};
 });
}
export async function completeOperation(db:Database,leaseToken:string,outcome:{kind:string;evidence?:Record<string,unknown>;code?:string}):Promise<boolean>{
 return db.transaction(async tx=>{const [r]=await tx.select().from(op).where(and(eq(op.leaseToken,leaseToken),eq(op.status,'sending'))).for('update');if(!r||!r.leaseExpiresAt||r.leaseExpiresAt.getTime()<=Date.now())return false;
 const status=outcome.kind==='confirmed'?(outcome.evidence?.status==='cancelled'?'cancelled':'succeeded'):outcome.kind==='rejected'?'rejected':'unknown';
 await tx.update(op).set({status,result:{...outcome},leaseToken:null,leaseExpiresAt:null}).where(eq(op.id,r.id));await tx.insert(gstSandboxEvent).values({...scope(r),operationId:r.id,kind:status,evidence:{...outcome}});
 if(r.parentId&&outcome.kind==='confirmed'){
  let parentId:string|null=r.parentId;
  for(let depth=0;parentId&&depth<100;depth++){
   const [p]=await tx.select().from(op).where(and(eq(op.id,parentId),eq(op.tenantId,r.tenantId),eq(op.entityId,r.entityId),eq(op.registrationId,r.registrationId))).for('update');if(!p||p.detachedAt)break;
   // Recover uncertain descendants and project the latest proven resource onto the root.
   if(p.status==='unknown'||!p.parentId){await tx.update(op).set({status:outcome.evidence?.status==='cancelled'?'cancelled':'succeeded',result:{...outcome}}).where(eq(op.id,p.id));await tx.insert(gstSandboxEvent).values({...scope(r),operationId:p.id,kind:'provider_reconciled',evidence:{childId:r.id,...outcome}})}
   parentId=p.parentId;
  }
 }

 return true;});
}
export async function recoverExpiredLease(db:Database,now=new Date()):Promise<number>{return db.transaction(async tx=>{const rows=await tx.select().from(op).where(and(eq(op.status,'sending'),lt(op.leaseExpiresAt,now))).for('update',{skipLocked:true});for(const r of rows){await tx.update(op).set({status:'unknown',leaseToken:null,leaseExpiresAt:null}).where(eq(op.id,r.id));await tx.insert(gstSandboxEvent).values({...scope(r),operationId:r.id,kind:'unknown',evidence:{reason:'sending lease expired',sequence:r.attemptSequence}})}return rows.length})}
