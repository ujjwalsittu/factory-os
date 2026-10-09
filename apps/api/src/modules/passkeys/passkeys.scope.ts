import {verification,type Database} from '@factoryos/db';
import {eq} from 'drizzle-orm';
import {parseCookies} from 'better-auth/cookies';
import {APIError,isAPIError} from 'better-auth/api';
import {canPreserveNativeMfaFailure,isPasskeyAdapter,withPasskeyTransaction} from './passkeys.adapter.js';

const methods=new Set(['generatePasskeyRegistrationOptions','generatePasskeyAuthenticationOptions','verifyPasskeyRegistration','verifyPasskeyAuthentication','listPasskeys','deletePasskey','updatePasskey']);
class ReturnedFailure extends Error{constructor(readonly value:unknown){super('Passkey native response refused');}}
class RetainedApiFailure{constructor(readonly error:APIError){}}
function failed(value:unknown):boolean{
 if(value instanceof Response)return value.status>=400;
 if(isAPIError(value))return true;
 if(value&&typeof value==='object'&&'response' in value)return failed(value.response);
 return false;
}
function safeHeaders(original:Headers,allowClears=false):Headers{const headers=new Headers(original);headers.delete('set-cookie');if(allowClears)for(const cookie of original.getSetCookie())if(/;\s*max-age=0(?:;|$)/i.test(cookie))headers.append('set-cookie',cookie);return headers;}
function withoutAuthorityCookies(value:unknown,allowClears=false):unknown{
 if(value instanceof Response)return new Response(value.body,{status:value.status,statusText:value.statusText,headers:safeHeaders(value.headers,allowClears)});
 if(value&&typeof value==='object'&&'headers' in value&&value.headers instanceof Headers)return {...value,headers:safeHeaders(value.headers,allowClears)};
 return value;
}
export function withPasskeyAuthority<T extends {handler:(request:Request)=>Promise<Response>;api:object;$context:Promise<{adapter:unknown;createAuthCookie?:(name:string)=>{name:string}}>}>(auth:T,db:Database):T{
 const call=async(work:()=>Promise<unknown>):Promise<unknown>=>{
  const {adapter}=await auth.$context;
  if(!isPasskeyAdapter(adapter))throw new Error('Passkey transaction adapter required');
  let retained=false;
  try{const result=await withPasskeyTransaction(adapter,async()=>{
   let result:unknown;try{result=await work();}catch(error){if(isAPIError(error)&&canPreserveNativeMfaFailure()){retained=true;return new RetainedApiFailure(error);}throw error;}
   if(failed(result)){if(canPreserveNativeMfaFailure()){retained=true;return withoutAuthorityCookies(result,true);}throw new ReturnedFailure(result);}return result;
  });if(result instanceof RetainedApiFailure)throw result.error;return result;}
  catch(error){
   if(error instanceof ReturnedFailure)return withoutAuthorityCookies(error.value);
   if(isAPIError(error)){
    // Native API dispatch stores accumulated cookies on a hidden error symbol.
    // Rebuilding its public error preserves ordinary headers without that state.
    const headers=new Headers(error.headers);
    for(const symbol of Object.getOwnPropertySymbols(error)){const value:unknown=Reflect.get(error,symbol);if(value instanceof Headers){value.forEach((v,k)=>{if(k!=='set-cookie')headers.set(k,v);});for(const cookie of value.getSetCookie())headers.append('set-cookie',cookie);}}
    throw new APIError(error.status,error.body,safeHeaders(headers,retained));
   }
   throw error;
  }
 };
 const mfaMethods=new Set(['verifyTOTP','verifyBackupCode','verifyTwoFactorOTP','sendTwoFactorOTP']);
 const selectsPasskeyMfa=async(headers:Headers)=>{
  const context=await auth.$context;if(!context.createAuthCookie)return false;const cookie=context.createAuthCookie('two_factor');
  const signed=parseCookies(headers.get('cookie')??'').get(cookie.name);if(!signed)return false;
  const identifier=signed.slice(0,signed.lastIndexOf('.'));if(!/^2fa-(?!attempts-)[A-Za-z0-9_-]{1,128}$/.test(identifier))return false;
  const [record]=await db.select({key:verification.passkeyCredentialId,rp:verification.passkeyRpId,cipher:verification.passkeyReturnCipher,version:verification.passkeyPasswordVersion}).from(verification).where(eq(verification.identifier,identifier));
  return !!record&&(!!record.key||!!record.rp||!!record.cipher||!!record.version); // Scope selection only; native signatures prove authority.
 };
 const api=new Proxy(auth.api,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);if(typeof key!=='string'||typeof value!=='function')return value;
  if(methods.has(key))return (...args:unknown[])=>call(()=>Reflect.apply(value,target,args));
  if(mfaMethods.has(key))return async (...args:unknown[])=>{const input=args[0],headers=typeof input==='object'&&input!==null&&'headers' in input?new Headers(input.headers as HeadersInit):new Headers();return await selectsPasskeyMfa(headers)?call(()=>Reflect.apply(value,target,args)):Reflect.apply(value,target,args);};
  return value;
 }});
 return {...auth,api,handler:async(request:Request)=>{
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/api/auth/passkey/')&&!(path.startsWith('/api/auth/two-factor/')&&await selectsPasskeyMfa(request.headers)))return auth.handler(request);
  return await call(()=>auth.handler(request)) as Response;
 }};
}
