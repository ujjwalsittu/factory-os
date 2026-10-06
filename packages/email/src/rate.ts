import {createHash} from 'node:crypto';
import {and,desc,eq,sql} from 'drizzle-orm';
import {emailRateLimit} from '@factoryos/db';
import type {Tx} from './contracts.js';
export interface EmailRatePolicy{recipientPerHour:number;originPer10Minutes:number;verificationCooldownSeconds:number}
export async function reserveEmailRateIn(tx:Tx,recipientDigest:string,originDigest:string,purpose:'password_reset'|'email_verification',now=new Date(),policy:EmailRatePolicy={recipientPerHour:5,originPer10Minutes:30,verificationCooldownSeconds:60}):Promise<boolean>{
 if(![recipientDigest,originDigest].every(s=>/^[a-f0-9]{64}$/.test(s))||!Number.isFinite(now.getTime())||![policy.recipientPerHour,policy.originPer10Minutes].every(n=>Number.isInteger(n)&&n>0&&n<=1000)||!Number.isInteger(policy.verificationCooldownSeconds)||policy.verificationCooldownSeconds<0||policy.verificationCooldownSeconds>3600)throw new Error('Invalid email rate policy');
 // Locks use only irreversible identities; lock order is stable across concurrent origins.
 await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'email-origin:'+originDigest}))`);await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'email-recipient:'+recipientDigest}))`);
 const reserve=async(kind:'recipient'|'origin',identityHash:string,period:number,max:number)=>{const windowStartedAt=new Date(Math.floor(now.getTime()/period)*period);const [row]=await tx.insert(emailRateLimit).values({identityHash,kind,windowStartedAt,count:1,expiresAt:new Date(windowStartedAt.getTime()+period)}).onConflictDoUpdate({target:[emailRateLimit.kind,emailRateLimit.identityHash,emailRateLimit.windowStartedAt],set:{count:sql`least(${emailRateLimit.count}+1,1001)`}}).returning();return row!.count<=max;};
 if(!await reserve('origin',originDigest,600000,policy.originPer10Minutes))return false;
 if(!await reserve('recipient',recipientDigest,3600000,policy.recipientPerHour))return false;
 if(purpose==='email_verification'&&policy.verificationCooldownSeconds>0){const identityHash=createHash('sha256').update('cooldown:'+recipientDigest).digest('hex');const [last]=await tx.select().from(emailRateLimit).where(and(eq(emailRateLimit.kind,'recipient'),eq(emailRateLimit.identityHash,identityHash))).orderBy(desc(emailRateLimit.windowStartedAt)).limit(1);if(last&&last.windowStartedAt.getTime()+policy.verificationCooldownSeconds*1000>now.getTime())return false;await tx.insert(emailRateLimit).values({kind:'recipient',identityHash,windowStartedAt:now,count:1,expiresAt:new Date(now.getTime()+3600000)});}
 return true;
}
