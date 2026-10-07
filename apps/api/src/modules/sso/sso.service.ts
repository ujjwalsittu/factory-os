import {Inject,Injectable,ForbiddenException} from '@nestjs/common';
import {account,authSsoEvent,user,type Database} from '@factoryos/db';
import {and,eq,inArray} from 'drizzle-orm';
import {DB,CONFIG} from '../../common/tokens.js';
import type {AppConfig} from '../../config.js';
import type {RequestContext} from '../../common/access.js';
import {providerAvailability} from './sso.config.js';
import {SsoStore} from './sso.store.js';
import type {ConnectionSummary,SsoActionKind,SsoProviderId} from './sso.types.js';
import {setSsoFrame,type NativeContext,type NativeUserValidation} from './sso.types.js';
import {getOAuthState,getAuthoritativeSessionFromCtx} from 'better-auth/api';
import {validateSsoReturn} from './sso.urls.js';

@Injectable()
export class SsoService {
 readonly store:SsoStore;
 constructor(@Inject(DB)private readonly db:Database,@Inject(CONFIG)private readonly config:AppConfig){this.store=new SsoStore(db,config);}
 availability(){return providerAvailability(this.config.sso);}
 async listMethods(ctx:RequestContext):Promise<ConnectionSummary[]>{
  const rows=await this.db.select({id:account.id,provider:account.providerId,createdAt:account.createdAt}).from(account).where(and(eq(account.userId,ctx.user.id),inArray(account.providerId,['google','microsoft'])));
  return rows.map(r=>({bindingId:r.id,provider:r.provider as SsoProviderId,label:r.provider==='google'?'Google':'Microsoft',connectedAt:r.createdAt.toISOString()}));
 }
 async issueAction(ctx:RequestContext,input:{provider:SsoProviderId;kind:SsoActionKind;targetAccountId?:string},passwordVerified:()=>Promise<boolean>){
  try{if(!await passwordVerified())throw new Error();return await this.store.createSsoAction(ctx,input);}catch{throw new ForbiddenException('Verify your email and sign in again before changing connected accounts');}
 }
 async disconnectAction(ctx:RequestContext,bindingId:string,nonce:string){
  const [binding]=await this.db.select().from(account).where(and(eq(account.id,bindingId),eq(account.userId,ctx.user.id),inArray(account.providerId,['google','microsoft'])));
  if(!binding)throw new ForbiddenException('Connection unavailable');
  const action=await this.store.validateSsoAction(ctx,nonce,{kind:'unlink',provider:binding.providerId as SsoProviderId,targetAccountId:binding.id});
  await this.store.prepareUnlinkReference(ctx,action);return binding;
 }
 async authorizeOAuth(data:NativeUserValidation,ctx:NativeContext):Promise<void|{error:string}>{
  if(data.source.method!=='oauth')return;
  const provider=data.source.oauth?.providerId;
  if(provider!=='google'&&provider!=='microsoft')return {error:'identity_refused'};
  const options=this.config.sso[provider];if(!options)return {error:'identity_refused'};
  const profile=data.source.oauth?.profile,issuer=provider==='google'?'https://accounts.google.com':this.config.sso.microsoft!.issuer;
  const subject=profile?.[provider==='google'?'sub':'oid'];
  if(typeof subject!=='string'||!subject||!profile||(provider==='google'&&(!['accounts.google.com',issuer].includes(String(profile.iss))||profile.email_verified!==true))||(provider==='microsoft'&&(profile.iss!==issuer||profile.tid!==this.config.sso.microsoft!.tenantId)))return {error:'identity_refused'};
  if(provider==='google'&&this.config.sso.google!.allowedHostedDomains.length&&!this.config.sso.google!.allowedHostedDomains.includes(String(profile.hd)))return {error:'identity_refused'};
  const state=await getOAuthState(),context=state?.serverContext;
  if(context?.factoryosProvider!==provider)return {error:'identity_refused'};
  const returnPath=validateSsoReturn(typeof context.factoryosReturn==='string'?context.factoryosReturn:undefined);
  const [binding]=await this.db.select().from(account).where(and(eq(account.providerId,provider),eq(account.accountId,subject)));
  try {
   if(data.source.action==='link-account'){
    if(typeof context.factoryosAction!=='string'||binding)throw new Error();
    const action=await this.store.validateActionById(context.factoryosAction);
    if(action.kind!=='link'||action.provider!==provider||action.issuer!==issuer||action.userId!==data.user.id||String(data.user.email).toLowerCase()!==action.emailSnapshot.toLowerCase())throw new Error();
    // Browser/session identity must still be the original locally authorized account.
    const live=await getAuthoritativeSessionFromCtx(ctx);
    if(!live||live.session.id!==action.sessionId||live.user.id!==action.userId)throw new Error();
    setSsoFrame(ctx,{mode:'link',provider,userId:action.userId,accountId:null,issuer,returnPath,actionId:action.id});
   }else{
    if(!binding||binding.ssoIssuer!==issuer||binding.userId!==data.user.id)throw new Error();
    const [current]=await this.db.select().from(user).where(eq(user.id,binding.userId));
    if(!current)throw new Error();
    setSsoFrame(ctx,{mode:'signin',provider,userId:binding.userId,accountId:binding.id,issuer,returnPath});
   }
  }catch{
   if(binding)await this.db.insert(authSsoEvent).values({userId:binding.userId,accountId:binding.id,provider,issuer,kind:'failed',code:'identity_refused'});
   return {error:'identity_refused'};
  }
 }
}
