import {createHash,createHmac} from 'node:crypto';
import {type Database,verification} from '@factoryos/db';
import {emailAad,enqueueEmailIn,renderEmail,validateEmailActionUrl,reserveEmailRateIn} from '@factoryos/email';
import {eq} from 'drizzle-orm';
import {decodeJwt} from 'jose';
import {createAuthMiddleware} from 'better-auth/api';
import type {AppConfig} from '../../config.js';
import type {EmailService} from './email.service.js';
const genericReset={status:true,message:'If this email exists in our system, check your email for the reset link'};
const digest=(secret:string,purpose:string,value:string)=>createHmac('sha256',secret).update(purpose+'\0'+value).digest('hex');
interface CallbackUser{id:string;email:string}
export function authEmailCallbacks(db:Database,config:AppConfig,email:EmailService){
 const enqueue=async(purpose:'password_reset'|'email_verification',data:{user:CallbackUser;url:string;token:string})=>{
  try{
   let source,sourceExpiresAt:Date;
   if(purpose==='password_reset'){const [record]=await db.select().from(verification).where(eq(verification.identifier,`reset-password:${data.token}`));if(!record||record.value!==data.user.id)throw new Error('Source unavailable');source={kind:'password_reset' as const,userId:data.user.id,verificationId:record.id};sourceExpiresAt=record.expiresAt;}
   else{const jwt=decodeJwt(data.token);if(typeof jwt.exp!=='number')throw new Error('Source unavailable');source={kind:'email_verification' as const,userId:data.user.id,tokenDigest:createHash('sha256').update(data.token).digest('hex')};sourceExpiresAt=new Date(jwt.exp*1000);}
   const url=new URL(data.url);url.searchParams.set('callbackURL',new URL(purpose==='password_reset'?'/reset-password':'/verify-email',config.WEB_ORIGIN).toString());
   const actionUrl=validateEmailActionUrl(purpose,url.toString(),config.BETTER_AUTH_URL,config.WEB_ORIGIN),mail=config.email;
   const envelope=mail.mode==='smtp'?renderEmail(purpose,{actionUrl,recipient:data.user.email,sender:mail.sender,...(mail.replyTo?{replyTo:mail.replyTo}:{})}):null;
   await db.transaction(tx=>enqueueEmailIn(tx,{purpose,source,sourceExpiresAt,dedupeKey:emailAad(purpose,source),templateVersion:'v1',envelope},mail.mode==='smtp'?mail.payloadKey:undefined));
  }catch{email.noteAuthEnqueueFailure();}// Public outcome cannot disclose that a known user's queue failed.
 };
 return {sendResetPassword:(data:{user:CallbackUser;url:string;token:string})=>enqueue('password_reset',data),sendVerificationEmail:async(data:{user:CallbackUser;url:string;token:string},request?:Request)=>{
  // Signup has no explicit resend hook; record its initial verification in the same limits.
  if(request&&new URL(request.url).pathname.endsWith('/sign-up/email')){try{const allowed=await db.transaction(tx=>reserveEmailRateIn(tx,digest(config.BETTER_AUTH_SECRET,'email_verification',data.user.email.toLowerCase()),digest(config.BETTER_AUTH_SECRET,'origin',request.headers.get('x-factoryos-mail-origin')??'internal'),'email_verification',new Date(),{recipientPerHour:config.EMAIL_VERIFICATION_MAX_PER_HOUR,originPer10Minutes:config.EMAIL_ORIGIN_MAX_PER_10_MIN,verificationCooldownSeconds:config.EMAIL_VERIFICATION_COOLDOWN_SECONDS}));if(!allowed)return;}catch{email.noteAuthEnqueueFailure();return;}}
  await enqueue('email_verification',data);
 },before:createAuthMiddleware(async ctx=>{
  const purpose=ctx.path==='/request-password-reset'?'password_reset':ctx.path==='/send-verification-email'?'email_verification':null;
  if(!purpose||typeof ctx.body?.email!=='string')return;
  const address=ctx.body.email.trim().toLowerCase();
  // Set by the API adapter from its trusted peer/proxy policy; direct library calls share a fallback bucket.
  const origin=ctx.request?.headers.get('x-factoryos-mail-origin')??'internal';
  try{const allowed=await db.transaction(tx=>reserveEmailRateIn(tx,digest(config.BETTER_AUTH_SECRET,purpose,address),digest(config.BETTER_AUTH_SECRET,'origin',origin),purpose,new Date(),{recipientPerHour:purpose==='password_reset'?config.EMAIL_RESET_MAX_PER_HOUR:config.EMAIL_VERIFICATION_MAX_PER_HOUR,originPer10Minutes:config.EMAIL_ORIGIN_MAX_PER_10_MIN,verificationCooldownSeconds:config.EMAIL_VERIFICATION_COOLDOWN_SECONDS}));if(!allowed)return ctx.json(purpose==='password_reset'?genericReset:{status:true});}catch{email.noteAuthEnqueueFailure();return ctx.json(purpose==='password_reset'?genericReset:{status:true});}
 })};
}
