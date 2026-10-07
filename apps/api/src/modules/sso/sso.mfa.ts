import {session,user,verification,type Database} from '@factoryos/db';
import {and,eq} from 'drizzle-orm';
import {APIError,createAuthMiddleware,isAPIError} from 'better-auth/api';
import {deleteSessionCookie} from 'better-auth/cookies';
import {symmetricDecrypt,symmetricEncrypt} from 'better-auth/crypto';
import type {BetterAuthPlugin} from 'better-auth';
import {twoFactor as twoFactorPlugin} from 'better-auth/plugins';
import type {AppConfig} from '../../config.js';
import {SsoStore} from './sso.store.js';
import {getSsoFrame,setSsoFrame} from './sso.types.js';
import {validateSsoReturn} from './sso.urls.js';

export function withSsoMfa(plugin:ReturnType<typeof twoFactorPlugin>,store:SsoStore,config:AppConfig,db:Database):BetterAuthPlugin {
 const nativePlugin:BetterAuthPlugin=plugin,native=nativePlugin.hooks?.after?.[0];
 if(!native||typeof native.matcher!=='function'||typeof native.handler!=='function'||plugin.id!=='two-factor')throw new Error('Unsupported native two-factor hook shape');
 const privateString={type:'string' as const,required:false,input:false,returned:false};
 return {...plugin,schema:{...plugin.schema,verification:{fields:{ssoAccountId:privateString,ssoIssuer:privateString,ssoReturnCipher:privateString}}},hooks:{...plugin.hooks,
  before:[...(nativePlugin.hooks?.before??[]),{matcher:ctx=>['/two-factor/verify-totp','/two-factor/verify-backup-code'].includes(ctx.path??''),handler:createAuthMiddleware(async ctx=>{
   const cookie=ctx.context.createAuthCookie('two_factor'),identifier=await ctx.getSignedCookie(cookie.name,ctx.context.secret);
   if(!identifier)return;
   const found=await ctx.context.internalAdapter.findVerificationValue(identifier);if(!found)return;
   const [record]=await db.select().from(verification).where(eq(verification.id,found.id));
   if(!record?.ssoAccountId)return; // Original password challenges retain native behavior.
   try{
    if(!record.ssoIssuer||!record.ssoReturnCipher||record.expiresAt<=new Date()||!/^2fa-(?!attempts-)/.test(identifier))throw new Error();
    const frame=await store.frameForBinding(record.ssoAccountId,record.value,record.ssoIssuer,'mfa',validateSsoReturn(await symmetricDecrypt({key:config.BETTER_AUTH_SECRET,data:record.ssoReturnCipher})));
    setSsoFrame(ctx,frame);
   }catch{throw new APIError('UNAUTHORIZED',{message:'Sign in again to complete verification'});}
  })}],
  after:[{matcher:ctx=>native.matcher(ctx)||(ctx.path??'').startsWith('/callback/'),handler:createAuthMiddleware(async ctx=>{
   const runNative=async()=>{
    const result=await native.handler({...ctx,returnHeaders:true});
    if(!result||typeof result!=='object'||!('headers' in result)||!(result.headers instanceof Headers)||!('response' in result))throw new Error('Unsupported native MFA response');
    result.headers.forEach((value,key)=>{if(key!=='set-cookie')ctx.setHeader(key,value);});
    for(const cookie of result.headers.getSetCookie())ctx.responseHeaders.append('set-cookie',cookie);
    return result.response;
   };
   const frame=getSsoFrame(ctx);
   if(!ctx.path.startsWith('/callback/')||frame?.mode!=='signin')return runNative();
   const provisional=ctx.context.newSession;if(!provisional)return;
   try{
    const [current]=await db.select().from(user).where(eq(user.id,frame.userId));if(!current)throw new Error();
    ctx.context.setNewSession({...provisional,user:{...provisional.user,twoFactorEnabled:current.twoFactorEnabled}});
    await runNative();
    if(!ctx.context.newSession)throw ctx.redirect(new URL('/sign-in/two-factor?'+new URLSearchParams({next:frame.returnPath}),config.WEB_ORIGIN).href);
    await store.completeSsoSession(provisional.session.id,frame);
   }catch(error){
    // Redirect-to-challenge has already removed the native provisional session.
    if(ctx.context.newSession){try{await db.delete(session).where(and(eq(session.id,provisional.session.id),eq(session.userId,frame.userId)));}finally{deleteSessionCookie(ctx,true);ctx.context.setNewSession(null);}}
    if(isAPIError(error)&&error.status==='FOUND')throw error;
    throw ctx.redirect(new URL('/sso/error',config.WEB_ORIGIN).href);
   }
  })},...(plugin.hooks?.after?.slice(1)??[])],
 }};
}

/** Persist provenance on the real challenge, never on native attempt/trust rows. */
export async function ssoVerificationData(data:typeof verification.$inferInsert,ctx:Parameters<typeof getSsoFrame>[0],config:AppConfig){
 const frame=getSsoFrame(ctx);
 if(!frame||frame.mode!=='signin'||data.value!==frame.userId||!/^2fa-(?!attempts-)/.test(data.identifier))return;
 return {data:{...data,ssoAccountId:frame.accountId,ssoIssuer:frame.issuer,ssoReturnCipher:await symmetricEncrypt({key:config.BETTER_AUTH_SECRET,data:frame.returnPath})}};
}
