import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {account,authPasskeyAction,authPasskeyCeremony,authPasskeyEvent,passkey,session,user,verification,type Database} from '@factoryos/db';
import {and,eq,sql} from 'drizzle-orm';
import type {AppConfig} from '../../config.js';
import type {RequestContext} from '../../common/access.js';
import type {AuthTransaction,PasskeyActionGrant,PasskeyActionInput,PasskeyFrame} from './passkeys.types.js';
import {getPasskeyTransaction,requirePasskeyTransaction} from './passkeys.adapter.js';
import {stampVerifiedRegistration} from './passkeys.adapter.js';
import {symmetricDecrypt,symmetricEncrypt} from 'better-auth/crypto';
import {getPasskeyFrame,setPasskeyFrame,type NativeAuthContext,type NativeRegistrationProof} from './passkeys.types.js';
import {validateSsoReturn} from '../sso/sso.urls.js';
import {z} from 'zod';

export type PasskeyActionRecord=typeof authPasskeyAction.$inferSelect;
export type PasskeyCeremonyRecord=typeof authPasskeyCeremony.$inferSelect;
export function passwordVersion(userId:string,passwordCredential:string,secret:string):string{return createHmac('sha256',secret).update(userId+'\0'+passwordCredential).digest('hex');}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const refused=()=>new Error('Passkey consent or reauthentication refused');
function sameVersion(a:string,b:string):boolean{return /^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
export class PasskeyStore{
 constructor(private readonly db:Database,private readonly config:AppConfig){}
 configHash():string{return hash(JSON.stringify(this.config.passkeys));}
 async pendingChallengeRecord(identifier:string):Promise<typeof verification.$inferSelect|undefined>{
  const [record]=await (getPasskeyTransaction()??this.db).select().from(verification).where(eq(verification.identifier,identifier));
  return record&&(record.passkeyCredentialId||record.passkeyRpId||record.passkeyReturnCipher||record.passkeyPasswordVersion)?record:undefined;
 }
 async prepareCeremony(ctx:NativeAuthContext,input:{kind:'register'|'signin';nonce?:string;returnPath:string},options:{challenge:string;userHandle?:string}):Promise<PasskeyCeremonyRecord>{
  const tx=requirePasskeyTransaction(),frame=getPasskeyFrame(ctx),cookie=ctx.context.createAuthCookie('better-auth-passkey');
  // Options just minted this cookie; getSignedCookie reads only request cookies.
  // This server response identifier selects the newly created challenge record,
  // never authenticates a later caller (the native verifier checks its signature).
  const headers='responseHeaders' in ctx.context&&ctx.context.responseHeaders instanceof Headers?ctx.context.responseHeaders:null;
  const outgoing=headers?.getSetCookie().find(value=>value.startsWith(cookie.name+'='));
  const signed=outgoing?decodeURIComponent(outgoing.split(';')[0]!.slice(cookie.name.length+1)):'';
  const identifier=signed.slice(0,signed.lastIndexOf('.'));
  const native=identifier?await ctx.context.internalAdapter.findVerificationValue(identifier):null;
  const data=native?JSON.parse(native.value) as {type?:string;expectedChallenge?:string}:null;
  if(!this.config.passkeys.enabled||!this.config.passkeys.rpId||!native||data?.expectedChallenge!==options.challenge||data.type!==(input.kind==='register'?'registration':'authentication'))throw refused();
  if(input.kind==='register'&&(!frame||frame.mode!=='register'||!options.userHandle||!/^[A-Za-z0-9_-]{43}$/.test(options.userHandle)))throw refused();
  const now=await this.now(tx),expiresAt=new Date(Math.min(now.getTime()+300000,native.expiresAt.getTime()));
  const [record]=await tx.insert(authPasskeyCeremony).values({kind:input.kind,challengeHash:hash(options.challenge),rpId:this.config.passkeys.rpId,returnCipher:await symmetricEncrypt({key:this.config.BETTER_AUTH_SECRET,data:validateSsoReturn(input.returnPath)}),createdAt:now,expiresAt,...(frame?.mode==='register'?{userId:frame.userId,sessionId:frame.sessionId,actionId:frame.actionId,userHandle:options.userHandle}: {})}).returning();
  if(!record)throw refused();return record;
 }
 async registrationFrame(ctx:NativeAuthContext,action:PasskeyActionRecord,challenge:string):Promise<Extract<PasskeyFrame,{mode:'register'}>>{
  const tx=requirePasskeyTransaction(),[ceremony]=await tx.select().from(authPasskeyCeremony).where(eq(authPasskeyCeremony.challengeHash,hash(challenge))).for('update'),now=await this.now(tx);
  if(!ceremony||ceremony.kind!=='register'||ceremony.actionId!==action.id||ceremony.userId!==action.userId||ceremony.sessionId!==action.sessionId||ceremony.rpId!==action.rpId||!ceremony.userHandle||ceremony.consumedAt||ceremony.createdAt>now||ceremony.expiresAt<=now)throw refused();
  const frame:Extract<PasskeyFrame,{mode:'register'}>={mode:'register',userId:action.userId,sessionId:action.sessionId,actionId:action.id,ceremonyId:ceremony.id,rpId:ceremony.rpId,userHandle:ceremony.userHandle};setPasskeyFrame(ctx,frame);return frame;
 }
 async acceptRegistrationProof(_ctx:NativeAuthContext,frame:Extract<PasskeyFrame,{mode:'register'}>,verified:NativeRegistrationProof):Promise<void>{
  if(!verified.verification.verified||!verified.verification.registrationInfo?.userVerified||verified.user.id!==frame.userId)throw refused();
  await requirePasskeyTransaction().execute(sql`select set_config('factoryos.passkey.ceremony_id',${frame.ceremonyId},true)`);stampVerifiedRegistration(frame);
 }
 async signinFrame(ctx:NativeAuthContext,challenge:string,credentialID:string,userHandle:string):Promise<Extract<PasskeyFrame,{mode:'signin'}>>{
  const tx=requirePasskeyTransaction();if(!/^[A-Za-z0-9_-]{1,1024}$/.test(credentialID)||Buffer.from(credentialID,'base64url').toString('base64url')!==credentialID)throw refused();
  const [lookup]=await tx.select({id:passkey.id,userId:passkey.userId}).from(passkey).where(eq(passkey.credentialID,credentialID));if(!lookup)throw refused();
  const [owner]=await tx.select().from(user).where(eq(user.id,lookup.userId)).for('update');if(!owner)throw refused();
  const version=await this.credentialVersion(tx,owner.id,true),[key]=await tx.select().from(passkey).where(eq(passkey.id,lookup.id)).for('update');
  const [ceremony]=await tx.select().from(authPasskeyCeremony).where(eq(authPasskeyCeremony.challengeHash,hash(challenge))).for('update'),now=await this.now(tx);
  if(!this.config.passkeys.enabled||!key||key.rpId!==this.config.passkeys.rpId||key.userHandle!==userHandle||!ceremony||ceremony.kind!=='signin'||ceremony.rpId!==key.rpId||ceremony.consumedAt||ceremony.createdAt>now||ceremony.expiresAt<=now)throw refused();
  const frame:Extract<PasskeyFrame,{mode:'signin'}>={mode:'signin',userId:owner.id,credentialId:key.id,ceremonyId:ceremony.id,rpId:key.rpId,passwordVersion:version,returnPath:validateSsoReturn(await symmetricDecrypt({key:this.config.BETTER_AUTH_SECRET,data:ceremony.returnCipher}))};setPasskeyFrame(ctx,frame);return frame;
 }
 async acceptAuthenticationProof(frame:Extract<PasskeyFrame,{mode:'signin'}>,userVerified:boolean):Promise<void>{
  if(!userVerified)throw refused();const tx=requirePasskeyTransaction(),now=await this.now(tx);
  const rows=await tx.update(authPasskeyCeremony).set({userId:frame.userId,credentialId:frame.credentialId,passwordVersion:frame.passwordVersion,consumedAt:now}).where(and(eq(authPasskeyCeremony.id,frame.ceremonyId),sql`${authPasskeyCeremony.consumedAt} is null`,sql`${authPasskeyCeremony.expiresAt}>clock_timestamp()`)).returning();if(rows.length!==1)throw refused();
  await tx.execute(sql`select set_config('factoryos.passkey.ceremony_id',${frame.ceremonyId},true)`);
 }
 async frameForPendingChallenge(record:typeof verification.$inferSelect):Promise<Extract<PasskeyFrame,{mode:'mfa'}>>{
  const tx=requirePasskeyTransaction();if(!record.passkeyCredentialId||!record.passkeyRpId||!record.passkeyPasswordVersion||!record.passkeyReturnCipher||!/^2fa-(?!attempts-)/.test(record.identifier)||record.ssoAccountId)throw refused();
  const [owner]=await tx.select().from(user).where(eq(user.id,record.value)).for('update');if(!owner)throw refused();
  const version=await this.credentialVersion(tx,owner.id,true),[key]=await tx.select().from(passkey).where(eq(passkey.id,record.passkeyCredentialId)).for('update');
  const payload=z.object({v:z.literal(1),ceremonyId:z.string().uuid(),returnPath:z.string().max(2048)}).strict().parse(JSON.parse(await symmetricDecrypt({key:this.config.BETTER_AUTH_SECRET,data:record.passkeyReturnCipher})));
  const [ceremony]=await tx.select().from(authPasskeyCeremony).where(eq(authPasskeyCeremony.id,payload.ceremonyId)).for('update');
  const [live]=await tx.select().from(verification).where(eq(verification.id,record.id)).for('update'),now=await this.now(tx);
  if(!this.config.passkeys.enabled||!key||key.userId!==owner.id||key.rpId!==this.config.passkeys.rpId||key.rpId!==record.passkeyRpId||!sameVersion(version,record.passkeyPasswordVersion)||!ceremony?.consumedAt||ceremony.kind!=='signin'||ceremony.userId!==owner.id||ceremony.credentialId!==key.id||ceremony.rpId!==key.rpId||!sameVersion(version,ceremony.passwordVersion??'')||!live||live.identifier!==record.identifier||live.value!==owner.id||live.passkeyCredentialId!==key.id||live.passkeyReturnCipher!==record.passkeyReturnCipher||live.expiresAt<=now)throw refused();
  return {mode:'mfa',userId:owner.id,credentialId:key.id,ceremonyId:ceremony.id,rpId:key.rpId,passwordVersion:version,returnPath:validateSsoReturn(payload.returnPath),challengeExpiresAt:live.expiresAt};
 }
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
  if(frame.mode==='mfa'&&(!frame.challengeExpiresAt||frame.challengeExpiresAt<=now))throw refused();
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
