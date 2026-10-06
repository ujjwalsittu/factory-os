import { createHash } from 'node:crypto';
import { profileTemplates, verifiedProfileCatalog, type TaxSourceEvidence, type TaxCounterState, type TaxProfileRevision } from '@factoryos/compliance-in';
import { Dec } from '@factoryos/core';
import { accountingSettings, glAccount, glEntry, legalEntity, party, taxCertificate, taxConfiguration, taxOpening, taxPartyEvidence, taxProfileRevision, taxSourceHistory, taxpayerIdentity } from '@factoryos/db';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { businessDate, type Tx } from '../accounting/accounting-lock.js';
import { seedChart } from '../accounting/chart.js';
import type { TaxActivationInput, TaxConfiguration } from './types.js';
export const TAX_MAPPING_ROLES=['tds_payable','tds_receivable','tcs_payable','tcs_recoverable','bank_charges'] as const;
export function evidenceHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export interface TaxOpeningLine {
 identityId:string;taxYear:string;category:'tds'|'tcs'|'customer_tds'|'supplier_tcs';accountId:string;
 eligibleBase:string;untaxedBase:string;recognizedTax:string;remittedTax:string;advanceBase:string;balance:string;
}
export interface TaxHistoryInput {sourceType:'purchase_invoice'|'sales_invoice'|'settlement';sourceId:string;history:{eligibleBase:string;consumedBase:string;reason:string;document:string};}
export interface TaxConfigurationInput {tan:string;deductorPan:string;enabledProfiles:string[];mappings:Record<string,string>;}
export interface PartyEvidenceInput {partyId:string;pan?:string;reviewedIdentity?:string;panStatus:'valid'|'missing'|'inoperative'|'unknown';effectiveDate:string;document:string;reason:string;selectors:Record<string,unknown>;}
@Injectable()
export class TaxPolicyService {
 constructor(private readonly audit:AuditService) {}
 async settingsIn(tx:Tx,ctx:TenantRequestContext,entityId:string) {
  await seedChart(tx,ctx,entityId);
  const accounts=await tx.select().from(glAccount).where(and(eq(glAccount.entityId,entityId),eq(glAccount.tenantId,ctx.tenant.tenantId)));
  const mappings=Object.fromEntries(TAX_MAPPING_ROLES.map(role=>[role,accounts.find(a=>a.role===role)!.id]));
  await tx.insert(taxConfiguration).values({tenantId:ctx.tenant.tenantId,entityId,mappings,createdBy:ctx.user.id}).onConflictDoNothing();
  const [configuration]=await tx.select().from(taxConfiguration).where(and(eq(taxConfiguration.entityId,entityId),eq(taxConfiguration.tenantId,ctx.tenant.tenantId)));
  if(!configuration)throw new NotFoundException('Tax settings not found');
  return {...configuration,templates:profileTemplates(),verifiedCatalog:verifiedProfileCatalog()};
 }
 async configureIn(tx:Tx,ctx:TenantRequestContext,entityId:string,input:TaxConfigurationInput) {
  const before=await this.settingsIn(tx,ctx,entityId);
  const [entity]=await tx.select().from(legalEntity).where(and(eq(legalEntity.id,entityId),eq(legalEntity.tenantId,ctx.tenant.tenantId)));
  if(!entity||entity.pan!==input.deductorPan)throw new BadRequestException('Deductor PAN must match the legal entity');
  for(const id of input.enabledProfiles) {
   const [revision]=await tx.select().from(taxProfileRevision).where(and(eq(taxProfileRevision.id,id),eq(taxProfileRevision.tenantId,ctx.tenant.tenantId),eq(taxProfileRevision.entityId,entityId)));
   if(!revision||revision.status!=='verified'||!verifiedProfileCatalog().some(p=>p.id===revision.profileKey))throw new ConflictException('Profile lacks a complete verified primary-source bundle');
  }
  const mappings={...before.mappings,...input.mappings};
  for(const [key,id] of Object.entries(mappings)) {
   if(!TAX_MAPPING_ROLES.includes(key as typeof TAX_MAPPING_ROLES[number]))throw new BadRequestException('Unknown tax account mapping');
   const [account]=await tx.select().from(glAccount).where(and(eq(glAccount.id,id),eq(glAccount.entityId,entityId),eq(glAccount.tenantId,ctx.tenant.tenantId)));
   if(!account?.isActive)throw new BadRequestException('Tax account mapping must be active and in this entity');
   const expectedRoot=key.endsWith('payable')?'liability':key==='bank_charges'?'expense':'asset';
   const root=await tx.execute(sql`select root from account_group where id=${account.groupId} and tenant_id=${ctx.tenant.tenantId} and entity_id=${entityId}`);
   if(root.rows[0]?.root!==expectedRoot)throw new BadRequestException('Tax account mapping has the wrong accounting type');
  }
  const [after]=await tx.update(taxConfiguration).set({tan:input.tan,deductorPan:input.deductorPan,enabledProfiles:input.enabledProfiles,mappings,revision:before.revision+1}).where(and(eq(taxConfiguration.entityId,entityId),eq(taxConfiguration.tenantId,ctx.tenant.tenantId))).returning();
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'withholding.configure',targetType:'tax_configuration',targetId:entityId,before,after},tx);
  return after!;
 }
 async draftProfileIn(tx:Tx,ctx:TenantRequestContext,entityId:string,input:{profileKey:string;definition:Record<string,unknown>;document:string}) {
  const prior=await tx.select().from(taxProfileRevision).where(and(eq(taxProfileRevision.entityId,entityId),eq(taxProfileRevision.tenantId,ctx.tenant.tenantId),eq(taxProfileRevision.profileKey,input.profileKey))).orderBy(desc(taxProfileRevision.revision)).limit(1);
  const [row]=await tx.insert(taxProfileRevision).values({tenantId:ctx.tenant.tenantId,entityId,profileKey:input.profileKey,revision:(prior[0]?.revision??0)+1,status:'draft',definition:input.definition,evidence:{document:input.document},createdBy:ctx.user.id}).returning();
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'withholding.profile_revision',targetType:'tax_profile_revision',targetId:row!.id,after:row},tx);return row!;
 }
 async partyEvidenceIn(tx:Tx,ctx:TenantRequestContext,entityId:string,input:PartyEvidenceInput) {
  const [master]=await tx.select().from(party).where(and(eq(party.id,input.partyId),eq(party.tenantId,ctx.tenant.tenantId)));
  if(!master)throw new NotFoundException('Party not found');
  if(input.effectiveDate>businessDate())throw new BadRequestException('PAN evidence cannot be future dated');
  if(master.pan&&input.pan&&master.pan!==input.pan)throw new BadRequestException('PAN evidence disagrees with party master');
  if((input.panStatus==='valid'||input.panStatus==='inoperative')&&!input.pan)throw new BadRequestException('PAN number is required for this evidence');
  if(!input.pan&&!input.reviewedIdentity)throw new BadRequestException('Missing PAN requires one reviewed taxpayer identity');
  const identityKey=input.pan?`PAN:${input.pan}`:`REVIEWED:${input.reviewedIdentity}`;
  await tx.insert(taxpayerIdentity).values({tenantId:ctx.tenant.tenantId,entityId,identityKey,panStatus:input.panStatus,evidence:{document:input.document,reason:input.reason},createdBy:ctx.user.id}).onConflictDoNothing();
  const [identity]=await tx.select().from(taxpayerIdentity).where(and(eq(taxpayerIdentity.entityId,entityId),eq(taxpayerIdentity.tenantId,ctx.tenant.tenantId),eq(taxpayerIdentity.identityKey,identityKey)));
  const prior=await tx.select().from(taxPartyEvidence).where(and(eq(taxPartyEvidence.partyId,input.partyId),eq(taxPartyEvidence.entityId,entityId),eq(taxPartyEvidence.tenantId,ctx.tenant.tenantId))).orderBy(desc(taxPartyEvidence.revision)).limit(1);
  const [row]=await tx.insert(taxPartyEvidence).values({tenantId:ctx.tenant.tenantId,entityId,partyId:input.partyId,identityId:identity!.id,effectiveDate:input.effectiveDate,revision:(prior[0]?.revision??0)+1,selectors:input.selectors,evidence:{panStatus:input.panStatus,document:input.document,reason:input.reason},createdBy:ctx.user.id}).returning();
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'withholding.party_evidence',targetType:'tax_party_evidence',targetId:row!.id,after:row},tx);return row!;
 }
 async openingIn(tx:Tx,ctx:TenantRequestContext,entityId:string,input:{postingDate:string;reason:string;lines:TaxOpeningLine[];sourceHistory:TaxHistoryInput[]}) {
  const prior=await tx.select().from(taxOpening).where(and(eq(taxOpening.entityId,entityId),eq(taxOpening.tenantId,ctx.tenant.tenantId))).orderBy(desc(taxOpening.revision)).limit(1);
  const keys=new Set<string>();
  for(const line of input.lines) {
   const key=`${line.identityId}:${line.taxYear}:${line.category}`;if(keys.has(key))throw new BadRequestException('Duplicate opening tax counter');keys.add(key);
   const [identity]=await tx.select().from(taxpayerIdentity).where(and(eq(taxpayerIdentity.id,line.identityId),eq(taxpayerIdentity.entityId,entityId),eq(taxpayerIdentity.tenantId,ctx.tenant.tenantId)));
   if(!identity)throw new BadRequestException('Opening identity is outside this entity');
   if(Dec.of(line.untaxedBase).gt(line.eligibleBase)||Dec.of(line.advanceBase).gt(line.eligibleBase)||Dec.of(line.remittedTax).gt(line.recognizedTax))throw new BadRequestException('Opening counter evidence is inconsistent');
  }
  const [row]=await tx.insert(taxOpening).values({tenantId:ctx.tenant.tenantId,entityId,postingDate:input.postingDate,revision:(prior[0]?.revision??0)+1,reason:input.reason,lines:input.lines as unknown as Record<string,unknown>[],createdBy:ctx.user.id}).returning();
  const sourceKeys=new Set<string>();
  for(const item of input.sourceHistory) {
   const key=`${item.sourceType}:${item.sourceId}`;if(sourceKeys.has(key))throw new BadRequestException('Duplicate opening source history');sourceKeys.add(key);
   const table=item.sourceType==='purchase_invoice'?'purchase_invoice':item.sourceType==='sales_invoice'?'sales_invoice':'party_settlement';
   const actual=await tx.execute(sql`select id from ${sql.raw(table)} where id=${item.sourceId} and entity_id=${entityId} and tenant_id=${ctx.tenant.tenantId} and status='submitted'`);
   if(!actual.rows.length)throw new BadRequestException('Opening history requires a submitted source in this entity');
   if(Dec.of(item.history.consumedBase).gt(item.history.eligibleBase))throw new BadRequestException('Opening consumed base exceeds eligible evidence');
   await tx.insert(taxSourceHistory).values({tenantId:ctx.tenant.tenantId,entityId,openingId:row!.id,sourceType:item.sourceType,sourceId:item.sourceId,revision:row!.revision,history:item.history,createdBy:ctx.user.id});
  }
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'withholding.opening_prepare',targetType:'tax_opening',targetId:row!.id,after:row},tx);return row!;
 }
 async reconciliationIn(tx:Tx,ctx:TenantRequestContext,entityId:string,id:string) {
  const [opening]=await tx.select().from(taxOpening).where(and(eq(taxOpening.id,id),eq(taxOpening.entityId,entityId),eq(taxOpening.tenantId,ctx.tenant.tenantId)));
  if(!opening)throw new NotFoundException('Tax opening not found');
  const settings=await this.settingsIn(tx,ctx,entityId);
  const balances=await tx.select({accountId:glEntry.accountId,amount:sql<string>`coalesce(sum(${glEntry.debit}-${glEntry.credit}),0)::text`}).from(glEntry).where(and(eq(glEntry.entityId,entityId),eq(glEntry.tenantId,ctx.tenant.tenantId))).groupBy(glEntry.accountId);
  const expected=new Map<string,Dec>();
  for(const line of opening.lines as unknown as TaxOpeningLine[]) {
   const role={tds:'tds_payable',tcs:'tcs_payable',customer_tds:'tds_receivable',supplier_tcs:'tcs_recoverable'}[line.category];
   if(settings.mappings[role]!==line.accountId)throw new BadRequestException('Opening account must match its tax category mapping');
   const liability=line.category==='tds'||line.category==='tcs';
   const remaining=Dec.of(line.recognizedTax).sub(line.remittedTax);
   const signed=liability?remaining.neg():remaining;
   if(!Dec.of(line.balance).eq(signed))throw new BadRequestException('Opening balance does not agree with recognition/remittance evidence');
   expected.set(line.accountId,(expected.get(line.accountId)??Dec.ZERO).add(line.balance));
  }
  const differences=[];
  for(const [role,accountId] of Object.entries(settings.mappings)) {
   if(role==='bank_charges')continue;
   const recorded=Dec.of(balances.find(b=>b.accountId===accountId)?.amount??'0'), imported=expected.get(accountId)??Dec.ZERO;
   if(!recorded.eq(imported))differences.push({role,accountId,glBalance:recorded.toString(),openingBalance:imported.toString()});
  }
  const history=await tx.select().from(taxSourceHistory).where(and(eq(taxSourceHistory.openingId,id),eq(taxSourceHistory.entityId,entityId),eq(taxSourceHistory.tenantId,ctx.tenant.tenantId))).orderBy(taxSourceHistory.id);
  const books=await tx.select().from(accountingSettings).where(and(eq(accountingSettings.entityId,entityId),eq(accountingSettings.tenantId,ctx.tenant.tenantId)));
  return {differences,reviewedHash:evidenceHash({opening,history,settingsRevision:settings.revision,balances:balances.sort((a,b)=>a.accountId.localeCompare(b.accountId)),books}),opening};
 }
 async activateIn(tx:Tx,ctx:TenantRequestContext,entityId:string,input:TaxActivationInput):Promise<TaxConfiguration> {
  const before=await this.settingsIn(tx,ctx,entityId);
  const [books]=await tx.select().from(accountingSettings).where(and(eq(accountingSettings.entityId,entityId),eq(accountingSettings.tenantId,ctx.tenant.tenantId)));
  if(!books?.active)throw new ConflictException('Active books are required for tax activation');
  if(before.active)throw new ConflictException('Tax settings are already activated');
  if(input.date!==businessDate())throw new ConflictException('Tax activation must use the current business date');
  if(!before.tan||!before.deductorPan)throw new ConflictException('Reviewed deductor TAN and PAN are required');
  const preview=await this.reconciliationIn(tx,ctx,entityId,input.openingId);
  if(preview.differences.length||preview.reviewedHash!==input.reviewedHash||preview.opening.status!=='draft'||preview.opening.postingDate!==input.date)throw new ConflictException('Tax opening is stale or not reconciled for activation date');
  await tx.update(taxOpening).set({status:'submitted',submittedBy:ctx.user.id,submittedAt:new Date(),reviewedHash:input.reviewedHash,reconciliation:{differences:preview.differences}}).where(eq(taxOpening.id,input.openingId));
  const [after]=await tx.update(taxConfiguration).set({active:true,activationDate:input.date,activatedBy:ctx.user.id,activatedAt:new Date(),openingId:input.openingId,revision:before.revision+1}).where(and(eq(taxConfiguration.entityId,entityId),eq(taxConfiguration.tenantId,ctx.tenant.tenantId))).returning();
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'withholding.activate',targetType:'tax_configuration',targetId:entityId,before,after},tx);return after!;
 }
 async certificateIn(tx:Tx,ctx:TenantRequestContext,entityId:string,input:{identityId:string;profileId:string;reference:string;authority:string;act:'1961'|'2025';deductorTan:string;validFrom:string;validTo:string;ratePercent:string;baseLimit:string;taxLimit:string|null;document:string;reason:string}) {
  const settings=await this.settingsIn(tx,ctx,entityId);
  if(settings.tan!==input.deductorTan)throw new BadRequestException('Certificate deductor TAN must match this entity');
  if(input.validFrom>input.validTo||Dec.of(input.ratePercent).gt('100'))throw new BadRequestException('Certificate validity or rate is invalid');
  const [identity]=await tx.select().from(taxpayerIdentity).where(and(eq(taxpayerIdentity.id,input.identityId),eq(taxpayerIdentity.tenantId,ctx.tenant.tenantId),eq(taxpayerIdentity.entityId,entityId)));
  const [profile]=await tx.select().from(taxProfileRevision).where(and(eq(taxProfileRevision.id,input.profileId),eq(taxProfileRevision.tenantId,ctx.tenant.tenantId),eq(taxProfileRevision.entityId,entityId)));
  if(!identity||!profile)throw new BadRequestException('Certificate identity and profile must be in this entity');
  const previous=await tx.select().from(taxCertificate).where(and(eq(taxCertificate.reference,input.reference),eq(taxCertificate.entityId,entityId),eq(taxCertificate.tenantId,ctx.tenant.tenantId))).orderBy(desc(taxCertificate.revision)).limit(1);
  const {document,reason,...fields}=input;
  const [row]=await tx.insert(taxCertificate).values({...fields,tenantId:ctx.tenant.tenantId,entityId,revision:(previous[0]?.revision??0)+1,createdBy:ctx.user.id,evidence:{document,reason,profileStatus:profile.status}}).returning();
  await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'withholding.certificate',targetType:'tax_certificate',targetId:row!.id,after:row},tx);
  return row!;
 }
 async contextIn(tx:Tx,ctx:TenantRequestContext,entityId:string,source:TaxSourceEvidence):Promise<{profile:TaxProfileRevision;state:TaxCounterState}> {
  const settings=await this.settingsIn(tx,ctx,entityId);
  if(!settings.active)throw new ConflictException('Tax settings are inactive');
  if(!settings.enabledProfiles.length)throw new ConflictException('Automatic tax profiles remain disabled pending complete primary verification');
  // An enabled numerical catalog needs its exact immutable revision decoder and source predicates.
  // Do not accept a raw JSON definition as an automatic rule while that verification is blocked.
  void source;
  throw new ConflictException('No complete verified numerical profile is available');
 }
}
