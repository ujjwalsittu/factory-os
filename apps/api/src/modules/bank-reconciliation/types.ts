import { z } from 'zod';
import type { bankReconciliationBaseline, bankReconciliationProfile, bankMappingRevision } from '@factoryos/db';
import type { BookItem, BankReportArithmetic } from '@factoryos/core';
const uuid = z.uuid();
export const BankDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(x => { const d = new Date(`${x}T00:00:00.000Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === x; },'Invalid calendar date');
export const BankMoney = z.string().regex(/^-?\d{1,18}(?:\.\d{1,6})?$/);
const positiveMoney = BankMoney.refine(x => BigInt(x.replace('.','').replace(/^-/,'-')) > 0n,'Amount must be positive');
const label = z.string().trim().min(1).max(200);
export const Reason = z.string().trim().min(1).max(2000);
const column = z.string().min(1).max(200);
export const CsvMappingInput = z.strictObject({
 delimiter:z.string().length(1).refine(x=>!/["\r\n]/.test(x)),skipRows:z.number().int().min(0).max(100),
 dateFormat:z.enum(['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD']),dateColumn:column,referenceColumn:column.optional(),descriptionColumn:column.optional(),transactionIdColumn:column.optional(),
 amount:z.discriminatedUnion('mode',[z.strictObject({mode:z.literal('split'),debitColumn:column,creditColumn:column}),z.strictObject({mode:z.literal('signed'),column,polarity:z.enum(['credit-positive','debit-positive'])})]),
 decimalSeparator:z.enum(['.',',']),groupSeparator:z.enum(['.',',',' ']).nullable(),order:z.enum(['ascending','descending']),runningBalanceColumn:column.optional(),balanceRow:z.strictObject({column,value:z.string().max(200)}).optional(),
}).refine(x=>x.decimalSeparator!==x.groupSeparator,'Separators must differ').refine(x=>x.amount.mode!=='split'||x.amount.debitColumn!==x.amount.creditColumn,'Debit and credit columns must differ');
export const BankProfileInput = z.strictObject({accountId:uuid,currency:z.literal('INR'),maskedIdentifier:z.string().min(4).max(100).regex(/^(?:\*|•|x|X)+[A-Za-z0-9]{0,4}$/),dateWindow:z.number().int().min(0).max(30).default(7),mapping:CsvMappingInput});
export const BankProfileSettingsInput = z.strictObject({dateWindow:z.number().int().min(0).max(30).optional(),mapping:CsvMappingInput.optional()}).refine(x=>x.dateWindow!==undefined||x.mapping!==undefined);
export const BaselineInput = z.strictObject({date:BankDate,bankBalance:BankMoney,reference:label,evidence:Reason,outstanding:z.array(z.strictObject({date:BankDate,signedAmount:BankMoney.refine(x=>!/^(-)?0+(\.0+)?$/.test(x)),reference:label,reason:Reason,evidence:Reason,glEntryId:uuid.optional()})).max(10000)});
export const StatementPeriodInput = z.strictObject({startDate:BankDate,endDate:BankDate,openingBalance:BankMoney,closingBalance:BankMoney,mappingId:uuid});
export const OrdinaryMatchInput = z.strictObject({kind:z.literal('ordinary'),edges:z.array(z.strictObject({statementRowId:uuid,bookItemKind:z.enum(['gl','opening']),bookItemId:uuid,amount:positiveMoney})).min(1).max(10000)});
export const NetMatchInput = z.strictObject({kind:z.literal('net'),statementRowIds:z.array(uuid).min(2).max(10000).refine(x=>new Set(x).size===x.length),bankEntryId:uuid,reason:Reason});
export const BankMatchInput = z.discriminatedUnion('kind',[OrdinaryMatchInput,NetMatchInput]);
export const DuplicateDecisionInput = z.strictObject({ordinal:z.number().int().min(1),decision:z.enum(['link','distinct']),movementId:uuid.optional(),reason:Reason}).refine(x=>(x.decision==='link')===(x.movementId!==undefined));
export const ReviewedInput = z.strictObject({reviewedHash:z.string().regex(/^[a-f0-9]{64}$/)});
export type BaselineInput = z.infer<typeof BaselineInput>;
export type BankBaseline = typeof bankReconciliationBaseline.$inferSelect;
export interface BankContext { profile:typeof bankReconciliationProfile.$inferSelect; mapping:typeof bankMappingRevision.$inferSelect|null; baseline:BankBaseline|null; revision:string }
export interface BaselineReview { input:BaselineInput; bookBalance:string; bankBalance:string; outstandingTotal:string; difference:string; ledger:BookItem[]; previewHash:string }
export interface BankReport extends BankReportArithmetic { profileId:string; baselineId:string; asOf:string; previewHash:string; coverage:unknown; matches:unknown }
export const ImportSubmitInput = z.strictObject({reviewedHash:z.string().regex(/^[a-f0-9]{64}$/),decisions:z.array(DuplicateDecisionInput).max(10000).default([])});
export type StatementUploadInput = z.infer<typeof StatementPeriodInput>;
export type ImportSubmitInput = z.infer<typeof ImportSubmitInput>;
export type StatementImport = typeof import('@factoryos/db').bankStatementImport.$inferSelect;
