import {passkey as nativePasskey} from '@better-auth/passkey';
import {APIError,createAuthMiddleware,getAuthoritativeSessionFromCtx,isAPIError} from 'better-auth/api';
import {deleteSessionCookie} from 'better-auth/cookies';
import {passkey,session,type Database} from '@factoryos/db';
import {and,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {BetterAuthPlugin} from 'better-auth';
import type {AppConfig} from '../../config.js';
import type {RequestContext} from '../../common/access.js';
import type {PasskeyStore} from './passkeys.store.js';
import {requirePasskeyTransaction} from './passkeys.adapter.js';
import {getPasskeyFrame,setPasskeyFrame} from './passkeys.types.js';
import {ownedPasskeySummaries} from './passkeys.service.js';
const id=z.string().min(1).max(256);
const renameInput=z.object({id,name:z.string().trim().min(1).max(80)}).strict();
const removeInput=z.object({id}).strict();
export function createPasskeyPlugin(db:Database,config:AppConfig,store:PasskeyStore):BetterAuthPlugin{
 const native=nativePasskey({rpID:config.passkeys.rpId??new URL(config.WEB_ORIGIN).hostname,rpName:'FactoryOS',origin:config.passkeys.origins,registration:{requireSession:true}});
 const privateString={type:'string' as const,required:false,input:false,returned:false};
 const fields={...native.schema.passkey.fields,rpId:privateString,userHandle:privateString,registrationActionId:privateString,registrationCeremonyId:privateString,lastUsedAt:{type:'date' as const,required:false,input:false,returned:false}};
 return {...native,schema:{...native.schema,passkey:{...native.schema.passkey,fields}},hooks:{
  before:[{matcher:ctx=>(ctx.path??'').startsWith('/passkey/'),handler:createAuthMiddleware(async ctx=>{
   if(!['/passkey/list-user-passkeys','/passkey/update-passkey','/passkey/delete-passkey'].includes(ctx.path))throw new APIError('SERVICE_UNAVAILABLE',{message:'Passkey ceremonies are not yet available'});
   const tx=requirePasskeyTransaction(),live=await getAuthoritativeSessionFromCtx({...ctx,query:{...ctx.query,disableRefresh:true}});
   if(!live)throw new APIError('FORBIDDEN',{message:'Complete sign-in before changing passkeys'});
   const rows=await tx.execute(sql`select id from session where id=${live.session.id} and user_id=${live.user.id} and expires_at>clock_timestamp() and not sso_pending and not passkey_pending`);
   if(!rows.rows.length)throw new APIError('FORBIDDEN',{message:'Complete verification first'});
   if(ctx.path==='/passkey/list-user-passkeys')return;
   const input=(ctx.path==='/passkey/update-passkey'?renameInput:removeInput).safeParse(ctx.body);if(!input.success)throw new APIError('BAD_REQUEST',{message:'Invalid passkey change'});
   const kind=ctx.path==='/passkey/update-passkey'?'rename':'remove';
   const current:RequestContext={user:live.user,sessionId:live.session.id,tenant:null,platformAdminLevel:null,ip:null,userAgent:null};
   try{const action=await store.authorizeAction(current,ctx.headers?.get('x-factoryos-passkey-action')??'',{kind,targetId:input.data.id});setPasskeyFrame(ctx,{mode:kind,userId:live.user.id,sessionId:live.session.id,actionId:action.id,credentialId:input.data.id});}catch{throw new APIError('FORBIDDEN',{message:'Passkey consent or reauthentication required'});}
  })}],
  after:[{matcher:ctx=>['/passkey/list-user-passkeys','/passkey/update-passkey','/passkey/delete-passkey'].includes(ctx.path??''),handler:createAuthMiddleware(async ctx=>{
   if(isAPIError(ctx.context.returned)||(ctx.context.returned instanceof Response&&ctx.context.returned.status>=400))return;
   if(ctx.path==='/passkey/list-user-passkeys'){const live=ctx.context.session;if(!live)return;return ctx.json(await ownedPasskeySummaries(db,live.user.id));}
   const frame=getPasskeyFrame(ctx);if(!frame||frame.mode!=='rename'&&frame.mode!=='remove')return;
   if(ctx.path==='/passkey/update-passkey'){const summaries=await ownedPasskeySummaries(db,frame.userId),key=summaries.find(key=>key.id===frame.credentialId);if(!key)throw new APIError('FORBIDDEN',{message:'Passkey change refused'});return ctx.json({passkey:key});}
   const [current]=await requirePasskeyTransaction().select({id:session.id}).from(session).where(and(eq(session.id,frame.sessionId),eq(session.userId,frame.userId)));
   if(!current)deleteSessionCookie(ctx,true);return ctx.json({status:true});
  })}],
 }};
}
