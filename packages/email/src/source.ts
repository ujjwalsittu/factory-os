import {createHash} from 'node:crypto';
import {invitation,tenant,user,verification,type Database} from '@factoryos/db';
import {and,eq} from 'drizzle-orm';
import {jwtVerify} from 'jose';
import {emailAad} from './envelope.js';
import type {EnqueueEmail,EmailEnvelope} from './contracts.js';
export type EmailSourceValidation={valid:true}|{valid:false;status:'cancelled'|'expired'|'superseded';code:'source_cancelled'|'source_expired'|'source_superseded'};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const cancelled:EmailSourceValidation={valid:false,status:'cancelled',code:'source_cancelled'};
const expired:EmailSourceValidation={valid:false,status:'expired',code:'source_expired'};
export async function validateEmailSource(db:Database,input:EnqueueEmail,envelope:EmailEnvelope,authSecret:string,now=new Date()):Promise<EmailSourceValidation>{
 emailAad(input.purpose,input.source);if(input.sourceExpiresAt<=now)return expired;
 const source=input.source,u=new URL(envelope.actionUrl);
 if(source.kind==='invitation'){
  const [row]=await db.select({inv:invitation,tenantStatus:tenant.status}).from(invitation).innerJoin(tenant,eq(tenant.id,invitation.tenantId)).where(and(eq(invitation.id,source.invitationId),eq(invitation.tenantId,source.tenantId)));
  if(!row||row.tenantStatus!=='active'||row.inv.status!=='pending'||row.inv.email!==envelope.recipient.toLowerCase())return cancelled;
  if(row.inv.expiresAt<=now||row.inv.expiresAt.getTime()!==input.sourceExpiresAt.getTime())return expired;
  const token=u.pathname.split('/').at(-1);if(!token||hash(token)!==row.inv.tokenHash)return cancelled;return {valid:true};
 }
 const [account]=await db.select().from(user).where(eq(user.id,source.userId));if(!account||account.email.toLowerCase()!==envelope.recipient.toLowerCase())return cancelled;
 if(source.kind==='password_reset'){
  const token=u.pathname.split('/').at(-1),[record]=await db.select().from(verification).where(eq(verification.id,source.verificationId));
  if(!token||!record||record.identifier!==`reset-password:${token}`||record.value!==source.userId)return cancelled;
  if(record.expiresAt<=now||record.expiresAt.getTime()!==input.sourceExpiresAt.getTime())return expired;return {valid:true};
 }
 if(account.emailVerified)return cancelled;
 const token=u.searchParams.get('token');if(!token||hash(token)!==source.tokenDigest)return cancelled;
 try{const {payload}=await jwtVerify(token,new TextEncoder().encode(authSecret),{algorithms:['HS256'],currentDate:now});if(payload.email!==account.email.toLowerCase()||payload.updateTo!==undefined||payload.requestType!==undefined||typeof payload.exp!=='number'||payload.exp*1000!==input.sourceExpiresAt.getTime())return cancelled;return {valid:true};}catch{return cancelled;}
}
