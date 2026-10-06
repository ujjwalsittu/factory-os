import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {cipherEnvelopeSchema,emailEnvelopeSchema,emailPurposeSchema,emailSourceSchema,type CipherEnvelope,type EmailEnvelope,type EmailPurpose,type EmailSource} from './contracts.js';
export function emailAad(purpose:EmailPurpose,source:EmailSource):string{
 const p=emailPurposeSchema.parse(purpose),s=emailSourceSchema.parse(source);
 if((p==='password_reset'&&s.kind!=='password_reset')||(p==='email_verification'&&s.kind!=='email_verification')||((p==='member_invitation'||p==='owner_invitation')&&s.kind!=='invitation'))throw new Error('Invalid email source binding');
 return JSON.stringify(['factoryos-email-v1',p,s.kind,...(s.kind==='invitation'?[s.tenantId,s.invitationId]:s.kind==='password_reset'?[s.userId,s.verificationId]:[s.userId,s.tokenDigest])]);
}
const keyCheck=(key:Buffer)=>{if(key.length!==32)throw new Error('Invalid email envelope key');};
const decode=(s:string,length?:number)=>{const b=Buffer.from(s,'base64');if(b.toString('base64')!==s||(length!==undefined&&b.length!==length))throw new Error();return b;};
export function sealEmail(input:EmailEnvelope,key:Buffer,aad:string):CipherEnvelope{
 keyCheck(key);const value=emailEnvelopeSchema.parse(input),bytes=Buffer.from(JSON.stringify(value));if(bytes.length>65536)throw new Error('Email envelope exceeds 64KiB');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);return {keyVersion:'v1',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
}
export function openEmail(input:CipherEnvelope,key:Buffer,aad:string):EmailEnvelope{
 try{keyCheck(key);const c=cipherEnvelopeSchema.parse(input),bytes=decode(c.ciphertext);if(bytes.length>65536)throw new Error();const decipher=createDecipheriv('aes-256-gcm',key,decode(c.iv,12));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(decode(c.tag,16));const json=Buffer.concat([decipher.update(bytes),decipher.final()]);return emailEnvelopeSchema.parse(JSON.parse(json.toString('utf8')));}catch{throw new Error('Invalid email envelope');}
}
