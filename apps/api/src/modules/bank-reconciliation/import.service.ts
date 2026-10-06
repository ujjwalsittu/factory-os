import { Dec, parseBankStatement, type NormalizedStatement, type NormalizedStatementRow } from '@factoryos/core';
import { bankDuplicateDecision, bankMappingRevision, bankMatchEdge, bankMatchGroup, bankNetVector, bankReconciliationEvent, bankReconciliationPeriod, bankStatementImport, bankStatementMembership, bankStatementMovement } from '@factoryos/db';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { TenantRequestContext } from '../../common/access.js';
import type { Db, Tx } from '../accounting/accounting-lock.js';
import { BankRegistryService, evidenceHash } from './registry.service.js';
import { CsvMappingInput, type ImportSubmitInput, type StatementUploadInput, type StatementImport } from './types.js';
const nextDay=(date:string)=>{const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
const signature=(row:NormalizedStatementRow)=>evidenceHash({date:row.date,amount:row.signedAmount,reference:row.reference,description:row.description});
@Injectable()
export class BankImportService {
 constructor(private readonly registry:BankRegistryService){}
 async evidenceIn(tx:Db,ctx:TenantRequestContext,entityId:string,profileId:string) {
  await this.registry.contextIn(tx,ctx,entityId,profileId);
  const imports=await tx.select().from(bankStatementImport).where(and(eq(bankStatementImport.profileId,profileId),eq(bankStatementImport.tenantId,ctx.tenant.tenantId),eq(bankStatementImport.entityId,entityId))).orderBy(bankStatementImport.createdAt,bankStatementImport.id);
  const events=await tx.select().from(bankReconciliationEvent).where(and(eq(bankReconciliationEvent.profileId,profileId),eq(bankReconciliationEvent.tenantId,ctx.tenant.tenantId),eq(bankReconciliationEvent.entityId,entityId)));
  const movements=await tx.select().from(bankStatementMovement).where(and(eq(bankStatementMovement.profileId,profileId),eq(bankStatementMovement.tenantId,ctx.tenant.tenantId),eq(bankStatementMovement.entityId,entityId)));
  const memberships=await tx.select().from(bankStatementMembership).where(and(eq(bankStatementMembership.profileId,profileId),eq(bankStatementMembership.tenantId,ctx.tenant.tenantId),eq(bankStatementMembership.entityId,entityId)));
  const activeImports=imports.filter(x=>x.status==='submitted'&&!events.some(e=>e.importId===x.id));
  const activeIds=new Set(memberships.filter(x=>activeImports.some(i=>i.id===x.importId)).map(x=>x.movementId));
  return {imports,events,movements,memberships,activeImports,activeMovements:movements.filter(x=>activeIds.has(x.id))};
 }
 async stageIn(tx:Tx,ctx:TenantRequestContext,entityId:string,profileId:string,bytes:Uint8Array,input:StatementUploadInput):Promise<StatementImport> {
  const context=await this.registry.contextIn(tx,ctx,entityId,profileId);
  if(!context.baseline)throw new ConflictException('Activate a reviewed bank baseline first');
  if(bytes.byteLength>5*1024*1024)throw new BadRequestException('File exceeds 5MiB');
  let csv:string;try{csv=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new BadRequestException('File must contain valid UTF-8');}
  if(input.startDate<=context.baseline.baselineDate||input.startDate>input.endDate)throw new BadRequestException('Statement interval must follow baseline');
  const hash=createHash('sha256').update(bytes).digest('hex');
  const evidence=await this.evidenceIn(tx,ctx,entityId,profileId),prior=evidence.imports.find(x=>x.fileHash===hash);
  if(prior){if(evidence.events.some(x=>x.importId===prior.id))throw new ConflictException('This file was reversed; review replacement evidence explicitly');return prior;}
  const [revision]=await tx.select().from(bankMappingRevision).where(and(eq(bankMappingRevision.id,input.mappingId),eq(bankMappingRevision.profileId,profileId),eq(bankMappingRevision.tenantId,ctx.tenant.tenantId),eq(bankMappingRevision.entityId,entityId)));
  if(!revision)throw new NotFoundException('Mapping revision not found');
  const parsed=parseBankStatement({...input,csv},CsvMappingInput.parse(revision.mapping));
  const [batch]=await tx.insert(bankStatementImport).values({tenantId:ctx.tenant.tenantId,entityId,profileId,mappingId:input.mappingId,startDate:input.startDate,endDate:input.endDate,openingBalance:input.openingBalance,closingBalance:input.closingBalance,fileHash:hash,rawCsv:csv,parsed,previewHash:evidenceHash({hash,input,context:context.revision}),createdBy:ctx.user.id}).returning();
  return batch!;
 }
 async reviewIn(tx:Db,ctx:TenantRequestContext,entityId:string,profileId:string,importId:string) {
  const context=await this.registry.contextIn(tx,ctx,entityId,profileId),evidence=await this.evidenceIn(tx,ctx,entityId,profileId);
  const batch=evidence.imports.find(x=>x.id===importId);if(!batch)throw new NotFoundException('Bank import not found');
  const [mapping]=await tx.select().from(bankMappingRevision).where(and(eq(bankMappingRevision.id,batch.mappingId),eq(bankMappingRevision.profileId,profileId),eq(bankMappingRevision.tenantId,ctx.tenant.tenantId),eq(bankMappingRevision.entityId,entityId)));
  if(!mapping)throw new ConflictException('Original mapping revision missing');
  const parsed=parseBankStatement({csv:batch.rawCsv,startDate:batch.startDate,endDate:batch.endDate,openingBalance:batch.openingBalance,closingBalance:batch.closingBalance},CsvMappingInput.parse(mapping.mapping));
  const decisions=await tx.select().from(bankDuplicateDecision).where(and(eq(bankDuplicateDecision.importId,importId),eq(bankDuplicateDecision.profileId,profileId),eq(bankDuplicateDecision.tenantId,ctx.tenant.tenantId),eq(bankDuplicateDecision.entityId,entityId)));
  const conflicts:{ordinal:number;message:string}[]=[],ambiguities:{ordinal:number;candidateIds:string[]}[]=[],linked:{ordinal:number;movementId:string}[]=[];
  const seenIds=new Set<string>();
  for(const row of parsed.rows){
   const existing=row.transactionId?evidence.movements.find(x=>x.transactionId===row.transactionId):undefined;
   if(row.transactionId&&seenIds.has(row.transactionId)){conflicts.push({ordinal:row.ordinal,message:'Repeated stable transaction ID in this file'});continue;}
   if(row.transactionId)seenIds.add(row.transactionId);
   if(existing){if(existing.transactionDate!==row.date||!Dec.of(existing.signedAmount).eq(row.signedAmount))conflicts.push({ordinal:row.ordinal,message:'Stable transaction identity conflicts with canonical date/amount'});else linked.push({ordinal:row.ordinal,movementId:existing.id});continue;}
   if(!row.transactionId){const candidates=evidence.movements.filter(x=>x.signature===signature(row));if(candidates.length)ambiguities.push({ordinal:row.ordinal,candidateIds:candidates.map(x=>x.id)});}
  }
  return {batch:{...batch,rawCsv:undefined},parsed,conflicts,ambiguities,linked,decisions,previewHash:evidenceHash({batch,mapping,context,evidence,decisions})};
 }
 /** Validate complete interval claims against unique canonical rows and overlapping balance anchors. */
 coverage(baseline:{baselineDate:string;bankBalance:string},batches:Pick<StatementImport,'id'|'startDate'|'endDate'|'openingBalance'|'closingBalance'>[],movements:{transactionDate:string;signedAmount:string}[],asOf?:string) {
  const conflicts:string[]=[];
  const sorted=[...batches].sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.endDate.localeCompare(b.endDate));
  let through=baseline.baselineDate;
  for(const batch of sorted){
   const total=movements.filter(x=>x.transactionDate>=batch.startDate&&x.transactionDate<=batch.endDate).reduce((sum,x)=>sum.add(x.signedAmount),Dec.ZERO);
   if(!Dec.of(batch.openingBalance).add(total).eq(batch.closingBalance))conflicts.push(`Statement ${batch.id} interval movements conflict with stated balances`);
   if(batch.startDate===nextDay(baseline.baselineDate)&&!Dec.of(batch.openingBalance).eq(baseline.bankBalance))conflicts.push('First statement opening differs from baseline bank balance');
   for(const prior of sorted){if(prior.id===batch.id||prior.startDate>batch.startDate||batch.startDate>nextDay(prior.endDate))continue;
    const delta=movements.filter(x=>x.transactionDate>=prior.startDate&&x.transactionDate<batch.startDate).reduce((sum,x)=>sum.add(x.signedAmount),Dec.ZERO);
    if(!Dec.of(prior.openingBalance).add(delta).eq(batch.openingBalance))conflicts.push('Overlapping or adjacent statement balances conflict');
   }
   if(batch.startDate<=nextDay(through)&&batch.endDate>through)through=batch.endDate;
  }
  return {complete:asOf!==undefined&&through>=asOf&&conflicts.length===0,through,conflicts,intervals:sorted.map(x=>({id:x.id,startDate:x.startDate,endDate:x.endDate}))};
 }
 async submitIn(tx:Tx,ctx:TenantRequestContext,entityId:string,profileId:string,importId:string,input:ImportSubmitInput):Promise<StatementImport> {
  const review=await this.reviewIn(tx,ctx,entityId,profileId,importId),evidence=await this.evidenceIn(tx,ctx,entityId,profileId),context=await this.registry.contextIn(tx,ctx,entityId,profileId);
  const batch=evidence.imports.find(x=>x.id===importId)!;
  if(evidence.events.some(x=>x.importId===importId))throw new ConflictException('Reversed import cannot be resubmitted');
  if(batch.status==='submitted')return batch;
  if(!context.baseline||batch.startDate<=context.baseline.baselineDate||review.previewHash!==input.reviewedHash)throw new ConflictException('Bank import preview changed; review again');
  if(review.parsed.errors.length||review.conflicts.length)throw new ConflictException('Resolve all row errors and identity conflicts before submission');
  if(input.decisions.length&&!ctx.tenant.permissions.has('accounts.bank_reconciliation.approve'))throw new ForbiddenException('Finance approval required for duplicate decisions');
  if(new Set(input.decisions.map(x=>x.ordinal)).size!==input.decisions.length)throw new BadRequestException('Duplicate decision ordinals');
  if(input.decisions.some(d=>!review.ambiguities.some(a=>a.ordinal===d.ordinal)))throw new BadRequestException('Decision does not identify an ambiguous row');
  const chosen=new Map<number,string>(),newRows:NormalizedStatementRow[]=[];
  for(const row of review.parsed.rows){
   const linked=review.linked.find(x=>x.ordinal===row.ordinal),ambiguous=review.ambiguities.find(x=>x.ordinal===row.ordinal),decision=input.decisions.find(x=>x.ordinal===row.ordinal);
   if(linked){chosen.set(row.ordinal,linked.movementId);continue;}
   if(ambiguous){if(!decision)throw new ConflictException('Finance must resolve duplicate occurrences');
    if(decision.decision==='link'){if(!ambiguous.candidateIds.includes(decision.movementId!))throw new BadRequestException('Duplicate link is not a canonical candidate');chosen.set(row.ordinal,decision.movementId!);continue;}
   }
   newRows.push(row);
  }
  if(new Set(chosen.values()).size!==chosen.size)throw new ConflictException('One canonical occurrence cannot satisfy repeated rows in one file');
  const union=[...evidence.activeMovements,...evidence.movements.filter(x=>[...chosen.values()].includes(x.id)&&!evidence.activeMovements.some(a=>a.id===x.id)),...newRows.map(x=>({transactionDate:x.date,signedAmount:x.signedAmount}))];
  const coverage=this.coverage(context.baseline,[...evidence.activeImports,batch],union);
  if(coverage.conflicts.length)throw new ConflictException(coverage.conflicts.join('; '));
  const scope={tenantId:ctx.tenant.tenantId,entityId,profileId,createdBy:ctx.user.id};
  for(const row of newRows){const [movement]=await tx.insert(bankStatementMovement).values({...scope,originalImportId:importId,ordinal:row.ordinal,transactionId:row.transactionId,transactionDate:row.date,signedAmount:row.signedAmount,reference:row.reference,description:row.description,signature:signature(row),rawEvidence:row}).returning();chosen.set(row.ordinal,movement!.id);}
  for(const row of review.parsed.rows)await tx.insert(bankStatementMembership).values({...scope,importId,movementId:chosen.get(row.ordinal)!,ordinal:row.ordinal});
  for(const decision of input.decisions)await tx.insert(bankDuplicateDecision).values({...scope,importId,...decision,snapshot:{previewHash:input.reviewedHash}});
  const [submitted]=await tx.update(bankStatementImport).set({status:'submitted',submittedAt:new Date(),previewHash:review.previewHash}).where(and(eq(bankStatementImport.id,importId),eq(bankStatementImport.profileId,profileId),eq(bankStatementImport.tenantId,ctx.tenant.tenantId),eq(bankStatementImport.entityId,entityId))).returning();return submitted!;
 }
 async reverseIn(tx:Tx,ctx:TenantRequestContext,entityId:string,profileId:string,importId:string,reason:string) {
  const evidence=await this.evidenceIn(tx,ctx,entityId,profileId),batch=evidence.activeImports.find(x=>x.id===importId);
  if(!batch)throw new ConflictException('Import is not active submitted evidence');
  const periods=await tx.select().from(bankReconciliationPeriod).where(and(eq(bankReconciliationPeriod.profileId,profileId),eq(bankReconciliationPeriod.tenantId,ctx.tenant.tenantId),eq(bankReconciliationPeriod.entityId,entityId)));
  if(periods.some(x=>!evidence.events.some(e=>e.periodId===x.id)&&x.endDate>=batch.startDate))throw new ConflictException('Reopen dependent bank periods first');
  const groups=await tx.select().from(bankMatchGroup).where(and(eq(bankMatchGroup.profileId,profileId),eq(bankMatchGroup.tenantId,ctx.tenant.tenantId),eq(bankMatchGroup.entityId,entityId)));
  const edges=await tx.select().from(bankMatchEdge).where(and(eq(bankMatchEdge.profileId,profileId),eq(bankMatchEdge.tenantId,ctx.tenant.tenantId),eq(bankMatchEdge.entityId,entityId)));
  const vectors=await tx.select().from(bankNetVector).where(and(eq(bankNetVector.profileId,profileId),eq(bankNetVector.tenantId,ctx.tenant.tenantId),eq(bankNetVector.entityId,entityId)));
  const movements=new Set(evidence.memberships.filter(x=>x.importId===importId).map(x=>x.movementId));
  if(groups.some(g=>!evidence.events.some(e=>e.matchId===g.id)&&[...edges,...vectors].some(x=>x.matchId===g.id&&x.movementId&&movements.has(x.movementId))))throw new ConflictException('Reverse dependent matches before reversing statement import');
  await tx.insert(bankReconciliationEvent).values({tenantId:ctx.tenant.tenantId,entityId,profileId,importId,kind:'import_reversal',reason,createdBy:ctx.user.id});return {reversed:true};
 }
}
