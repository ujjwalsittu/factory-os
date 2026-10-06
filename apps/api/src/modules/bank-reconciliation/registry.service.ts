import { Dec } from '@factoryos/core';
import { accountGroup, accountingSettings, bankMappingRevision, bankOpeningItem, bankReconciliationBaseline, bankReconciliationEvent, bankReconciliationProfile, bankStatementImport, bankMatchGroup, bankReconciliationPeriod, glAccount, glEntry } from '@factoryos/db';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { Db, Tx } from '../accounting/accounting-lock.js';
import type { BankContext, BaselineInput, BaselineReview } from './types.js';
export const evidenceHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class BankRegistryService {
 async contextIn(tx:Db,ctx:TenantRequestContext,entityId:string,profileId:string):Promise<BankContext> {
  const [profile]=await tx.select().from(bankReconciliationProfile).where(and(eq(bankReconciliationProfile.id,profileId),eq(bankReconciliationProfile.tenantId,ctx.tenant.tenantId),eq(bankReconciliationProfile.entityId,entityId)));
  if(!profile)throw new NotFoundException('Bank profile not found');
  const [mapping]=await tx.select().from(bankMappingRevision).where(and(eq(bankMappingRevision.profileId,profileId),eq(bankMappingRevision.tenantId,ctx.tenant.tenantId),eq(bankMappingRevision.entityId,entityId))).orderBy(desc(bankMappingRevision.revision)).limit(1);
  const events=await tx.select().from(bankReconciliationEvent).where(and(eq(bankReconciliationEvent.profileId,profileId),eq(bankReconciliationEvent.tenantId,ctx.tenant.tenantId),eq(bankReconciliationEvent.entityId,entityId))).orderBy(bankReconciliationEvent.id);
  const baselines=await tx.select().from(bankReconciliationBaseline).where(and(eq(bankReconciliationBaseline.profileId,profileId),eq(bankReconciliationBaseline.tenantId,ctx.tenant.tenantId),eq(bankReconciliationBaseline.entityId,entityId))).orderBy(desc(bankReconciliationBaseline.createdAt));
  const baseline=baselines.find(x=>!events.some(e=>e.baselineId===x.id))??null;
  return {profile,mapping:mapping??null,baseline,revision:evidenceHash({profile,mapping,baseline,events})};
 }
 async eligibleAccountIn(tx:Db,ctx:TenantRequestContext,entityId:string,accountId:string) {
  const [settings]=await tx.select().from(accountingSettings).where(and(eq(accountingSettings.tenantId,ctx.tenant.tenantId),eq(accountingSettings.entityId,entityId)));
  if(!settings?.active)throw new ConflictException('Activate accounting before configuring bank reconciliation');
  const [account]=await tx.select().from(glAccount).where(and(eq(glAccount.id,accountId),eq(glAccount.tenantId,ctx.tenant.tenantId),eq(glAccount.entityId,entityId)));
  if(!account?.isActive)throw new BadRequestException('An active bank account is required');
  const groups=await tx.select().from(accountGroup).where(and(eq(accountGroup.tenantId,ctx.tenant.tenantId),eq(accountGroup.entityId,entityId)));
  const visited=new Set<string>();let group=groups.find(x=>x.id===account.groupId),bank=false;
  while(group&&!visited.has(group.id)){visited.add(group.id);if(group.name==='Bank Accounts'&&group.root==='asset')bank=true;group=groups.find(x=>x.id===group!.parentId);}
  if(!bank)throw new BadRequestException('Account must belong to asset Bank Accounts ancestry');
  return {account,settings};
 }
 async reviewBaselineIn(tx:Db,ctx:TenantRequestContext,entityId:string,profileId:string,input:BaselineInput):Promise<BaselineReview> {
  const context=await this.contextIn(tx,ctx,entityId,profileId);
  const [settings]=await tx.select().from(accountingSettings).where(and(eq(accountingSettings.tenantId,ctx.tenant.tenantId),eq(accountingSettings.entityId,entityId)));
  if(!settings?.active||input.date<settings.cutoverDate!)throw new ConflictException('Baseline must follow active accounting cut-over');
  if(context.baseline)throw new ConflictException('Reset the existing baseline first');
  const entries=(await tx.select().from(glEntry).where(and(eq(glEntry.tenantId,ctx.tenant.tenantId),eq(glEntry.entityId,entityId),eq(glEntry.accountId,context.profile.accountId))).orderBy(glEntry.postingDate,glEntry.id)).filter(x=>x.postingDate<=input.date);
  const ledger=entries.map(x=>({id:x.id,kind:'gl' as const,date:x.postingDate,signedAmount:Dec.of(x.debit).sub(x.credit).toString(),reference:x.billReference??x.voucherId}));
  const seen=new Set<string>();
  for(const item of input.outstanding){
   if(item.date>input.date)throw new BadRequestException('Outstanding movement follows baseline date');
   if(item.glEntryId){
    const source=ledger.find(x=>x.id===item.glEntryId);
    if(!source||seen.has(source.id)||source.date!==item.date||Dec.of(source.signedAmount).isNeg()!==Dec.of(item.signedAmount).isNeg()||Dec.of(item.signedAmount).abs().gt(Dec.of(source.signedAmount).abs()))throw new BadRequestException('Outstanding source identity, date, sign or amount is inconsistent');
    seen.add(source.id);
   }
  }
  const bookBalance=ledger.reduce((sum,x)=>sum.add(x.signedAmount),Dec.ZERO),outstanding= input.outstanding.reduce((sum,x)=>sum.add(x.signedAmount),Dec.ZERO);
  const difference=bookBalance.sub(outstanding).sub(input.bankBalance);
  return {input,bookBalance:bookBalance.toString(),bankBalance:Dec.of(input.bankBalance).toString(),outstandingTotal:outstanding.toString(),difference:difference.toString(),ledger,previewHash:evidenceHash({input,context,ledger,settings})};
 }
 async activateBaselineIn(tx:Tx,ctx:TenantRequestContext,entityId:string,profileId:string,input:BaselineInput,reviewedHash:string) {
  const review=await this.reviewBaselineIn(tx,ctx,entityId,profileId,input);
  if(review.previewHash!==reviewedHash)throw new ConflictException('Baseline preview changed; review again');
  if(!Dec.of(review.difference).isZero())throw new ConflictException('Baseline book minus outstanding must equal bank balance');
  const [baseline]=await tx.insert(bankReconciliationBaseline).values({tenantId:ctx.tenant.tenantId,entityId,profileId,baselineDate:input.date,bookBalance:review.bookBalance,bankBalance:review.bankBalance,reference:input.reference,evidence:{document:input.evidence,ledger:review.ledger},previewHash:review.previewHash,createdBy:ctx.user.id}).returning();
  if(input.outstanding.length)await tx.insert(bankOpeningItem).values(input.outstanding.map(x=>({tenantId:ctx.tenant.tenantId,entityId,profileId,baselineId:baseline!.id,glEntryId:x.glEntryId,postingDate:x.date,signedAmount:x.signedAmount,reference:x.reference,reason:x.reason,evidence:{document:x.evidence,source:x.glEntryId?review.ledger.find(l=>l.id===x.glEntryId):'imported-pre-cutover'},createdBy:ctx.user.id})));
  return baseline!;
 }
 async resetBaselineIn(tx:Tx,ctx:TenantRequestContext,entityId:string,profileId:string,reason:string) {
  const context=await this.contextIn(tx,ctx,entityId,profileId);
  if(!context.baseline)throw new ConflictException('No active bank baseline');
  const events=await tx.select().from(bankReconciliationEvent).where(and(eq(bankReconciliationEvent.profileId,profileId),eq(bankReconciliationEvent.tenantId,ctx.tenant.tenantId),eq(bankReconciliationEvent.entityId,entityId)));
  const scope={tenantId:ctx.tenant.tenantId,entityId,profileId};
  const matches=await tx.select().from(bankMatchGroup).where(and(eq(bankMatchGroup.profileId,profileId),eq(bankMatchGroup.tenantId,scope.tenantId),eq(bankMatchGroup.entityId,entityId)));
  const imports=await tx.select().from(bankStatementImport).where(and(eq(bankStatementImport.profileId,profileId),eq(bankStatementImport.tenantId,scope.tenantId),eq(bankStatementImport.entityId,entityId),eq(bankStatementImport.status,'submitted')));
  const periods=await tx.select().from(bankReconciliationPeriod).where(and(eq(bankReconciliationPeriod.profileId,profileId),eq(bankReconciliationPeriod.tenantId,scope.tenantId),eq(bankReconciliationPeriod.entityId,entityId)));
  if(matches.some(x=>!events.some(e=>e.matchId===x.id))||imports.some(x=>!events.some(e=>e.importId===x.id))||periods.some(x=>!events.some(e=>e.periodId===x.id)))throw new ConflictException('Reverse matches/imports and reopen periods before resetting baseline');
  await tx.insert(bankReconciliationEvent).values({...scope,kind:'baseline_reset',baselineId:context.baseline.id,reason,createdBy:ctx.user.id});
  return {reset:true};
 }
}
