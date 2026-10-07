import {z} from 'zod';
import type {ProviderAvailability,SsoConfig} from './sso.types.js';

const enabled=z.enum(['true','false']).default('false');
const secret=z.string().min(1).max(4096).refine(v=>!/[\x00-\x1f\x7f]/.test(v)).optional();
const schema=z.object({
  SSO_GOOGLE_ENABLED:enabled,SSO_GOOGLE_CLIENT_ID:secret,SSO_GOOGLE_CLIENT_SECRET:secret,
  SSO_GOOGLE_ALLOWED_HOSTED_DOMAINS:z.string().default(''),
  SSO_MICROSOFT_ENABLED:enabled,SSO_MICROSOFT_CLIENT_ID:secret,SSO_MICROSOFT_CLIENT_SECRET:secret,
  SSO_MICROSOFT_TENANT_ID:z.string().optional(),
});
export function loadSsoConfig(env:NodeJS.ProcessEnv):SsoConfig {
  const parsed=schema.safeParse(Object.fromEntries(Object.entries(env).filter(([,v])=>v!==''&&v!==undefined)));
  if(!parsed.success)throw new Error('Invalid SSO configuration');
  const c=parsed.data;
  const googleOn=c.SSO_GOOGLE_ENABLED==='true',microsoftOn=c.SSO_MICROSOFT_ENABLED==='true';
  if(!googleOn&&!microsoftOn)return {google:null,microsoft:null};
  try {
    const auth=new URL(env.BETTER_AUTH_URL!),web=new URL(env.WEB_ORIGIN!);
    for(const u of [auth,web])if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol!=='https:'&&(env.NODE_ENV==='production'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname))))throw new Error();
    if(auth.origin!==web.origin)throw new Error();
  }catch {throw new Error('Invalid SSO canonical origins');}
  if(googleOn&&(!c.SSO_GOOGLE_CLIENT_ID||!c.SSO_GOOGLE_CLIENT_SECRET))throw new Error('Incomplete Google SSO configuration');
  if(microsoftOn&&(!c.SSO_MICROSOFT_CLIENT_ID||!c.SSO_MICROSOFT_CLIENT_SECRET||!z.uuid().safeParse(c.SSO_MICROSOFT_TENANT_ID).success))throw new Error('Incomplete Microsoft SSO configuration; organization UUID required');
  if(/[\x00-\x1f\x7f]/.test(c.SSO_GOOGLE_ALLOWED_HOSTED_DOMAINS))throw new Error('Invalid SSO hosted domains');
  const domains=[...new Set(c.SSO_GOOGLE_ALLOWED_HOSTED_DOMAINS.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean))];
  if(domains.some(v=>v.length>253||!v.includes('.')||v.split('.').some(label=>!(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))))throw new Error('Invalid SSO hosted domains');
  const tenant=c.SSO_MICROSOFT_TENANT_ID?.toLowerCase();
  return {google:googleOn?{clientId:c.SSO_GOOGLE_CLIENT_ID!,clientSecret:c.SSO_GOOGLE_CLIENT_SECRET!,allowedHostedDomains:domains}:null,microsoft:microsoftOn?{clientId:c.SSO_MICROSOFT_CLIENT_ID!,clientSecret:c.SSO_MICROSOFT_CLIENT_SECRET!,tenantId:tenant!,issuer:`https://login.microsoftonline.com/${tenant}/v2.0`}:null};
}
export function providerAvailability(config:SsoConfig):ProviderAvailability[] {
  return [...(config.google?[{id:'google' as const,label:'Google'}]:[]),...(config.microsoft?[{id:'microsoft' as const,label:'Microsoft'}]:[])];
}
