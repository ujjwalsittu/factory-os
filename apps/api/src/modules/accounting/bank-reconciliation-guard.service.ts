import { bankReconciliationBaseline, bankReconciliationEvent, bankReconciliationProfile, glEntry } from '@factoryos/db';
import { ConflictException, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { Tx } from './accounting-lock.js';
@Injectable()
export class BankReconciliationGuard {
 async assertPostingAllowedIn(tx:Tx,ctx:TenantRequestContext,entityId:string,postingDate:string,accountIds:string[]) {
  if(!accountIds.length)return;
  const profiles=await tx.select().from(bankReconciliationProfile).where(and(eq(bankReconciliationProfile.tenantId,ctx.tenant.tenantId),eq(bankReconciliationProfile.entityId,entityId),inArray(bankReconciliationProfile.accountId,accountIds)));
  for(const profile of profiles){
   const baselines=await tx.select().from(bankReconciliationBaseline).where(and(eq(bankReconciliationBaseline.profileId,profile.id),eq(bankReconciliationBaseline.tenantId,ctx.tenant.tenantId),eq(bankReconciliationBaseline.entityId,entityId)));
   const events=await tx.select().from(bankReconciliationEvent).where(and(eq(bankReconciliationEvent.profileId,profile.id),eq(bankReconciliationEvent.tenantId,ctx.tenant.tenantId),eq(bankReconciliationEvent.entityId,entityId)));
   if(baselines.some(x=>x.baselineDate>=postingDate&&!events.some(e=>e.baselineId===x.id)))throw new ConflictException('Bank posting changes the reviewed baseline; Finance must reset it first');
  }
 }
 async assertReversalAllowedIn(tx:Tx,ctx:TenantRequestContext,entityId:string,voucherId:string) {
  const entries=await tx.select().from(glEntry).where(and(eq(glEntry.voucherId,voucherId),eq(glEntry.tenantId,ctx.tenant.tenantId),eq(glEntry.entityId,entityId)));
  for(const entry of entries)await this.assertPostingAllowedIn(tx,ctx,entityId,entry.postingDate,[entry.accountId]);
 }
}
