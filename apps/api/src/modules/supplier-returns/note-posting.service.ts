import {returnAccountsIn} from './return-accounts.js';
import {Dec,type AccountingLine} from '@factoryos/core';
import {accountingSettings,accountGroup,glAccount,glEntry,journalVoucher,purchaseInvoiceLine,item,supplierNote,tradeBill,tradeBillEffect} from '@factoryos/db';
import {ConflictException,Injectable} from '@nestjs/common';
import {and,eq,sql} from 'drizzle-orm';
import type {TenantRequestContext} from '../../common/access.js';
import type {Tx} from '../accounting/accounting-lock.js';
import {GlPostingService} from '../accounting/gl-posting.service.js';
import {SupplierReturnClaimService} from './claim.service.js';
import type {SupplierNotePreview} from './contracts.js';
@Injectable()
export class SupplierNotePostingService {
 constructor(private readonly claims:SupplierReturnClaimService,private readonly gl:GlPostingService){}
 async recognizeIn(tx:Tx,ctx:TenantRequestContext,e:string,note:typeof supplierNote.$inferSelect,p:SupplierNotePreview){
 const source=await this.claims.sourceIn(tx,ctx,e,note.originalInvoiceId);
 const originals=await tx.select({l:glEntry,a:glAccount}).from(glEntry).innerJoin(glAccount,eq(glAccount.id,glEntry.accountId)).where(and(eq(glEntry.voucherId,source.voucher.id),eq(glEntry.entityId,e),eq(glEntry.tenantId,ctx.tenant.tenantId)));
 const creditor=originals.find(x=>x.l.partyId===note.supplierId&&Dec.of(x.l.credit).gt('0'));if(!creditor)throw new ConflictException('Original supplier payable evidence missing');
 const [settings]=await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId,e));
 const accounts=await tx.select().from(glAccount).where(and(eq(glAccount.entityId,e),eq(glAccount.tenantId,ctx.tenant.tenantId)));
 const role=(name:string)=>settings!.mappings[name]??accounts.find(x=>x.role===name)?.id;
 const evidenceVoucherIds=[source.voucher.id];const plan:AccountingLine[]=[];const sign=note.kind==='credit'?Dec.of('1'):Dec.of('-1');const add=(accountId:string|undefined,debit:Dec,extra:Partial<AccountingLine>={})=>{if(debit.isZero())return;if(!accountId)throw new ConflictException('Supplier adjustment account mapping missing');plan.push({accountId,debit:debit.gt('0')?debit.toFixed(6):'0',credit:debit.lt('0')?debit.neg().toFixed(6):'0',...extra});};
 add(creditor.l.accountId,Dec.of(p.grandTotal).mul(note.exchangeRate).mul(sign),{partyId:note.supplierId,billReference:note.number!});
 for(const l of p.lines){
 const [row]=await tx.select({l:purchaseInvoiceLine,i:item}).from(purchaseInvoiceLine).innerJoin(item,eq(item.id,purchaseInvoiceLine.itemId)).where(and(eq(purchaseInvoiceLine.id,l.invoiceLineId),eq(purchaseInvoiceLine.invoiceId,note.originalInvoiceId)));
 if(!row)throw new ConflictException('Original purchase line missing');
 const taxable=Dec.of(l.taxableAmount).mul(note.exchangeRate),pending=Dec.of(l.pendingValueInr);
 let adjustment=role('return_variance');
 if(!row.i.isStockItem){const expense=originals.filter(x=>!x.l.partyId&&!x.l.gstRegistrationId&&Dec.of(x.l.debit).gt('0')&&(x.a.role==='purchases'||x.a.id===role('purchases')||(settings!.controlHistory.purchases??[]).includes(x.a.id)));if(expense.length!==1)throw new ConflictException('Original service purchase account evidence is ambiguous');adjustment=expense[0]!.l.accountId;}
 const returned=l.claimLineId?await returnAccountsIn(tx,ctx,e,l.claimLineId):null;if(returned)evidenceVoucherIds.push(...returned.evidenceVoucherIds);add(returned?.pending??role('pending_returns'),pending.mul(sign).neg());
 add(adjustment,taxable.sub(pending).mul(sign).neg());
 for(const k of ['cgst','sgst','igst','cess'] as const){const amount=Dec.of(l[k]).mul(note.exchangeRate);if(amount.isZero())continue;
 if(!source.invoice.itcEligible){const taxAccount=originals.find(x=>x.a.role==='noncreditable_tax'||x.a.id===role('noncreditable_tax')||(settings!.controlHistory.noncreditable_tax??[]).includes(x.a.id));add(taxAccount?.a.id??role('noncreditable_tax'),amount.mul(sign).neg());continue;}
 const name=`input_${k}`;const matches=originals.filter(x=>Dec.of(x.l.debit).gt('0')&&(x.a.role===name||settings!.mappings[name]===x.a.id||(settings!.controlHistory[name]??[]).includes(x.a.id)));
 if(matches.length!==1)throw new ConflictException(`Original ${k.toUpperCase()} input account evidence is ambiguous; Finance review required`);
 add(matches[0]!.a.id,amount.mul(sign).neg(),{gstRegistrationId:matches[0]!.l.gstRegistrationId!});
 }
 }
 const net=plan.reduce((s,x)=>s.add(x.debit).sub(x.credit),Dec.ZERO);add(role('rounding'),net.neg());
 const {voucherId}=await this.gl.postIn(tx,ctx,e,{type:'supplier_note',id:note.id,purpose:'main',number:note.number,currency:note.currency,exchangeRate:note.exchangeRate,evidenceVoucherIds},note.postingDate,{lines:plan,disposition:'posted'});
 const [bill]=await tx.insert(tradeBill).values({tenantId:ctx.tenant.tenantId,entityId:e,side:'payable',kind:note.kind==='credit'?'journal_credit':'bill',partyId:note.supplierId,accountId:creditor.l.accountId,reference:note.supplierNoteNo,sourceType:'supplier_note',sourceId:note.id,originKey:`supplier_note:${note.id}`,currency:note.currency,originalAmount:p.grandTotal,recognitionDate:note.postingDate,dueDate:note.kind==='debit'?note.postingDate:null}).returning();
 await tx.insert(tradeBillEffect).values({tenantId:ctx.tenant.tenantId,entityId:e,billId:bill!.id,sourceType:'supplier_note',sourceId:note.id,originKey:`supplier_note:${note.id}:recognition`,postingDate:note.postingDate,amount:Dec.of(p.grandTotal).mul(sign).neg().toString(),carryingInr:Dec.of(p.grandTotal).mul(note.exchangeRate).mul(sign).neg().toString()});return {billId:bill!.id,voucherId};
 }
}
