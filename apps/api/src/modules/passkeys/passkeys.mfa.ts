import {verification} from '@factoryos/db';
import {eq} from 'drizzle-orm';
import {APIError,createAuthMiddleware,getAuthoritativeSessionFromCtx,isAPIError} from 'better-auth/api';
import {symmetricEncrypt} from 'better-auth/crypto';
import type {BetterAuthPlugin} from 'better-auth';
import type {AppConfig} from '../../config.js';
import type {PasskeyStore} from './passkeys.store.js';
import {markNativeMfaFailure,requirePasskeyTransaction} from './passkeys.adapter.js';
import {getPasskeyFrame,setPasskeyFrame,type NativeAuthContext} from './passkeys.types.js';
import {session} from '@factoryos/db';
export function withPasskeyMfa(plugin:BetterAuthPlugin,store:PasskeyStore,config:AppConfig):BetterAuthPlugin{
 const native=plugin.hooks?.after?.[0];if(!native||plugin.id!=='two-factor')throw new Error('Unsupported native MFA hook');
 const refused=()=>new APIError('UNAUTHORIZED',{message:'Sign in again to complete verification'});
 return {...plugin,hooks:{...plugin.hooks,before:[...(plugin.hooks?.before??[]),{matcher:ctx=>(ctx.path??'').startsWith('/two-factor/'),handler:createAuthMiddleware(async ctx=>{
  const cookie=ctx.context.createAuthCookie('two_factor'),identifier=await ctx.getSignedCookie(cookie.name,ctx.context.secret);if(!identifier)return;
  const found=await ctx.context.internalAdapter.findVerificationValue(identifier);if(!found)return;
  const record=await store.pendingChallengeRecord(identifier);
  if(!record)return; // Original password/SSO challenges keep their native behavior.
  if(!['/two-factor/verify-totp','/two-factor/verify-backup-code'].includes(ctx.path)||!config.passkeys.origins.includes(ctx.headers?.get('origin')??''))throw refused();
  const current=await getAuthoritativeSessionFromCtx({...ctx,query:{...ctx.query,disableRefresh:true}});if(current)throw refused();
  try{setPasskeyFrame(ctx,await store.frameForPendingChallenge(record));}catch{throw refused();}
 })}],after:[{matcher:ctx=>native.matcher(ctx)||ctx.path==='/passkey/verify-authentication'||['/two-factor/verify-totp','/two-factor/verify-backup-code'].includes(ctx.path??''),handler:createAuthMiddleware(async ctx=>{
  const runNative=async()=>{const result=await native.handler({...ctx,returnHeaders:true});if(!result||typeof result!=='object'||!('headers' in result)||!(result.headers instanceof Headers)||!('response' in result))throw refused();result.headers.forEach((v,k)=>{if(k!=='set-cookie')ctx.setHeader(k,v);});for(const cookie of result.headers.getSetCookie())ctx.responseHeaders.append('set-cookie',cookie);return result.response;};
  const frame=getPasskeyFrame(ctx);if(frame?.mode!=='signin'&&frame?.mode!=='mfa')return native.matcher(ctx)?runNative():undefined;
  if(isAPIError(ctx.context.returned)){
   if(frame.mode==='mfa'&&['INVALID_CODE','INVALID_BACKUP_CODE','TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE','ACCOUNT_TEMPORARILY_LOCKED'].includes(String(ctx.context.returned.body?.code)))markNativeMfaFailure();
   return;
  }
  if(ctx.context.returned instanceof Response&&ctx.context.returned.status>=400)return;
  const response=frame.mode==='signin'?await runNative():undefined;
  const provisional=ctx.context.newSession;
  if(!provisional){if(frame.mode!=='signin')throw refused();return ctx.json({twoFactorRedirect:true,next:frame.returnPath});}
  try{await store.completeSession(provisional.session.id,frame);const [completed]=await requirePasskeyTransaction().select().from(session).where(eq(session.id,provisional.session.id));if(!completed)throw refused();ctx.context.setNewSession({...provisional,session:completed});}catch{throw refused();}
  if(frame.mode==='mfa')return ctx.json({status:true,next:frame.returnPath});return response;
 })},...(plugin.hooks?.after?.slice(1)??[])]}};
}
export async function passkeyVerificationData(data:typeof verification.$inferInsert,ctx:NativeAuthContext|null,config:AppConfig):Promise<void|{data:typeof verification.$inferInsert}>{
 const frame=getPasskeyFrame(ctx);if(frame?.mode!=='signin'||data.value!==frame.userId||!/^2fa-(?!attempts-)/.test(data.identifier))return;
 return {data:{...data,passkeyCredentialId:frame.credentialId,passkeyRpId:frame.rpId,passkeyPasswordVersion:frame.passwordVersion,passkeyReturnCipher:await symmetricEncrypt({key:config.BETTER_AUTH_SECRET,data:JSON.stringify({v:1,ceremonyId:frame.ceremonyId,returnPath:frame.returnPath})})}};
}
