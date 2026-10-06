import {z} from 'zod';
import type {Database} from '@factoryos/db';
export type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
export const emailPurposeSchema=z.enum(['password_reset','email_verification','member_invitation','owner_invitation']);
export type EmailPurpose=z.infer<typeof emailPurposeSchema>;
export const emailStatusSchema=z.enum(['unconfigured','queued','dispatching','retry_scheduled','accepted','failed','unknown','expired','cancelled','superseded']);
export type EmailStatus=z.infer<typeof emailStatusSchema>;
export const emailSourceSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('invitation'),tenantId:z.uuid(),invitationId:z.uuid()}),
 z.strictObject({kind:z.literal('password_reset'),userId:z.string().min(1).max(256),verificationId:z.string().min(1).max(256)}),
 z.strictObject({kind:z.literal('email_verification'),userId:z.string().min(1).max(256),tokenDigest:z.string().regex(/^[a-f0-9]{64}$/)}),
]);
export type EmailSource=z.infer<typeof emailSourceSchema>;
const header=z.string().min(1).max(200).refine(s=>!/[\x00-\x1f\x7f]/.test(s));
export const senderSchema=z.strictObject({address:z.email().max(254),name:header});
export const emailEnvelopeSchema=z.strictObject({recipient:z.email().max(254),sender:senderSchema,replyTo:z.email().max(254).optional(),subject:header,text:z.string(),html:z.string(),actionUrl:z.url().refine(s=>{const u=new URL(s);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;})});
export type EmailEnvelope=z.infer<typeof emailEnvelopeSchema>;
export const cipherEnvelopeSchema=z.strictObject({keyVersion:z.literal('v1'),iv:z.string(),tag:z.string(),ciphertext:z.string()});
export type CipherEnvelope=z.infer<typeof cipherEnvelopeSchema>;
export interface EnqueueEmail{purpose:EmailPurpose;source:EmailSource;sourceExpiresAt:Date;dedupeKey:string;templateVersion:'v1';envelope:EmailEnvelope|null}
export type EmailOutcome={kind:'accepted';remoteId?:string}|{kind:'temporary'|'permanent'|'unknown';code:string};
export interface EmailTransport{send(envelope:EmailEnvelope,messageId:string):Promise<EmailOutcome>}
export interface EmailClaim{deliveryId:string;leaseToken:string;attemptId:string;input:EnqueueEmail;cipher:CipherEnvelope;retryCount:number}
export interface DeliveryView{id:string;purpose:EmailPurpose;status:EmailStatus;recipient:string;createdAt:string;lastAttemptAt:string|null;nextAttemptAt:string|null;errorCode:string|null;invitationId:string|null}
const codes=new Set(['auth_refused','recipient_refused','temporary_refusal','config_unavailable','key_unavailable','transport_timeout','transport_unknown','source_expired','source_cancelled','source_superseded','lease_expired']);
/** Never preserve provider response text, objects or recipient-bearing IDs. */
export function redactEmailOutcome(value:unknown):EmailOutcome{
 const v=value&&typeof value==='object'?value as Record<string,unknown>:{};
 if(v.kind==='accepted')return typeof v.remoteId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v.remoteId)?{kind:'accepted',remoteId:v.remoteId}:{kind:'accepted'};
 const kind=v.kind==='temporary'||v.kind==='permanent'?v.kind:'unknown';
 return {kind,code:typeof v.code==='string'&&codes.has(v.code)?v.code:'transport_unknown'};
}
