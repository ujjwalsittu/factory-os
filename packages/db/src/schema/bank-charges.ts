import { sql } from 'drizzle-orm';
import { check, date, foreignKey, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { glAccount } from './accounting.js';
import { docStatus } from './inventory.js';
import { legalEntity, tenant } from './platform.js';
const money = (name:string) => numeric(name,{precision:24,scale:6});
export const bankChargeDocument = pgTable('bank_charge_document', {
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull().references(()=>tenant.id),entityId:uuid('entity_id').notNull().references(()=>legalEntity.id),
 status:docStatus('status').notNull().default('draft'),postingDate:date('posting_date').notNull(),bankAccountId:uuid('bank_account_id').notNull(),expenseAccountId:uuid('expense_account_id').notNull(),
 baseAmount:money('base_amount').notNull(),gstAmount:money('gst_amount').notNull().default('0'),totalAmount:money('total_amount').notNull(),referenceKey:text('reference_key').notNull(),
 settlementId:uuid('settlement_id'),evidence:jsonb('evidence').$type<Record<string,unknown>>().notNull(),snapshot:jsonb('snapshot').$type<Record<string,unknown>>(),voucherId:uuid('voucher_id'),
 createdBy:text('created_by').notNull().references(()=>user.id),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),submittedBy:text('submitted_by').references(()=>user.id),submittedAt:timestamp('submitted_at',{withTimezone:true}),
 cancelledBy:text('cancelled_by').references(()=>user.id),cancelledAt:timestamp('cancelled_at',{withTimezone:true}),cancelReason:text('cancel_reason'),
},t=>[uniqueIndex('bank_charge_scope_uq').on(t.id,t.tenantId,t.entityId),uniqueIndex('bank_charge_reference_uq').on(t.entityId,t.referenceKey),
 foreignKey({name:'bank_charge_entity_fk',columns:[t.entityId,t.tenantId],foreignColumns:[legalEntity.id,legalEntity.tenantId]}),
 foreignKey({name:'bank_charge_bank_scope_fk',columns:[t.bankAccountId,t.tenantId,t.entityId],foreignColumns:[glAccount.id,glAccount.tenantId,glAccount.entityId]}),
 foreignKey({name:'bank_charge_expense_scope_fk',columns:[t.expenseAccountId,t.tenantId,t.entityId],foreignColumns:[glAccount.id,glAccount.tenantId,glAccount.entityId]}),
 check('bank_charge_amount_ck',sql`${t.baseAmount}>=0 and ${t.gstAmount}>=0 and ${t.totalAmount}>0 and ${t.totalAmount}=${t.baseAmount}+${t.gstAmount}`)]);
