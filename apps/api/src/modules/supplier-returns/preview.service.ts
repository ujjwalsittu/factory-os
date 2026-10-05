import {pendingSegmentsIn} from './pending-segments.js';
import {Dec,allocateNoteComponents,type TaxComponents} from '@factoryos/core';
import {supplierNote,supplierNoteLine,supplierReturnClaimLine,supplierReturnClaim,supplierReturnEffect,supplierAcceptanceEffect,supplierResolutionEffect} from '@factoryos/db';
import {BadRequestException,ConflictException,Injectable,NotFoundException} from '@nestjs/common';
import {and,eq,ne} from 'drizzle-orm';
import type {TenantRequestContext} from '../../common/access.js';
import {businessDate,type Tx} from '../accounting/accounting-lock.js';
import {BillService} from '../accounting/bill.service.js';
import {SupplierReturnClaimService} from './claim.service.js';
import type {SupplierNoteInput,SupplierNotePreview} from './contracts.js';
const keys=['taxableValue','cgst','sgst','igst','cess'] as const;
@Injectable()
export class SupplierNotePreviewService {
 constructor(private readonly claims:SupplierReturnClaimService,private readonly bills:BillService){}
 async calculateIn(tx:Tx,ctx:TenantRequestContext,e:string,input:SupplierNoteInput,excludeId?:string):Promise<SupplierNotePreview>{
 const {invoice,lines}=await this.claims.sourceIn(tx,ctx,e,input.invoiceId);
 if(input.postingDate<invoice.postingDate||input.postingDate>businessDate()||input.supplierNoteDate>input.postingDate||input.supplierNoteDate<invoice.supplierInvoiceDate)throw new BadRequestException('Supplier note dates must be from source through today');
 if(input.taxTreatment==='gst'){
 if(!input.taxEligibilityConfirmed)throw new BadRequestException('Finance must confirm documented GST eligibility');
 if(invoice.reverseCharge||invoice.supplyType.startsWith('import'))throw new ConflictException('Customs ITC and RCM adjustment require separate workflows; use commercial treatment');
 }
 const existing=await tx.select({n:supplierNote,l:supplierNoteLine}).from(supplierNoteLine).innerJoin(supplierNote,eq(supplierNote.id,supplierNoteLine.noteId)).where(and(eq(supplierNote.tenantId,ctx.tenant.tenantId),eq(supplierNote.entityId,e),eq(supplierNote.originalInvoiceId,invoice.id),eq(supplierNote.status,'submitted'),excludeId?ne(supplierNote.id,excludeId):undefined));
 const seen=new Set<string>(),output:SupplierNotePreview['lines']=[];
 for(const l of input.lines){const original=lines.find(x=>x.id===l.invoiceLineId);if(!original||seen.has(l.invoiceLineId))throw new BadRequestException('Choose unique original invoice lines');seen.add(l.invoiceLineId);
 const prior=existing.filter(x=>x.l.invoiceLineId===l.invoiceLineId);
 const sum=(kind:string,k:typeof keys[number],gstOnly=false)=>prior.filter(x=>x.n.kind===kind&&(!gstOnly||x.n.taxTreatment==='gst')).reduce((s,x)=>s.add(k==='taxableValue'?x.l.taxableAmount:x.l[k]),Dec.ZERO);
 const originalValue=Dec.of(original.taxableValue??'0');const financial=originalValue.add(sum('debit','taxableValue')).sub(sum('credit','taxableValue'));
 const quantityUsed=prior.filter(x=>x.n.kind==='credit'&&x.l.mode==='quantity').reduce((s,x)=>s.add(x.l.qty),Dec.ZERO);
 const remainingQty=Dec.of(original.qty).sub(quantityUsed);
 let taxable=Dec.of(l.taxableAmount),qty=Dec.ZERO;
 if(l.mode==='quantity'){qty=Dec.of(l.qty);if(!qty.gt('0')||qty.gt(remainingQty))throw new ConflictException('Supplier credit quantity exceeds remaining original quantity');taxable=qty.eq(remainingQty)&&input.kind==='credit'?originalValue.sub(prior.filter(x=>x.n.kind==='credit'&&x.l.mode==='quantity').reduce((s,x)=>s.add(x.l.taxableAmount),Dec.ZERO)):originalValue.mul(qty).div(original.qty);taxable=Dec.of(taxable.toFixed(2));}
 if(!taxable.gt('0'))throw new BadRequestException('Supplier financial notes require a positive value');
 if(input.kind==='credit'&&taxable.gt(financial))throw new ConflictException('Supplier credit exceeds remaining financial value');
 const components:TaxComponents={taxableValue:taxable.toFixed(2),cgst:'0.00',sgst:'0.00',igst:'0.00',cess:'0.00'};
 if(input.taxTreatment==='gst'){
 const base=originalValue.add(sum('debit','taxableValue',true)),remaining=base.sub(sum('credit','taxableValue',true));
 if(input.kind==='credit'&&taxable.gt(remaining))throw new ConflictException('Supplier GST credit exceeds original GST base');
 const total:TaxComponents={taxableValue:base.toString(),cgst:Dec.of(original.cgst??'0').add(sum('debit','cgst',true)).toString(),sgst:Dec.of(original.sgst??'0').add(sum('debit','sgst',true)).toString(),igst:Dec.of(original.igst??'0').add(sum('debit','igst',true)).toString(),cess:Dec.of(original.cess??'0').add(sum('debit','cess',true)).toString()};
 const residual:TaxComponents={...total};for(const k of keys)residual[k]=Dec.of(total[k]).sub(sum('credit',k,true)).toString();
 if(input.kind==='credit'){const allocated=allocateNoteComponents(total,residual,taxable.toString(),base.toString(),taxable.eq(remaining));Object.assign(components,allocated,{taxableValue:taxable.toFixed(2)});}else{if(!originalValue.gt('0'))throw new ConflictException('Original tax base is unavailable');for(const k of ['cgst','sgst','igst','cess'] as const)components[k]=Dec.of(original[k]??'0').mul(taxable).div(originalValue).toFixed(2);}
 }
 let pending=Dec.ZERO;const pendingReturns:{returnEffectId:string;qty:string;valueInr:string}[]=[];
 if(l.claimLineId){const [claimLine]=await tx.select({l:supplierReturnClaimLine,c:supplierReturnClaim}).from(supplierReturnClaimLine).innerJoin(supplierReturnClaim,eq(supplierReturnClaim.id,supplierReturnClaimLine.claimId)).where(and(eq(supplierReturnClaimLine.id,l.claimLineId),eq(supplierReturnClaimLine.entityId,e),eq(supplierReturnClaimLine.tenantId,ctx.tenant.tenantId)));
 if(!claimLine||claimLine.l.invoiceLineId!==l.invoiceLineId||claimLine.c.originalInvoiceId!==invoice.id)throw new NotFoundException('Matching claim line not found');
 if(claimLine.c.status!=='submitted'||!claimLine.c.approvedBy||input.kind!=='credit')throw new ConflictException('Acceptance requires an approved submitted claim and credit note');
 const accept=await tx.select().from(supplierAcceptanceEffect).where(and(eq(supplierAcceptanceEffect.entityId,e),eq(supplierAcceptanceEffect.claimLineId,l.claimLineId)));
 const acceptedQty=accept.reduce((s,x)=>s.add(x.qty),Dec.ZERO),acceptedValue=accept.reduce((s,x)=>s.add(x.taxableAmount),Dec.ZERO);
 if(taxable.gt(Dec.of(claimLine.l.taxableAmount).sub(acceptedValue))||qty.gt(Dec.of(claimLine.l.qty).sub(acceptedQty)))throw new ConflictException('Supplier acceptance exceeds unresolved claim');
 const segments=await pendingSegmentsIn(tx,e,l.claimLineId);let left=qty;for(const segment of segments){if(!left.gt('0')||!segment.qty.gt('0'))continue;const take=Dec.min(left,segment.qty),value=take.eq(segment.qty)?segment.value:segment.value.mul(take).div(segment.qty);pendingReturns.push({returnEffectId:segment.returnEffectId,qty:take.toFixed(6),valueInr:value.toFixed(6)});pending=pending.add(value);left=left.sub(take);}
 }
 output.push({invoiceLineId:l.invoiceLineId,...(l.claimLineId?{claimLineId:l.claimLineId}:{}),qty:qty.toFixed(6),taxableAmount:components.taxableValue,cgst:components.cgst,sgst:components.sgst,igst:components.igst,cess:components.cess,pendingValueInr:pending.toFixed(6),pendingReturns,varianceInr:taxable.mul(invoice.exchangeRate).sub(pending).toFixed(6),remainingQty:remainingQty.toFixed(6),remainingTaxable:financial.toFixed(2)});
 }
 const totals:TaxComponents={taxableValue:'0',cgst:'0',sgst:'0',igst:'0',cess:'0'};for(const k of keys)totals[k]=output.reduce((s,l)=>s.add(k==='taxableValue'?l.taxableAmount:l[k]),Dec.ZERO).toFixed(2);
 await this.bills.syncIn(tx,ctx,e);const bills=await this.bills.list(tx,e,{partyId:invoice.supplierId,side:'payable',currency:invoice.currency});const sourceBill=bills.find(x=>x.sourceType==='purchase_invoice'&&x.sourceId===invoice.id);
 if(!sourceBill)throw new ConflictException('Original supplier bill evidence missing');
 return {...totals,grandTotal:Object.values(totals).reduce((s,x)=>s.add(x),Dec.ZERO).toFixed(2),currency:invoice.currency,exchangeRate:invoice.exchangeRate,sourceBillId:sourceBill.id,lines:output};
 }
}
