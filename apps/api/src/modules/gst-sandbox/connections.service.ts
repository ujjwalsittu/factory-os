import {Inject,Injectable,BadRequestException,NotFoundException,ConflictException} from '@nestjs/common';
import {gstRegistration,gstSandboxConnection,gstSandboxCredentialRevision,type Database} from '@factoryos/db';
import {sealCredential} from '@factoryos/gsp';
import type {AnyPgColumn} from 'drizzle-orm/pg-core';
import {and,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import {DB,CONFIG} from '../../common/tokens.js';
import type {AppConfig} from '../../config.js';
import type {TenantRequestContext} from '../../common/access.js';
import {AuditService} from '../../common/audit.service.js';
import {lockAccounting,type Tx} from '../accounting/accounting-lock.js';
export const connectionInput=z.object({registrationId:z.string().uuid(),capability:z.enum(['irn','ewb']),provider:z.enum(['mock','nic_direct']),environment:z.literal('sandbox').default('sandbox'),scenario:z.enum(['normal','timeout_after_success','rejected','unsupported_lookup','mismatched_lookup']).default('normal'),credentials:z.record(z.string().min(1).max(100),z.string().max(10000)).optional()}).strict();
export function scopeOf(ctx:TenantRequestContext){const entityId=ctx.tenant.activeEntityId;if(!entityId)throw new BadRequestException('Choose an entity');return {tenantId:ctx.tenant.tenantId,entityId}}
export function scopeWhere(t:{tenantId:AnyPgColumn;entityId:AnyPgColumn},scope:{tenantId:string;entityId:string}){return and(eq(t.tenantId,scope.tenantId),eq(t.entityId,scope.entityId))}
@Injectable()
export class SandboxConnectionsService{
 constructor(@Inject(DB)private readonly db:Database,@Inject(CONFIG)private readonly config:AppConfig,private readonly audit:AuditService){}
 async list(ctx:TenantRequestContext){const s=scopeOf(ctx);return this.db.select({id:gstSandboxConnection.id,registrationId:gstSandboxConnection.registrationId,capability:gstSandboxConnection.capability,provider:gstSandboxConnection.provider,environment:gstSandboxConnection.environment,revision:gstSandboxConnection.revision,scenario:gstSandboxConnection.scenario,credentialConfigured:sql<boolean>`${gstSandboxConnection.credentialRevision}>0`}).from(gstSandboxConnection).where(scopeWhere(gstSandboxConnection,s))}
 async save(ctx:TenantRequestContext,input:z.infer<typeof connectionInput>){const s=scopeOf(ctx);return this.db.transaction(async tx=>{await lockAccounting(tx,s.entityId);const [reg]=await tx.select().from(gstRegistration).where(and(eq(gstRegistration.id,input.registrationId),eq(gstRegistration.tenantId,s.tenantId),eq(gstRegistration.entityId,s.entityId)));if(!reg)throw new NotFoundException('GST registration not found');if(input.provider==='mock'&&input.credentials)throw new BadRequestException('Mock connection accepts no credentials');if(input.provider==='nic_direct'&&input.scenario!=='normal')throw new BadRequestException('Mock scenarios apply only to mock connections');if(input.credentials&&!this.config.GSP_CREDENTIAL_KEY_V1)throw new ConflictException('Credential encryption key is not configured');
 const [old]=await tx.select().from(gstSandboxConnection).where(and(scopeWhere(gstSandboxConnection,s),eq(gstSandboxConnection.registrationId,input.registrationId),eq(gstSandboxConnection.capability,input.capability)));const revision=(old?.revision??0)+1,credentialRevision=(old?.credentialRevision??0)+(input.credentials?1:0);
 const values={...s,registrationId:reg.id,capability:input.capability,environment:'sandbox',provider:input.provider,scenario:input.scenario,revision,credentialRevision,createdBy:ctx.user.id};const [row]=old?await tx.update(gstSandboxConnection).set(values).where(eq(gstSandboxConnection.id,old.id)).returning():await tx.insert(gstSandboxConnection).values(values).returning();
 if(input.credentials){const envelope=sealCredential(input.credentials,'v1',this.config.GSP_CREDENTIAL_KEY_V1!);await tx.insert(gstSandboxCredentialRevision).values({...s,registrationId:reg.id,connectionId:row!.id,revision:credentialRevision,envelope:{...envelope},createdBy:ctx.user.id})}
 await this.audit.record(ctx,{...s,action:'gst_sandbox.connection.save',targetType:'gst_sandbox_connection',targetId:row!.id,after:{registrationId:reg.id,provider:input.provider,capability:input.capability,revision,credentialConfigured:credentialRevision>0}},tx);return {id:row!.id,registrationId:reg.id,capability:row!.capability,provider:row!.provider,environment:'sandbox',revision,scenario:row!.scenario,credentialConfigured:credentialRevision>0};})}
 async getIn(tx:Tx,ctx:TenantRequestContext,id:string){const s=scopeOf(ctx);const [c]=await tx.select().from(gstSandboxConnection).where(and(scopeWhere(gstSandboxConnection,s),eq(gstSandboxConnection.id,id)));if(!c)throw new NotFoundException('Connection not found');if(c.environment!=='sandbox')throw new ConflictException('Only sandbox connections are allowed');return c}
}
