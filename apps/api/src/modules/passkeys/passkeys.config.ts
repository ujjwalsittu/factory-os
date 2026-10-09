import {z} from 'zod';
import {isIP} from 'node:net';
import type {PasskeyConfig} from './passkeys.types.js';

const envSchema=z.object({
 NODE_ENV:z.enum(['development','test','production']).default('development'),
 PASSKEY_ENABLED:z.enum(['true','false']).default('false'),
 PASSKEY_MAX_PER_USER:z.string().regex(/^\d+$/).default('10').transform(Number).pipe(z.number().int().min(1).max(20)),
});
const invalid=()=>new Error('Invalid PASSKEY configuration');
function exactOrigin(raw:string,production:boolean):URL{
 let url:URL;try{url=new URL(raw);}catch{throw invalid();}
 if(url.origin!==raw||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['https:','http:'].includes(url.protocol))throw invalid();
 if(url.protocol==='http:'&&(production||url.hostname!=='localhost'||!url.port))throw invalid();
 return url;
}
export function loadPasskeyConfig(env:NodeJS.ProcessEnv,base:{webOrigin:string;trustedOrigins:string[]}):PasskeyConfig{
 const parsed=envSchema.safeParse(env);if(!parsed.success)throw invalid();const c=parsed.data;
 if(c.PASSKEY_ENABLED==='false')return {enabled:false,rpId:null,origins:[],maxPerUser:c.PASSKEY_MAX_PER_USER};
 const canonical=exactOrigin(base.webOrigin,c.NODE_ENV==='production');
 const rp=env.PASSKEY_RP_ID;
 if(!rp||rp!==canonical.hostname||isIP(rp)||!(/^(?:localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/.test(rp)))throw invalid();
 if(!base.trustedOrigins.includes(base.webOrigin))throw invalid();
 const origins=env.PASSKEY_ALLOWED_ORIGINS===undefined?[base.webOrigin]:env.PASSKEY_ALLOWED_ORIGINS.split(',').map(origin=>origin.trim());
 if(!origins.length||origins.some(origin=>!origin))throw invalid();
 for(const origin of origins){const url=exactOrigin(origin,c.NODE_ENV==='production');if(!base.trustedOrigins.includes(origin)||(url.hostname!==rp&&!url.hostname.endsWith('.'+rp)))throw invalid();}
 return {enabled:true,rpId:rp,origins:[...new Set(origins)],maxPerUser:c.PASSKEY_MAX_PER_USER};
}
export function passkeyAvailability(config:PasskeyConfig):{enabled:boolean;rpName:'FactoryOS'}{return {enabled:config.enabled,rpName:'FactoryOS'};}
