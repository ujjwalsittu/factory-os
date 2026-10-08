import type {Database} from '@factoryos/db';
import {isAPIError} from 'better-auth/api';
import {isPasskeyAdapter,withPasskeyTransaction} from './passkeys.adapter.js';

const methods=new Set(['generatePasskeyRegistrationOptions','generatePasskeyAuthenticationOptions','verifyPasskeyRegistration','verifyPasskeyAuthentication','listPasskeys','deletePasskey','updatePasskey']);
class ReturnedFailure extends Error{constructor(readonly value:unknown){super('Passkey native response refused');}}
function failed(value:unknown):boolean{
 if(value instanceof Response)return value.status>=400;
 if(isAPIError(value))return true;
 if(value&&typeof value==='object'&&'response' in value)return failed(value.response);
 return false;
}
function withoutAuthorityCookies(value:unknown):unknown{
 if(value instanceof Response){const headers=new Headers(value.headers);headers.delete('set-cookie');return new Response(value.body,{status:value.status,statusText:value.statusText,headers});}
 if(value&&typeof value==='object'&&'headers' in value&&value.headers instanceof Headers){const headers=new Headers(value.headers);headers.delete('set-cookie');return {...value,headers};}
 return value;
}
export function withPasskeyAuthority<T extends {handler:(request:Request)=>Promise<Response>;api:object;$context:Promise<{adapter:unknown}>}>(auth:T,_db:Database):T{
 const call=async(work:()=>Promise<unknown>):Promise<unknown>=>{
  const {adapter}=await auth.$context;
  if(!isPasskeyAdapter(adapter))throw new Error('Passkey transaction adapter required');
  try{return await withPasskeyTransaction(adapter,async()=>{const result=await work();if(failed(result))throw new ReturnedFailure(result);return result;});}
  catch(error){if(error instanceof ReturnedFailure)return withoutAuthorityCookies(error.value);throw error;}
 };
 const api=new Proxy(auth.api,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);if(typeof key!=='string'||!methods.has(key)||typeof value!=='function')return value;return (...args:unknown[])=>call(()=>Reflect.apply(value,target,args));}});
 return {...auth,api,handler:async(request:Request)=>{
  if(!new URL(request.url).pathname.startsWith('/api/auth/passkey/'))return auth.handler(request);
  return await call(()=>auth.handler(request)) as Response;
 }};
}
