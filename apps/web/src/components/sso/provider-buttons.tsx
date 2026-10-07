'use client';
import {Alert,Button} from '@factoryos/ui';
import {useEffect,useState} from 'react';
import {api} from '@/lib/api';
import {startSsoRedirect} from '@/lib/auth-client';
export type SsoProvider={id:'google'|'microsoft';label:string};
export function ProviderButtons({next}:{next:string}){
 const [providers,setProviders]=useState<SsoProvider[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 useEffect(()=>{let active=true;void api<SsoProvider[]>('/sso/providers').then(rows=>{if(active)setProviders(rows);}).catch(()=>{});return()=>{active=false;};},[]);
 if(!providers.length)return null;
 return <div className="mt-6 space-y-3">{error&&<Alert tone="danger">Could not start sign-in. Try again or use your password.</Alert>}{providers.map(provider=><Button key={provider.id} variant="secondary" className="w-full" disabled={busy} onClick={async()=>{setBusy(true);setError(false);try{await startSsoRedirect(provider.id,next);}catch{setError(true);setBusy(false);}}}>Continue with {provider.label}</Button>)}</div>;
}
