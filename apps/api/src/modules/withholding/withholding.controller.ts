import { taxCertificate, taxOpening, taxPartyEvidence, taxProfileRevision, type Database } from '@factoryos/db';
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf, lockAccounting, type Tx } from '../accounting/accounting-lock.js';
import { TaxPolicyService } from './policy.service.js';
const money=z.string().regex(/^\d{1,18}(\.\d{1,6})?$/);
const signed=z.string().regex(/^-?\d{1,18}(\.\d{1,6})?$/);
const pan=z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/);
const evidence=z.string().trim().min(5).max(1000);
const configInput=z.object({tan:z.string().regex(/^[A-Z]{4}\d{5}[A-Z]$/),deductorPan:pan,enabledProfiles:z.array(z.uuid()).max(100),mappings:z.record(z.string(),z.uuid())}).strict();
const openingLine=z.object({identityId:z.uuid(),taxYear:z.string().regex(/^\d{4}-\d{2}$/),category:z.enum(['tds','tcs','customer_tds','supplier_tcs']),accountId:z.uuid(),eligibleBase:money,untaxedBase:money,recognizedTax:money,remittedTax:money,advanceBase:money,balance:signed}).strict();
const sourceHistory=z.object({sourceType:z.enum(['purchase_invoice','sales_invoice','settlement']),sourceId:z.uuid(),history:z.object({eligibleBase:money,consumedBase:money,reason:evidence,document:evidence}).strict()}).strict();
const openingInput=z.object({postingDate:z.iso.date(),reason:evidence,lines:z.array(openingLine).max(2000),sourceHistory:z.array(sourceHistory).max(2000)}).strict();
const partyInput=z.object({partyId:z.uuid(),pan:pan.optional(),reviewedIdentity:z.string().trim().min(5).max(100).optional(),panStatus:z.enum(['valid','missing','inoperative','unknown']),effectiveDate:z.iso.date(),document:evidence,reason:evidence,selectors:z.record(z.string(),z.unknown())}).strict();
const certificateInput=z.object({identityId:z.uuid(),profileId:z.uuid(),reference:z.string().trim().min(1).max(120),authority:evidence,act:z.enum(['1961','2025']),deductorTan:z.string().regex(/^[A-Z]{4}\d{5}[A-Z]$/),validFrom:z.iso.date(),validTo:z.iso.date(),ratePercent:money,baseLimit:money,taxLimit:money.nullable(),document:evidence,reason:evidence}).strict();
@Controller('accounts/withholding')
export class WithholdingController {
 constructor(@Inject(DB) private readonly db:Database,private readonly policy:TaxPolicyService) {}
 private transaction<T>(ctx:TenantRequestContext,run:(tx:Tx,entityId:string)=>Promise<T>) {
  const id=entityOf(ctx);return this.db.transaction(async tx=>{await lockAccounting(tx,id);return run(tx,id);});
 }
 @Get('settings') @RequirePermission('accounts.withholding.read')
 settings(@Ctx() ctx:TenantRequestContext){return this.transaction(ctx,(tx,id)=>this.policy.settingsIn(tx,ctx,id));}
 @Put('settings') @RequirePermission('accounts.withholding.configure')
 configure(@Ctx() ctx:TenantRequestContext,@Body() body:unknown){const input=parse(configInput,body);return this.transaction(ctx,(tx,id)=>this.policy.configureIn(tx,ctx,id,input));}
 @Get('profiles') @RequirePermission('accounts.withholding.read')
 profiles(@Ctx() ctx:TenantRequestContext){const id=entityOf(ctx);return this.db.select().from(taxProfileRevision).where(and(eq(taxProfileRevision.entityId,id),eq(taxProfileRevision.tenantId,ctx.tenant.tenantId))).orderBy(desc(taxProfileRevision.createdAt));}
 @Post('profiles') @RequirePermission('accounts.withholding.configure')
 draftProfile(@Ctx() ctx:TenantRequestContext,@Body() body:unknown){const input=parse(z.object({profileKey:z.string().trim().min(1).max(100),definition:z.record(z.string(),z.unknown()),document:evidence}).strict(),body);return this.transaction(ctx,(tx,id)=>this.policy.draftProfileIn(tx,ctx,id,input));}
 @Get('party-evidence') @RequirePermission('accounts.withholding.read')
 parties(@Ctx() ctx:TenantRequestContext){return this.db.select().from(taxPartyEvidence).where(and(eq(taxPartyEvidence.entityId,entityOf(ctx)),eq(taxPartyEvidence.tenantId,ctx.tenant.tenantId))).orderBy(desc(taxPartyEvidence.createdAt));}
 @Post('party-evidence') @RequirePermission('accounts.withholding.approve')
 party(@Ctx() ctx:TenantRequestContext,@Body() body:unknown){const input=parse(partyInput,body);return this.transaction(ctx,(tx,id)=>this.policy.partyEvidenceIn(tx,ctx,id,input));}
 @Get('openings') @RequirePermission('accounts.withholding.read')
 openings(@Ctx() ctx:TenantRequestContext){return this.db.select().from(taxOpening).where(and(eq(taxOpening.entityId,entityOf(ctx)),eq(taxOpening.tenantId,ctx.tenant.tenantId))).orderBy(desc(taxOpening.revision));}
 @Post('openings') @RequirePermission('accounts.withholding.configure')
 opening(@Ctx() ctx:TenantRequestContext,@Body() body:unknown){const input=parse(openingInput,body);return this.transaction(ctx,(tx,id)=>this.policy.openingIn(tx,ctx,id,input));}
 @Get('openings/:id/reconciliation') @RequirePermission('accounts.withholding.read')
 reconciliation(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string){return this.transaction(ctx,(tx,entity)=>this.policy.reconciliationIn(tx,ctx,entity,id));}
 @Post('activate') @RequirePermission('accounts.withholding.approve')
 activate(@Ctx() ctx:TenantRequestContext,@Body() body:unknown){const input=parse(z.object({date:z.iso.date(),openingId:z.uuid(),reviewedHash:z.string().min(1).max(64)}).strict(),body);return this.transaction(ctx,(tx,id)=>this.policy.activateIn(tx,ctx,id,input));}
 @Get('certificates') @RequirePermission('accounts.withholding.read')
 certificates(@Ctx() ctx:TenantRequestContext){return this.db.select().from(taxCertificate).where(and(eq(taxCertificate.entityId,entityOf(ctx)),eq(taxCertificate.tenantId,ctx.tenant.tenantId))).orderBy(desc(taxCertificate.createdAt));}
 @Post('certificates') @RequirePermission('accounts.withholding.approve')
 certificate(@Ctx() ctx:TenantRequestContext,@Body() body:unknown){const input=parse(certificateInput,body);return this.transaction(ctx,(tx,id)=>this.policy.certificateIn(tx,ctx,id,input));}
}
