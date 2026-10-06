import {guardSandboxSourceIn} from '../gst-sandbox/source-guards.js';
import {Dec} from '@factoryos/core';
import {gstRegistration,item,legalEntity,salesInvoice,salesInvoiceLine,salesNote,salesNoteLine,settlementAllocationDocument} from '@factoryos/db';
import {ConflictException,Injectable,NotFoundException} from '@nestjs/common';
import {and,asc,desc,eq} from 'drizzle-orm';
import type {TenantRequestContext} from '../../common/access.js';
import {AuditService} from '../../common/audit.service.js';
import {businessDate,lockAccounting,type Tx} from '../accounting/accounting-lock.js';
import {BillService} from '../accounting/bill.service.js';
import {GlPostingService} from '../accounting/gl-posting.service.js';
import {SalesNotePreviewService} from './sales-note-preview.service.js';
import {SalesNotePostingService,type SalesNote} from './sales-note-posting.service.js';
import {SalesReturnService} from './sales-return.service.js';
import {CreditApplicationService} from './credit-application.service.js';
import {StockPostingService} from '../stock-posting.service.js';
import type {NoteDraftInput,NotePreview} from './sales-notes.contracts.js';
@Injectable()
export class SalesNoteService {
 constructor(private readonly preview:SalesNotePreviewService,private readonly posting:SalesNotePostingService,private readonly returns:SalesReturnService,private readonly credits:CreditApplicationService,private readonly stock:StockPostingService,private readonly bills:BillService,private readonly gl:GlPostingService,private readonly audit:AuditService){}
 async noteIn(tx:Tx,ctx:TenantRequestContext,entityId:string,id:string,lock=false){
  const query=tx.select().from(salesNote).where(and(eq(salesNote.id,id),eq(salesNote.tenantId,ctx.tenant.tenantId),eq(salesNote.entityId,entityId)));
  const [note]=await (lock?query.for('update'):query);if(!note)throw new NotFoundException('Customer note not found');return note;
 }
 async listIn(tx:Tx,ctx:TenantRequestContext,entityId:string){return tx.select().from(salesNote).where(and(eq(salesNote.tenantId,ctx.tenant.tenantId),eq(salesNote.entityId,entityId))).orderBy(desc(salesNote.createdAt));}
 async getIn(tx:Tx,ctx:TenantRequestContext,entityId:string,id:string){
  const note=await this.noteIn(tx,ctx,entityId,id);
  const rows=await tx.select({line:salesNoteLine,source:salesInvoiceLine,itemName:item.name,itemCode:item.code}).from(salesNoteLine).innerJoin(salesInvoiceLine,eq(salesInvoiceLine.id,salesNoteLine.invoiceLineId)).innerJoin(item,eq(item.id,salesInvoiceLine.itemId)).where(and(eq(salesNoteLine.noteId,id),eq(salesNoteLine.tenantId,ctx.tenant.tenantId),eq(salesNoteLine.entityId,entityId))).orderBy(asc(salesNoteLine.lineNo));
  const [invoice]=await tx.select().from(salesInvoice).where(eq(salesInvoice.id,note.originalInvoiceId));
  const [reg]=await tx.select().from(gstRegistration).where(eq(gstRegistration.id,note.gstRegistrationId));
  const [entity]=await tx.select().from(legalEntity).where(eq(legalEntity.id,entityId));
  await this.bills.syncIn(tx,ctx,entityId);
  const [creditBalance]=note.billId?await this.bills.list(tx,entityId,{billIds:[note.billId]}):[];
  const applications=await tx.select().from(settlementAllocationDocument).where(and(eq(settlementAllocationDocument.creditNoteId,id),eq(settlementAllocationDocument.entityId,entityId))).orderBy(asc(settlementAllocationDocument.createdAt));
  return {...note,originalInvoiceNumber:invoice!.number,originalInvoiceDate:invoice!.invoiceDate,ourGstin:note.sellerGstin??reg!.gstin,ourAddress:note.sellerAddress,entityName:note.sellerName??entity!.legalName,lines:rows.map(x=>({...x.line,itemCode:x.itemCode,itemName:x.itemName,description:x.source.description,hsnCode:x.source.hsnCode,gstRate:x.source.gstRate,originalQty:x.source.qty,originalRate:x.source.rate})),creditBalance:creditBalance??null,applications};
 }
 async saveIn(tx:Tx,ctx:TenantRequestContext,entityId:string,input:NoteDraftInput,id?:string){
  await lockAccounting(tx,entityId);
  const prior=id?await this.noteIn(tx,ctx,entityId,id,true):null;
  if(prior&&(prior.status!=='draft'||prior.originalInvoiceId!==input.invoiceId))throw new ConflictException('Only draft values of the original invoice can be changed');
  const p=await this.preview.previewIn(tx,ctx,entityId,input),{invoice}=await this.preview.sourceIn(tx,ctx,entityId,input.invoiceId);
  const [sellerReg]=await tx.select().from(gstRegistration).where(eq(gstRegistration.id,invoice.gstRegistrationId!));
  const [sellerEntity]=await tx.select().from(legalEntity).where(eq(legalEntity.id,entityId));
  const data={sellerName:sellerEntity!.legalName,sellerGstin:sellerReg!.gstin,sellerAddress:sellerReg!.address,originalInvoiceId:invoice.id,kind:input.kind,taxTreatment:input.taxTreatment,customerId:invoice.customerId,gstRegistrationId:invoice.gstRegistrationId!,postingDate:input.postingDate,dueDate:input.kind==='debit'?input.dueDate??input.postingDate:null,reason:input.reason,currency:invoice.currency,exchangeRate:invoice.exchangeRate,supplyType:invoice.supplyType,placeOfSupplyStateCode:invoice.placeOfSupplyStateCode,customerName:invoice.customerName,customerGstin:invoice.customerGstin,billingAddress:invoice.billingAddress,shippingAddress:invoice.shippingAddress,lutArn:invoice.lutArn,taxEligibilityConfirmed:input.taxTreatment==='gst'&&input.kind==='credit'&&input.taxEligibilityConfirmed,taxableValue:p.taxableValue,cgst:p.cgst,sgst:p.sgst,igst:p.igst,cess:p.cess,grandTotal:p.grandTotal,updatedAt:new Date()};
  const [note]=id?await tx.update(salesNote).set(data).where(eq(salesNote.id,id)).returning():await tx.insert(salesNote).values({...data,tenantId:ctx.tenant.tenantId,entityId,createdBy:ctx.user.id}).returning();
  if(prior)await tx.delete(salesNoteLine).where(eq(salesNoteLine.noteId,note!.id));
  await tx.insert(salesNoteLine).values(p.lines.map((l,i)=>({tenantId:ctx.tenant.tenantId,entityId,noteId:note!.id,originalInvoiceId:invoice.id,invoiceLineId:l.invoiceLineId,lineNo:i+1,mode:l.mode,qty:l.qty,taxableAmount:l.taxableAmount,returnQty:l.returnQty,warehouseId:l.warehouseId,taxableValue:l.taxableValue,cgst:l.cgst,sgst:l.sgst,igst:l.igst,cess:l.cess,returnValueInr:l.returnValueInr})));
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:prior?'sales_note.update':'sales_note.create',targetType:'sales_note',targetId:note!.id,after:{kind:note!.kind,grandTotal:note!.grandTotal}},tx);
  return note!;
 }
 async inputIn(tx:Tx,note:SalesNote):Promise<NoteDraftInput>{
  const rows=await tx.select().from(salesNoteLine).where(eq(salesNoteLine.noteId,note.id)).orderBy(asc(salesNoteLine.lineNo));
  return {invoiceId:note.originalInvoiceId,kind:note.kind as 'credit'|'debit',taxTreatment:note.taxTreatment as 'gst'|'commercial',postingDate:note.postingDate,...(note.dueDate?{dueDate:note.dueDate}:{}),reason:note.reason,taxEligibilityConfirmed:note.taxEligibilityConfirmed,lines:rows.map(l=>({invoiceLineId:l.invoiceLineId,mode:l.mode as 'quantity'|'value',...(l.mode==='quantity'?{qty:l.qty}:{taxableAmount:l.taxableAmount}),...(Dec.of(l.returnQty).gt('0')?{returnQty:l.returnQty,warehouseId:l.warehouseId!}:{})}))};
 }
 async submitIn(tx:Tx,ctx:TenantRequestContext,entityId:string,id:string){
  await lockAccounting(tx,entityId);const prior=await this.noteIn(tx,ctx,entityId,id,true);
  if(prior.status!=='draft')throw new ConflictException('Only drafts can be submitted');
  const input=await this.inputIn(tx,prior);
  // Recalculate and replace only draft lines; submitted evidence is never edited.
  const refreshed=await this.saveIn(tx,ctx,entityId,input,id),p=await this.preview.previewIn(tx,ctx,entityId,input);
  await this.bills.assertReconciledIn(tx,entityId);
  const number=await this.stock.allocateNumber(tx,ctx.tenant.tenantId,entityId,`${prior.kind==='credit'?'credit_note':'debit_note'}:${prior.gstRegistrationId}`,prior.postingDate);
  const [note]=await tx.update(salesNote).set({status:'submitted',number,submittedBy:ctx.user.id,submittedAt:new Date(),taxEligibilityActor:prior.taxEligibilityConfirmed?ctx.user.id:null,updatedAt:new Date()}).where(eq(salesNote.id,id)).returning();
  const recognition=await this.posting.recognizeIn(tx,ctx,entityId,note!);
  await tx.update(salesNote).set(recognition).where(eq(salesNote.id,id));
  const returned=await this.returns.postIn(tx,ctx,entityId,id,p.lines);
  if(returned.stockEntryId)await tx.update(salesNote).set({stockEntryId:returned.stockEntryId}).where(eq(salesNote.id,id));
  if(prior.kind==='credit'&&Dec.of(p.applyAmount).gt('0')){
   const invoiceBills=(await this.bills.list(tx,entityId,{partyId:prior.customerId,side:'receivable',currency:prior.currency})).filter(b=>b.sourceType==='sales_invoice'&&b.sourceId===prior.originalInvoiceId&&Dec.of(b.openAmount).gt('0'));
   let left=Dec.of(p.applyAmount);const allocations=invoiceBills.map(b=>{const amount=Dec.of(b.openAmount).gt(left)?left:Dec.of(b.openAmount);left=left.sub(amount);return {billId:b.id,amount:amount.toString()};}).filter(a=>Dec.of(a.amount).gt('0'));
   await this.credits.applyIn(tx,ctx,entityId,{creditNoteId:id,postingDate:prior.postingDate,allocations,sourceId:id,automatic:true});
  }
  await this.bills.assertReconciledIn(tx,entityId);
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'sales_note.submit',targetType:'sales_note',targetId:id,after:{number,grandTotal:refreshed.grandTotal,stockEntryId:returned.stockEntryId}},tx);
  return this.getIn(tx,ctx,entityId,id);
 }
 async cancelIn(tx:Tx,ctx:TenantRequestContext,entityId:string,id:string,reason:string){
 await lockAccounting(tx,entityId);await guardSandboxSourceIn(tx,ctx,entityId,'sales_note',id);
  await lockAccounting(tx,entityId);const note=await this.noteIn(tx,ctx,entityId,id,true);
  if(note.status!=='submitted')throw new ConflictException('Only submitted notes can be cancelled');
  if(note.kind==='debit')await this.preview.assertDebitCancellableIn(tx,ctx,entityId,id,note.originalInvoiceId);
  const dependencies=await tx.select().from(settlementAllocationDocument).where(and(eq(settlementAllocationDocument.entityId,entityId),eq(settlementAllocationDocument.creditNoteId,id),eq(settlementAllocationDocument.status,'submitted')));
  if(dependencies.length)throw new ConflictException(`Reverse applications ${dependencies.map(d=>d.number).join(', ')} first`);
  await this.credits.reverseIn(tx,ctx,entityId,id,reason);
  await this.gl.reverseIn(tx,ctx,entityId,{type:'sales_note',id,purpose:'main'},reason);
  await this.bills.reverseSourceEffects(tx,ctx,entityId,'sales_note',id,businessDate());
  await this.returns.cancelIn(tx,ctx,entityId,id,reason);
  await tx.update(salesNote).set({status:'cancelled',cancelledBy:ctx.user.id,cancelledAt:new Date(),cancelReason:reason,updatedAt:new Date()}).where(eq(salesNote.id,id));
  await this.bills.assertReconciledIn(tx,entityId);
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'sales_note.cancel',targetType:'sales_note',targetId:id,reason},tx);
 }
 async deleteIn(tx:Tx,ctx:TenantRequestContext,entityId:string,id:string){await lockAccounting(tx,entityId);const note=await this.noteIn(tx,ctx,entityId,id,true);if(note.status!=='draft')throw new ConflictException('Only drafts can be deleted');await tx.delete(salesNote).where(eq(salesNote.id,id));await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'sales_note.delete',targetType:'sales_note',targetId:id},tx);}
}
