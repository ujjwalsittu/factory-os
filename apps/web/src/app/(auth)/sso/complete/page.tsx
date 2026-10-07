'use client';
import {useEffect} from 'react';
import {safeNextPath} from '@/lib/safe-next';
import {authClient} from '@/lib/auth-client';
export default function SsoCompletePage(){
 useEffect(()=>{const next=safeNextPath(new URLSearchParams(window.location.search).get('next'));window.history.replaceState(null,'','/sso/complete');let active=true;void authClient.getSession().then(result=>{if(active)window.location.replace(result.data?next:'/sso/error');}).catch(()=>{if(active)window.location.replace('/sso/error');});return()=>{active=false;};},[]);
 return <p className="text-sm text-muted">Completing sign-in…</p>;
}
