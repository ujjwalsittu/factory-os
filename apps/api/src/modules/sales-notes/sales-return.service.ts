import {Dec,splitAcquisitionCost,type AccountingLine} from '@factoryos/core';
import {accountingSettings,fifoLayer,glEntry,journalVoucher,salesInvoice,salesInvoiceLine,salesNote,salesNoteLine,salesReturnEffect,stockEntry,stockEntryLine,stockLedgerEntry} from '@factoryos/db';
import {ConflictException,Injectable} from '@nestjs/common';
import {and,eq,sql} from 'drizzle-orm';
import type {TenantRequestContext} from '../../common/access.js';
import type {Tx} from '../accounting/accounting-lock.js';
import {GlPostingService} from '../accounting/gl-posting.service.js';
import {StockPostingService} from '../stock-posting.service.js';
import type {NoteLinePreview} from './sales-notes.contracts.js';
@Injectable()
export class SalesReturnService {
 constructor(private readonly stock:StockPostingService,private readonly gl:GlPostingService){}
 async postIn(tx:Tx,ctx:TenantRequestContext,entityId:string,noteId:string,previewLines:NoteLinePreview[]){
  const lines=previewLines.filter(x=>Dec.of(x.returnQty).gt('0'));if(!lines.length)return {stockEntryId:null,valueInr:'0.000000'};
  const [note]=await tx.select().from(salesNote).where(and(eq(salesNote.id,noteId),eq(salesNote.entityId,entityId),eq(salesNote.tenantId,ctx.tenant.tenantId)));
  if(!note)throw new ConflictException('Return note missing');
  const [invoice]=await tx.select().from(salesInvoice).where(eq(salesInvoice.id,note.originalInvoiceId));
  const [entry]=await tx.insert(stockEntry).values({tenantId:ctx.tenant.tenantId,entityId,purpose:'sales_return',postingDate:note.postingDate,partyId:note.customerId,reference:note.number,remarks:`Return on ${note.number}`,systemGenerated:true,createdBy:ctx.user.id}).returning();
  const costs=lines.map(x=>splitAcquisitionCost({amount:x.returnValueInr,quantity:x.returnQty,remaining:x.returnQty,oldRate:'0'}));
  for(let i=0;i<lines.length;i++){
   const p=lines[i]!,[source]=await tx.select().from(salesInvoiceLine).where(and(eq(salesInvoiceLine.id,p.invoiceLineId),eq(salesInvoiceLine.invoiceId,invoice!.id)));
   await tx.insert(stockEntryLine).values({entryId:entry!.id,lineNo:i+1,itemId:source!.itemId,qty:p.returnQty,toWarehouseId:p.warehouseId,batchId:source!.batchId,rate:costs[i]!.newRate});
  }
  await this.stock.submitIn(tx,ctx,entityId,entry!.id);
  const posted=await tx.select({s:stockLedgerEntry,l:fifoLayer,sl:stockEntryLine}).from(stockLedgerEntry).innerJoin(fifoLayer,eq(fifoLayer.sourceSeq,stockLedgerEntry.seq)).innerJoin(stockEntryLine,eq(stockEntryLine.id,stockLedgerEntry.voucherLineId)).where(and(eq(stockLedgerEntry.entityId,entityId),eq(stockLedgerEntry.voucherId,entry!.id),eq(stockLedgerEntry.isReversal,false)));
  for(const row of posted){
   const p=lines[row.sl.lineNo-1]!,[noteLine]=await tx.select().from(salesNoteLine).where(and(eq(salesNoteLine.noteId,noteId),eq(salesNoteLine.invoiceLineId,p.invoiceLineId)));
   await tx.insert(salesReturnEffect).values({tenantId:ctx.tenant.tenantId,entityId,noteId,noteLineId:noteLine!.id,originalLedgerSeq:p.originalLedgerSeq!,originalQty:p.originalQty!,originalValue:p.originalValue!,qty:p.returnQty,value:p.returnValueInr,inboundLedgerSeq:row.s.seq,layerId:row.l.id});
  }
  const originals=await tx.select({e:glEntry,v:journalVoucher.id}).from(glEntry).innerJoin(journalVoucher,eq(journalVoucher.id,glEntry.voucherId)).where(and(eq(glEntry.tenantId,ctx.tenant.tenantId),eq(glEntry.entityId,entityId),eq(journalVoucher.sourceType,'stock_entry'),eq(journalVoucher.sourceId,invoice!.stockEntryId!),sql`${journalVoucher.reversalOf} is null`));
  const inventory=originals.find(x=>Dec.of(x.e.credit).gt('0')),expense=originals.find(x=>Dec.of(x.e.debit).gt('0'));
  if(!inventory||!expense)throw new ConflictException('Original dispatch account evidence missing');
  const exact=lines.reduce((s,x)=>s.add(x.returnValueInr),Dec.ZERO),represented=posted.reduce((s,x)=>s.add(x.s.value),Dec.ZERO),residual=exact.sub(represented);
  const plan:AccountingLine[]=[];
  if(!represented.isZero())plan.push({accountId:inventory.e.accountId,debit:represented.toFixed(6),credit:'0'});
  if(!exact.isZero())plan.push({accountId:expense.e.accountId,debit:'0',credit:exact.toFixed(6)});
  if(!residual.isZero()){
   const [settings]=await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId,entityId));
   plan.push({accountId:settings!.mappings.rounding!,debit:residual.gt('0')?residual.toFixed(6):'0',credit:residual.lt('0')?residual.neg().toFixed(6):'0'});
  }
  await this.gl.postIn(tx,ctx,entityId,{type:'sales_return',id:entry!.id,purpose:'main',number:note.number,evidenceVoucherIds:[inventory.v]},note.postingDate,{lines:plan,disposition:plan.length?'posted':'no_value_change'});
  return {stockEntryId:entry!.id,valueInr:exact.toFixed(6)};
 }
 async cancelIn(tx:Tx,ctx:TenantRequestContext,entityId:string,noteId:string,reason:string){
  const [note]=await tx.select().from(salesNote).where(and(eq(salesNote.id,noteId),eq(salesNote.entityId,entityId),eq(salesNote.tenantId,ctx.tenant.tenantId)));
  if(!note?.stockEntryId)return;
  await this.stock.cancelIn(tx,ctx,entityId,note.stockEntryId,reason);
  const effects=await tx.select().from(salesReturnEffect).where(and(eq(salesReturnEffect.noteId,noteId),eq(salesReturnEffect.entityId,entityId),sql`${salesReturnEffect.reversalOf} is null`));
  for(const f of effects)await tx.insert(salesReturnEffect).values({...f,id:undefined,qty:Dec.of(f.qty).neg().toString(),value:Dec.of(f.value).neg().toString(),reversalOf:f.id,createdAt:new Date()});
 }
}
