import {account,type Database} from '@factoryos/db';
import {and,eq,inArray} from 'drizzle-orm';
import {APIError,createAuthMiddleware,getAuthoritativeSessionFromCtx} from 'better-auth/api';
import type {AppConfig} from '../../config.js';
import type {RequestContext} from '../../common/access.js';
import {SsoStore} from './sso.store.js';
import type {SsoProviderId} from './sso.types.js';
export function ssoMutationBefore(db:Database,config:AppConfig){
 const store=new SsoStore(db,config);
 return createAuthMiddleware(async ctx=>{
  if(ctx.path==='/link-social')throw new APIError('FORBIDDEN',{message:'Connection authorization required'});
  if(ctx.path!=='/unlink-account')return;
  try{
   const current=await getAuthoritativeSessionFromCtx(ctx);
   if(!current)throw new Error();
   const [binding]=await db.select().from(account).where(and(eq(account.id,String(ctx.body?.accountId??'')),eq(account.userId,current.user.id),inArray(account.providerId,['google','microsoft'])));
   if(!binding)throw new Error();
   const requestContext:RequestContext={user:current.user,sessionId:current.session.id,platformAdminLevel:null,tenant:null,ip:null,userAgent:null};
   const grant=await store.validateSsoAction(requestContext,ctx.headers?.get('x-factoryos-sso-action')??'',{kind:'unlink',provider:binding.providerId as SsoProviderId,targetAccountId:binding.id});
   await store.prepareUnlinkReference(requestContext,grant);
  }catch{throw new APIError('FORBIDDEN',{message:'Connection authorization required'});}
 });
}
