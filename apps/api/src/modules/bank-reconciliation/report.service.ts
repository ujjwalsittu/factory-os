import { calculateBankReconciliation, Dec } from '@factoryos/core';
import { bankReconciliationEvent, bankReconciliationPeriod } from '@factoryos/db';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { Db, Tx } from '../accounting/accounting-lock.js';
import { BankMatchService } from './match.service.js';
import { BankImportService } from './import.service.js';
import { evidenceHash } from './registry.service.js';
import type { BankReport, PeriodApprovalInput } from './types.js';
const nextDay=(date:string)=>{const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
@Injectable()
export class BankReportService {
 constructor(private readonly matches:BankMatchService,private readonly imports:BankImportService){}
 async periodsIn(tx:Db,ctx:TenantRequestContext,entityId:string,profileId:string) {
  // Validate the frozen profile identity even when the account is now inactive.
  const evidence=await this.imports.evidenceIn(tx,ctx,entityId,profileId);
  const periods=await tx.select().from(bankReconciliationPeriod).where(and(eq(bankReconciliationPeriod.tenantId,ctx.tenant.tenantId),eq(bankReconciliationPeriod.entityId,entityId),eq(bankReconciliationPeriod.profileId,profileId))).orderBy(bankReconciliationPeriod.createdAt,bankReconciliationPeriod.id);
  return periods.map(p=>({...p,reopened:evidence.events.some(e=>e.periodId===p.id),reopening:evidence.events.find(e=>e.periodId===p.id)??null}));
 }
 private async reviewIn(tx:Db,ctx:TenantRequestContext,entityId:string,profileId:string,asOf:string) {
  const state=await this.matches.stateIn(tx,ctx,entityId,profileId);
  if(asOf<state.context.baseline!.baselineDate)throw new ConflictException('Report date must not precede the active baseline');
  const coverage=this.imports.coverage(state.context.baseline!,state.imports.activeImports,state.imports.activeMovements,asOf);
  const arithmetic=calculateBankReconciliation({...state.input,asOf,coverageComplete:coverage.complete});
  const periods=await tx.select().from(bankReconciliationPeriod).where(and(eq(bankReconciliationPeriod.tenantId,ctx.tenant.tenantId),eq(bankReconciliationPeriod.entityId,entityId),eq(bankReconciliationPeriod.profileId,profileId))).orderBy(bankReconciliationPeriod.createdAt,bankReconciliationPeriod.id);
  const active=periods.filter(p=>!state.imports.events.some(e=>e.periodId===p.id));
  const prior=active.sort((a,b)=>b.endDate.localeCompare(a.endDate))[0];
  const startDate=nextDay(prior?.endDate??state.context.baseline!.baselineDate);
  const report:BankReport={...arithmetic,profileId,baselineId:state.context.baseline!.id,asOf,coverage,matches:state.input.matches,previewHash:evidenceHash({asOf,startDate,stateRevision:state.revision,periods,coverage,arithmetic})};
  return {report,state,startDate};
 }
 async reportIn(tx:Db,ctx:TenantRequestContext,entityId:string,profileId:string,asOf:string):Promise<BankReport>{return (await this.reviewIn(tx,ctx,entityId,profileId,asOf)).report;}
 async approveIn(tx:Tx,ctx:TenantRequestContext,entityId:string,profileId:string,input:PeriodApprovalInput) {
  const {report,state,startDate}=await this.reviewIn(tx,ctx,entityId,profileId,input.asOf);
  if(report.previewHash!==input.reviewedHash)throw new ConflictException('Reconciliation report changed; review again');
  if(input.asOf<startDate)throw new ConflictException('Approve the next contiguous bank period');
  if(!report.coverageComplete||!Dec.of(report.difference).isZero()||!Dec.of(report.E).isZero()||report.statementResiduals.some(x=>!Dec.of(x.remaining).isZero()))throw new ConflictException('Complete statement coverage and resolve every bank exception before approval');
  const [period]=await tx.insert(bankReconciliationPeriod).values({tenantId:ctx.tenant.tenantId,entityId,profileId,baselineId:report.baselineId,startDate,endDate:input.asOf,previewHash:report.previewHash,createdBy:ctx.user.id,snapshot:{report,input:state.input,sourceRevision:state.revision,reviewerId:ctx.user.id,outstandingReviewed:input.outstandingReviewed,outstanding:report.bookResiduals.filter(x=>!Dec.of(x.remaining).isZero()),imports:state.imports.activeImports.map(({rawCsv,...batch})=>batch)}}).returning();
  return period!;
 }
 async reopenIn(tx:Tx,ctx:TenantRequestContext,entityId:string,profileId:string,periodId:string,reason:string) {
  const periods=await this.periodsIn(tx,ctx,entityId,profileId),period=periods.find(x=>x.id===periodId);
  if(!period)throw new NotFoundException('Bank period not found');
  if(period.reopened)throw new ConflictException('Bank period already reopened');
  if(periods.some(x=>!x.reopened&&x.startDate>period.endDate))throw new ConflictException('Reopen later bank periods first');
  await tx.insert(bankReconciliationEvent).values({tenantId:ctx.tenant.tenantId,entityId,profileId,periodId,kind:'period_reopen',reason,evidence:{previewHash:period.previewHash},createdBy:ctx.user.id});
  return {reopened:true};
 }
}
