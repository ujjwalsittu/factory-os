import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {account,authPasskeyAction,authPasskeyCeremony,authPasskeyEvent,passkey,session,user,type Database} from '@factoryos/db';
import {and,eq,sql} from 'drizzle-orm';
import type {AppConfig} from '../../config.js';
import type {RequestContext} from '../../common/access.js';
import type {AuthTransaction,PasskeyActionGrant,PasskeyActionInput,PasskeyFrame} from './passkeys.types.js';
import {getPasskeyTransaction,requirePasskeyTransaction} from './passkeys.adapter.js';

export type PasskeyActionRecord=typeof authPasskeyAction.$inferSelect;
export type PasskeyCeremonyRecord=typeof authPasskeyCeremony.$inferSelect;
export function passwordVersion(userId:string,passwordCredential:string,secret:string):string{return createHmac('sha256',secret).update(userId+'\0'+passwordCredential).digest('hex');}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const refused=()=>new Error('Passkey consent or reauthentication refused');
function sameVersion(a:string,b:string):boolean{return /^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
export class PasskeyStore{
 constructor(private readonly db:Database,private readonly config:AppConfig){}
 configHash():string{return hash(JSON.stringify(this.config.passkeys));}
 async passwordVersionForOwner(userId:string):Promise<string>{return this.credentialVersion(getPasskeyTransaction()??this.db,userId,false);}
 private async credentialVersion(reader:Database|AuthTransaction,userId:string,locked:boolean):Promise<string>{
  const query=reader.select().from(account).where(and(eq(account.userId,userId),eq(account.providerId,'credential'),eq(account.accountId,userId)));
  const [credential]=await (locked?query.for('update'):query);
  if(!credential?.password)throw refused();return passwordVersion(userId,credential.password,this.config.BETTER_AUTH_SECRET);
 }
 async issueAction(ctx:RequestContext,input:PasskeyActionInput,verifiedVersion:string):Promise<PasskeyActionGrant>{
  const nonce=randomBytes(32).toString('base64url');
  const work=async(tx:AuthTransaction)=>{
   const [owner]=await tx.select().from(user).where(eq(user.id,ctx.user.id)).for('update');
   const current=await this.credentialVersion(tx,ctx.user.id,true);
   if(!owner||!sameVersion(current,verifiedVersion)||!['register','rename','remove'].includes(input.kind))throw refused();
   const rp=await this.actionRp(tx,owner.id,input);
   const [live]=await tx.select().from(session).where(and(eq(session.id,ctx.sessionId),eq(session.userId,owner.id))).for('update');
   const now=await this.now(tx);this.freshSession(live,now);
   const [grant]=await tx.insert(authPasskeyAction).values({userId:owner.id,sessionId:live!.id,kind:input.kind,targetId:input.targetId??null,rpId:rp,configHash:this.configHash(),passwordVersion:verifiedVersion,nonceHash:hash(nonce),createdAt:now,expiresAt:new Date(now.getTime()+300000)}).returning();
   return {nonce,expiresAt:grant!.expiresAt.toISOString()};
  };
  const tx=getPasskeyTransaction();return tx?work(tx):this.db.transaction(work);
 }
 private async actionRp(tx:AuthTransaction,userId:string,input:PasskeyActionInput):Promise<string>{
  if(input.kind==='register'){
   if(input.targetId||!this.config.passkeys.enabled||!this.config.passkeys.rpId)throw refused();
   const keys=await tx.select({id:passkey.id}).from(passkey).where(eq(passkey.userId,userId));if(keys.length>=this.config.passkeys.maxPerUser)throw refused();return this.config.passkeys.rpId;
  }
  const [key]=await tx.select().from(passkey).where(and(eq(passkey.id,input.targetId??''),eq(passkey.userId,userId))).for('update');if(!key)throw refused();return key.rpId;
 }
 async authorizeAction(ctx:RequestContext,nonce:string,input:PasskeyActionInput):Promise<PasskeyActionRecord>{
  if(!/^[A-Za-z0-9_-]{43}$/.test(nonce))throw refused();const tx=requirePasskeyTransaction();
  const [owner]=await tx.select().from(user).where(eq(user.id,ctx.user.id)).for('update');if(!owner)throw refused();
  const version=await this.credentialVersion(tx,owner.id,true);
  const [action]=await tx.select().from(authPasskeyAction).where(eq(authPasskeyAction.nonceHash,hash(nonce))).for('update');
  if(!action||action.userId!==owner.id||action.sessionId!==ctx.sessionId||action.kind!==input.kind||action.targetId!==(input.targetId??null)||action.consumedAt||action.configHash!==this.configHash()||!sameVersion(action.passwordVersion,version))throw refused();
  if(action.rpId!==await this.actionRp(tx,owner.id,input))throw refused();
  const [live]=await tx.select().from(session).where(and(eq(session.id,ctx.sessionId),eq(session.userId,owner.id))).for('update');const now=await this.now(tx);this.freshSession(live,now);
  if(action.createdAt>now||action.expiresAt<=now)throw refused();
  await tx.execute(sql`select set_config('factoryos.passkey.action_id',${action.id},true)`);return action;
 }
 async completeSession(sessionId:string,frame:Extract<PasskeyFrame,{mode:'signin'|'mfa'}>):Promise<void>{
  const tx=requirePasskeyTransaction();const [owner]=await tx.select().from(user).where(eq(user.id,frame.userId)).for('update');if(!owner)throw refused();
  const version=await this.credentialVersion(tx,owner.id,true);
  const [key]=await tx.select().from(passkey).where(and(eq(passkey.id,frame.credentialId),eq(passkey.userId,owner.id))).for('update');
  const [ceremony]=await tx.select().from(authPasskeyCeremony).where(eq(authPasskeyCeremony.id,frame.ceremonyId)).for('update');
  const [pending]=await tx.select().from(session).where(eq(session.id,sessionId)).for('update');const now=await this.now(tx);
  if(!this.config.passkeys.enabled||!key||key.rpId!==this.config.passkeys.rpId||key.rpId!==frame.rpId||!sameVersion(version,frame.passwordVersion)||!ceremony?.consumedAt||ceremony.kind!=='signin'||ceremony.userId!==owner.id||ceremony.credentialId!==key.id||ceremony.rpId!==key.rpId||!sameVersion(ceremony.passwordVersion??'',version)||!pending?.passkeyPending||pending.userId!==owner.id||pending.passkeyCredentialId!==key.id||pending.passkeyRpId!==key.rpId||pending.expiresAt<=now)throw refused();
  await tx.insert(authPasskeyEvent).values({kind:'signed_in',userId:owner.id,credentialId:key.id,sessionId:pending.id,rpId:key.rpId,createdAt:now});
  await tx.update(session).set({passkeyPending:false}).where(eq(session.id,pending.id));
  await tx.execute(sql`select set_config('factoryos.passkey.ceremony_id',${ceremony.id},true),set_config('factoryos.passkey.session_id',${pending.id},true)`);
  await tx.update(passkey).set({lastUsedAt:now}).where(eq(passkey.id,key.id));
 }
 async pruneActions(limit=500):Promise<number>{
  if(!Number.isInteger(limit)||limit<1||limit>500)throw new Error('Invalid passkey cleanup limit');
  const result=await this.db.execute(sql`delete from auth_passkey_action where id in (select id from auth_passkey_action where expires_at<clock_timestamp() order by expires_at limit ${limit} for update skip locked) returning id`);return result.rows.length;
 }
 private async now(tx:AuthTransaction):Promise<Date>{const result=await tx.execute<{now:Date}>(sql`select clock_timestamp() now`);return new Date(result.rows[0]!.now);}
 private freshSession(live:typeof session.$inferSelect|undefined,now:Date){if(!live||live.ssoPending||live.passkeyPending||live.expiresAt<=now||live.createdAt>now||now.getTime()-live.createdAt.getTime()>=300000)throw refused();}
}
