import {assertReturnActivityDateIn} from './activity-date.js';
import {pendingSegmentsIn} from './pending-segments.js';
import {returnAccountsIn} from './return-accounts.js';
import {Dec,splitAcquisitionCost,type AccountingLine} from '@factoryos/core';
import {glAccount,stockEntry,stockEntryLine,supplierReturnEffect,supplierAcceptanceEffect,supplierResolutionEffect,warehouse} from '@factoryos/db';
import {Injectable,BadRequestException,ConflictException,ForbiddenException,NotFoundException} from '@nestjs/common';
import {and,eq,inArray,isNull} from 'drizzle-orm';
import type {TenantRequestContext} from '../../common/access.js';
import {AuditService} from '../../common/audit.service.js';
import {businessDate,lockAccounting,type Tx} from '../accounting/accounting-lock.js';
import {StockPostingService} from '../stock-posting.service.js';
import {GlPostingService} from '../accounting/gl-posting.service.js';
import {SupplierReturnClaimService} from './claim.service.js';
import type {ResolutionInput} from './contracts.js';
@Injectable()
export class SupplierReturnResolutionService {
 constructor(private readonly claims:SupplierReturnClaimService,private readonly stock:StockPostingService,private readonly gl:GlPostingService,private readonly audit:AuditService){}
 async postIn(tx:Tx,ctx:TenantRequestContext,e:string,id:string,input:ResolutionInput){
 if(input.kind==='acceptance_reversal')throw new BadRequestException('Reverse the linked supplier note through its cancellation action');
 const permission=input.kind==='receive_back'?'buying.return_movement.create':'buying.return_resolution.create';if(!ctx.tenant.permissions.has(permission))throw new ForbiddenException('Supplier return resolution permission required');
 await lockAccounting(tx,e);const claim=await this.claims.getIn(tx,ctx,e,id);if(claim.status!=='submitted')throw new ConflictException('Only submitted claims can be resolved');
 const cl=claim.lines.find(x=>x.id===input.claimLineId);if(!cl)throw new NotFoundException('Claim line not found');
 const [effect]=await tx.select().from(supplierReturnEffect).where(and(eq(supplierReturnEffect.id,input.returnEffectId),eq(supplierReturnEffect.claimLineId,cl.id),eq(supplierReturnEffect.entityId,e),eq(supplierReturnEffect.tenantId,ctx.tenant.tenantId),isNull(supplierReturnEffect.reversalOf)));
 if(!effect)throw new NotFoundException('Original return evidence not found');
 const [entry]=await tx.select().from(stockEntry).where(eq(stockEntry.id,effect.stockEntryId));if(!entry||entry.status!=='submitted')throw new ConflictException('Original dispatch is not live');
 if(input.postingDate<entry.postingDate||input.postingDate>businessDate())throw new BadRequestException('Resolution date must be from dispatch through today');
 await assertReturnActivityDateIn(tx,e,cl.id,input.postingDate);
 const segments=await pendingSegmentsIn(tx,e,cl.id),segment=segments.find(x=>x.returnEffectId===effect.id);const qty=Dec.of(input.qty);if(!segment||!segment.qty.gt('0')||qty.gt(segment.qty))throw new ConflictException('Resolution exceeds this dispatch unresolved quantity');const value=qty.eq(segment.qty)?segment.value:segment.value.mul(qty).div(segment.qty);
 let stockEntryId:string|null=null,represented=value;
 if(input.kind==='receive_back'){
 const [wh]=await tx.select().from(warehouse).where(and(eq(warehouse.id,input.warehouseId),eq(warehouse.entityId,e),eq(warehouse.tenantId,ctx.tenant.tenantId),eq(warehouse.isActive,true)));if(!wh)throw new NotFoundException('Receive-back warehouse not found');
 const [original]=await tx.select().from(stockEntryLine).where(eq(stockEntryLine.id,effect.receiptLineId));if(!original)throw new ConflictException('Original item/batch evidence missing');
 const [receipt]=await tx.insert(stockEntry).values({tenantId:ctx.tenant.tenantId,entityId:e,purpose:'purchase_return_receipt',postingDate:input.postingDate,partyId:claim.supplierId,reference:claim.number,remarks:input.reason,systemGenerated:true,createdBy:ctx.user.id}).returning();
 const cost=splitAcquisitionCost({amount:value.toString(),quantity:qty.toString(),remaining:qty.toString(),oldRate:'0'});
 await tx.insert(stockEntryLine).values({entryId:receipt!.id,lineNo:1,itemId:original.itemId,batchId:original.batchId,qty:qty.toString(),rate:cost.newRate,toWarehouseId:wh.id});await this.stock.submitIn(tx,ctx,e,receipt!.id);stockEntryId=receipt!.id;represented=Dec.of(cost.inventory);
 }
 const [resolution]=await tx.insert(supplierResolutionEffect).values({tenantId:ctx.tenant.tenantId,entityId:e,claimLineId:cl.id,returnEffectId:effect.id,kind:input.kind,qty:qty.toString(),valueInr:value.toFixed(6),postingDate:input.postingDate,reason:input.reason,stockEntryId,createdBy:ctx.user.id}).returning();
 const selected=await returnAccountsIn(tx,ctx,e,cl.id);const account=(role:string)=>role==='pending_returns'?selected.pending:role==='inventory'?selected.inventory:role==='return_variance'?selected.variance:selected.rounding;
 const plan:AccountingLine[]=[];if(!represented.isZero())plan.push({accountId:account(input.kind==='write_off'?'return_variance':'inventory'),debit:represented.toFixed(6),credit:'0'});if(!value.isZero())plan.push({accountId:account('pending_returns'),debit:'0',credit:value.toFixed(6)});const residual=value.sub(represented);if(!residual.isZero())plan.push({accountId:account('rounding'),debit:residual.gt('0')?residual.toFixed(6):'0',credit:residual.lt('0')?residual.neg().toFixed(6):'0'});
 let voucherId:string|null;
 if(stockEntryId){const posted=await this.gl.postIn(tx,ctx,e,{type:'purchase_return_receipt',id:stockEntryId,purpose:'main',number:claim.number,evidenceVoucherIds:selected.evidenceVoucherIds},input.postingDate,{lines:plan,disposition:plan.length?'posted':'no_value_change'});voucherId=posted.voucherId;await this.gl.postIn(tx,ctx,e,{type:'supplier_return_resolution',id:resolution!.id,purpose:'main'},input.postingDate,{lines:[],disposition:'no_value_change'});}
 else{const posted=await this.gl.postIn(tx,ctx,e,{type:'supplier_return_resolution',id:resolution!.id,purpose:'main',number:claim.number,evidenceVoucherIds:selected.evidenceVoucherIds},input.postingDate,{lines:plan,disposition:plan.length?'posted':'no_value_change'});voucherId=posted.voucherId;}
 // Resolution evidence stays immutable: its voucher is found by source identity.
 await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId:e,action:'supplier_return_claim.resolve',targetType:'supplier_return_claim',targetId:id,reason:input.reason,after:{resolutionId:resolution!.id,kind:input.kind,qty:input.qty,valueInr:value.toFixed(6),voucherId,stockEntryId}},tx);return {...resolution!,voucherId};
 }
 async cancelIn(tx:Tx,ctx:TenantRequestContext,e:string,id:string,reason:string){await lockAccounting(tx,e);const [r]=await tx.select().from(supplierResolutionEffect).where(and(eq(supplierResolutionEffect.id,id),eq(supplierResolutionEffect.entityId,e),eq(supplierResolutionEffect.tenantId,ctx.tenant.tenantId),isNull(supplierResolutionEffect.reversalOf)));if(!r)throw new NotFoundException('Supplier return resolution not found');if(r.kind==='acceptance_reversal')throw new ConflictException('Acceptance reversal evidence belongs to its supplier-note cancellation');const [reversed]=await tx.select().from(supplierResolutionEffect).where(eq(supplierResolutionEffect.reversalOf,id));if(reversed)throw new ConflictException('Resolution already reversed');if(r.stockEntryId)await this.stock.cancelIn(tx,ctx,e,r.stockEntryId,reason);await this.gl.reverseIn(tx,ctx,e,{type:'supplier_return_resolution',id,purpose:'main'},reason);await tx.insert(supplierResolutionEffect).values({...r,id:undefined,qty:Dec.of(r.qty).neg().toString(),valueInr:Dec.of(r.valueInr).neg().toString(),postingDate:businessDate(),reason,reversalOf:id,createdBy:ctx.user.id,createdAt:new Date()});await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId:e,action:'supplier_return_resolution.cancel',targetType:'supplier_resolution_effect',targetId:id,reason},tx);return {ok:true};}
}
