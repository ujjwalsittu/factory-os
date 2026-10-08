import {ForbiddenException,Inject,Injectable} from '@nestjs/common';
import {passkey,session,type Database} from '@factoryos/db';
import {and,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import {AUTH,CONFIG,DB} from '../../common/tokens.js';
import type {AppConfig} from '../../config.js';
import type {Auth} from '../../auth.js';
import type {RequestContext} from '../../common/access.js';
import type {PasskeyActionInput,PasskeySummary} from './passkeys.types.js';
import {passkeyAvailability} from './passkeys.config.js';
import {getPasskeyTransaction} from './passkeys.adapter.js';
import {PasskeyStore} from './passkeys.store.js';

export const passkeySummarySchema=z.object({id:z.string(),name:z.string(),createdAt:z.string(),lastUsedAt:z.string().nullable(),deviceType:z.string(),backedUp:z.boolean()}).strict();
export function passkeySummary(row:Pick<typeof passkey.$inferSelect,'id'|'name'|'createdAt'|'lastUsedAt'|'deviceType'|'backedUp'>):PasskeySummary{return {id:row.id,name:row.name,createdAt:row.createdAt.toISOString(),lastUsedAt:row.lastUsedAt?.toISOString()??null,deviceType:row.deviceType,backedUp:row.backedUp};}
export async function ownedPasskeySummaries(db:Database,userId:string):Promise<PasskeySummary[]>{const rows=await (getPasskeyTransaction()??db).select({id:passkey.id,name:passkey.name,createdAt:passkey.createdAt,lastUsedAt:passkey.lastUsedAt,deviceType:passkey.deviceType,backedUp:passkey.backedUp}).from(passkey).where(eq(passkey.userId,userId));return rows.map(passkeySummary);}
@Injectable()
export class PasskeysService{
 readonly store:PasskeyStore;
 constructor(@Inject(DB)private readonly db:Database,@Inject(CONFIG)private readonly config:AppConfig,@Inject(AUTH)private readonly auth:Auth){this.store=new PasskeyStore(db,config);}
 availability(){return passkeyAvailability(this.config.passkeys);}
 async listMethods(ctx:RequestContext):Promise<PasskeySummary[]>{
  const reader=getPasskeyTransaction()??this.db;
  const rows=await reader.execute(sql`select id from session where id=${ctx.sessionId} and user_id=${ctx.user.id} and expires_at>clock_timestamp() and not sso_pending and not passkey_pending`);
  if(!rows.rows.length)throw new ForbiddenException('Complete sign-in before viewing passkeys');return ownedPasskeySummaries(this.db,ctx.user.id);
 }
 async issueAction(ctx:RequestContext,input:PasskeyActionInput,passwordVerified:()=>Promise<boolean>){
  try{const version=await this.store.passwordVersionForOwner(ctx.user.id);if(!await passwordVerified())throw new Error();return await this.store.issueAction(ctx,input,version);}catch{throw new ForbiddenException('Confirm your password and sign in again before changing passkeys');}
 }
 private async mutation(path:string,body:object,nonce:string,headers:Headers):Promise<{data:unknown;headers:Headers}>{
  const forwarded=new Headers(headers);forwarded.set('x-factoryos-passkey-action',nonce);forwarded.set('content-type','application/json');
  const response=await this.auth.handler(new Request(new URL('/api/auth/passkey/'+path,this.config.BETTER_AUTH_URL),{method:'POST',headers:forwarded,body:JSON.stringify(body)}));
  if(!response.ok)throw new ForbiddenException('Passkey change refused; confirm your password and try again');
  return {data:await response.json(),headers:response.headers};
 }
 async rename(ctx:RequestContext,id:string,nonce:string,name:string,headers:Headers):Promise<{method:PasskeySummary;headers:Headers}>{
  const owned=await this.listMethods(ctx);if(!owned.some(key=>key.id===id))throw new ForbiddenException('Passkey change refused');
  const result=await this.mutation('update-passkey',{id,name},nonce,headers);
  const data=z.object({passkey:passkeySummarySchema}).strict().parse(result.data);if(data.passkey.id!==id)throw new ForbiddenException('Passkey change refused');
  return {method:data.passkey,headers:result.headers};
 }
 async remove(ctx:RequestContext,id:string,nonce:string,headers:Headers):Promise<{status:true;reauthenticate:boolean;headers:Headers}>{
  const owned=await this.listMethods(ctx);if(!owned.some(key=>key.id===id))throw new ForbiddenException('Passkey change refused');
  const [current]=await this.db.select({credentialId:session.passkeyCredentialId}).from(session).where(and(eq(session.id,ctx.sessionId),eq(session.userId,ctx.user.id)));
  const result=await this.mutation('delete-passkey',{id},nonce,headers);z.object({status:z.literal(true)}).strict().parse(result.data);
  return {status:true,reauthenticate:current?.credentialId===id,headers:result.headers};
 }
}
