import { Dec, allocateNoteComponents, calculateReturnCost, gstCreditDeadline, type TaxComponents } from '@factoryos/core';
import { accountingSettings, gstRegistration, item, journalVoucher, salesInvoice, salesInvoiceLine, salesNote, salesNoteLine, salesReturnEffect, stockLedgerEntry, stockEntryLine, warehouse } from '@factoryos/db';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { businessDate, type Tx } from '../accounting/accounting-lock.js';
import { BillService } from '../accounting/bill.service.js';
import { SalesNotePostingService } from './sales-note-posting.service.js';
import type { NoteDraftInput, NoteLineLimit, NoteLinePreview, NotePreview } from './sales-notes.contracts.js';
const keys=['taxableValue','cgst','sgst','igst','cess'] as const;
const zero=():TaxComponents=>({taxableValue:'0',cgst:'0',sgst:'0',igst:'0',cess:'0'});
@Injectable()
export class SalesNotePreviewService {
 constructor(private readonly bills:BillService,private readonly posting:SalesNotePostingService){}
 async sourceIn(tx:Tx,ctx:TenantRequestContext,entityId:string,invoiceId:string){
  const [invoice]=await tx.select().from(salesInvoice).where(and(eq(salesInvoice.id,invoiceId),eq(salesInvoice.tenantId,ctx.tenant.tenantId),eq(salesInvoice.entityId,entityId)));
  if(!invoice)throw new NotFoundException('Sales invoice not found');
  const [settings]=await tx.select().from(accountingSettings).where(and(eq(accountingSettings.entityId,entityId),eq(accountingSettings.tenantId,ctx.tenant.tenantId)));
  if(!settings?.active||!settings.cutoverDate||invoice.invoiceDate<settings.cutoverDate)throw new ConflictException('Notes require an active-era invoice in active books');
  if(invoice.status!=='submitted')throw new ConflictException('Choose a submitted invoice');
  const [voucher]=await tx.select().from(journalVoucher).where(and(eq(journalVoucher.entityId,entityId),eq(journalVoucher.tenantId,ctx.tenant.tenantId),eq(journalVoucher.sourceType,'sales_invoice'),eq(journalVoucher.sourceId,invoice.id),sql`${journalVoucher.reversalOf} is null`));
  if(!voucher)throw new ConflictException('Original invoice posting evidence is missing');
  const lines=await tx.select({line:salesInvoiceLine,stock:item.isStockItem}).from(salesInvoiceLine).innerJoin(item,eq(item.id,salesInvoiceLine.itemId)).where(eq(salesInvoiceLine.invoiceId,invoice.id));
  return {invoice,settings,voucher,lines};
 }
 async previewIn(tx:Tx,ctx:TenantRequestContext,entityId:string,input:NoteDraftInput):Promise<NotePreview>{
  const {invoice,lines,settings}=await this.sourceIn(tx,ctx,entityId,input.invoiceId);
  if(input.postingDate<invoice.invoiceDate||input.postingDate<settings.cutoverDate!||input.postingDate>businessDate())throw new BadRequestException('Note date must be from invoice/cut-over through today');
  if(input.dueDate&&input.dueDate<input.postingDate)throw new BadRequestException('Due date precedes note date');
  if(input.kind==='credit'&&input.dueDate)throw new BadRequestException('Credit notes do not have a due date');
  const [reg]=await tx.select().from(gstRegistration).where(and(eq(gstRegistration.id,invoice.gstRegistrationId!),eq(gstRegistration.entityId,entityId)));
  if(input.taxTreatment==='gst'){
   if(reg?.einvoiceApplicableFrom&&input.postingDate>=reg.einvoiceApplicableFrom)throw new ConflictException('GST notes require the upcoming IRN workflow for this registration');
   if(input.kind==='credit'&&(!input.taxEligibilityConfirmed||input.postingDate>gstCreditDeadline(invoice.invoiceDate)))throw new BadRequestException('Confirm eligible GST reduction before the statutory credit deadline and annual return filing');
  }
  const previous=await tx.select({n:salesNote,l:salesNoteLine}).from(salesNoteLine).innerJoin(salesNote,eq(salesNote.id,salesNoteLine.noteId)).where(and(eq(salesNote.originalInvoiceId,invoice.id),eq(salesNote.entityId,entityId),eq(salesNote.tenantId,ctx.tenant.tenantId),eq(salesNote.status,'submitted')));
  const out:NoteLinePreview[]=[],limits:NoteLineLimit[]=[],seen=new Set<string>();
  for(const inputLine of input.lines){
   if(seen.has(inputLine.invoiceLineId))throw new BadRequestException('Choose each invoice line once'); seen.add(inputLine.invoiceLineId);
   const found=lines.find(x=>x.line.id===inputLine.invoiceLineId); if(!found)throw new NotFoundException('Original invoice line not found'); const original=found.line;
   const total={} as TaxComponents,remaining={} as TaxComponents;
   const prev=previous.filter(x=>x.l.invoiceLineId===original.id);
   for(const k of keys){total[k]=Dec.of(original[k]??'0').add(prev.filter(x=>x.n.kind==='debit').reduce((s,x)=>s.add(x.l[k]),Dec.ZERO)).toString(); remaining[k]=Dec.of(total[k]).sub(prev.filter(x=>x.n.kind==='credit').reduce((s,x)=>s.add(x.l[k]),Dec.ZERO)).toString();}
   const creditedQty=prev.filter(x=>x.n.kind==='credit').reduce((s,x)=>s.add(x.l.qty),Dec.ZERO), qty=Dec.of(inputLine.qty??'0'),returnQty=Dec.of(inputLine.returnQty??'0');
   if(input.kind==='debit'&&(inputLine.mode!=='value'||!qty.isZero()||!returnQty.isZero()))throw new BadRequestException('Debit notes add value without shipping or returning quantity');
   if(inputLine.mode==='quantity'&&(!qty.gt('0')||inputLine.taxableAmount!==undefined))throw new BadRequestException('Quantity credit requires quantity only');
   if(inputLine.mode==='value'&&(inputLine.qty!==undefined||!inputLine.taxableAmount))throw new BadRequestException('Value adjustment requires taxable amount only');
   if(returnQty.gt('0')&&(input.kind!=='credit'||inputLine.mode!=='quantity'||returnQty.gt(qty)||!found.stock||!inputLine.warehouseId))throw new BadRequestException('Physical returns require a stock quantity credit and destination warehouse');
   if(inputLine.warehouseId&&!returnQty.gt('0'))throw new BadRequestException('Destination belongs to a physical return');
   if(input.kind==='credit'&&qty.gt(Dec.of(original.qty).sub(creditedQty)))throw new ConflictException('Credit quantity exceeds original remaining quantity');
   const quantityCredits=prev.filter(x=>x.n.kind==='credit'&&x.l.mode==='quantity');
   const quantityAmount=qty.eq(Dec.of(original.qty).sub(creditedQty))
    ?Dec.of(original.taxableValue??'0').sub(quantityCredits.reduce((sum,x)=>sum.add(x.l.taxableAmount),Dec.ZERO))
    :Dec.of(Dec.of(original.taxableValue??'0').mul(qty).div(original.qty).toFixed(2));
   const amount=inputLine.mode==='quantity'?quantityAmount:Dec.of(inputLine.taxableAmount!);
   if(!amount.gt('0')||!Dec.of(amount.toFixed(2)).eq(amount))throw new BadRequestException('Taxable amount must be positive with at most two decimals');
   if(input.kind==='credit'&&amount.gt(remaining.taxableValue))throw new ConflictException('Credit exceeds remaining original value');
   let tax:TaxComponents;
   if(input.taxTreatment==='commercial')tax={...zero(),taxableValue:amount.toFixed(2)};
   else if(input.kind==='debit'){
    if(!Dec.of(original.taxableValue??'0').gt('0'))throw new BadRequestException('Original taxable value must be positive');
    tax={...zero(),taxableValue:amount.toFixed(2)}; for(const k of keys.filter(k=>k!=='taxableValue'))tax[k]=Dec.of(original[k]??'0').mul(amount).div(original.taxableValue!).toFixed(2);
   } else {
    const gstCredits=prev.filter(x=>x.n.kind==='credit'&&x.n.taxTreatment==='gst').reduce((s,x)=>s.add(x.l.taxableValue),Dec.ZERO);
    const gstTaxable=Dec.of(original.taxableValue??'0').add(prev.filter(x=>x.n.kind==='debit'&&x.n.taxTreatment==='gst').reduce((s,x)=>s.add(x.l.taxableValue),Dec.ZERO));
    const gstRemaining=gstTaxable.sub(gstCredits);
    if(amount.gt(gstRemaining))throw new ConflictException('GST credit exceeds remaining GST-adjusting supply value; commercial adjustments require commercial treatment');
    tax=allocateNoteComponents({...total,taxableValue:gstTaxable.toString()},remaining,amount.toString(),gstTaxable.toString(),amount.eq(gstRemaining));
   }
   let cost='0.000000',originalSeq:number|undefined,originalQty:string|undefined,originalValue:string|undefined,returnedQty=Dec.ZERO,returnedValue=Dec.ZERO;
   if(found.stock){
    if(!invoice.stockEntryId)throw new ConflictException('Original dispatch evidence is missing');
    // Delivery lines use the stock-only invoice line order, not arbitrary reference text.
    const deliveryLineNo=lines.filter(x=>x.stock).sort((a,b)=>a.line.lineNo-b.line.lineNo).findIndex(x=>x.line.id===original.id)+1;
    const [deliveryLine]=await tx.select().from(stockEntryLine).where(and(eq(stockEntryLine.entryId,invoice.stockEntryId),eq(stockEntryLine.lineNo,deliveryLineNo)));
    const [entry]=await tx.select().from(stockLedgerEntry).where(and(eq(stockLedgerEntry.entityId,entityId),eq(stockLedgerEntry.tenantId,ctx.tenant.tenantId),eq(stockLedgerEntry.voucherId,invoice.stockEntryId),eq(stockLedgerEntry.voucherLineId,deliveryLine!.id),sql`${stockLedgerEntry.qty}<0`,eq(stockLedgerEntry.isReversal,false)));
    if(!entry||entry.ownerPartyId)throw new ConflictException('Company-owned original dispatch evidence is missing');
    originalSeq=entry.seq;originalQty=Dec.of(entry.qty).neg().toString();originalValue=Dec.of(entry.value).neg().toString();
    const effects=await tx.select().from(salesReturnEffect).where(and(eq(salesReturnEffect.entityId,entityId),eq(salesReturnEffect.originalLedgerSeq,entry.seq)));
    returnedQty=effects.reduce((s,x)=>s.add(x.qty),Dec.ZERO);returnedValue=effects.reduce((s,x)=>s.add(x.value),Dec.ZERO);
    if(returnQty.gt('0')){
     const [wh]=await tx.select().from(warehouse).where(and(eq(warehouse.id,inputLine.warehouseId!),eq(warehouse.entityId,entityId),eq(warehouse.tenantId,ctx.tenant.tenantId)));
     if(!wh||!wh.isActive)throw new NotFoundException('Active destination warehouse not found');
     try{cost=calculateReturnCost({originalQty,originalValue,returnedQty:returnedQty.toString(),returnedValue:returnedValue.toString(),qty:returnQty.toString()});}catch{throw new ConflictException('Return exceeds original dispatched quantity or value');}
    }
   }
   limits.push({invoiceLineId:original.id,creditQty:Dec.of(original.qty).sub(creditedQty).toString(),...remaining,returnQty:originalQty?Dec.of(originalQty).sub(returnedQty).toString():'0',returnValueInr:originalValue?Dec.of(originalValue).sub(returnedValue).toString():'0'});
   out.push({invoiceLineId:original.id,mode:inputLine.mode,qty:qty.toString(),taxableAmount:amount.toFixed(2),returnQty:returnQty.toString(),warehouseId:inputLine.warehouseId,...tax,returnValueInr:cost,originalLedgerSeq:originalSeq,originalQty,originalValue});
  }
  const totals=zero();for(const k of keys)totals[k]=out.reduce((s,x)=>s.add(x[k]),Dec.ZERO).toFixed(2);
  const grand=keys.reduce((s,k)=>s.add(totals[k]),Dec.ZERO);
  await this.bills.syncIn(tx,ctx,entityId);
  const bills=await this.bills.list(tx,entityId,{partyId:invoice.customerId,side:'receivable',currency:invoice.currency});
  const open=bills.filter(b=>b.sourceType==='sales_invoice'&&b.sourceId===invoice.id).reduce((s,b)=>s.add(b.openAmount),Dec.ZERO);
  const applied=input.kind==='credit'?(grand.gt(open)?open:grand):Dec.ZERO;
  return {...totals,currency:invoice.currency,exchangeRate:invoice.exchangeRate,grandTotal:grand.toFixed(2),returnValueInr:out.reduce((s,x)=>s.add(x.returnValueInr),Dec.ZERO).toFixed(6),applyAmount:applied.toFixed(6),remainingInvoiceAmount:open.sub(applied).toFixed(6),unappliedCredit:input.kind==='credit'?grand.sub(applied).toFixed(6):'0.000000',lines:out,limits,ledgerLines:(await this.posting.planIn(tx,ctx,entityId,invoice.id,invoice.customerId,input.kind,invoice.exchangeRate,totals,invoice.number!)).lines};
 }
}
