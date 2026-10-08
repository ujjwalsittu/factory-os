import {passkey as nativePasskey} from '@better-auth/passkey';
import {APIError,createAuthMiddleware,getAuthoritativeSessionFromCtx,isAPIError} from 'better-auth/api';
import {deleteSessionCookie} from 'better-auth/cookies';
import {session,type Database} from '@factoryos/db';
import {and,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {BetterAuthPlugin} from 'better-auth';
import type {AppConfig} from '../../config.js';
import type {RequestContext} from '../../common/access.js';
import type {PasskeyStore} from './passkeys.store.js';
import {requirePasskeyTransaction} from './passkeys.adapter.js';
import {getPasskeyFrame,setPasskeyFrame} from './passkeys.types.js';
import {parseSessionOutput,parseUserOutput} from 'better-auth/db';
import {validateSsoReturn} from '../sso/sso.urls.js';
import {ownedPasskeySummaries} from './passkeys.service.js';
const id=z.string().min(1).max(256);
const renameInput=z.object({id,name:z.string().trim().min(1).max(80)}).strict();
const removeInput=z.object({id}).strict();
export function createPasskeyPlugin(db:Database,config:AppConfig,store:PasskeyStore):BetterAuthPlugin{
 const refused=()=>new APIError('FORBIDDEN',{message:'Passkey verification or reauthentication required'});
 const native=nativePasskey({rpID:config.passkeys.rpId??new URL(config.WEB_ORIGIN).hostname,rpName:'FactoryOS',origin:config.passkeys.origins,authenticatorSelection:{residentKey:'required',userVerification:'required'},registration:{requireSession:true,afterVerification:async proof=>{const frame=getPasskeyFrame(proof.ctx);if(frame?.mode!=='register')throw refused();try{await store.acceptRegistrationProof(proof.ctx,frame,proof);return {name:'Passkey'};}catch{throw refused();}}},authentication:{afterVerification:async proof=>{const frame=getPasskeyFrame(proof.ctx);if(frame?.mode!=='signin')throw refused();try{await store.acceptAuthenticationProof(frame,proof.verification.authenticationInfo.userVerified);}catch{throw refused();}}}});
 const bytes=z.string().min(1).max(32768).regex(/^[A-Za-z0-9_-]+$/);
 const common={id:bytes.max(1024),rawId:bytes.max(1024),type:z.literal('public-key'),authenticatorAttachment:z.enum(['platform','cross-platform']).nullable().optional(),clientExtensionResults:z.object({credProps:z.object({rk:z.boolean()}).strict().optional()}).strict()};
 const registration=z.object({response:z.object({...common,response:z.object({clientDataJSON:bytes,attestationObject:bytes,transports:z.array(z.enum(['usb','nfc','ble','internal','hybrid','smart-card','cable'])).max(8).optional(),authenticatorData:bytes.optional(),publicKey:bytes.optional(),publicKeyAlgorithm:z.number().int().optional()}).strict()}).strict(),name:z.string().trim().min(1).max(80).default('Passkey'),createSession:z.literal(false).optional()}).strict();
 const authentication=z.object({response:z.object({...common,response:z.object({clientDataJSON:bytes,authenticatorData:bytes,signature:bytes,userHandle:bytes.max(43)}).strict()}).strict()}).strict();
 const challenge=async(ctx:Parameters<typeof getPasskeyFrame>[0])=>{
  if(!ctx)throw refused();const cookie=ctx.context.createAuthCookie('better-auth-passkey'),identifier=await ctx.getSignedCookie(cookie.name,ctx.context.secret),record=identifier?await ctx.context.internalAdapter.findVerificationValue(identifier):null;
  if(!record||record.expiresAt<=new Date())throw refused();const data:unknown=JSON.parse(record.value),parsed=z.object({expectedChallenge:bytes,type:z.enum(['registration','authentication'])}).passthrough().safeParse(data);if(!parsed.success)throw refused();return parsed.data;
 };
 const privateString={type:'string' as const,required:false,input:false,returned:false};
 const fields={...native.schema.passkey.fields,rpId:privateString,userHandle:privateString,registrationActionId:privateString,registrationCeremonyId:privateString,lastUsedAt:{type:'date' as const,required:false,input:false,returned:false}};
 return {...native,schema:{...native.schema,passkey:{...native.schema.passkey,fields}},hooks:{
  before:[{matcher:ctx=>(ctx.path??'').startsWith('/passkey/'),handler:createAuthMiddleware(async ctx=>{
   const ceremony=['/passkey/generate-register-options','/passkey/generate-authenticate-options','/passkey/verify-registration','/passkey/verify-authentication'].includes(ctx.path);
   if(ceremony){
    let browserOrigin=ctx.headers?.get('origin')??'';
    // Browsers omit Origin on same-origin options GETs. Classify that request
    // using exact allowed referrer + Fetch Metadata; verifier origins stay fixed.
    if(!browserOrigin&&ctx.method==='GET'&&ctx.path.endsWith('-options')&&ctx.headers?.get('sec-fetch-site')==='same-origin'){
     try{browserOrigin=new URL(ctx.headers.get('referer')??'').origin;}catch{/* Missing or invalid metadata refuses below. */}
    }
    if(!config.passkeys.enabled||!config.passkeys.origins.includes(browserOrigin))throw new APIError('SERVICE_UNAVAILABLE',{message:'Passkeys are unavailable'});
    if(ctx.path.includes('authenticate-options')||ctx.path.includes('verify-authentication')){
     const current=await getAuthoritativeSessionFromCtx({...ctx,query:{...ctx.query,disableRefresh:true}});if(current)throw refused();
     if(ctx.path.includes('options')){if(Object.keys(ctx.query??{}).length)throw refused();try{validateSsoReturn(ctx.headers?.get('x-factoryos-passkey-return')??undefined);}catch{throw refused();}return;}
     const input=authentication.safeParse(ctx.body);if(!input.success)throw refused();
     try{const native=await challenge(ctx);if(native.type!=='authentication')throw refused();await store.signinFrame(ctx,native.expectedChallenge,input.data.response.id,input.data.response.response.userHandle);}catch{throw refused();}return;
    }
    if(ctx.path.includes('generate-register-options')){if(Object.keys(ctx.query??{}).length)throw refused();}
    else{const input=registration.safeParse(ctx.body);if(!input.success)throw refused();}
   }else if(!['/passkey/list-user-passkeys','/passkey/update-passkey','/passkey/delete-passkey'].includes(ctx.path))throw refused();
   const tx=requirePasskeyTransaction(),live=await getAuthoritativeSessionFromCtx({...ctx,query:{...ctx.query,disableRefresh:true}});
   if(!live)throw new APIError('FORBIDDEN',{message:'Complete sign-in before changing passkeys'});
   const rows=await tx.execute(sql`select id from session where id=${live.session.id} and user_id=${live.user.id} and expires_at>clock_timestamp() and not sso_pending and not passkey_pending`);
   if(!rows.rows.length)throw new APIError('FORBIDDEN',{message:'Complete verification first'});
   if(ctx.path==='/passkey/list-user-passkeys')return;
   if(ceremony){
    const current:RequestContext={user:live.user,sessionId:live.session.id,tenant:null,platformAdminLevel:null,ip:null,userAgent:null};
    try{const action=await store.authorizeAction(current,ctx.headers?.get('x-factoryos-passkey-action')??'',{kind:'register'});
     if(ctx.path.includes('options'))setPasskeyFrame(ctx,{mode:'register',userId:live.user.id,sessionId:live.session.id,actionId:action.id,ceremonyId:'',rpId:action.rpId,userHandle:''});
     else{const native=await challenge(ctx);if(native.type!=='registration')throw refused();await store.registrationFrame(ctx,action,native.expectedChallenge);}
    }catch{throw refused();}return;
   }
   const input=(ctx.path==='/passkey/update-passkey'?renameInput:removeInput).safeParse(ctx.body);if(!input.success)throw new APIError('BAD_REQUEST',{message:'Invalid passkey change'});
   const kind=ctx.path==='/passkey/update-passkey'?'rename':'remove';
   const current:RequestContext={user:live.user,sessionId:live.session.id,tenant:null,platformAdminLevel:null,ip:null,userAgent:null};
   try{const action=await store.authorizeAction(current,ctx.headers?.get('x-factoryos-passkey-action')??'',{kind,targetId:input.data.id});setPasskeyFrame(ctx,{mode:kind,userId:live.user.id,sessionId:live.session.id,actionId:action.id,credentialId:input.data.id});}catch{throw new APIError('FORBIDDEN',{message:'Passkey consent or reauthentication required'});}
  })}],
  after:[{matcher:ctx=>(ctx.path??'').startsWith('/passkey/'),handler:createAuthMiddleware(async ctx=>{
   if(isAPIError(ctx.context.returned)||(ctx.context.returned instanceof Response&&ctx.context.returned.status>=400))return;
   if(ctx.path.includes('generate-')&&ctx.path.includes('-options')){
    const parsed=z.object({challenge:z.string(),user:z.object({id:z.string()}).passthrough().optional()}).passthrough().safeParse(ctx.context.returned);if(!parsed.success)throw refused();
    try{await store.prepareCeremony(ctx,{kind:ctx.path.includes('register')?'register':'signin',returnPath:validateSsoReturn(ctx.headers?.get('x-factoryos-passkey-return')??undefined)},{challenge:parsed.data.challenge,userHandle:parsed.data.user?.id});}catch{throw refused();}
    return ctx.json({...parsed.data,...(ctx.path.includes('authenticate')?{userVerification:'required'}:{})});
   }
   if(ctx.path==='/passkey/verify-registration'){const frame=getPasskeyFrame(ctx);if(frame?.mode!=='register')throw refused();const keys=await ownedPasskeySummaries(db,frame.userId);const returned=z.object({id:z.string()}).passthrough().safeParse(ctx.context.returned),key=returned.success?keys.find(key=>key.id===returned.data.id):null;if(!key)throw refused();return ctx.json(key);}
   if(ctx.path==='/passkey/verify-authentication'){
    const frame=getPasskeyFrame(ctx),provisional=ctx.context.newSession;if(frame?.mode!=='signin')throw refused();
    if(!provisional){const pending=z.object({twoFactorRedirect:z.literal(true),next:z.string()}).strict().safeParse(ctx.context.returned);if(!pending.success)throw refused();return ctx.json(pending.data);}
    const [completed]=await requirePasskeyTransaction().select().from(session).where(eq(session.id,provisional.session.id));if(!completed||completed.passkeyPending)throw refused();
    return ctx.json({session:parseSessionOutput(ctx.context.options,completed),user:parseUserOutput(ctx.context.options,provisional.user)});
   }
   if(ctx.path==='/passkey/list-user-passkeys'){const live=ctx.context.session;if(!live)return;return ctx.json(await ownedPasskeySummaries(db,live.user.id));}
   const frame=getPasskeyFrame(ctx);if(!frame||frame.mode!=='rename'&&frame.mode!=='remove')return;
   if(ctx.path==='/passkey/update-passkey'){const summaries=await ownedPasskeySummaries(db,frame.userId),key=summaries.find(key=>key.id===frame.credentialId);if(!key)throw new APIError('FORBIDDEN',{message:'Passkey change refused'});return ctx.json({passkey:key});}
   const [current]=await requirePasskeyTransaction().select({id:session.id}).from(session).where(and(eq(session.id,frame.sessionId),eq(session.userId,frame.userId)));
   if(!current)deleteSessionCookie(ctx,true);return ctx.json({status:true});
  })}],
 }};
}
