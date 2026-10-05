import { Dec, consumeCarryingValue, type AccountingLine } from '@factoryos/core';
import { accountingSettings, glDisposition, journalVoucher, salesNote,tradeBillEffect } from '@factoryos/db';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and,eq,sql } from 'drizzle-orm';
import type {TenantRequestContext} from '../../common/access.js';
import {businessDate,type Db,type Tx} from '../accounting/accounting-lock.js';
import {BillService,type NewEffect} from '../accounting/bill.service.js';
import {GlPostingService} from '../accounting/gl-posting.service.js';
export interface CreditApplicationInput {creditNoteId:string;postingDate:string;allocations:readonly {billId:string;amount:string}[];sourceId:string;automatic:boolean}
@Injectable()
export class CreditApplicationService {
 constructor(private readonly bills:BillService,private readonly gl:GlPostingService){}
 async previewIn(tx:Db,ctx:TenantRequestContext,entityId:string,input:Omit<CreditApplicationInput,'sourceId'|'automatic'>){
  if(!ctx.tenant.permissions.has('selling.sales_note.read'))throw new ForbiddenException('Customer note read permission required');
  const [note]=await tx.select().from(salesNote).where(and(eq(salesNote.id,input.creditNoteId),eq(salesNote.tenantId,ctx.tenant.tenantId),eq(salesNote.entityId,entityId)));
  if(!note)throw new NotFoundException('Credit note not found');
  if(note.status!=='submitted'||note.kind!=='credit'||!note.billId)throw new ConflictException('Choose a submitted credit note');
  if(input.postingDate<note.postingDate||input.postingDate>businessDate())throw new BadRequestException('Application date is outside note date through today');
  const [settings]=await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId,entityId));
  if(!settings?.active||input.postingDate<settings.cutoverDate!)throw new ConflictException('Active books required');
  const [advance]=await this.bills.list(tx,entityId,{billIds:[note.billId]});
  if(!advance)throw new ConflictException('Credit evidence is missing');
  const [creditActivity]=await tx.select({latest:sql<string|null>`max(${tradeBillEffect.postingDate})`}).from(tradeBillEffect).where(and(eq(tradeBillEffect.entityId,entityId),eq(tradeBillEffect.billId,advance.id)));
  if(creditActivity?.latest&&input.postingDate<creditActivity.latest)throw new BadRequestException('Application precedes recorded credit activity');
  let open=Dec.of(advance.openAmount),carry=Dec.of(advance.carryingInr),allocated=Dec.ZERO,targetTotal=Dec.ZERO,creditTotal=Dec.ZERO;
  const lines:AccountingLine[]=[],allocations:{billId:string;amount:string;reference:string;openAmount:string;carryingInr:string;advanceInr:string}[]=[],seen=new Set<string>();
  if(!input.allocations.length)throw new BadRequestException('Choose at least one bill');
  for(const a of input.allocations){
   if(seen.has(a.billId)||!Dec.of(a.amount).gt('0'))throw new BadRequestException('Duplicate bill or nonpositive allocation');seen.add(a.billId);
   const [b]=await this.bills.list(tx,entityId,{billIds:[a.billId]});
   if(!b||b.kind!=='bill'||b.partyId!==note.customerId||b.side!=='receivable'||b.currency!==note.currency)throw new BadRequestException('Choose a receivable bill for this customer and currency');
   const [activity]=await tx.select({latest:sql<string|null>`max(${tradeBillEffect.postingDate})`}).from(tradeBillEffect).where(and(eq(tradeBillEffect.entityId,entityId),eq(tradeBillEffect.billId,b.id)));
   if(activity?.latest&&input.postingDate<activity.latest)throw new BadRequestException('Application precedes recorded target activity');
   if(b.recognitionDate>input.postingDate)throw new BadRequestException('Application cannot precede target bill');
   if(Dec.of(a.amount).gt(open)||Dec.of(a.amount).gt(b.openAmount))throw new ConflictException('Application exceeds available credit or bill balance');
   const credit=Dec.of(consumeCarryingValue(open.toString(),carry.toString(),a.amount)),target=Dec.of(consumeCarryingValue(b.openAmount,b.carryingInr,a.amount));
   open=open.sub(a.amount);carry=carry.sub(credit);allocated=allocated.add(a.amount);targetTotal=targetTotal.add(target);creditTotal=creditTotal.add(credit);
   if(!credit.isZero())lines.push({accountId:advance.accountId,partyId:note.customerId,billReference:advance.reference,debit:credit.toFixed(6),credit:'0'});
   if(!target.isZero())lines.push({accountId:b.accountId,partyId:note.customerId,billReference:b.reference,debit:'0',credit:target.toFixed(6)});
   allocations.push({...a,reference:b.reference,openAmount:b.openAmount,carryingInr:target.toFixed(6),advanceInr:credit.toFixed(6)});
  }
  const diff=targetTotal.sub(creditTotal);
  if(!diff.isZero())lines.push({accountId:settings.mappings.forex!,debit:diff.gt('0')?diff.toFixed(6):'0',credit:diff.lt('0')?diff.neg().toFixed(6):'0'});
  const net=new Map<string,Dec>();for(const l of lines)net.set(l.accountId,(net.get(l.accountId)??Dec.ZERO).add(l.debit).sub(l.credit));
  const noValue=[...net.values()].every(x=>x.isZero());
  return {amount:allocated.toFixed(2),allocated:allocated.toFixed(2),unapplied:open.toFixed(2),cashInr:creditTotal.toFixed(6),carryingInr:targetTotal.toFixed(6),forexInr:diff.toFixed(6),lines:noValue?[]:lines,allocations,disposition:noValue?'no_value_change' as const:'posted' as const,advance};
 }
 async applyIn(tx:Tx,ctx:TenantRequestContext,entityId:string,input:CreditApplicationInput){
  const p=await this.previewIn(tx,ctx,entityId,input);
  const {voucherId}=await this.gl.postIn(tx,ctx,entityId,{type:'sales_note_application',id:input.sourceId,purpose:'main',narration:'Customer note credit application'},input.postingDate,{lines:p.lines,disposition:p.disposition});
  const effects:NewEffect[]=p.allocations.flatMap((a,i)=>[
   {billId:p.advance.id,sourceType:'sales_note_application',sourceId:input.sourceId,originKey:`noteapp:${input.sourceId}:${i}:credit`,postingDate:input.postingDate,amount:Dec.of(a.amount).toString(),carryingInr:a.advanceInr},
   {billId:a.billId,sourceType:'sales_note_application',sourceId:input.sourceId,originKey:`noteapp:${input.sourceId}:${i}:bill`,postingDate:input.postingDate,amount:Dec.of(a.amount).neg().toString(),carryingInr:Dec.of(a.carryingInr).neg().toString()},
  ]);
  await this.bills.addEffects(tx,ctx,entityId,effects);
  return {voucherId,appliedAmount:p.allocated};
 }
 async reverseIn(tx:Tx,ctx:TenantRequestContext,entityId:string,sourceId:string,reason:string){
  const [d]=await tx.select().from(glDisposition).where(and(eq(glDisposition.tenantId,ctx.tenant.tenantId),eq(glDisposition.entityId,entityId),eq(glDisposition.sourceType,'sales_note_application'),eq(glDisposition.sourceId,sourceId),eq(glDisposition.purpose,'main')));
  if(!d)return;
  await this.gl.reverseIn(tx,ctx,entityId,{type:'sales_note_application',id:sourceId,purpose:'main'},reason);
  await this.bills.reverseSourceEffects(tx,ctx,entityId,'sales_note_application',sourceId,businessDate());
 }
}
