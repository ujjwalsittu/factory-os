import {emailEnvelopeSchema,emailPurposeSchema,type EmailEnvelope,type EmailPurpose} from './contracts.js';
const escape=(s:string)=>s.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
export function validateEmailActionUrl(purpose:EmailPurpose,url:string,authBaseUrl:string,webOrigin:string):string{
 try{
  emailPurposeSchema.parse(purpose);const u=new URL(url),web=new URL(webOrigin),auth=new URL(authBaseUrl);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash)throw new Error();
  const invitation=purpose==='member_invitation'||purpose==='owner_invitation';
  const prefix=auth.pathname.replace(/\/$/,'').replace(/\/api\/auth$/,'')+'/api/auth';
  if(invitation){if(u.origin!==web.origin||!/^\/invite\/[A-Za-z0-9_-]+$/.test(u.pathname)||u.search)throw new Error();}
  else{
   if(u.origin!==auth.origin)throw new Error();
   const reset=purpose==='password_reset';
   if(reset?!new RegExp('^'+prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/reset-password/[A-Za-z0-9_-]+$').test(u.pathname):u.pathname!==prefix+'/verify-email')throw new Error();
   if(!reset&&!u.searchParams.get('token'))throw new Error();
   for(const name of u.searchParams.keys())if(!['token','callbackURL'].includes(name))throw new Error();
   for(const name of ['token','callbackURL'])if(u.searchParams.getAll(name).length>1)throw new Error();
   const callback=u.searchParams.get('callbackURL');if(callback){const target=new URL(callback,web.origin);if(target.origin!==web.origin||target.pathname!==(reset?'/reset-password':'/verify-email')||target.username||target.password||target.search||target.hash)throw new Error();}
  }
  return url;
 }catch{throw new Error('Invalid email action URL');}
}
export function renderEmail(purpose:EmailPurpose,input:{actionUrl:string;recipient:string;tenantName?:string;sender:EmailEnvelope['sender'];replyTo?:string}):EmailEnvelope{
 try{
  emailPurposeSchema.parse(purpose);
  if(input.tenantName!==undefined&&(input.tenantName.length>200||/[\x00-\x1f\x7f]/.test(input.tenantName)))throw new Error();
  const reset=purpose==='password_reset',verify=purpose==='email_verification';
  const subject=reset?'Reset your FactoryOS password':verify?'Verify your FactoryOS email':`Join ${input.tenantName??'your organization'} on FactoryOS`;
  const intro=reset?'Use this link to reset your password. If you did not request it, ignore this email.':verify?'Confirm your email address for FactoryOS.':`You have been invited to join ${input.tenantName??'your organization'} on FactoryOS.`;
  return emailEnvelopeSchema.parse({recipient:input.recipient,sender:input.sender,...(input.replyTo?{replyTo:input.replyTo}:{}),subject,text:`${intro}\n\n${input.actionUrl}\n\nThis link expires. FactoryOS will never ask you to email your password.`,html:`<p>${escape(intro)}</p><p><a href="${escape(input.actionUrl)}">${reset?'Reset password':verify?'Verify email':'View invitation'}</a></p><p>This link expires. FactoryOS will never ask you to email your password.</p>`,actionUrl:input.actionUrl});
 }catch{throw new Error('Invalid email template input');}
}
