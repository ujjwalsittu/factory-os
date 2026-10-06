import { bankMappingRevision, bankReconciliationProfile, type Database } from '@factoryos/db';
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf, lockAccounting, type Tx } from '../accounting/accounting-lock.js';
import { BankRegistryService, evidenceHash } from './registry.service.js';
import { BankProfileInput, BankProfileSettingsInput, BaselineInput, Reason, ReviewedInput } from './types.js';
@Controller('accounts/bank-reconciliation')
export class BankReconciliationController {
 constructor(@Inject(DB) private readonly db:Database,private readonly registry:BankRegistryService,private readonly audit:AuditService){}
 private transaction<T>(ctx:TenantRequestContext,run:(tx:Tx,entityId:string)=>Promise<T>){const entityId=entityOf(ctx);return this.db.transaction(async tx=>{await lockAccounting(tx,entityId);return run(tx,entityId);});}
 @Get('profiles') @RequirePermission('accounts.bank_reconciliation.read')
 list(@Ctx() ctx:TenantRequestContext){return this.db.select().from(bankReconciliationProfile).where(and(eq(bankReconciliationProfile.tenantId,ctx.tenant.tenantId),eq(bankReconciliationProfile.entityId,entityOf(ctx))));}
 @Get('profiles/:id') @RequirePermission('accounts.bank_reconciliation.read')
 detail(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string){return this.registry.contextIn(this.db,ctx,entityOf(ctx),id);}
 @Post('profiles') @RequirePermission('accounts.bank_reconciliation.configure')
 create(@Ctx() ctx:TenantRequestContext,@Body() body:unknown){const input=parse(BankProfileInput,body);return this.transaction(ctx,async(tx,entityId)=>{
  await this.registry.eligibleAccountIn(tx,ctx,entityId,input.accountId);
  const [prior]=await tx.select().from(bankReconciliationProfile).where(and(eq(bankReconciliationProfile.tenantId,ctx.tenant.tenantId),eq(bankReconciliationProfile.entityId,entityId),eq(bankReconciliationProfile.accountId,input.accountId)));
  if(prior)throw new ConflictException('This bank account already has a reconciliation profile');
  const [profile]=await tx.insert(bankReconciliationProfile).values({tenantId:ctx.tenant.tenantId,entityId,accountId:input.accountId,currency:input.currency,maskedIdentifier:input.maskedIdentifier,dateWindow:input.dateWindow,createdBy:ctx.user.id}).returning();
  await tx.insert(bankMappingRevision).values({tenantId:ctx.tenant.tenantId,entityId,profileId:profile!.id,revision:1,mapping:input.mapping,createdBy:ctx.user.id});
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.configure',targetType:'bank_profile',targetId:profile!.id,after:{accountId:input.accountId,mappingHash:evidenceHash(input.mapping)}},tx);return profile!;
 });}
 @Put('profiles/:id') @RequirePermission('accounts.bank_reconciliation.configure')
 settings(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){const input=parse(BankProfileSettingsInput,body);return this.transaction(ctx,async(tx,entityId)=>{
  const context=await this.registry.contextIn(tx,ctx,entityId,id);
  if(input.dateWindow!==undefined)await tx.update(bankReconciliationProfile).set({dateWindow:input.dateWindow}).where(and(eq(bankReconciliationProfile.id,id),eq(bankReconciliationProfile.tenantId,ctx.tenant.tenantId),eq(bankReconciliationProfile.entityId,entityId)));
  if(input.mapping)await tx.insert(bankMappingRevision).values({tenantId:ctx.tenant.tenantId,entityId,profileId:id,revision:(context.mapping?.revision??0)+1,mapping:input.mapping,createdBy:ctx.user.id});
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.configure',targetType:'bank_profile',targetId:id,after:{dateWindow:input.dateWindow,mappingHash:input.mapping?evidenceHash(input.mapping):undefined}},tx);
  return this.registry.contextIn(tx,ctx,entityId,id);
 });}
 @Post('profiles/:id/baseline/preview') @RequirePermission('accounts.bank_reconciliation.read')
 previewBaseline(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){const input=parse(BaselineInput,body);return this.transaction(ctx,(tx,entityId)=>this.registry.reviewBaselineIn(tx,ctx,entityId,id,input));}
 @Post('profiles/:id/baseline/activate') @RequirePermission('accounts.bank_reconciliation.approve')
 activateBaseline(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){const {reviewedHash,...input}=parse(BaselineInput.extend(ReviewedInput.shape),body);return this.transaction(ctx,async(tx,entityId)=>{const baseline=await this.registry.activateBaselineIn(tx,ctx,entityId,id,input,reviewedHash);await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.approve',targetType:'bank_baseline',targetId:baseline.id,after:{previewHash:reviewedHash}},tx);return baseline;});}
 @Post('profiles/:id/baseline/reset') @RequirePermission('accounts.bank_reconciliation.approve')
 resetBaseline(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){const {reason}=parse(z.strictObject({reason:Reason}),body);return this.transaction(ctx,async(tx,entityId)=>{const result=await this.registry.resetBaselineIn(tx,ctx,entityId,id,reason);await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.approve',targetType:'bank_baseline_reset',targetId:id,reason},tx);return result;});}
}
