'use client';
import {startRegistration,startAuthentication,WebAuthnAbortService,browserSupportsWebAuthn} from '@simplewebauthn/browser';
import {z} from 'zod';
import {authClient} from './auth-client';
import {safeNextPath} from './safe-next';
const id=z.string().min(1).max(256),bytes=z.string().min(1).max(32768).regex(/^[A-Za-z0-9_-]+$/);
export const passkeySummarySchema=z.object({id,name:z.string().trim().min(1).max(80),createdAt:z.iso.datetime(),lastUsedAt:z.iso.datetime().nullable(),deviceType:z.enum(['singleDevice','multiDevice']),backedUp:z.boolean()}).strict();
export type PasskeySummary=z.infer<typeof passkeySummarySchema>;
export type PasskeyIdentity={userId:string;sessionId:string};
const identitySchema=z.object({user:z.object({id}),session:z.object({id})});
const transports=z.array(z.enum(['usb','nfc','ble','internal','hybrid','smart-card'])).max(8);
const descriptor=z.object({id:bytes.max(1024),type:z.literal('public-key'),transports:transports.optional()});
const creationSchema=z.object({challenge:bytes,rp:z.object({id:z.string().min(1).max(253),name:z.literal('FactoryOS')}),user:z.object({id:bytes.max(43),name:z.string().max(512),displayName:z.string().max(512)}),pubKeyCredParams:z.array(z.object({type:z.literal('public-key'),alg:z.number().int()})).min(1).max(20),timeout:z.number().int().positive().max(300000).optional(),excludeCredentials:z.array(descriptor).max(20).optional(),attestation:z.literal('none'),authenticatorSelection:z.object({residentKey:z.literal('required'),requireResidentKey:z.boolean().optional(),userVerification:z.literal('required'),authenticatorAttachment:z.enum(['platform','cross-platform']).optional()}),extensions:z.object({credProps:z.boolean().optional()}).optional()});
const authenticationSchema=z.object({challenge:bytes,rpId:z.string().min(1).max(253),timeout:z.number().int().positive().max(300000).optional(),allowCredentials:z.array(descriptor).max(20).optional(),userVerification:z.literal('required'),extensions:z.object({}).optional()});
const failure=()=>new Error('Passkey request was not completed. Use your password or try again.');
let cancelActive:(()=>void)|null=null;
export function passkeySupported():boolean{return typeof window!=='undefined'&&window.isSecureContext&&browserSupportsWebAuthn();}
export function cancelPasskeyRequest():void{cancelActive?.();}
export function notifyPasskeyAuthChanged():void{authClient.$store.notify('$sessionSignal');}
export async function passkeyRequest(path:string,body:unknown=undefined,signal?:AbortSignal,headers:Record<string,string>={}):Promise<unknown>{
 const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal,headers:{accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!response.ok)throw failure();return response.json();
}
export async function currentPasskeyIdentity(signal?:AbortSignal):Promise<PasskeyIdentity|null>{
 const data=await passkeyRequest('/api/auth/get-session?disableRefresh=true',undefined,signal);if(data===null)return null;const parsed=identitySchema.safeParse(data);if(!parsed.success)throw failure();return {userId:parsed.data.user.id,sessionId:parsed.data.session.id};
}
export function samePasskeyIdentity(a:PasskeyIdentity|null,b:PasskeyIdentity|null):boolean{return a?.userId===b?.userId&&a?.sessionId===b?.sessionId;}
async function ceremony(parent?:AbortSignal){
 cancelActive?.();const controller=new AbortController();
 const cancel=()=>{controller.abort();if(cancelActive===cancel)WebAuthnAbortService.cancelCeremony();};cancelActive=cancel;
 if(parent?.aborted)cancel();parent?.addEventListener('abort',cancel,{once:true});
 let unsubscribe:(()=>void)|undefined;
 try{const expected=await currentPasskeyIdentity(controller.signal);
  unsubscribe=authClient.$store.atoms.session?.subscribe((value:unknown)=>{if(!value||typeof value!=='object'||!('data' in value)||('isPending' in value&&value.isPending))return;const parsed=identitySchema.safeParse(value.data),observed=parsed.success?{userId:parsed.data.user.id,sessionId:parsed.data.session.id}:null;if((parsed.success||value.data===null)&&!samePasskeyIdentity(expected,observed))cancel();});
  const finish=()=>{unsubscribe?.();parent?.removeEventListener('abort',cancel);if(cancelActive===cancel)cancelActive=null;};
  return {signal:controller.signal,expected,async assertCurrent(){if(controller.signal.aborted||!samePasskeyIdentity(expected,await currentPasskeyIdentity(controller.signal)))throw failure();},finish};
 }catch{unsubscribe?.();parent?.removeEventListener('abort',cancel);if(cancelActive===cancel)cancelActive=null;throw failure();}
}
export async function enrollPasskey(name:string,nonce:string,signal?:AbortSignal):Promise<PasskeySummary>{
 const op=await ceremony(signal);try{if(!passkeySupported()||!op.expected)throw failure();const label=z.string().trim().min(1).max(80).parse(name),proof=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(nonce),headers={'x-factoryos-passkey-action':proof};await op.assertCurrent();const options=creationSchema.parse(await passkeyRequest('/api/auth/passkey/generate-register-options',undefined,op.signal,headers));if(options.rp.id!==window.location.hostname)throw failure();await op.assertCurrent();const response=await startRegistration({optionsJSON:options});await op.assertCurrent();const result=passkeySummarySchema.parse(await passkeyRequest('/api/auth/passkey/verify-registration',{name:label,response},op.signal,headers));await op.assertCurrent();return result;}catch{throw failure();}finally{op.finish();}
}
export async function signInPasskey(next:string,signal?:AbortSignal):Promise<{twoFactorRedirect:boolean;next:string}>{
 const op=await ceremony(signal);try{if(!passkeySupported()||op.expected)throw failure();const headers={'x-factoryos-passkey-return':safeNextPath(next)};await op.assertCurrent();const options=authenticationSchema.parse(await passkeyRequest('/api/auth/passkey/generate-authenticate-options',undefined,op.signal,headers));if(options.rpId!==window.location.hostname)throw failure();await op.assertCurrent();const response=await startAuthentication({optionsJSON:options,useBrowserAutofill:false});await op.assertCurrent();const result=await passkeyRequest('/api/auth/passkey/verify-authentication',{response},op.signal,headers);
  const pending=z.object({twoFactorRedirect:z.literal(true),next:z.string().max(2048)}).strict().safeParse(result);if(pending.success){await op.assertCurrent();return {twoFactorRedirect:true,next:safeNextPath(pending.data.next)};}
  const completed=identitySchema.parse(result),current=await currentPasskeyIdentity(op.signal);if(!current||current.userId!==completed.user.id||current.sessionId!==completed.session.id)throw failure();op.finish();notifyPasskeyAuthChanged();return {twoFactorRedirect:false,next:headers['x-factoryos-passkey-return']};
 }catch{throw failure();}finally{op.finish();}
}
