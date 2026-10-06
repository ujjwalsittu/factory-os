import {type Database,emailDelivery,emailEvent,emailWorkerHeartbeat,invitation,role,tenant} from '@factoryos/db';
import {enqueueEmailIn,renderEmail,validateEmailActionUrl,type Tx,type DeliveryView,type EmailPurpose,type EmailStatus} from '@factoryos/email';
import {BadRequestException,ForbiddenException,Inject,Injectable,NotFoundException} from '@nestjs/common';
import {and,desc,eq} from 'drizzle-orm';
import type {RequestContext,TenantRequestContext} from '../../common/access.js';
import {AuditService} from '../../common/audit.service.js';
import {DB,CONFIG} from '../../common/tokens.js';
import type {AppConfig} from '../../config.js';
import {TenancyService} from '../tenancy.service.js';
type Invitation=typeof invitation.$inferSelect;
type Delivery=typeof emailDelivery.$inferSelect;
@Injectable()
export class EmailService{
 private authEnqueueFailures=0;
 noteAuthEnqueueFailure(){this.authEnqueueFailures++;}
 availability(){return {available:this.config.email.mode==='smtp',verificationCooldownSeconds:this.config.EMAIL_VERIFICATION_COOLDOWN_SECONDS};}
 constructor(@Inject(DB)private readonly db:Database,@Inject(CONFIG)private readonly config:AppConfig,private readonly audit:AuditService,private readonly tenancy:TenancyService){}
 async enqueueInvitationIn(tx:Tx,_ctx:RequestContext,inv:Invitation,token:string,purpose:Extract<EmailPurpose,'member_invitation'|'owner_invitation'>){
  const email=this.config.email;let envelope=null;
  if(email.mode==='smtp'){
   const [t]=await tx.select().from(tenant).where(eq(tenant.id,inv.tenantId));if(!t||t.status!=='active')throw new BadRequestException('Tenant unavailable');
   const actionUrl=validateEmailActionUrl(purpose,`${this.config.WEB_ORIGIN}/invite/${token}`,this.config.BETTER_AUTH_URL,this.config.WEB_ORIGIN);
   envelope=renderEmail(purpose,{actionUrl,recipient:inv.email,tenantName:t.name,sender:email.sender,...(email.replyTo?{replyTo:email.replyTo}:{})});
  }
  return enqueueEmailIn(tx,{purpose,source:{kind:'invitation',tenantId:inv.tenantId,invitationId:inv.id},sourceExpiresAt:inv.expiresAt,dedupeKey:inv.id,templateVersion:'v1',envelope},email.mode==='smtp'?email.payloadKey:undefined);
 }
 private view(row:Delivery,recipient:string):DeliveryView{return {id:row.id,purpose:row.purpose as EmailPurpose,status:row.status as EmailStatus,recipient,createdAt:row.createdAt.toISOString(),lastAttemptAt:row.lastAttemptAt?.toISOString()??null,nextAttemptAt:row.nextAttemptAt?.toISOString()??null,errorCode:row.errorCode,invitationId:row.invitationId};}
 async listTenant(ctx:TenantRequestContext){
  if(!ctx.tenant.permissions.has('settings.email.read'))throw new ForbiddenException('Email access required');
  const rows=await this.db.select({delivery:emailDelivery,recipient:invitation.email}).from(emailDelivery).innerJoin(invitation,and(eq(invitation.id,emailDelivery.invitationId),eq(invitation.tenantId,emailDelivery.tenantId))).where(eq(emailDelivery.tenantId,ctx.tenant.tenantId)).orderBy(desc(emailDelivery.createdAt)).limit(100);
  return rows.map(r=>this.view(r.delivery,r.recipient));
 }
 private assertSuperadmin(ctx:RequestContext){if(ctx.platformAdminLevel!=='superadmin')throw new ForbiddenException('Platform administrators only');}
 async listPlatform(ctx:RequestContext){this.assertSuperadmin(ctx);return (await this.db.select().from(emailDelivery).orderBy(desc(emailDelivery.createdAt)).limit(100)).map(r=>({...this.view(r,r.recipientMasked),tenantId:r.tenantId}));}
 async health(ctx:RequestContext){this.assertSuperadmin(ctx);const workers=await this.db.select().from(emailWorkerHeartbeat).orderBy(desc(emailWorkerHeartbeat.lastSeenAt)).limit(20);return {authEnqueueFailures:this.authEnqueueFailures,mode:this.config.email.mode,workerEnabled:this.config.email.workerEnabled,workers:workers.map(w=>({id:w.id,lastSeenAt:w.lastSeenAt.toISOString(),configurationState:w.configurationState}))};}
 async cancelInvitationIn(tx:Tx,inv:Invitation,status:'cancelled'|'superseded'){
  const rows=await tx.select().from(emailDelivery).where(and(eq(emailDelivery.invitationId,inv.id),eq(emailDelivery.tenantId,inv.tenantId))).for('update');
  for(const row of rows){if(['queued','retry_scheduled','failed','unknown','unconfigured'].includes(row.status))await tx.update(emailDelivery).set({status,envelope:null,nextAttemptAt:null,errorCode:status==='cancelled'?'source_cancelled':'source_superseded',updatedAt:new Date()}).where(eq(emailDelivery.id,row.id));await tx.insert(emailEvent).values({deliveryId:row.id,tenantId:row.tenantId,scopeKey:row.scopeKey,kind:'source_'+status});}
 }
 async retryInvitation(ctx:TenantRequestContext,id:string,reason:string){
  if(!ctx.tenant.permissions.has('settings.email.retry')||!ctx.tenant.permissions.has('settings.user.create'))throw new ForbiddenException('Email and invitation creation authority required');
  if(this.config.email.mode!=='smtp')throw new BadRequestException('Email is unconfigured; renew after configuration');
  return this.db.transaction(async tx=>{
   // Lock the source first, matching acceptance/renewal lock order.
   const [identity]=await tx.select({invitationId:emailDelivery.invitationId}).from(emailDelivery).where(and(eq(emailDelivery.id,id),eq(emailDelivery.tenantId,ctx.tenant.tenantId)));
   if(!identity?.invitationId)throw new NotFoundException('Delivery not found');
   const [inv]=await tx.select().from(invitation).where(and(eq(invitation.id,identity.invitationId),eq(invitation.tenantId,ctx.tenant.tenantId))).for('update');
   const [row]=await tx.select().from(emailDelivery).where(and(eq(emailDelivery.id,id),eq(emailDelivery.tenantId,ctx.tenant.tenantId))).for('update');
   const [t]=await tx.select().from(tenant).where(eq(tenant.id,ctx.tenant.tenantId));
   if(!inv||inv.status!=='pending'||inv.expiresAt<=new Date()||t?.status!=='active'||row?.status!=='failed'||!row.envelope)throw new BadRequestException('Request a new invitation for this delivery state');
   await tx.update(emailDelivery).set({status:'queued',nextAttemptAt:new Date(),errorCode:null,updatedAt:new Date()}).where(eq(emailDelivery.id,id));
   await tx.insert(emailEvent).values({deliveryId:id,tenantId:row.tenantId,scopeKey:row.scopeKey,kind:'manual_retry'});await this.audit.record(ctx,{tenantId:row.tenantId,action:'email.retry',targetType:'email_delivery',targetId:id,reason},tx);return {id,status:'queued'};
  });
 }
 async renewOwner(ctx:RequestContext,id:string,reason:string){
  this.assertSuperadmin(ctx);
  return this.db.transaction(async tx=>{
   const [identity]=await tx.select().from(emailDelivery).where(eq(emailDelivery.id,id));if(!identity?.invitationId||identity.purpose!=='owner_invitation'||!identity.tenantId)throw new NotFoundException('Owner delivery not found');
   const [inv]=await tx.select().from(invitation).where(and(eq(invitation.id,identity.invitationId),eq(invitation.tenantId,identity.tenantId))).for('update');
   const [t]=await tx.select().from(tenant).where(eq(tenant.id,identity.tenantId));const [owner]=await tx.select().from(role).where(and(eq(role.tenantId,identity.tenantId),eq(role.systemKey,'owner')));
   const [current]=await tx.select().from(emailDelivery).where(eq(emailDelivery.id,id)).for('update');
   if(current?.status==='superseded')throw new BadRequestException('This invitation already has a replacement');
   if(!inv||inv.status==='accepted'||t?.status!=='active'||!owner||inv.roles.length!==1||inv.roles[0]?.roleId!==owner.id||inv.roles[0].entityIds!==null)throw new BadRequestException('Owner invitation cannot be renewed');
   await tx.update(invitation).set({status:'revoked'}).where(eq(invitation.id,inv.id));await this.cancelInvitationIn(tx,inv,'superseded');
   const {invitation:replacement,token}=await this.tenancy.createInvitation(tx,inv.tenantId,ctx.user.id,inv.email,[{roleId:owner.id,entityIds:null}]);const delivery=await this.enqueueInvitationIn(tx,ctx,replacement,token,'owner_invitation');await this.audit.record(ctx,{action:'platform.owner_invitation.renew',targetType:'invitation',targetId:replacement.id,before:{invitationId:inv.id},reason},tx);await this.audit.record(ctx,{tenantId:inv.tenantId,action:'platform.owner_invitation.renew',targetType:'invitation',targetId:replacement.id,before:{invitationId:inv.id},reason},tx);return {id:replacement.id,delivery,ownerInviteUrl:`${this.config.WEB_ORIGIN}/invite/${token}`};
  });
 }
}
