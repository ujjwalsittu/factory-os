import { BankReportService } from './report.service.js';
import { BankAdjustmentService } from './adjustment.service.js';
import { bankChargeInput } from '../accounting/bank-charge.service.js';
import { BankMatchService } from './match.service.js';
import { FileInterceptor } from '@nestjs/platform-express';
import { BankImportService } from './import.service.js';
import { bankOpeningItem, glEntry, bankMappingRevision, bankReconciliationProfile, type Database } from '@factoryos/db';
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, ConflictException, NotFoundException, BadRequestException, UseInterceptors, UploadedFile, Header, Query } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf, lockAccounting, type Tx } from '../accounting/accounting-lock.js';
import { BankRegistryService, evidenceHash } from './registry.service.js';
import { BankDate, PeriodApprovalInput, BankProfileInput, BankProfileSettingsInput, BaselineInput, Reason, ReviewedInput, StatementPeriodInput, ImportSubmitInput, BankMatchInput, MatchSubmitInput } from './types.js';
@Controller('accounts/bank-reconciliation')
export class BankReconciliationController {
 constructor(@Inject(DB) private readonly db:Database,private readonly registry:BankRegistryService,private readonly audit:AuditService,private readonly imports:BankImportService,private readonly matches:BankMatchService,private readonly adjustments:BankAdjustmentService,private readonly reports:BankReportService){}
 private transaction<T>(ctx:TenantRequestContext,run:(tx:Tx,entityId:string)=>Promise<T>){const entityId=entityOf(ctx);return this.db.transaction(async tx=>{await lockAccounting(tx,entityId);return run(tx,entityId);});}
 @Get('profiles') @RequirePermission('accounts.bank_reconciliation.read')
 list(@Ctx() ctx:TenantRequestContext){return this.db.select().from(bankReconciliationProfile).where(and(eq(bankReconciliationProfile.tenantId,ctx.tenant.tenantId),eq(bankReconciliationProfile.entityId,entityOf(ctx))));}
 @Get('profiles/:id') @RequirePermission('accounts.bank_reconciliation.read')
 async detail(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string){const entityId=entityOf(ctx),context=await this.registry.contextIn(this.db,ctx,entityId,id);const rows=context.baseline?await this.db.select({item:bankOpeningItem,sourceVoucherId:glEntry.voucherId}).from(bankOpeningItem).leftJoin(glEntry,and(eq(glEntry.id,bankOpeningItem.glEntryId),eq(glEntry.tenantId,ctx.tenant.tenantId),eq(glEntry.entityId,entityId),eq(glEntry.accountId,context.profile.accountId))).where(and(eq(bankOpeningItem.baselineId,context.baseline.id),eq(bankOpeningItem.profileId,id),eq(bankOpeningItem.tenantId,ctx.tenant.tenantId),eq(bankOpeningItem.entityId,entityId))).orderBy(bankOpeningItem.postingDate,bankOpeningItem.id):[];return {...context,openingItems:rows.map(({item,sourceVoucherId})=>({...item,sourceVoucherId}))};}
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
 @Post('profiles/:id/imports') @RequirePermission('accounts.bank_reconciliation.create')
 @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024,files:1,fields:1,fieldSize:16384}}))
 upload(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@UploadedFile() file:{buffer:Uint8Array}|undefined,@Body('metadata') metadata:unknown){
  if(!file||typeof metadata!=='string'||metadata.length>16384)throw new BadRequestException('One CSV file and bounded metadata required');
  let decoded:unknown;try{decoded=JSON.parse(metadata);}catch{throw new BadRequestException('Invalid statement metadata JSON');}
  const input=parse(StatementPeriodInput,decoded);return this.transaction(ctx,async(tx,entityId)=>{const batch=await this.imports.stageIn(tx,ctx,entityId,id,file.buffer,input);await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.create',targetType:'bank_import',targetId:batch.id,after:{fileHash:batch.fileHash}},tx);const {rawCsv,...publicBatch}=batch;return publicBatch;});
 }
 @Get('profiles/:id/imports') @RequirePermission('accounts.bank_reconciliation.read')
 async listImports(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string){const evidence=await this.imports.evidenceIn(this.db,ctx,entityOf(ctx),id);return evidence.imports.map(({rawCsv,parsed,...batch})=>({...batch,reversed:evidence.events.some(x=>x.importId===batch.id)}));}
 @Get('profiles/:id/imports/:importId/review') @RequirePermission('accounts.bank_reconciliation.read')
 reviewImport(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Param('importId',ParseUUIDPipe) importId:string){return this.transaction(ctx,(tx,entityId)=>this.imports.reviewIn(tx,ctx,entityId,id,importId));}
 @Post('profiles/:id/imports/:importId/submit') @RequirePermission('accounts.bank_reconciliation.submit')
 submitImport(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Param('importId',ParseUUIDPipe) importId:string,@Body() body:unknown){const input=parse(ImportSubmitInput,body);return this.transaction(ctx,async(tx,entityId)=>{const batch=await this.imports.submitIn(tx,ctx,entityId,id,importId,input);await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.submit',targetType:'bank_import',targetId:batch.id,after:{fileHash:batch.fileHash}},tx);const {rawCsv,...publicBatch}=batch;return publicBatch;});}
 @Post('profiles/:id/imports/:importId/reverse') @RequirePermission('accounts.bank_reconciliation.cancel')
 reverseImport(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Param('importId',ParseUUIDPipe) importId:string,@Body() body:unknown){const {reason}=parse(z.strictObject({reason:Reason}),body);return this.transaction(ctx,async(tx,entityId)=>{const result=await this.imports.reverseIn(tx,ctx,entityId,id,importId,reason);await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.cancel',targetType:'bank_import',targetId:importId,reason},tx);return result;});}
 @Get('profiles/:id/imports/:importId/raw') @RequirePermission('accounts.bank_reconciliation.read') @Header('Content-Type','text/plain; charset=utf-8') @Header('Content-Disposition','attachment; filename="statement-evidence.txt"')
 async rawImport(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Param('importId',ParseUUIDPipe) importId:string){const evidence=await this.imports.evidenceIn(this.db,ctx,entityOf(ctx),id),batch=evidence.imports.find(x=>x.id===importId);if(!batch)throw new BadRequestException('Import not found');return batch.rawCsv;}
 @Get('profiles/:id/imports/:importId/export') @RequirePermission('accounts.bank_reconciliation.export') @Header('Content-Type','text/csv; charset=utf-8') @Header('Content-Disposition','attachment; filename="bank-movements.csv"')
 async exportImport(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Param('importId',ParseUUIDPipe) importId:string){const review=await this.imports.reviewIn(this.db,ctx,entityOf(ctx),id,importId);const cell=(value:string)=>'"'+(/^[\s]*[=+\-@]/.test(value)?"'"+value:value).replaceAll('"','""')+'"';return ['Date,Reference,Description,Amount',...review.parsed.rows.map(row=>[row.date,row.reference,row.description,row.signedAmount].map(cell).join(','))].join('\r\n');}

 @Get('profiles/:id/matches') @RequirePermission('accounts.bank_reconciliation.read')
 async matchState(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string){return this.transaction(ctx,async(tx,entityId)=>{const state=await this.matches.stateIn(tx,ctx,entityId,id);return {context:state.context,book:state.book,statement:state.statement,sources:state.entries.map(({entry,voucher})=>({id:entry.id,voucherId:voucher.id,sourceType:voucher.sourceType,sourceId:voucher.sourceId,status:voucher.status})),groups:state.groups.map(g=>({...g,reversed:!state.activeGroups.some(x=>x.id===g.id)})),revision:state.revision};});}
 @Get('profiles/:id/candidates') @RequirePermission('accounts.bank_reconciliation.read')
 candidates(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Query('statementRowId',ParseUUIDPipe) statementRowId:string){return this.transaction(ctx,(tx,entityId)=>this.matches.candidatesIn(tx,ctx,entityId,id,statementRowId));}
 @Post('profiles/:id/matches/preview') @RequirePermission('accounts.bank_reconciliation.read')
 previewMatch(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){const input=parse(BankMatchInput,body);return this.transaction(ctx,(tx,entityId)=>this.matches.previewIn(tx,ctx,entityId,id,input));}
 @Post('profiles/:id/matches') @RequirePermission('accounts.bank_reconciliation.submit')
 submitMatch(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){const input=parse(MatchSubmitInput,body);return this.transaction(ctx,async(tx,entityId)=>{const group=await this.matches.submitIn(tx,ctx,entityId,id,input);await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.submit',targetType:'bank_match',targetId:group.id,after:{kind:group.kind,previewHash:group.previewHash}},tx);return group;});}
 @Post('profiles/:id/matches/:groupId/reverse') @RequirePermission('accounts.bank_reconciliation.cancel')
 reverseMatch(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Param('groupId',ParseUUIDPipe) groupId:string,@Body() body:unknown){const {reason}=parse(z.strictObject({reason:Reason}),body);return this.transaction(ctx,async(tx,entityId)=>{const result=await this.matches.reverseIn(tx,ctx,entityId,id,groupId,reason);await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.cancel',targetType:'bank_match',targetId:groupId,reason},tx);return result;});}

 @Post('profiles/:id/adjustments/preview') @RequirePermission('accounts.bank_reconciliation.read')
 previewAdjustment(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){const {statementRowId}=parse(z.strictObject({statementRowId:z.uuid()}),body);return this.transaction(ctx,(tx,entityId)=>this.adjustments.previewIn(tx,ctx,entityId,id,statementRowId));}
 @Post('profiles/:id/adjustments/charge') @RequirePermission('accounts.bank_reconciliation.submit','accounts.bank_charge.create','accounts.bank_charge.submit')
 submitAdjustmentCharge(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){const input=parse(z.strictObject({statementRowId:z.uuid(),reviewedHash:ReviewedInput.shape.reviewedHash,replacementOf:z.uuid().optional(),charge:bankChargeInput}),body);return this.transaction(ctx,async(tx,entityId)=>{const result=await this.adjustments.submitChargeIn(tx,ctx,entityId,id,input);await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.create',targetType:'bank_adjustment',targetId:result.chargeId,after:{statementRowId:input.statementRowId}},tx);return result;});}

 @Post('profiles/:id/adjustments/:linkId/release') @RequirePermission('accounts.bank_reconciliation.cancel')
 releaseAdjustment(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Param('linkId',ParseUUIDPipe) linkId:string,@Body() body:unknown){const {reason}=parse(z.strictObject({reason:Reason}),body);return this.transaction(ctx,async(tx,entityId)=>{const result=await this.adjustments.releaseCancelledIn(tx,ctx,entityId,id,linkId,reason);await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.cancel',targetType:'bank_adjustment_release',targetId:linkId,reason},tx);return result;});}

 @Get('profiles/:id/report') @RequirePermission('accounts.bank_reconciliation.read')
 report(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Query('asOf') date:unknown){const asOf=parse(BankDate,date);return this.transaction(ctx,(tx,entityId)=>this.reports.reportIn(tx,ctx,entityId,id,asOf));}
 @Get('profiles/:id/periods') @RequirePermission('accounts.bank_reconciliation.read')
 periods(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string){return this.transaction(ctx,(tx,entityId)=>this.reports.periodsIn(tx,ctx,entityId,id));}
 @Post('profiles/:id/periods/approve') @RequirePermission('accounts.bank_reconciliation.approve')
 approvePeriod(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){const input=parse(PeriodApprovalInput,body);return this.transaction(ctx,async(tx,entityId)=>{const period=await this.reports.approveIn(tx,ctx,entityId,id,input);await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.approve',targetType:'bank_period',targetId:period.id,after:{previewHash:period.previewHash}},tx);return period;});}
 @Post('profiles/:id/periods/:periodId/reopen') @RequirePermission('accounts.bank_reconciliation.approve')
 reopenPeriod(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Param('periodId',ParseUUIDPipe) periodId:string,@Body() body:unknown){const {reason}=parse(z.strictObject({reason:Reason}),body);return this.transaction(ctx,async(tx,entityId)=>{const result=await this.reports.reopenIn(tx,ctx,entityId,id,periodId,reason);await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'accounts.bank_reconciliation.approve',targetType:'bank_period_reopen',targetId:periodId,reason},tx);return result;});}

 @Get('profiles/:id/periods/:periodId') @RequirePermission('accounts.bank_reconciliation.read')
 period(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Param('periodId',ParseUUIDPipe) periodId:string){return this.transaction(ctx,async(tx,entityId)=>{const periods=await this.reports.periodsIn(tx,ctx,entityId,id),period=periods.find(x=>x.id===periodId);if(!period)throw new NotFoundException('Bank period not found');return period;});}
 @Get('profiles/:id/report/export') @RequirePermission('accounts.bank_reconciliation.export') @Header('Content-Type','text/csv; charset=utf-8') @Header('Content-Disposition','attachment; filename="bank-reconciliation.csv"')
 exportReport(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Query('asOf') date:unknown){const asOf=parse(BankDate,date);return this.transaction(ctx,async(tx,entityId)=>{const report=await this.reports.reportIn(tx,ctx,entityId,id,asOf),cell=(value:string)=>'"'+(/^[\s]*[=+\-@]/.test(value)?"'"+value:value).replaceAll('"','""')+'"';return [['Date',asOf],['Book balance',report.B],['Uncleared books',report.U],['Bank exceptions',report.E],['Statement balance',report.S],['Difference',report.difference],['Coverage complete',String(report.coverageComplete)],['Preview hash',report.previewHash],['Kind','Date','Reference','Amount','Remaining'],...report.bookResiduals.map(x=>[x.kind,x.date,x.reference,x.signedAmount,x.remaining]),...report.statementResiduals.map(x=>['bank',x.date,x.reference,x.signedAmount,x.remaining])].map(row=>row.map(cell).join(',')).join('\r\n');});}

}
