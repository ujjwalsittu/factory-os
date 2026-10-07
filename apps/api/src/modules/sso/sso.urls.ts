import type {SsoReturn} from './sso.types.js';

export function validateSsoReturn(value:string|undefined):SsoReturn {
  if(value===undefined)return '/app';
  if(value.length>2048)throw new Error('Invalid SSO return');
  let decoded=value;
  for(let i=0;i<5;i++){
    if(!decoded.startsWith('/')||decoded.startsWith('//')||/[\\\x00-\x20\x7f]/.test(decoded))throw new Error('Invalid SSO return');
    let next:string;try {next=decodeURIComponent(decoded);}catch {throw new Error('Invalid SSO return');}
    if(next===decoded)return value;
    decoded=next;
  }
  throw new Error('Invalid SSO return');
}
export function ssoLanding(origin:string,kind:'success'|'error'):string {
  return new URL(kind==='success'?'/sso/complete':'/sso/error',origin).href;
}
