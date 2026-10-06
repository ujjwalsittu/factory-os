import {emailWorkerHeartbeat,type Database} from '@factoryos/db';
import type {EmailConfig} from './config.js';
import type {EmailTransport} from './contracts.js';
import {emailAad,openEmail} from './envelope.js';
import {validateEmailActionUrl} from './templates.js';
import {abandonEmail,claimEmail,finishEmail,reclaimEmailLeases,startEmailDispatch,expireEmailSources} from './queue.js';
import {validateEmailSource} from './source.js';
export async function runEmailOnce(db:Database,config:EmailConfig,transport:EmailTransport,now=new Date(),workerId='email-worker',shouldStop:()=>boolean=()=>false):Promise<boolean>{
 const startedAt=Date.now();
 // Advance the supplied clock through awaited DB work as well as SMTP work.
 const currentNow=()=>new Date(now.getTime()+Math.max(0,Date.now()-startedAt));
 await db.insert(emailWorkerHeartbeat).values({id:workerId,lastSeenAt:now,configurationState:config.mode==='smtp'?'ready':'disabled'}).onConflictDoUpdate({target:emailWorkerHeartbeat.id,set:{lastSeenAt:now,configurationState:config.mode==='smtp'?'ready':'disabled'}});
 if(config.mode!=='smtp'||!config.workerEnabled)return false;
 await reclaimEmailLeases(db,currentNow());await expireEmailSources(db,currentNow());
 if(shouldStop())return false;
 const claim=await claimEmail(db,workerId,currentNow());if(!claim)return false;
 let envelope;
 try{envelope=openEmail(claim.cipher,config.payloadKey,emailAad(claim.input.purpose,claim.input.source));validateEmailActionUrl(claim.input.purpose,envelope.actionUrl,config.authBaseUrl,config.webOrigin);}catch{await abandonEmail(db,claim,'failed','key_unavailable',currentNow());return true;}
 let validation;
 try{validation=await validateEmailSource(db,claim.input,envelope,config.authSecret,currentNow());}catch{return true;}// A DB failure leaves a definitely-unsent lease recoverable; never infer valid source.
 if(!validation.valid){await abandonEmail(db,claim,validation.status,validation.code,currentNow());return true;}
 if(shouldStop())return true;
 if(!await startEmailDispatch(db,claim,currentNow()))return true;
 let outcome;
 try{outcome=await transport.send(envelope,`<email-${claim.deliveryId}@factoryos.invalid>`);}catch{outcome={kind:'unknown' as const,code:'transport_unknown'};}
 // Use actual elapsed time even for a supplied fixture clock; a slow transport cannot outlive its fence.
 await finishEmail(db,claim,outcome,currentNow());return true;
}
