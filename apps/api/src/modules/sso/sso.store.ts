import {createHash,randomBytes} from 'node:crypto';
import {authSsoAction,account,session,user,type Database} from '@factoryos/db';
import {and,eq,sql} from 'drizzle-orm';
import type {AppConfig} from '../../config.js';
import type {RequestContext} from '../../common/access.js';
import type {SsoActionKind,SsoAuthFrame,SsoProviderId} from './sso.types.js';

export type SsoActionRecord=typeof authSsoAction.$inferSelect;
export class SsoStore {
 constructor(private readonly db:Database,private readonly config:AppConfig){}
 async createSsoAction(ctx:RequestContext,input:{provider:SsoProviderId;kind:SsoActionKind;targetAccountId?:string}):Promise<{nonce:string;expiresAt:Date}>{
  const nonce=randomBytes(32).toString('base64url');
  const row=await this.db.transaction(async tx=>{
   const [s]=await tx.select().from(session).where(and(eq(session.id,ctx.sessionId),eq(session.userId,ctx.user.id))).for('update');
   const [u]=await tx.select().from(user).where(eq(user.id,ctx.user.id)).for('update');
   const result=await tx.execute<{now:Date}>(sql`select clock_timestamp() as now`),now=new Date(result.rows[0]!.now);
   if(!s||!u||s.ssoPending||s.expiresAt<=now||now.getTime()-s.createdAt.getTime()>=300000||!u.emailVerified)throw new Error('SSO reauthentication required');
   let issuer:string;
   if(input.kind==='link'){
    if(input.targetAccountId||!this.config.sso[input.provider])throw new Error('SSO provider unavailable');
    issuer=input.provider==='google'?'https://accounts.google.com':this.config.sso.microsoft!.issuer;
   }else{
    const [binding]=await tx.select().from(account).where(and(eq(account.id,input.targetAccountId??''),eq(account.userId,u.id),eq(account.providerId,input.provider)));
    if(!binding||!binding.ssoIssuer)throw new Error('SSO connection unavailable');issuer=binding.ssoIssuer;
   }
   const [action]=await tx.insert(authSsoAction).values({userId:u.id,sessionId:s.id,provider:input.provider,kind:input.kind,emailSnapshot:u.email,issuer,targetAccountId:input.targetAccountId??null,nonceHash:this.digest(nonce),createdAt:now,expiresAt:new Date(now.getTime()+300000)}).returning();return action!;
  });
  return {nonce,expiresAt:row.expiresAt};
 }
 async validateSsoAction(ctx:RequestContext,nonce:string,input:{provider:SsoProviderId;kind:SsoActionKind;targetAccountId?:string}):Promise<SsoActionRecord>{
  if(!/^[A-Za-z0-9_-]{43}$/.test(nonce))throw new Error('SSO consent refused');
  const [action]=await this.db.select().from(authSsoAction).where(eq(authSsoAction.nonceHash,this.digest(nonce)));
  if(!action||action.userId!==ctx.user.id||action.sessionId!==ctx.sessionId||action.kind!==input.kind||action.provider!==input.provider||action.targetAccountId!==(input.targetAccountId??null))throw new Error('SSO consent refused');
  await this.validateActionById(action.id);return action;
 }
 async validateActionById(id:string):Promise<SsoActionRecord>{
  const [a]=await this.db.select().from(authSsoAction).where(eq(authSsoAction.id,id));
  if(!a||a.consumedAt)throw new Error('SSO consent refused');
  const [s]=await this.db.select().from(session).where(and(eq(session.id,a.sessionId),eq(session.userId,a.userId)));
  const [u]=await this.db.select().from(user).where(eq(user.id,a.userId));const now=new Date();
  if(!s||!u||s.ssoPending||!u.emailVerified||u.email!==a.emailSnapshot||s.expiresAt<=now||a.expiresAt<=now||now.getTime()-s.createdAt.getTime()>=300000)throw new Error('SSO consent refused');
  if(a.kind==='link'&&(!this.config.sso[a.provider]||a.issuer!==(a.provider==='google'?'https://accounts.google.com':this.config.sso.microsoft!.issuer)))throw new Error('SSO provider unavailable');
  return a;
 }
 async prepareUnlinkReference(ctx:RequestContext,action:SsoActionRecord):Promise<void>{
  if(action.kind!=='unlink'||action.userId!==ctx.user.id||action.sessionId!==ctx.sessionId)throw new Error('SSO consent refused');
  const rows=await this.db.update(account).set({ssoActionId:action.id}).where(and(eq(account.id,action.targetAccountId!),eq(account.userId,ctx.user.id))).returning({id:account.id});
  if(rows.length!==1)throw new Error('SSO connection unavailable');
 }
 async completeSsoSession(sessionId:string,frame:SsoAuthFrame):Promise<void>{
  if(!this.config.sso[frame.provider]||frame.issuer!==(frame.provider==='google'?'https://accounts.google.com':this.config.sso.microsoft!.issuer))throw new Error('SSO provider unavailable');
  const rows=await this.db.update(session).set({ssoPending:false}).where(and(eq(session.id,sessionId),eq(session.userId,frame.userId),eq(session.ssoAccountId,frame.accountId!),eq(session.ssoIssuer,frame.issuer))).returning({id:session.id});
  if(rows.length!==1)throw new Error('SSO session refused');
 }
 async pruneSsoActions(limit=500):Promise<number>{
  const bounded=Math.min(500,Math.max(1,Math.trunc(limit)||500));
  const result=await this.db.execute(sql`delete from auth_sso_action where id in (select id from auth_sso_action where expires_at<clock_timestamp() order by expires_at limit ${bounded} for update skip locked) returning id`);return result.rows.length;
 }
 private digest(nonce:string){return createHash('sha256').update(nonce).digest('hex');}
}
