import {supplierReturnEffect,stockEntry,supplierAcceptanceEffect,supplierNoteLine,supplierNote,supplierResolutionEffect} from '@factoryos/db';
import {and,eq,sql} from 'drizzle-orm';
import {ConflictException} from '@nestjs/common';
import type {Tx} from '../accounting/accounting-lock.js';
/** Current balances cannot be spent before the activity (including reversal) that supplied them. */
export async function assertReturnActivityDateIn(tx:Tx,e:string,claimLineId:string,postingDate:string){
 const [movement]=await tx.select({day:sql<string|null>`max(case when ${supplierReturnEffect.reversalOf} is null then ${stockEntry.postingDate} else timezone('Asia/Kolkata',${stockEntry.cancelledAt})::date end)`}).from(supplierReturnEffect).innerJoin(stockEntry,eq(stockEntry.id,supplierReturnEffect.stockEntryId)).where(and(eq(supplierReturnEffect.entityId,e),eq(supplierReturnEffect.claimLineId,claimLineId)));
 const [acceptance]=await tx.select({day:sql<string|null>`max(case when ${supplierAcceptanceEffect.reversalOf} is null then ${supplierNote.postingDate} else timezone('Asia/Kolkata',${supplierNote.cancelledAt})::date end)`}).from(supplierAcceptanceEffect).innerJoin(supplierNoteLine,eq(supplierNoteLine.id,supplierAcceptanceEffect.noteLineId)).innerJoin(supplierNote,eq(supplierNote.id,supplierNoteLine.noteId)).where(and(eq(supplierAcceptanceEffect.entityId,e),eq(supplierAcceptanceEffect.claimLineId,claimLineId)));
 const [resolution]=await tx.select({day:sql<string|null>`max(${supplierResolutionEffect.postingDate})`}).from(supplierResolutionEffect).where(and(eq(supplierResolutionEffect.entityId,e),eq(supplierResolutionEffect.claimLineId,claimLineId)));
 if([movement?.day,acceptance?.day,resolution?.day].some(day=>day&&day>postingDate))throw new ConflictException('Posting date precedes recorded return or acceptance activity; use a current date');
}
