import {returnAccountsIn} from './return-accounts.js';
import {consumeFifo,Dec,type AccountingLine} from '@factoryos/core';
import {fifoLayer,fifoConsumption,glAccount,item,receiptInvoiceAllocation,stockBin,stockEntry,stockEntryLine,stockLedgerEntry,supplierReturnClaimLine,supplierReturnEffect,supplierAcceptanceEffect,supplierResolutionEffect,warehouse} from '@factoryos/db';
import {Injectable,BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {and,eq,asc,gt,isNull,inArray} from 'drizzle-orm';
import type {TenantRequestContext} from '../../common/access.js';
import {AuditService} from '../../common/audit.service.js';
import {businessDate,lockAccounting,type Tx} from '../accounting/accounting-lock.js';
import {GlPostingService} from '../accounting/gl-posting.service.js';
import {StockPostingService} from '../stock-posting.service.js';
import {SupplierReturnClaimService} from './claim.service.js';
import type {DispatchInput,MovementResult} from './contracts.js';
@Injectable()
export class SupplierReturnMovementService {
 constructor(private readonly claims:SupplierReturnClaimService,private readonly stock:StockPostingService,private readonly gl:GlPostingService,private readonly audit:AuditService){}
 async previewDispatchIn(tx:Tx,ctx:TenantRequestContext,e:string,id:string,input:DispatchInput){
 await lockAccounting(tx,e);const claim=await this.claims.getIn(tx,ctx,e,id);const source=await this.claims.sourceIn(tx,ctx,e,claim.originalInvoiceId);
 if(claim.status!=='submitted'||!claim.approvedBy)throw new ConflictException('An approved submitted claim is required');
 if(input.postingDate<claim.postingDate||input.postingDate>businessDate())throw new BadRequestException('Return date must be from claim through today');
 const seen=new Set<string>(),staged=new Map<string,Dec>();const results=[];
 for(const l of input.lines){if(seen.has(l.claimLineId))throw new BadRequestException('Dispatch each claim line once');seen.add(l.claimLineId);
 const cl=claim.lines.find(x=>x.id===l.claimLineId);if(!cl)throw new NotFoundException('Claim line not found');
 const il=source.lines.find(x=>x.id===cl.invoiceLineId)!;
 const [allocation]=await tx.select().from(receiptInvoiceAllocation).where(and(eq(receiptInvoiceAllocation.id,l.receiptAllocationId),eq(receiptInvoiceAllocation.entityId,e),eq(receiptInvoiceAllocation.tenantId,ctx.tenant.tenantId),eq(receiptInvoiceAllocation.invoiceId,source.invoice.id),eq(receiptInvoiceAllocation.receiptLineId,l.receiptLineId),isNull(receiptInvoiceAllocation.reversalOf)));
 const [receipt]=await tx.select({l:stockEntryLine,s:stockEntry}).from(stockEntryLine).innerJoin(stockEntry,eq(stockEntry.id,stockEntryLine.entryId)).where(and(eq(stockEntryLine.id,l.receiptLineId),eq(stockEntry.entityId,e),eq(stockEntry.tenantId,ctx.tenant.tenantId)));
 if(!allocation||!receipt||receipt.s.status!=='submitted'||receipt.l.itemId!==il.itemId||receipt.l.poLineId!==il.poLineId||receipt.l.ownerPartyId)throw new NotFoundException('Original company-owned receipt allocation not found');
 const [wh]=await tx.select().from(warehouse).where(and(eq(warehouse.id,l.warehouseId),eq(warehouse.entityId,e),eq(warehouse.tenantId,ctx.tenant.tenantId),eq(warehouse.isActive,true)));
 if(!wh)throw new NotFoundException('Return warehouse not found');
 const returns=await tx.select().from(supplierReturnEffect).where(and(eq(supplierReturnEffect.entityId,e),eq(supplierReturnEffect.tenantId,ctx.tenant.tenantId)));
 const claimUsed=returns.filter(x=>x.claimLineId===cl.id).reduce((s,x)=>s.add(x.qty),Dec.ZERO);
 const invoiceUsed=returns.filter(x=>x.invoiceLineId===il.id).reduce((s,x)=>s.add(x.qty),Dec.ZERO);
 const allocationUsed=returns.filter(x=>x.receiptAllocationId===allocation.id).reduce((s,x)=>s.add(x.qty),Dec.ZERO);
 const q=Dec.of(l.qty);if(q.gt(Dec.of(cl.qty).sub(claimUsed))||q.gt(Dec.of(il.qty).sub(invoiceUsed))||q.gt(Dec.of(allocation.qty).sub(allocationUsed)))throw new ConflictException('Return exceeds remaining claim, invoice or receipt quantity');
 const acceptance=await tx.select().from(supplierAcceptanceEffect).where(and(eq(supplierAcceptanceEffect.entityId,e),eq(supplierAcceptanceEffect.claimLineId,cl.id)));
 const accepted=acceptance.reduce((s,x)=>s.add(x.qty),Dec.ZERO);
 if(claim.policySnapshot?.dispatchApproval==='acceptance_required'&&q.gt(accepted.sub(claimUsed)))throw new ConflictException('Supplier acceptance is required before dispatch');
 const [bin]=await tx.select().from(stockBin).where(and(eq(stockBin.entityId,e),eq(stockBin.itemId,il.itemId),eq(stockBin.warehouseId,wh.id),receipt.l.batchId?eq(stockBin.batchId,receipt.l.batchId):isNull(stockBin.batchId),isNull(stockBin.ownerPartyId)));
 if(!bin||q.gt(bin.qty))throw new ConflictException('Insufficient goods at the return warehouse');
 const layers=await tx.select().from(fifoLayer).where(and(eq(fifoLayer.entityId,e),eq(fifoLayer.itemId,il.itemId),receipt.l.batchId?eq(fifoLayer.batchId,receipt.l.batchId):isNull(fifoLayer.batchId),gt(fifoLayer.qtyRemaining,'0'))).orderBy(asc(fifoLayer.postingDate),asc(fifoLayer.sourceSeq)).for('update');
 const available=layers.map(x=>({id:x.id,qty:Dec.of(x.qtyRemaining).sub(staged.get(x.id)??Dec.ZERO),rate:Dec.of(x.rate)}));
 let consumed;try{consumed=consumeFifo(available,q)}catch{throw new ConflictException('Insufficient FIFO goods for return')}
 for(const x of consumed.consumed)staged.set(x.layerId,(staged.get(x.layerId)??Dec.ZERO).add(x.qty));
 const preAcceptedQty=Dec.min(q,accepted.gt(claimUsed)?accepted.sub(claimUsed):Dec.ZERO),preAcceptedValue=preAcceptedQty.eq(q)?consumed.value:consumed.value.mul(preAcceptedQty).div(q);
 const reversed=new Set(acceptance.filter(x=>x.reversalOf).map(x=>x.reversalOf));const liveAcceptances=acceptance.filter(x=>!x.reversalOf&&!reversed.has(x.id)).sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime());let skip=claimUsed,left=preAcceptedQty,costLeft=preAcceptedValue;const preAcceptances:{acceptanceEffectId:string;qty:string;valueInr:string}[]=[];
 for(const a of liveAcceptances){let available=Dec.of(a.qty);if(skip.gt('0')){const used=Dec.min(skip,available);available=available.sub(used);skip=skip.sub(used);}if(!available.gt('0')||!left.gt('0'))continue;const take=Dec.min(available,left),cost=take.eq(left)?costLeft:preAcceptedValue.mul(take).div(preAcceptedQty);preAcceptances.push({acceptanceEffectId:a.id,qty:take.toFixed(6),valueInr:cost.toFixed(6)});left=left.sub(take);costLeft=costLeft.sub(cost);}
 if(!left.isZero())throw new ConflictException('Preaccepted quantity evidence is incomplete');
 results.push({...l,preAcceptedQty:preAcceptedQty.toFixed(6),preAcceptedValueInr:preAcceptedValue.toFixed(6),preAcceptances,invoiceLineId:il.id,itemId:il.itemId,batchId:receipt.l.batchId,valueInr:consumed.value.toFixed(6),consumptions:consumed.consumed.map(x=>({layerId:x.layerId,qty:x.qty.toString(),rate:x.rate.toString()}))});
 }
 return {qty:input.lines.reduce((s,x)=>s.add(x.qty),Dec.ZERO).toFixed(6),valueInr:results.reduce((s,x)=>s.add(x.valueInr),Dec.ZERO).toFixed(6),lines:results};
 }
 async dispatchIn(tx:Tx,ctx:TenantRequestContext,e:string,id:string,input:DispatchInput):Promise<MovementResult>{
 const p=await this.previewDispatchIn(tx,ctx,e,id,input),claim=await this.claims.claimIn(tx,ctx,e,id);
 const [entry]=await tx.insert(stockEntry).values({tenantId:ctx.tenant.tenantId,entityId:e,purpose:'purchase_return',postingDate:input.postingDate,partyId:claim.supplierId,reference:claim.number,remarks:input.reason,systemGenerated:true,createdBy:ctx.user.id}).returning();
 await tx.insert(stockEntryLine).values(p.lines.map((l,i)=>({entryId:entry!.id,lineNo:i+1,itemId:l.itemId,qty:l.qty,batchId:l.batchId,fromWarehouseId:l.warehouseId})));
 await this.stock.submitIn(tx,ctx,e,entry!.id);
 const rows=await tx.select({s:stockLedgerEntry,l:stockEntryLine}).from(stockLedgerEntry).innerJoin(stockEntryLine,eq(stockEntryLine.id,stockLedgerEntry.voucherLineId)).where(and(eq(stockLedgerEntry.voucherId,entry!.id),eq(stockLedgerEntry.entityId,e),eq(stockLedgerEntry.isReversal,false))).orderBy(asc(stockEntryLine.lineNo));
 const ids:string[]=[];for(const row of rows){const l=p.lines[row.l.lineNo-1]!;if(!Dec.of(row.s.value).neg().eq(l.valueInr))throw new ConflictException('FIFO return preview changed');const [effect]=await tx.insert(supplierReturnEffect).values({tenantId:ctx.tenant.tenantId,entityId:e,claimLineId:l.claimLineId,invoiceLineId:l.invoiceLineId,receiptAllocationId:l.receiptAllocationId,receiptLineId:l.receiptLineId,stockEntryId:entry!.id,ledgerSeq:row.s.seq,warehouseId:l.warehouseId,qty:l.qty,valueInr:l.valueInr,preAcceptedQty:l.preAcceptedQty,preAcceptedValueInr:l.preAcceptedValueInr,preAcceptances:l.preAcceptances,consumptions:l.consumptions}).returning();ids.push(effect!.id);}
 const selected=await returnAccountsIn(tx,ctx,e);const pending={id:selected.pending},inventory={id:selected.inventory};
 const value=Dec.of(p.valueInr),preAccepted=p.lines.reduce((s,x)=>s.add(x.preAcceptedValueInr),Dec.ZERO),pendingValue=value.sub(preAccepted);const variance={id:selected.variance};const plan:AccountingLine[]=[];
 if(!value.isZero()){if(!pending||!inventory)throw new ConflictException('Configure pending-return and inventory accounts');if(!pendingValue.isZero())plan.push({accountId:pending.id,debit:pendingValue.toString(),credit:'0'});if(!preAccepted.isZero()){if(!variance)throw new ConflictException('Configure return variance account');plan.push({accountId:variance.id,debit:preAccepted.toString(),credit:'0'});}plan.push({accountId:inventory.id,debit:'0',credit:value.toString()});}
 await this.gl.postIn(tx,ctx,e,{type:'purchase_return',id:entry!.id,purpose:'main',number:entry!.number},input.postingDate,{lines:plan,disposition:plan.length?'posted':'no_value_change'});
 await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId:e,action:'supplier_return_claim.dispatch',targetType:'supplier_return_claim',targetId:id,reason:input.reason,after:{stockEntryId:entry!.id,qty:p.qty,valueInr:p.valueInr}},tx);
 return {stockEntryId:entry!.id,qty:p.qty,valueInr:p.valueInr,evidenceIds:ids};
 }
 async cancelIn(tx:Tx,ctx:TenantRequestContext,e:string,id:string,reason:string){await lockAccounting(tx,e);const effects=await tx.select().from(supplierReturnEffect).where(and(eq(supplierReturnEffect.stockEntryId,id),eq(supplierReturnEffect.entityId,e),eq(supplierReturnEffect.tenantId,ctx.tenant.tenantId),isNull(supplierReturnEffect.reversalOf)));if(!effects.length)throw new NotFoundException('Supplier return movement not found');for(const f of effects){const [reversed]=await tx.select().from(supplierReturnEffect).where(eq(supplierReturnEffect.reversalOf,f.id));if(reversed)throw new ConflictException('Movement already cancelled');const acceptance=await tx.select().from(supplierAcceptanceEffect).where(and(eq(supplierAcceptanceEffect.entityId,e),eq(supplierAcceptanceEffect.claimLineId,f.claimLineId)));if(acceptance.reduce((s,x)=>s.add(x.qty).add(x.taxableAmount),Dec.ZERO).gt('0'))throw new ConflictException('Reverse dependent supplier acceptances first');}
 for(const f of effects){const resolutions=await tx.select().from(supplierResolutionEffect).where(and(eq(supplierResolutionEffect.entityId,e),eq(supplierResolutionEffect.returnEffectId,f.id)));if(resolutions.filter(x=>x.kind!=='acceptance_reversal').reduce((s,x)=>s.add(x.qty),Dec.ZERO).gt('0'))throw new ConflictException('Reverse dependent supplier return resolutions first');const reversed=new Set(resolutions.filter(x=>x.reversalOf).map(x=>x.reversalOf));for(const r of resolutions.filter(x=>x.kind==='acceptance_reversal'&&!x.reversalOf&&!reversed.has(x.id))){await this.gl.reverseIn(tx,ctx,e,{type:'supplier_return_resolution',id:r.id,purpose:'main'},reason);await tx.insert(supplierResolutionEffect).values({...r,id:undefined,qty:Dec.of(r.qty).neg().toString(),valueInr:Dec.of(r.valueInr).neg().toString(),postingDate:businessDate(),reason,createdBy:ctx.user.id,reversalOf:r.id,createdAt:new Date()});}}
 await this.stock.cancelIn(tx,ctx,e,id,reason);for(const f of effects)await tx.insert(supplierReturnEffect).values({...f,id:undefined,qty:Dec.of(f.qty).neg().toString(),valueInr:Dec.of(f.valueInr).neg().toString(),preAcceptedQty:Dec.of(f.preAcceptedQty).neg().toString(),preAcceptedValueInr:Dec.of(f.preAcceptedValueInr).neg().toString(),reversalOf:f.id,createdAt:new Date()});await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId:e,action:'supplier_return_movement.cancel',targetType:'stock_entry',targetId:id,reason},tx);return {ok:true};}
}
