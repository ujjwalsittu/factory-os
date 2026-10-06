import nodemailer from 'nodemailer';
import {emailEnvelopeSchema,type EmailTransport,type EmailOutcome} from './contracts.js';
import type {EmailConfig} from './config.js';
/** Transport exceptions are deliberately categorized without returning server response text. */
export function classifySmtpError(error:unknown):EmailOutcome{
 const e=error&&typeof error==='object'?error as Record<string,unknown>:{};
 const responseCode=typeof e.responseCode==='number'?e.responseCode:0;
 if(e.code==='EAUTH')return {kind:'permanent',code:'auth_refused'};
 if(responseCode>=500&&responseCode<600)return {kind:'permanent',code:'recipient_refused'};
 if(responseCode>=400&&responseCode<500)return {kind:'temporary',code:'temporary_refusal'};
 if(e.errno==='ECONNREFUSED'||e.code==='EDNS')return {kind:'temporary',code:'transport_timeout'};
 return {kind:'unknown',code:'transport_unknown'};
}
export function createSmtpTransport(config:EmailConfig):EmailTransport{
 if(config.mode!=='smtp')throw new Error('Email transport unavailable');
 const client=nodemailer.createTransport({host:config.smtp.host.replace(/^\[|\]$/g,''),port:config.smtp.port,secure:config.smtp.tls==='implicit-tls',requireTLS:config.smtp.tls==='starttls-required',ignoreTLS:config.smtp.tls==='plaintext-loopback-test',...(config.smtp.user?{auth:{user:config.smtp.user,pass:config.smtp.password!}}:{}),tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeout:30000,greetingTimeout:30000,socketTimeout:30000,pool:false,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
 return {async send(input,messageId){
  try{const envelope=emailEnvelopeSchema.parse(input);if(!/^<email-[a-f0-9-]{36}@factoryos\.invalid>$/.test(messageId))throw new Error('Invalid Message-ID');const info=await client.sendMail({from:{address:envelope.sender.address,name:envelope.sender.name},to:envelope.recipient,...(envelope.replyTo?{replyTo:envelope.replyTo}:{}),subject:envelope.subject,text:envelope.text,html:envelope.html,messageId,disableFileAccess:true,disableUrlAccess:true});return info.accepted.length?{kind:'accepted'}:{kind:'permanent',code:'recipient_refused'};}catch(error){return classifySmtpError(error);}
 }};
}
