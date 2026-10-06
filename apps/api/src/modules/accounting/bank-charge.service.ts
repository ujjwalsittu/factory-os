import { validateGstin } from '@factoryos/compliance-in';
import { Dec, type AccountingLine } from '@factoryos/core';
import { accountGroup, accountingSettings, bankChargeDocument, glAccount, gstRegistration, type Database } from '@factoryos/db';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { businessDate, type Db, type Tx } from './accounting-lock.js';
import { GlPostingService } from './gl-posting.service.js';
const money=z.string().regex(/^\d{1,18}(\.\d{1,6})?$/);
const evidence=z.string().trim().min(5).max(1000);
export const bankChargeInput=z.object({postingDate:z.iso.date(),bankAccountId:z.uuid(),expenseAccountId:z.uuid(),baseAmount:money,
 gst:z.object({cgst:money,sgst:money,igst:money,cess:money}).strict(),reference:z.string().trim().min(1).max(120),
 evidence:z.object({document:evidence,reason:evidence}).strict(),itcEligible:z.boolean().default(false),
 gstInvoice:z.object({number:z.string().trim().min(1).max(120),date:z.iso.date(),supplierGstin:z.string().trim().toUpperCase(),registrationId:z.uuid(),reason:evidence}).strict().optional(),
}).strict();
export type BankChargeInput=z.infer<typeof bankChargeInput>;
export interface BankChargePreview {totalAmount:string;gstAmount:string;inputTax:string;referenceKey:string;lines:AccountingLine[];input:BankChargeInput;}
export type BankChargeDocument=typeof bankChargeDocument.$inferSelect;
export type ChargeSource={kind:'standalone'}|{kind:'settlement';settlementId:string;voucherId:string};
@Injectable()
export class BankChargeService {
 constructor(private readonly gl:GlPostingService,private readonly audit:AuditService) {}
 async previewIn(tx:Db,ctx:TenantRequestContext,entityId:string,input:BankChargeInput):Promise<BankChargePreview> {
  const [settings]=await tx.select().from(accountingSettings).where(and(eq(accountingSettings.entityId,entityId),eq(accountingSettings.tenantId,ctx.tenant.tenantId)));
  if(!settings?.active)throw new BadRequestException('Active accounting is required for bank charges');
  if(input.postingDate<settings.cutoverDate!||input.postingDate>businessDate())throw new BadRequestException('Charge posting date must be within active books and not in the future');
  const [bank]=await tx.select().from(glAccount).where(and(eq(glAccount.id,input.bankAccountId),eq(glAccount.entityId,entityId),eq(glAccount.tenantId,ctx.tenant.tenantId)));
  if(!bank?.isActive)throw new BadRequestException('Choose an active bank account of this entity');
  let groupId:string|null=bank.groupId,bankGroup=false;
  for(let i=0;groupId&&i<20;i++){
   const [group]=await tx.select().from(accountGroup).where(and(eq(accountGroup.id,groupId),eq(accountGroup.entityId,entityId),eq(accountGroup.tenantId,ctx.tenant.tenantId)));
   if(!group)break;if(group.name==='Bank Accounts'&&group.root==='asset'){bankGroup=true;break;}groupId=group.parentId;
  }
  if(!bankGroup)throw new BadRequestException('Bank charges require a Bank Accounts ledger');
  const [expense]=await tx.select().from(glAccount).where(and(eq(glAccount.id,input.expenseAccountId),eq(glAccount.entityId,entityId),eq(glAccount.tenantId,ctx.tenant.tenantId)));
  const [expenseGroup]=expense?await tx.select().from(accountGroup).where(and(eq(accountGroup.id,expense.groupId),eq(accountGroup.entityId,entityId),eq(accountGroup.tenantId,ctx.tenant.tenantId))):[];
  if(!expense?.isActive||expenseGroup?.root!=='expense')throw new BadRequestException('Choose an active expense account of this entity');
  const gst=Object.values(input.gst).reduce((sum,value)=>sum.add(value),Dec.ZERO),base=Dec.of(input.baseAmount),total=base.add(gst);
  if(!total.gt('0'))throw new BadRequestException('Charge total must be positive');
  let referenceKey=input.reference.trim().toUpperCase();
  if(input.gstInvoice){
   if(!validateGstin(input.gstInvoice.supplierGstin).valid||input.gstInvoice.date>input.postingDate)throw new BadRequestException('Invalid bank GST invoice evidence');
   const [registration]=await tx.select().from(gstRegistration).where(and(eq(gstRegistration.id,input.gstInvoice.registrationId),eq(gstRegistration.entityId,entityId),eq(gstRegistration.tenantId,ctx.tenant.tenantId)));
   if(!registration)throw new BadRequestException('GST invoice registration must belong to this entity');
   referenceKey=`GST:${input.gstInvoice.supplierGstin}:${input.gstInvoice.number.trim().toUpperCase()}`;
  }
  const [duplicate]=await tx.select().from(bankChargeDocument).where(and(eq(bankChargeDocument.entityId,entityId),eq(bankChargeDocument.tenantId,ctx.tenant.tenantId),or(eq(bankChargeDocument.referenceKey,referenceKey),eq(bankChargeDocument.referenceKey,input.reference.trim().toUpperCase()),sql`upper(btrim(${bankChargeDocument.snapshot}->'input'->>'reference'))=${input.reference.trim().toUpperCase()}`)));
  if(duplicate)throw new ConflictException('Bank invoice or charge reference was already recorded; use linked reversal evidence');
  const lines:AccountingLine[]=[];
  if(input.itcEligible){
   if(!ctx.tenant.permissions.has('accounts.withholding.approve'))throw new ForbiddenException('Finance must confirm documented GST credit eligibility');
   if(!input.gstInvoice||gst.isZero())throw new BadRequestException('GST credit requires a qualifying invoice and documented split');
   if(Dec.of(input.gst.igst).gt('0')&&(Dec.of(input.gst.cgst).gt('0')||Dec.of(input.gst.sgst).gt('0')))throw new BadRequestException('GST split cannot combine IGST with CGST/SGST');
   if(!Dec.of(input.gst.cgst).eq(input.gst.sgst))throw new BadRequestException('CGST and SGST must have matching amounts');
   for(const [kind,value] of Object.entries(input.gst))if(Dec.of(value).gt('0')){
    const accountId=settings.mappings[`input_${kind}`];if(!accountId)throw new ConflictException('Input GST account mapping is missing');
    const [taxAccount]=await tx.select().from(glAccount).where(and(eq(glAccount.id,accountId),eq(glAccount.entityId,entityId),eq(glAccount.tenantId,ctx.tenant.tenantId)));
    const [taxGroup]=taxAccount?await tx.select().from(accountGroup).where(and(eq(accountGroup.id,taxAccount.groupId),eq(accountGroup.entityId,entityId),eq(accountGroup.tenantId,ctx.tenant.tenantId))):[];
    const forbidden=['inventory','grni','debtors','creditors','cash','bank'];
    const forbiddenIds=forbidden.flatMap(role=>[settings.mappings[role],...(settings.controlHistory[role]??[])]).filter(Boolean);
    let taxGroupId:string|null=taxAccount?.groupId??null,controlGroup=false;
    for(let depth=0;taxGroupId&&depth<20;depth++){
     const [ancestor]=await tx.select().from(accountGroup).where(and(eq(accountGroup.id,taxGroupId),eq(accountGroup.entityId,entityId),eq(accountGroup.tenantId,ctx.tenant.tenantId)));
     if(!ancestor)break;if(['Bank Accounts','Cash-in-Hand','Stock-in-Hand','Sundry Debtors','Sundry Creditors'].includes(ancestor.name)){controlGroup=true;break;}taxGroupId=ancestor.parentId;
    }
    if(controlGroup||!taxAccount?.isActive||taxGroup?.root!=='asset'||forbidden.includes(taxAccount.role??'')||forbiddenIds.includes(accountId)||accountId===input.bankAccountId)throw new BadRequestException('Input GST cannot use inventory, bank or trade controls');
    lines.push({accountId,debit:Dec.of(value).toString(),credit:'0',gstRegistrationId:input.gstInvoice.registrationId});
   }
  }
  const expenseAmount=input.itcEligible?base:total;
  if(expenseAmount.gt('0'))lines.unshift({accountId:input.expenseAccountId,debit:expenseAmount.toString(),credit:'0'});
  lines.push({accountId:input.bankAccountId,debit:'0',credit:total.toString()});
  await this.gl.validateLines(tx as Tx,ctx,entityId,lines);
  return {totalAmount:total.toString(),gstAmount:gst.toString(),inputTax:input.itcEligible?gst.toString():'0.000000',referenceKey,lines,input};
 }
 async submitIn(tx:Tx,ctx:TenantRequestContext,entityId:string,input:BankChargeInput,source:ChargeSource):Promise<BankChargeDocument> {
  const preview=await this.previewIn(tx,ctx,entityId,input);
  const [draft]=await tx.insert(bankChargeDocument).values({tenantId:ctx.tenant.tenantId,entityId,postingDate:input.postingDate,bankAccountId:input.bankAccountId,expenseAccountId:input.expenseAccountId,baseAmount:input.baseAmount,gstAmount:preview.gstAmount,totalAmount:preview.totalAmount,referenceKey:preview.referenceKey,evidence:input.evidence,snapshot:{input,lines:preview.lines,inputTax:preview.inputTax},settlementId:source.kind==='settlement'?source.settlementId:null,createdBy:ctx.user.id}).returning();
  const voucherId=source.kind==='settlement'?source.voucherId:(await this.gl.postIn(tx,ctx,entityId,{type:'bank_charge',id:draft!.id,purpose:'main',narration:`Bank charge ${input.reference}`},input.postingDate,{lines:preview.lines,disposition:'posted'})).voucherId;
  const [after]=await tx.update(bankChargeDocument).set({status:'submitted',submittedBy:ctx.user.id,submittedAt:new Date(),voucherId}).where(eq(bankChargeDocument.id,draft!.id)).returning();
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'bank_charge.submit',targetType:'bank_charge_document',targetId:draft!.id,after},tx);return after!;
 }
 async cancelIn(tx:Tx,ctx:TenantRequestContext,entityId:string,id:string,reason:string){
  const [document]=await tx.select().from(bankChargeDocument).where(and(eq(bankChargeDocument.id,id),eq(bankChargeDocument.entityId,entityId),eq(bankChargeDocument.tenantId,ctx.tenant.tenantId))).for('update');
  if(!document)throw new NotFoundException('Bank charge not found');if(document.status!=='submitted')throw new ConflictException('Only submitted charges can be cancelled');
  if(document.settlementId)throw new ConflictException('Reverse a linked charge through its receipt or payment');
  await this.gl.reverseIn(tx,ctx,entityId,{type:'bank_charge',id,purpose:'main'},reason);
  const [after]=await tx.update(bankChargeDocument).set({status:'cancelled',cancelledBy:ctx.user.id,cancelledAt:new Date(),cancelReason:reason}).where(eq(bankChargeDocument.id,id)).returning();
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'bank_charge.cancel',targetType:'bank_charge_document',targetId:id,reason},tx);return after!;
 }
 async cancelLinkedIn(tx:Tx,ctx:TenantRequestContext,entityId:string,settlementId:string,reason:string){
  const rows=await tx.select().from(bankChargeDocument).where(and(eq(bankChargeDocument.entityId,entityId),eq(bankChargeDocument.tenantId,ctx.tenant.tenantId),eq(bankChargeDocument.settlementId,settlementId),eq(bankChargeDocument.status,'submitted')));
  if(rows.length&&!ctx.tenant.permissions.has('accounts.bank_charge.cancel'))throw new ForbiddenException('Bank-charge cancellation permission is required');
  for(const row of rows){await tx.update(bankChargeDocument).set({status:'cancelled',cancelledBy:ctx.user.id,cancelledAt:new Date(),cancelReason:reason}).where(eq(bankChargeDocument.id,row.id));await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'bank_charge.cancel',targetType:'bank_charge_document',targetId:row.id,reason},tx);}
 }
}
