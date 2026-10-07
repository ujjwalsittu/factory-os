'use client';
import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import {safeNextPath} from './safe-next';

/** Talks to /api/auth on the same origin (proxied to the API). */
export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        const next = new URLSearchParams(window.location.search).get('next') ?? '';
        window.location.href = `/sign-in/two-factor${next ? `?next=${encodeURIComponent(next)}` : ''}`;
      },
    }),
  ],
});

export async function startSsoRedirect(provider:'google'|'microsoft',next:string,nonce?:string){
 const origin=window.location.origin,response=await fetch('/api/auth/'+(nonce?'link-social':'sign-in/social'),{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-factoryos-sso-return':safeNextPath(next),...(nonce?{'x-factoryos-sso-action':nonce}:{})},body:JSON.stringify({provider,callbackURL:origin+'/sso/complete',errorCallbackURL:origin+'/sso/error',disableRedirect:true})});
 if(!response.ok)throw new Error('SSO unavailable');
 const data:unknown=await response.json();if(!data||typeof data!=='object'||!('url' in data)||typeof data.url!=='string')throw new Error('SSO unavailable');
 const url=new URL(data.url);if(url.protocol!=='https:'||!['accounts.google.com','login.microsoftonline.com'].includes(url.hostname))throw new Error('SSO unavailable');
 window.location.assign(url.href);
}
