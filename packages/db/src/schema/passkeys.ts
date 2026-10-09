// Global existing-account security evidence; independent of tenant business ledgers.
import {sql} from 'drizzle-orm';
import {bigint,boolean,check,index,pgTable,text,timestamp,uniqueIndex,uuid} from 'drizzle-orm/pg-core';
import {user} from './auth.js';
const time=(name:string)=>timestamp(name,{withTimezone:true});
export const passkey=pgTable('passkey',{
 id:text('id').primaryKey(),name:text('name').notNull(),userId:text('user_id').notNull().references(()=>user.id,{onDelete:'cascade'}),
 credentialID:text('credential_id').notNull(),publicKey:text('public_key').notNull(),counter:bigint('counter',{mode:'number'}).notNull(),
 deviceType:text('device_type').notNull(),backedUp:boolean('backed_up').notNull(),transports:text('transports'),aaguid:text('aaguid'),
 rpId:text('rp_id').notNull(),userHandle:text('user_handle').notNull(),registrationActionId:uuid('registration_action_id').notNull(),registrationCeremonyId:uuid('registration_ceremony_id').notNull(),
 createdAt:time('created_at').notNull().defaultNow(),lastUsedAt:time('last_used_at'),
},t=>[uniqueIndex('passkey_credential_uq').on(t.credentialID),index('passkey_owner_idx').on(t.userId),check('passkey_shape_ck',sql`length(btrim(${t.name})) between 1 and 80 and ${t.name}=btrim(${t.name}) and ${t.counter} between 0 and 4294967295 and ${t.credentialID} ~ '^[A-Za-z0-9_-]+$' and length(${t.credentialID}) between 1 and 1024 and length(${t.credentialID})%4<>1 and ${t.userHandle} ~ '^[A-Za-z0-9_-]{43}$' and length(${t.rpId}) between 1 and 253 and length(${t.publicKey})>0 and ${t.deviceType} in ('singleDevice','multiDevice')`)]);
export const authPasskeyAction=pgTable('auth_passkey_action',{
 id:uuid('id').primaryKey().defaultRandom(),userId:text('user_id').notNull(),sessionId:text('session_id').notNull(),
 kind:text('kind').$type<'register'|'rename'|'remove'>().notNull(),targetId:text('target_id'),rpId:text('rp_id').notNull(),configHash:text('config_hash').notNull(),passwordVersion:text('password_version').notNull(),nonceHash:text('nonce_hash').notNull(),
 createdAt:time('created_at').notNull().defaultNow(),expiresAt:time('expires_at').notNull(),consumedAt:time('consumed_at'),
},t=>[uniqueIndex('auth_passkey_action_nonce_uq').on(t.nonceHash),index('auth_passkey_action_expiry_idx').on(t.expiresAt),check('auth_passkey_action_shape_ck',sql`${t.kind} in ('register','rename','remove') and ((${t.kind}='register')=(${t.targetId} is null)) and ${t.nonceHash} ~ '^[a-f0-9]{64}$' and ${t.passwordVersion} ~ '^[a-f0-9]{64}$' and ${t.configHash} ~ '^[a-f0-9]{64}$' and ${t.expiresAt}>${t.createdAt} and ${t.expiresAt}<=${t.createdAt}+interval '300 seconds' and (${t.consumedAt} is null or (${t.consumedAt}>=${t.createdAt} and ${t.consumedAt}<${t.expiresAt}))`)]);
export const authPasskeyCeremony=pgTable('auth_passkey_ceremony',{
 id:uuid('id').primaryKey().defaultRandom(),kind:text('kind').$type<'register'|'signin'>().notNull(),userId:text('user_id'),sessionId:text('session_id'),actionId:uuid('action_id'),
 challengeHash:text('challenge_hash').notNull(),rpId:text('rp_id').notNull(),userHandle:text('user_handle'),returnCipher:text('return_cipher').notNull(),
 credentialId:text('credential_id'),passwordVersion:text('password_version'),
 createdAt:time('created_at').notNull().defaultNow(),expiresAt:time('expires_at').notNull(),consumedAt:time('consumed_at'),
},t=>[uniqueIndex('auth_passkey_ceremony_challenge_uq').on(t.challengeHash),index('auth_passkey_ceremony_expiry_idx').on(t.expiresAt),check('auth_passkey_ceremony_shape_ck',sql`${t.kind} in ('register','signin') and ${t.challengeHash} ~ '^[a-f0-9]{64}$' and ((${t.kind}='register' and ${t.userId} is not null and ${t.sessionId} is not null and ${t.actionId} is not null and ${t.userHandle} is not null and ${t.userHandle} ~ '^[A-Za-z0-9_-]{43}$' and ${t.credentialId} is null and ${t.passwordVersion} is null) or (${t.kind}='signin' and ${t.sessionId} is null and ${t.actionId} is null and ${t.userHandle} is null and ((${t.userId} is null and ${t.credentialId} is null and ${t.passwordVersion} is null and ${t.consumedAt} is null) or (${t.userId} is not null and ${t.credentialId} is not null and ${t.passwordVersion} is not null and ${t.consumedAt} is not null)))) and ${t.expiresAt}>${t.createdAt} and ${t.expiresAt}<=${t.createdAt}+interval '300 seconds' and (${t.passwordVersion} is null or ${t.passwordVersion} ~ '^[a-f0-9]{64}$') and (${t.consumedAt} is null or (${t.consumedAt}>=${t.createdAt} and ${t.consumedAt}<${t.expiresAt}))`)]);
export const authPasskeyEvent=pgTable('auth_passkey_event',{
 id:uuid('id').primaryKey().defaultRandom(),userId:text('user_id').notNull(),credentialId:text('credential_id'),sessionId:text('session_id'),rpId:text('rp_id').notNull(),
 kind:text('kind').$type<'enrolled'|'renamed'|'removed'|'signed_in'|'failed'>().notNull(),code:text('code'),createdAt:time('created_at').notNull().defaultNow(),
},t=>[index('auth_passkey_event_owner_idx').on(t.userId,t.createdAt),check('auth_passkey_event_shape_ck',sql`${t.kind} in ('enrolled','renamed','removed','signed_in','failed') and (${t.code} is null or ${t.code} in ('credential_refused','consent_refused','mfa_refused','configuration_refused'))`)]);
