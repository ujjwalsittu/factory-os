import {account,session,verification,type Database} from '@factoryos/db';
import {and,eq,inArray} from 'drizzle-orm';
import {APIError,createAuthMiddleware,getAuthoritativeSessionFromCtx,addOAuthServerContext,getOAuthState} from 'better-auth/api';
import {google,microsoft,verifyGoogleIdToken} from 'better-auth/social-providers';
import {verifyProviderIdToken} from 'better-auth/oauth2';
import {symmetricEncrypt} from 'better-auth/crypto';
import type {BetterAuthOptions} from 'better-auth';
import type {AppConfig} from '../../config.js';
import type {RequestContext} from '../../common/access.js';
import {SsoStore} from './sso.store.js';
import {SsoService} from './sso.service.js';
import {getSsoFrame,type SsoProviderId} from './sso.types.js';
import {validateSsoReturn,ssoLanding} from './sso.urls.js';
import {ssoVerificationData} from './sso.mfa.js';

export function ssoMutationBefore(db:Database,config:AppConfig){
 const store=new SsoStore(db,config);
 return createAuthMiddleware(async ctx=>{
  // Authorization reads must not renew: native dispatch replaces before-hook
  // headers with endpoint headers. Let the endpoint renew its own cookie.
  const currentSession=()=>getAuthoritativeSessionFromCtx({...ctx,query:{...ctx.query,disableRefresh:true}});
  if(!ctx.path.startsWith('/callback/')&&!['/sign-in/social','/link-social'].includes(ctx.path)){
   const current=await currentSession();
   if(current){
    const [row]=await db.select({pending:session.ssoPending}).from(session).where(eq(session.id,current.session.id));
    if(row?.pending){ctx.context.session=null;if(ctx.path==='/get-session')return ctx.json(null);throw new APIError('UNAUTHORIZED',{message:'Complete verification first'});}
    if(['/revoke-sessions','/revoke-other-sessions'].includes(ctx.path))await db.delete(verification).where(and(eq(verification.value,current.user.id),inArray(verification.ssoAccountId,(await db.select({id:account.id}).from(account).where(eq(account.userId,current.user.id))).map(a=>a.id))));
   }
  }
  if(['/get-access-token','/refresh-token','/account-info','/list-accounts'].includes(ctx.path))throw new APIError('FORBIDDEN',{message:'Provider token access is unavailable'});
  if(ctx.path.startsWith('/callback/')){
   const provider:unknown=ctx.params?.id;
   if((provider!=='google'&&provider!=='microsoft')||!config.sso[provider])throw ctx.redirect(ssoLanding(config.WEB_ORIGIN,'error'));
  }
  if(ctx.path==='/sign-in/social'||ctx.path==='/link-social'){
   const provider:unknown=ctx.body?.provider;
   if((provider!=='google'&&provider!=='microsoft')||!config.sso[provider])throw new APIError('FORBIDDEN',{message:'Provider unavailable'});
   const body=ctx.body??{};
   if(body.idToken!==undefined||body.scopes!==undefined||body.additionalParams!==undefined||body.additionalData!==undefined||body.newUserCallbackURL!==undefined||
    (body.callbackURL!==undefined&&body.callbackURL!==ssoLanding(config.WEB_ORIGIN,'success'))||
    (body.errorCallbackURL!==undefined&&body.errorCallbackURL!==ssoLanding(config.WEB_ORIGIN,'error')))throw new APIError('FORBIDDEN',{message:'SSO request refused'});
   let returnPath:string;try{returnPath=validateSsoReturn(ctx.headers?.get('x-factoryos-sso-return')??undefined);}catch{throw new APIError('BAD_REQUEST',{message:'SSO return refused'});}
   if(ctx.path==='/link-social'){
    try{
     const current=await currentSession();if(!current)throw new Error();
     const requestContext:RequestContext={user:current.user,sessionId:current.session.id,platformAdminLevel:null,tenant:null,ip:null,userAgent:null};
     const grant=await store.validateSsoAction(requestContext,ctx.headers?.get('x-factoryos-sso-action')??'',{kind:'link',provider});
     await addOAuthServerContext({factoryosAction:grant.id});returnPath='/app/settings/security';
    }catch{throw new APIError('FORBIDDEN',{message:'Connection authorization required'});}
   }
   await addOAuthServerContext({factoryosProvider:provider,factoryosReturn:returnPath});
   return {context:{body:{...body,callbackURL:ssoLanding(config.WEB_ORIGIN,'success')+'?'+new URLSearchParams({next:returnPath}),errorCallbackURL:ssoLanding(config.WEB_ORIGIN,'error')}}};
  }
  if(ctx.path!=='/unlink-account')return;
  try{
   const current=await currentSession();if(!current)throw new Error();
   const [binding]=await db.select().from(account).where(and(eq(account.id,String(ctx.body?.accountId??'')),eq(account.userId,current.user.id),inArray(account.providerId,['google','microsoft'])));
   if(!binding)throw new Error();
   const requestContext:RequestContext={user:current.user,sessionId:current.session.id,platformAdminLevel:null,tenant:null,ip:null,userAgent:null};
   await store.validateSsoAction(requestContext,ctx.headers?.get('x-factoryos-sso-action')??'',{kind:'unlink',provider:binding.providerId as SsoProviderId,targetAccountId:binding.id});
  }catch{throw new APIError('FORBIDDEN',{message:'Connection authorization required'});}
 });
}

export function buildSsoOptions(db:Database,config:AppConfig):Pick<BetterAuthOptions,'socialProviders'|'account'|'session'|'user'|'hooks'|'databaseHooks'>{
 const service=new SsoService(db,config),socialProviders:NonNullable<BetterAuthOptions['socialProviders']>={};
 if(config.sso.google){
  const c=config.sso.google,base={clientId:c.clientId,clientSecret:c.clientSecret,disableDefaultScope:true,scope:['openid','profile','email'],includeGrantedScopes:false,disableSignUp:true};
  const native=google(base);
  socialProviders.google={...base,disableIdTokenSignIn:true,getUserInfo:async token=>{
   // This installed version decodes callback id_tokens in getUserInfo. Verify
   // with the exported native verifier before handing the same token to it.
   const state=await getOAuthState();
   if(!token.idToken||!await verifyGoogleIdToken({token:token.idToken,audience:c.clientId,nonce:state?.idTokenNonce}))return null;
   return native.getUserInfo(token);
  }};
 }
 if(config.sso.microsoft){
  const c=config.sso.microsoft,base={clientId:c.clientId,clientSecret:c.clientSecret,tenantId:c.tenantId,disableDefaultScope:true,scope:['openid','profile','email'],disableProfilePhoto:true,disableSignUp:true};
  const native=microsoft(base);
  socialProviders.microsoft={...base,disableIdTokenSignIn:true,getUserInfo:async token=>{
   const state=await getOAuthState();
   if(!token.idToken||!await verifyProviderIdToken(native,token.idToken,state?.idTokenNonce))return null;
   return native.getUserInfo(token);
  }};
 }
 const privateString={type:'string' as const,required:false,input:false,returned:false};
 return {
  socialProviders,
  account:{encryptOAuthTokens:true,storeAccountCookie:false,updateAccountOnSignIn:false,additionalFields:{ssoIssuer:privateString,ssoClientId:privateString,ssoActionId:privateString},accountLinking:{enabled:true,disableImplicitLinking:true,allowDifferentEmails:false,updateUserInfoOnLink:false,trustedProviders:['google','microsoft']}},
  session:{expiresIn:60*60*24*7,updateAge:60*60*24,additionalFields:{ssoAccountId:privateString,ssoIssuer:privateString,ssoClientId:privateString,ssoPending:{type:'boolean',required:false,input:false,returned:false,defaultValue:false}}},
  user:{validateUserInfo:(data,ctx)=>service.authorizeOAuth(data,ctx)},
  hooks:{before:ssoMutationBefore(db,config),after:createAuthMiddleware(async ctx=>{
   if(ctx.path.startsWith('/callback/')){
    const location=ctx.context.responseHeaders?.get('location');
    if(location){try{if(new URL(location).pathname==='/sso/error')ctx.setHeader('location',ssoLanding(config.WEB_ORIGIN,'error'));}catch{ctx.setHeader('location',ssoLanding(config.WEB_ORIGIN,'error'));}}
   }
  })},
  databaseHooks:{
   account:{create:{before:async (data,ctx)=>{
    if(data.providerId!=='google'&&data.providerId!=='microsoft')return;
    const frame=getSsoFrame(ctx);if(!frame||frame.mode!=='link'||frame.userId!==data.userId||frame.provider!==data.providerId||!frame.actionId)throw new APIError('FORBIDDEN',{message:'Identity authorization required'});
    return {data:{...data,ssoIssuer:frame.issuer,ssoClientId:frame.clientId,ssoActionId:frame.actionId,...(data.idToken?{idToken:await symmetricEncrypt({key:config.BETTER_AUTH_SECRET,data:data.idToken})}:{})}};
   }},update:{before:async(data)=>({data:{...data,...(data.idToken?{idToken:await symmetricEncrypt({key:config.BETTER_AUTH_SECRET,data:data.idToken})}:{})}})},delete:{before:async(data,ctx)=>{
    if((data.providerId!=='google'&&data.providerId!=='microsoft')||ctx?.path!=='/unlink-account')return;
    const live=await getAuthoritativeSessionFromCtx({...ctx,query:{...ctx.query,disableRefresh:true}});
    if(!live||live.user.id!==data.userId)throw new APIError('FORBIDDEN',{message:'Connection authorization required'});
    const current:RequestContext={user:live.user,sessionId:live.session.id,platformAdminLevel:null,tenant:null,ip:null,userAgent:null};
    const grant=await service.store.validateSsoAction(current,ctx.headers?.get('x-factoryos-sso-action')??'',{kind:'unlink',provider:data.providerId,targetAccountId:data.id});
    await service.store.unlinkSsoAccount(current,grant);
    // Supported native hook cancellation suppresses a second adapter delete;
    // native ownership/last-account checks ran, and SQL mutation/event committed.
    return false;
   }}},
   session:{create:{before:async(data,ctx)=>{
    const frame=getSsoFrame(ctx);if(!frame||frame.mode==='link')return;
    if(frame.userId!==data.userId||!frame.accountId||!config.sso[frame.provider])throw new APIError('FORBIDDEN',{message:'SSO session refused'});
    await service.store.frameForBinding(frame.accountId,frame.userId,frame.issuer,frame.mode==='mfa'?'mfa':'signin',frame.returnPath);
    return {data:{...data,ssoAccountId:frame.accountId,ssoIssuer:frame.issuer,ssoClientId:frame.clientId,ssoPending:frame.mode==='signin'}};
   }}},
   verification:{create:{before:(data,ctx)=>ssoVerificationData(data,ctx,config)}},
  },
 };
}
