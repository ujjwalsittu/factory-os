import { calculateBankReconciliation, Dec, validateBankMatch, type BookItem, type ResolvedMatch, type StatementItem } from '@factoryos/core';
import { bankChargeDocument, bankMatchEdge, bankMatchGroup, bankNetVector, bankOpeningItem, bankReconciliationEvent, bankReconciliationPeriod, glEntry, journalVoucher, partySettlement } from '@factoryos/db';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { Db, Tx } from '../accounting/accounting-lock.js';
import { BankImportService } from './import.service.js';
import { BankRegistryService, evidenceHash } from './registry.service.js';
import type { MatchRequest, MatchSubmitInput } from './types.js';
@Injectable()
export class BankMatchService {
 constructor(private readonly registry:BankRegistryService,private readonly imports:BankImportService){}
 async stateIn(tx:Db,ctx:TenantRequestContext,entityId:string,profileId:string) {
  const context=await this.registry.contextIn(tx,ctx,entityId,profileId);
  if(!context.baseline)throw new ConflictException('Activate a reviewed bank baseline first');
  const imports=await this.imports.evidenceIn(tx,ctx,entityId,profileId);
  const entries=await tx.select({entry:glEntry,voucher:journalVoucher}).from(glEntry).innerJoin(journalVoucher,and(eq(journalVoucher.id,glEntry.voucherId),eq(journalVoucher.tenantId,ctx.tenant.tenantId),eq(journalVoucher.entityId,entityId))).where(and(eq(glEntry.tenantId,ctx.tenant.tenantId),eq(glEntry.entityId,entityId),eq(glEntry.accountId,context.profile.accountId))).orderBy(glEntry.postingDate,glEntry.id);
  const settlements=await tx.select().from(partySettlement).where(and(eq(partySettlement.tenantId,ctx.tenant.tenantId),eq(partySettlement.entityId,entityId),eq(partySettlement.accountId,context.profile.accountId)));
  const opening=await tx.select().from(bankOpeningItem).where(and(eq(bankOpeningItem.baselineId,context.baseline.id),eq(bankOpeningItem.profileId,profileId),eq(bankOpeningItem.tenantId,ctx.tenant.tenantId),eq(bankOpeningItem.entityId,entityId)));
  const groups=await tx.select().from(bankMatchGroup).where(and(eq(bankMatchGroup.profileId,profileId),eq(bankMatchGroup.tenantId,ctx.tenant.tenantId),eq(bankMatchGroup.entityId,entityId))).orderBy(bankMatchGroup.createdAt,bankMatchGroup.id);
  const activeGroups=groups.filter(x=>!imports.events.some(e=>e.matchId===x.id));
  const openingBook:BookItem[]=opening.map(x=>({id:x.id,kind:'opening',date:x.postingDate,signedAmount:x.signedAmount,reference:x.reference}));
  const book:BookItem[]=entries.filter(x=>x.entry.postingDate>context.baseline!.baselineDate&&x.voucher.sourceType!=='opening').map(({entry,voucher})=>({id:entry.id,kind:'gl',date:entry.postingDate,signedAmount:Dec.of(entry.debit).sub(entry.credit).toString(),reference:(voucher.sourceType==='settlement'?settlements.find(s=>s.id===voucher.sourceId)?.bankReference:undefined)??entry.billReference??voucher.sourceNumber??voucher.number??voucher.id}));
  const statement:StatementItem[]=imports.activeMovements.map(x=>({id:x.id,date:x.transactionDate,signedAmount:x.signedAmount,reference:x.reference}));
  // These snapshots are written by submitIn and protected by the append-only DB trigger; revalidate all capacities below.
  const matches=activeGroups.map(x=>(x.evidence as {match:ResolvedMatch}).match);
  const input={baseline:{date:context.baseline.baselineDate,bookBalance:context.baseline.bookBalance,bankBalance:context.baseline.bankBalance,outstanding:openingBook},book,statement,matches,coverageComplete:false};
  const residuals=calculateBankReconciliation({...input,asOf:'9999-12-31'});
  const allBook=[...openingBook,...book].map(x=>({...x,remaining:residuals.bookResiduals.find(r=>r.id===x.id&&r.kind===x.kind)?.remaining??'0.000000'}));
  const allStatement=statement.map(x=>({...x,remaining:residuals.statementResiduals.find(r=>r.id===x.id)?.remaining??'0.000000'}));
  return {context,imports,entries,settlements,groups,activeGroups,input,book:allBook,statement:allStatement,revision:evidenceHash({context,imports,entries,settlements,opening,groups})};
 }
 async candidatesIn(tx:Db,ctx:TenantRequestContext,entityId:string,profileId:string,statementRowId:string) {
  const state=await this.stateIn(tx,ctx,entityId,profileId),row=state.statement.find(x=>x.id===statementRowId);
  if(!row)throw new NotFoundException('Active statement movement not found');
  if(Dec.of(row.remaining).isZero())return [];
  const normalize=(x:string)=>x.trim().toUpperCase();
  const distance=(date:string)=>Math.abs(new Date(`${date}T00:00:00Z`).getTime()-new Date(`${row.date}T00:00:00Z`).getTime())/86400000;
  return state.book.filter(x=>!Dec.of(x.remaining).isZero()&&Dec.of(x.remaining).isNeg()===Dec.of(row.remaining).isNeg()&&distance(x.date)<=state.context.profile.dateWindow).map(x=>({...x,exactAmount:Dec.of(x.remaining).eq(row.remaining),exactReference:normalize(x.reference)===normalize(row.reference)&&normalize(row.reference)!=='',dateDistance:distance(x.date)})).sort((a,b)=>Number(b.exactAmount&&b.exactReference)-Number(a.exactAmount&&a.exactReference)||Number(b.exactAmount)-Number(a.exactAmount)||a.dateDistance-b.dateDistance||a.id.localeCompare(b.id));
 }
 async assertOpenDatesIn(tx:Db,ctx:TenantRequestContext,entityId:string,profileId:string,dates:string[]) {
  const periods=await tx.select().from(bankReconciliationPeriod).where(and(eq(bankReconciliationPeriod.profileId,profileId),eq(bankReconciliationPeriod.tenantId,ctx.tenant.tenantId),eq(bankReconciliationPeriod.entityId,entityId)));
  const events=await tx.select().from(bankReconciliationEvent).where(and(eq(bankReconciliationEvent.profileId,profileId),eq(bankReconciliationEvent.tenantId,ctx.tenant.tenantId),eq(bankReconciliationEvent.entityId,entityId)));
  if(periods.some(p=>!events.some(e=>e.periodId===p.id)&&dates.some(d=>d<=p.endDate)))throw new ConflictException('Reopen the bank reconciliation period before changing its evidence');
 }
 async previewIn(tx:Db,ctx:TenantRequestContext,entityId:string,profileId:string,input:MatchRequest) {
  const state=await this.stateIn(tx,ctx,entityId,profileId);
  let match:ResolvedMatch,source:unknown=null;
  try {
   if(input.kind==='ordinary')match=validateBankMatch(input,state.input.statement,[...state.input.baseline.outstanding,...state.input.book]);
   else {
    const item=state.entries.find(x=>x.entry.id===input.bankEntryId&&x.entry.postingDate>state.context.baseline!.baselineDate),settlement=item&&state.settlements.find(x=>x.voucherId===item.voucher.id&&x.id===item.voucher.sourceId);
    if(!item||item.voucher.sourceType!=='settlement'||item.voucher.reversalOf||!settlement||!['submitted','cancelled'].includes(settlement.status)||settlement.direction!=='receipt'||settlement.currency!=='INR'||!Dec.of(settlement.bankCharge).gt(Dec.ZERO))throw new ConflictException('Net group requires one supported fee-bearing receipt bank line');
    const charges=await tx.select().from(bankChargeDocument).where(and(eq(bankChargeDocument.tenantId,ctx.tenant.tenantId),eq(bankChargeDocument.entityId,entityId),eq(bankChargeDocument.settlementId,settlement.id),eq(bankChargeDocument.voucherId,item.voucher.id),eq(bankChargeDocument.bankAccountId,state.context.profile.accountId)));
    if(charges.length!==1||!['submitted','cancelled'].includes(charges[0]!.status)||!Dec.of(charges[0]!.totalAmount).eq(settlement.bankCharge))throw new ConflictException('Linked bank fee evidence is inconsistent');
    source={settlement,charge:charges[0],entry:item.entry,voucher:item.voucher};
    match=validateBankMatch({...input,source:{principal:settlement.amount,charge:settlement.bankCharge}},state.input.statement,[...state.input.baseline.outstanding,...state.input.book]);
   }
   calculateBankReconciliation({...state.input,asOf:'9999-12-31',matches:[...state.input.matches,match]});
  } catch(error){if(error instanceof ConflictException)throw error;throw new ConflictException((error as Error).message);}
  const dates=match.kind==='ordinary'?match.edges.flatMap(e=>[state.statement.find(x=>x.id===e.statementRowId)!.date,state.book.find(x=>x.kind===e.bookItemKind&&x.id===e.bookItemId)!.date]):[...state.statement.filter(x=>match.statementRowIds.includes(x.id)).map(x=>x.date),state.book.find(x=>x.kind==='gl'&&x.id===match.bankEntryId)!.date];
  await this.assertOpenDatesIn(tx,ctx,entityId,profileId,dates);
  return {match,source,previewHash:evidenceHash({input,stateRevision:state.revision,source,match}),statement:state.statement,book:state.book};
 }
 async submitIn(tx:Tx,ctx:TenantRequestContext,entityId:string,profileId:string,input:MatchSubmitInput) {
  const {reviewedHash,...request}=input;
  if(request.kind==='net'&&!ctx.tenant.permissions.has('accounts.bank_reconciliation.approve'))throw new ForbiddenException('Finance approval required for net groups');
  const preview=await this.previewIn(tx,ctx,entityId,profileId,request);
  if(preview.previewHash!==reviewedHash)throw new ConflictException('Bank match preview changed; review again');
  const scope={tenantId:ctx.tenant.tenantId,entityId,profileId,createdBy:ctx.user.id};
  const [group]=await tx.insert(bankMatchGroup).values({...scope,kind:preview.match.kind,reason:request.kind==='net'?request.reason:undefined,evidence:{match:preview.match,source:preview.source,book:preview.book,statement:preview.statement},previewHash:reviewedHash}).returning();
  if(preview.match.kind==='ordinary')await tx.insert(bankMatchEdge).values(preview.match.edges.map(edge=>({...scope,matchId:group!.id,movementId:edge.statementRowId,glEntryId:edge.bookItemKind==='gl'?edge.bookItemId:undefined,openingItemId:edge.bookItemKind==='opening'?edge.bookItemId:undefined,amount:edge.amount,effectiveDate:edge.effectiveDate,snapshot:edge})));
  else {
   const match=preview.match;
   await tx.insert(bankNetVector).values([...preview.statement.filter(x=>match.statementRowIds.includes(x.id)).map(x=>({...scope,matchId:group!.id,side:'bank',movementId:x.id,signedAmount:x.signedAmount,effectiveDate:match.effectiveDate,snapshot:x})),...preview.book.filter(x=>x.kind==='gl'&&x.id===match.bankEntryId).map(x=>({...scope,matchId:group!.id,side:'book',glEntryId:x.id,signedAmount:x.signedAmount,effectiveDate:match.effectiveDate,snapshot:x}))]);
  }
  return group!;
 }
 async reverseIn(tx:Tx,ctx:TenantRequestContext,entityId:string,profileId:string,groupId:string,reason:string) {
  const state=await this.stateIn(tx,ctx,entityId,profileId),group=state.activeGroups.find(x=>x.id===groupId);
  if(!group)throw new ConflictException('Match group is not active');
  if(group.kind==='net'&&!ctx.tenant.permissions.has('accounts.bank_reconciliation.approve'))throw new ForbiddenException('Finance must reverse the complete net group');
  const match=(group.evidence as {match:ResolvedMatch}).match;
  const dates=match.kind==='ordinary'?match.edges.flatMap(e=>[state.statement.find(x=>x.id===e.statementRowId)!.date,state.book.find(x=>x.kind===e.bookItemKind&&x.id===e.bookItemId)!.date]):[...state.statement.filter(x=>match.statementRowIds.includes(x.id)).map(x=>x.date),state.book.find(x=>x.kind==='gl'&&x.id===match.bankEntryId)!.date];
  await this.assertOpenDatesIn(tx,ctx,entityId,profileId,dates);
  await tx.insert(bankReconciliationEvent).values({tenantId:ctx.tenant.tenantId,entityId,profileId,matchId:groupId,kind:'match_reversal',reason,createdBy:ctx.user.id});return {reversed:true};
 }
}
