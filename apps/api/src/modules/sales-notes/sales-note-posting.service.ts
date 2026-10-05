import { Dec, allocateProportion, type AccountingLine, type TaxComponents } from '@factoryos/core';
import { accountingSettings, accountGroup, glAccount, glEntry, journalVoucher, salesNote, tradeBill, tradeBillEffect } from '@factoryos/db';
import { ConflictException, Injectable } from '@nestjs/common';
import { and,eq,sql } from 'drizzle-orm';
import type {TenantRequestContext} from '../../common/access.js';
import type {Tx} from '../accounting/accounting-lock.js';
import { GlPostingService } from '../accounting/gl-posting.service.js';
export type SalesNote=typeof salesNote.$inferSelect;
@Injectable()
export class SalesNotePostingService {
 constructor(private readonly gl:GlPostingService){}
 async planIn(tx:Tx,ctx:TenantRequestContext,entityId:string,invoiceId:string,customerId:string,kind:'credit'|'debit',rate:string,totals:TaxComponents,reference:string){
  const rows=await tx.select({e:glEntry,role:glAccount.role,root:accountGroup.root,v:journalVoucher.id}).from(glEntry).innerJoin(journalVoucher,eq(journalVoucher.id,glEntry.voucherId)).innerJoin(glAccount,eq(glAccount.id,glEntry.accountId)).innerJoin(accountGroup,eq(accountGroup.id,glAccount.groupId)).where(and(eq(glEntry.tenantId,ctx.tenant.tenantId),eq(glEntry.entityId,entityId),eq(journalVoucher.sourceType,'sales_invoice'),eq(journalVoucher.sourceId,invoiceId),sql`${journalVoucher.reversalOf} is null`));
  const debtor=rows.find(x=>x.e.partyId===customerId&&Dec.of(x.e.debit).gt('0'));
  if(!debtor)throw new ConflictException('Original debtor posting evidence is missing');
  const [settings]=await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId,entityId));
  const revenue=rows.filter(x=>!x.e.partyId&&!x.e.gstRegistrationId&&Dec.of(x.e.credit).gt('0')&&x.root==='income');
  const tax=rows.filter(x=>x.e.gstRegistrationId&&Dec.of(x.e.credit).gt('0'));
  const lines:AccountingLine[]=[],credit=kind==='credit';
  const add=(accountId:string,value:string,extra:Partial<AccountingLine>={})=>{if(Dec.of(value).isZero())return;lines.push({accountId,debit:credit?'0':value,credit:credit?value:'0',...extra});};
  const grand=Object.values(totals).reduce((s,x)=>s.add(x),Dec.ZERO).mul(rate).toFixed(6);
  add(debtor.e.accountId,grand,{partyId:customerId,billReference:reference});
  const revenueAmount=Dec.of(totals.taxableValue).mul(rate);
  if(!revenueAmount.isZero()){
   if(!revenue.length)throw new ConflictException('Original revenue evidence is missing');
   const total=revenue.reduce((s,x)=>s.add(x.e.credit),Dec.ZERO);let left=revenueAmount;
   revenue.forEach((x,i)=>{const share=i===revenue.length-1?left:Dec.of(allocateProportion(revenueAmount.toString(),x.e.credit,total.toString()));left=left.sub(share);if(!share.isZero())lines.push({accountId:x.e.accountId,debit:credit?share.toFixed(6):'0',credit:credit?'0':share.toFixed(6)});});
  }
  for(const component of ['cgst','sgst','igst','cess'] as const){
   const amount=Dec.of(totals[component]).mul(rate);if(amount.isZero())continue;
   const role=`output_${component}`;
   const matches=tax.filter(x=>x.role===role||settings!.mappings[role]===x.e.accountId||(settings!.controlHistory[role]??[]).includes(x.e.accountId));
   if(matches.length!==1)throw new ConflictException(`Original ${component.toUpperCase()} account evidence is ambiguous; Finance review is required`);
   const e=matches[0]!.e;
   lines.push({accountId:e.accountId,debit:credit?amount.toFixed(6):'0',credit:credit?'0':amount.toFixed(6),gstRegistrationId:e.gstRegistrationId!});
  }
  const net=lines.reduce((s,x)=>s.add(x.debit).sub(x.credit),Dec.ZERO);
  if(!net.isZero())lines.push({accountId:settings!.mappings.rounding!,debit:net.isNeg()?net.neg().toFixed(6):'0',credit:net.isNeg()?'0':net.toFixed(6)});
  return {lines,accountId:debtor.e.accountId,evidenceVoucherId:debtor.v};
 }
 async recognizeIn(tx:Tx,ctx:TenantRequestContext,entityId:string,note:SalesNote){
  const totals={taxableValue:note.taxableValue,cgst:note.cgst,sgst:note.sgst,igst:note.igst,cess:note.cess};
  const plan=await this.planIn(tx,ctx,entityId,note.originalInvoiceId,note.customerId,note.kind as 'credit'|'debit',note.exchangeRate,totals,note.number!);
  const {voucherId}=await this.gl.postIn(tx,ctx,entityId,{type:'sales_note',id:note.id,purpose:'main',number:note.number,currency:note.currency,exchangeRate:note.exchangeRate,evidenceVoucherIds:[plan.evidenceVoucherId]},note.postingDate,{lines:plan.lines,disposition:'posted'});
  const [bill]=await tx.insert(tradeBill).values({tenantId:ctx.tenant.tenantId,entityId,side:'receivable',kind:note.kind==='credit'?'journal_credit':'bill',partyId:note.customerId,accountId:plan.accountId,reference:note.number!,sourceType:'sales_note',sourceId:note.id,originKey:`sales_note:${note.id}`,currency:note.currency,originalAmount:note.grandTotal,recognitionDate:note.postingDate,dueDate:note.kind==='debit'?note.dueDate:null}).returning();
  const sign=note.kind==='credit'?Dec.of('-1'):Dec.of('1');
  await tx.insert(tradeBillEffect).values({tenantId:ctx.tenant.tenantId,entityId,billId:bill!.id,sourceType:'sales_note',sourceId:note.id,originKey:`note:${note.id}:recognition`,postingDate:note.postingDate,amount:Dec.of(note.grandTotal).mul(sign).toString(),carryingInr:Dec.of(note.grandTotal).mul(note.exchangeRate).mul(sign).toString()});
  return {voucherId:voucherId!,billId:bill!.id};
 }
}
