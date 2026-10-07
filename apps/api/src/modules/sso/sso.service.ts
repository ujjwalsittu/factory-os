import {Inject,Injectable,ForbiddenException} from '@nestjs/common';
import {account,type Database} from '@factoryos/db';
import {and,eq,inArray} from 'drizzle-orm';
import {DB,CONFIG} from '../../common/tokens.js';
import type {AppConfig} from '../../config.js';
import type {RequestContext} from '../../common/access.js';
import {providerAvailability} from './sso.config.js';
import {SsoStore} from './sso.store.js';
import type {ConnectionSummary,SsoActionKind,SsoProviderId} from './sso.types.js';

@Injectable()
export class SsoService {
 readonly store:SsoStore;
 constructor(@Inject(DB)private readonly db:Database,@Inject(CONFIG)private readonly config:AppConfig){this.store=new SsoStore(db,config);}
 availability(){return providerAvailability(this.config.sso);}
 async listMethods(ctx:RequestContext):Promise<ConnectionSummary[]>{
  const rows=await this.db.select({id:account.id,provider:account.providerId,createdAt:account.createdAt}).from(account).where(and(eq(account.userId,ctx.user.id),inArray(account.providerId,['google','microsoft'])));
  return rows.map(r=>({bindingId:r.id,provider:r.provider as SsoProviderId,label:r.provider==='google'?'Google':'Microsoft',connectedAt:r.createdAt.toISOString()}));
 }
 async issueAction(ctx:RequestContext,input:{provider:SsoProviderId;kind:SsoActionKind;targetAccountId?:string},passwordVerified:()=>Promise<boolean>){
  try{if(!await passwordVerified())throw new Error();return await this.store.createSsoAction(ctx,input);}catch{throw new ForbiddenException('Verify your email and sign in again before changing connected accounts');}
 }
 async disconnectAction(ctx:RequestContext,bindingId:string,nonce:string){
  const [binding]=await this.db.select().from(account).where(and(eq(account.id,bindingId),eq(account.userId,ctx.user.id),inArray(account.providerId,['google','microsoft'])));
  if(!binding)throw new ForbiddenException('Connection unavailable');
  const action=await this.store.validateSsoAction(ctx,nonce,{kind:'unlink',provider:binding.providerId as SsoProviderId,targetAccountId:binding.id});
  await this.store.prepareUnlinkReference(ctx,action);return binding;
 }
}
