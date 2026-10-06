import { Dec, type AccountingLine } from '@factoryos/core';
import { bankAdjustmentLink, bankChargeDocument, glEntry, journalVoucher } from '@factoryos/db';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { BankChargeService, type BankChargeInput } from '../accounting/bank-charge.service.js';
import type { Db, Tx } from '../accounting/accounting-lock.js';
import { BankMatchService } from './match.service.js';
import { evidenceHash } from './registry.service.js';
import type { JournalAdjustmentRef } from './types.js';
@Injectable()
export class BankAdjustmentService {
 constructor(private readonly matches:BankMatchService,private readonly charges:BankChargeService){}
 async previewIn(tx:Db,ctx:TenantRequestContext,entityId:string,profileId:string,statementRowId:string) {
  const state=await this.matches.stateIn(tx,ctx,entityId,profileId),row=state.statement.find(x=>x.id===statementRowId);
  if(!row||Dec.of(row.remaining).isZero())throw new ConflictException('Choose an unmatched statement residual');
  await this.matches.assertOpenDatesIn(tx,ctx,entityId,profileId,[row.date]);
  const links=await tx.select().from(bankAdjustmentLink).where(and(eq(bankAdjustmentLink.tenantId,ctx.tenant.tenantId),eq(bankAdjustmentLink.entityId,entityId),eq(bankAdjustmentLink.profileId,profileId),eq(bankAdjustmentLink.movementId,statementRowId))).orderBy(bankAdjustmentLink.createdAt,bankAdjustmentLink.id);
  return {row,bankAccountId:state.context.profile.accountId,links,stateRevision:state.revision,previewHash:evidenceHash({stateRevision:state.revision,row,links})};
 }
 private replacement(preview:Awaited<ReturnType<BankAdjustmentService['previewIn']>>,replacementOf?:string) {
  if(preview.links.some(x=>!x.releasedAt))throw new ConflictException('Statement residual already has an active adjustment source');
  if(preview.links.length&&!preview.links.some(x=>x.id===replacementOf&&x.releasedAt))throw new ConflictException('Explicit replacement provenance is required after cancellation or abandonment');
  if(replacementOf&&!preview.links.some(x=>x.id===replacementOf&&x.releasedAt))throw new ConflictException('Replacement does not identify released provenance for this statement');
 }
 async submitChargeIn(tx:Tx,ctx:TenantRequestContext,entityId:string,profileId:string,input:{statementRowId:string;reviewedHash:string;replacementOf?:string;charge:BankChargeInput}) {
  const links=await tx.select().from(bankAdjustmentLink).where(and(eq(bankAdjustmentLink.tenantId,ctx.tenant.tenantId),eq(bankAdjustmentLink.entityId,entityId),eq(bankAdjustmentLink.profileId,profileId),eq(bankAdjustmentLink.movementId,input.statementRowId)));
  const payloadHash=evidenceHash(input.charge),prior=links.find(x=>!x.releasedAt);
  if(prior){
   if(prior.kind!=='charge'||(prior.snapshot as {payloadHash:string}).payloadHash!==payloadHash)throw new ConflictException('Different payload against reserved statement movement');
   const [charge]=await tx.select().from(bankChargeDocument).where(and(eq(bankChargeDocument.id,prior.chargeId!),eq(bankChargeDocument.tenantId,ctx.tenant.tenantId),eq(bankChargeDocument.entityId,entityId)));
   if(charge?.status!=='submitted')throw new ConflictException('Cancelled source needs an explicit reservation release and replacement');
   const [entry]=await tx.select().from(glEntry).where(and(eq(glEntry.voucherId,charge.voucherId!),eq(glEntry.accountId,charge.bankAccountId),eq(glEntry.tenantId,ctx.tenant.tenantId),eq(glEntry.entityId,entityId)));
   return {chargeId:charge.id,bankEntryId:entry!.id};
  }
  const preview=await this.previewIn(tx,ctx,entityId,profileId,input.statementRowId);this.replacement(preview,input.replacementOf);
  if(preview.previewHash!==input.reviewedHash)throw new ConflictException('Exception preview changed; review again');
  const state=await this.matches.stateIn(tx,ctx,entityId,profileId);
  const existingFees=await tx.select().from(bankChargeDocument).where(and(eq(bankChargeDocument.tenantId,ctx.tenant.tenantId),eq(bankChargeDocument.entityId,entityId),eq(bankChargeDocument.bankAccountId,preview.bankAccountId),eq(bankChargeDocument.postingDate,preview.row.date),eq(bankChargeDocument.status,'submitted')));
  const normalize=(value:string)=>value.trim().toUpperCase();
  if(existingFees.some(fee=>{
   const originalReference=(fee.snapshot as {input?:{reference?:string}}|null)?.input?.reference;
   if(originalReference&&normalize(originalReference)===normalize(preview.row.reference))return true;
   return state.entries.some(x=>x.entry.voucherId===fee.voucherId&&state.book.some(b=>b.id===x.entry.id&&b.kind==='gl'&&Dec.of(b.remaining).eq(preview.row.remaining)));
  }))throw new ConflictException('Existing bank fee evidence is available; match its actual bank movement instead of posting another fee');
  const chargePreview=await this.charges.previewIn(tx,ctx,entityId,input.charge);
  if(!Dec.of(preview.row.remaining).isNeg()||input.charge.bankAccountId!==preview.bankAccountId||input.charge.postingDate!==preview.row.date||!Dec.of(preview.row.remaining).abs().eq(chargePreview.totalAmount))throw new ConflictException('Bank charge must equal the exact statement residual on its bank account and date');
  const charge=await this.charges.submitIn(tx,ctx,entityId,input.charge,{kind:'standalone'});
  await tx.insert(bankAdjustmentLink).values({tenantId:ctx.tenant.tenantId,entityId,profileId,movementId:input.statementRowId,kind:'charge',chargeId:charge.id,snapshot:{payloadHash,ref:input,replacementOf:input.replacementOf},createdBy:ctx.user.id});
  const [entry]=await tx.select().from(glEntry).where(and(eq(glEntry.voucherId,charge.voucherId!),eq(glEntry.accountId,charge.bankAccountId),eq(glEntry.tenantId,ctx.tenant.tenantId),eq(glEntry.entityId,entityId)));return {chargeId:charge.id,bankEntryId:entry!.id};
 }
 async reserveJournalIn(tx:Tx,ctx:TenantRequestContext,entityId:string,profileId:string,ref:JournalAdjustmentRef,voucherId:string,lines:AccountingLine[],postingDate:string) {
  if(!ctx.tenant.permissions.has('accounts.bank_reconciliation.create'))throw new ForbiddenException('Bank reconciliation create permission required');
  const [existing]=await tx.select().from(bankAdjustmentLink).where(and(eq(bankAdjustmentLink.voucherId,voucherId),eq(bankAdjustmentLink.tenantId,ctx.tenant.tenantId),eq(bankAdjustmentLink.entityId,entityId)));
  if(existing){if(existing.profileId!==profileId||existing.movementId!==ref.statementRowId||(existing.snapshot as {ref:JournalAdjustmentRef}).ref.reviewedHash!==ref.reviewedHash)throw new ConflictException('Journal provenance cannot change');return;}
  const preview=await this.previewIn(tx,ctx,entityId,profileId,ref.statementRowId);this.replacement(preview,ref.replacementOf);
  if(preview.previewHash!==ref.reviewedHash)throw new ConflictException('Journal exception preview changed; review again');
  const bankLines=lines.filter(x=>x.accountId===preview.bankAccountId);
  if(bankLines.length!==1||postingDate!==preview.row.date||!Dec.of(bankLines[0]!.debit).sub(bankLines[0]!.credit).eq(preview.row.remaining))throw new ConflictException('Journal bank line must equal exact statement residual, account and date');
  await tx.insert(bankAdjustmentLink).values({tenantId:ctx.tenant.tenantId,entityId,profileId,movementId:ref.statementRowId,kind:'journal',voucherId,snapshot:{ref,bankAccountId:preview.bankAccountId,amount:preview.row.remaining,date:postingDate,stateRevision:preview.stateRevision},createdBy:ctx.user.id});
 }
 async assertJournalIn(tx:Tx,ctx:TenantRequestContext,entityId:string,voucherId:string) {
  const [link]=await tx.select().from(bankAdjustmentLink).where(and(eq(bankAdjustmentLink.voucherId,voucherId),eq(bankAdjustmentLink.tenantId,ctx.tenant.tenantId),eq(bankAdjustmentLink.entityId,entityId)));
  if(!link)return;
  if(link.releasedAt)throw new ConflictException('Journal provenance reservation was released');
  const [voucher]=await tx.select().from(journalVoucher).where(and(eq(journalVoucher.id,voucherId),eq(journalVoucher.tenantId,ctx.tenant.tenantId),eq(journalVoucher.entityId,entityId)));
  if(!voucher)throw new NotFoundException('Linked journal missing');
  const snapshot=link.snapshot as {amount:string;date:string;bankAccountId:string;stateRevision:string},preview=await this.previewIn(tx,ctx,entityId,link.profileId,link.movementId),lines=voucher.draftLines.filter(x=>x.accountId===snapshot.bankAccountId);
  if(preview.stateRevision!==snapshot.stateRevision||preview.row.remaining!==snapshot.amount||voucher.postingDate!==snapshot.date||lines.length!==1||!Dec.of(lines[0]!.debit).sub(lines[0]!.credit).eq(snapshot.amount))throw new ConflictException('Journal exception evidence or residual changed; explicitly abandon and review a replacement');
 }
 async cancelJournalDraftIn(tx:Tx,ctx:TenantRequestContext,entityId:string,voucherId:string,reason:string) {
  const [link]=await tx.select().from(bankAdjustmentLink).where(and(eq(bankAdjustmentLink.voucherId,voucherId),eq(bankAdjustmentLink.tenantId,ctx.tenant.tenantId),eq(bankAdjustmentLink.entityId,entityId)));
  if(!link)return false;
  const [voucher]=await tx.select().from(journalVoucher).where(and(eq(journalVoucher.id,voucherId),eq(journalVoucher.tenantId,ctx.tenant.tenantId),eq(journalVoucher.entityId,entityId)));
  if(!voucher||voucher.status!=='draft'||link.releasedAt)throw new ConflictException('Only active linked journal drafts may be abandoned');
  await tx.update(journalVoucher).set({status:'cancelled',cancelledAt:new Date(),cancelReason:reason}).where(eq(journalVoucher.id,voucherId));
  await tx.update(bankAdjustmentLink).set({releasedAt:new Date(),releaseReason:reason}).where(eq(bankAdjustmentLink.id,link.id));return true;
 }
 async releaseCancelledIn(tx:Tx,ctx:TenantRequestContext,entityId:string,profileId:string,linkId:string,reason:string) {
  const [link]=await tx.select().from(bankAdjustmentLink).where(and(eq(bankAdjustmentLink.id,linkId),eq(bankAdjustmentLink.profileId,profileId),eq(bankAdjustmentLink.tenantId,ctx.tenant.tenantId),eq(bankAdjustmentLink.entityId,entityId)));
  if(!link||link.releasedAt)throw new ConflictException('Only an active cancelled source reservation may be released');
  const state=await this.matches.stateIn(tx,ctx,entityId,profileId),row=state.statement.find(x=>x.id===link.movementId);if(!row)throw new ConflictException('Original statement evidence is no longer active');
  await this.matches.assertOpenDatesIn(tx,ctx,entityId,profileId,[row.date]);
  if(link.kind==='charge'){
   const [source]=await tx.select().from(bankChargeDocument).where(and(eq(bankChargeDocument.id,link.chargeId!),eq(bankChargeDocument.tenantId,ctx.tenant.tenantId),eq(bankChargeDocument.entityId,entityId)));if(source?.status!=='cancelled')throw new ConflictException('Cancel the original charge through its authorized source workflow first');
  }else{
   const [source]=await tx.select().from(journalVoucher).where(and(eq(journalVoucher.id,link.voucherId!),eq(journalVoucher.tenantId,ctx.tenant.tenantId),eq(journalVoucher.entityId,entityId)));if(source?.status!=='cancelled')throw new ConflictException('Cancel the original journal through its authorized source workflow first');
  }
  await tx.update(bankAdjustmentLink).set({releasedAt:new Date(),releaseReason:reason}).where(eq(bankAdjustmentLink.id,link.id));return {released:true};
 }

}
