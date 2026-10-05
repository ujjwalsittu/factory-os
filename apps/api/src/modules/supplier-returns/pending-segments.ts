import {Dec} from '@factoryos/core';
import {supplierReturnEffect,supplierAcceptanceEffect,supplierResolutionEffect} from '@factoryos/db';
import {and,eq} from 'drizzle-orm';
import {ConflictException} from '@nestjs/common';
import type {Tx} from '../accounting/accounting-lock.js';
/** Assign acceptance and resolution to exact dispatch carrying evidence, in ledger order. */
export async function pendingSegmentsIn(tx:Tx,e:string,claimLineId:string){
 const returns=await tx.select().from(supplierReturnEffect).where(and(eq(supplierReturnEffect.entityId,e),eq(supplierReturnEffect.claimLineId,claimLineId)));
 const accepts=await tx.select().from(supplierAcceptanceEffect).where(and(eq(supplierAcceptanceEffect.entityId,e),eq(supplierAcceptanceEffect.claimLineId,claimLineId)));
 const resolutions=await tx.select().from(supplierResolutionEffect).where(and(eq(supplierResolutionEffect.entityId,e),eq(supplierResolutionEffect.claimLineId,claimLineId)));
 const reversedReturns=new Set(returns.filter(x=>x.reversalOf).map(x=>x.reversalOf)),reversedAccepts=new Set(accepts.filter(x=>x.reversalOf).map(x=>x.reversalOf));const liveAccepts=accepts.filter(x=>!x.reversalOf&&!reversedAccepts.has(x.id));
 if(liveAccepts.some(x=>Dec.of(x.pendingValueInr).gt('0')&&!x.pendingReturns.length))throw new ConflictException('Legacy acceptance carrying attribution requires Finance review');
 return returns.filter(x=>!x.reversalOf&&!reversedReturns.has(x.id)).sort((a,b)=>a.ledgerSeq-b.ledgerSeq).map(r=>{const links=liveAccepts.flatMap(a=>a.pendingReturns).filter(a=>a.returnEffectId===r.id),resolved=resolutions.filter(x=>x.returnEffectId===r.id);const qty=Dec.of(r.qty).sub(r.preAcceptedQty).sub(links.reduce((s,x)=>s.add(x.qty),Dec.ZERO)).sub(resolved.reduce((s,x)=>s.add(x.qty),Dec.ZERO));const value=Dec.of(r.valueInr).sub(r.preAcceptedValueInr).sub(links.reduce((s,x)=>s.add(x.valueInr),Dec.ZERO)).sub(resolved.reduce((s,x)=>s.add(x.valueInr),Dec.ZERO));if(qty.lt('0')||value.lt('0'))throw new ConflictException('Return carrying evidence is inconsistent');return {returnEffectId:r.id,qty,value};});
}
