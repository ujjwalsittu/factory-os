'use client';
import {Alert,Button,Card,CardHeader,Field,Input} from '@factoryos/ui';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api} from '@/lib/api';
import {authClient,startSsoRedirect} from '@/lib/auth-client';
import type {SsoProvider} from './provider-buttons';
type Method={bindingId:string;provider:SsoProvider['id'];label:string;connectedAt:string};
type Selection={provider:SsoProvider['id'];label:string;kind:'link'|'unlink';bindingId?:string};
export function ConnectionCard({user,sessionId}:{user:{id:string;email:string;emailVerified:boolean};sessionId:string}){
 const [providers,setProviders]=useState<SsoProvider[]>([]),[methods,setMethods]=useState<Method[]>([]),[selection,setSelection]=useState<Selection|null>(null),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null),alive=useRef(true);
 const current=async()=>{const result=await authClient.getSession();return alive.current&&result.data?.user.id===user.id&&result.data.session.id===sessionId;};
 const refresh=async()=>{const rows=await api<Method[]>('/sso/methods');if(await current())setMethods(rows);};
 useEffect(()=>{alive.current=true;void Promise.all([api<SsoProvider[]>('/sso/providers'),api<Method[]>('/sso/methods')]).then(async([available,rows])=>{if(await current()){setProviders(available);setMethods(rows);}}).catch(()=>{});return()=>{alive.current=false;};},[user.id,sessionId]);
 const submit=async(e:FormEvent)=>{
  e.preventDefault();if(!selection)return;
  const action=selection,proofPassword=password;setPassword('');setBusy(true);setNotice(null);
  try{
   if(!await current())return;
   const proof=await api<{nonce:string}>('/sso/actions',{method:'POST',body:{provider:action.provider,kind:action.kind,...(action.bindingId?{targetBindingId:action.bindingId}:{}),password:proofPassword}});
   if(!await current())return;
   if(action.kind==='link')await startSsoRedirect(action.provider,'/app/settings/security',proof.nonce);
   else{await api('/sso/methods/'+encodeURIComponent(action.bindingId!)+'/disconnect',{method:'POST',body:{nonce:proof.nonce}});if(await current()){setSelection(null);setNotice('Connection removed.');await refresh();}}
  }catch{if(alive.current)setNotice('Could not change this connection. Verify your email and sign in again with your password and verification code.');}
  finally{if(alive.current)setBusy(false);}
 };
 if(!providers.length&&!methods.length)return null;
 return <Card className="mb-6 max-w-2xl"><CardHeader title="Connected accounts" description={`Connect a provider identity for ${user.email}. Your password and verification code remain available.`}/><div className="space-y-4 px-5 py-5">{notice&&<Alert tone="info">{notice}</Alert>}{!user.emailVerified&&<Alert tone="warning">Verify your email before connecting or disconnecting an account.</Alert>}<p className="text-[13px] text-muted">Sign in within the last five minutes and confirm your password to change a connection.</p><div className="flex flex-wrap gap-3">{providers.filter(p=>!methods.some(m=>m.provider===p.id)).map(p=><Button key={p.id} variant="secondary" disabled={busy||!user.emailVerified} onClick={()=>{setSelection({provider:p.id,label:p.label,kind:'link'});setPassword('');setNotice(null);}}>Connect {p.label}</Button>)}{methods.map(m=><Button key={m.bindingId} variant="secondary" disabled={busy||!user.emailVerified} onClick={()=>{setSelection({provider:m.provider,label:m.label,kind:'unlink',bindingId:m.bindingId});setPassword('');setNotice(null);}}>Disconnect {m.label}</Button>)}</div>{selection&&<form onSubmit={submit} className="space-y-3"><p className="text-sm">{selection.kind==='link'?'Connect':'Disconnect'} {selection.label} for {user.email}</p><Field label="Password for connected accounts">{p=><Input {...p} type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/>}</Field><div className="flex gap-3"><Button type="submit" loading={busy}>{selection.kind==='link'?'Confirm connection':'Confirm disconnection'}</Button><Button variant="secondary" type="button" disabled={busy} onClick={()=>{setSelection(null);setPassword('');}}>Cancel</Button></div></form>}</div></Card>;
}
