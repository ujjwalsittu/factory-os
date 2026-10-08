'use client';
import {Alert,Button} from '@factoryos/ui';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {z} from 'zod';
import {authClient} from '@/lib/auth-client';
import {passkeyRequest,passkeySupported,signInPasskey} from '@/lib/passkeys';
export function PasskeySignInButton({next}:{next:string}){
 const router=useRouter(),session=authClient.useSession(),[available,setAvailable]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),request=useRef<AbortController|null>(null);
 useEffect(()=>{const controller=new AbortController();void passkeyRequest('/api/passkeys/availability',undefined,controller.signal).then(data=>{const result=z.object({enabled:z.boolean(),rpName:z.literal('FactoryOS')}).strict().parse(data);setAvailable(result.enabled&&passkeySupported());}).catch(()=>{});return()=>{controller.abort();request.current?.abort();};},[]);
 if(!available||session.data?.user)return null;
 const start=async()=>{if(request.current)return;const controller=new AbortController();request.current=controller;setBusy(true);setError(null);try{const result=await signInPasskey(next,controller.signal);if(!controller.signal.aborted)router.replace(result.twoFactorRedirect?'/sign-in/two-factor?'+new URLSearchParams({next:result.next}):result.next);}catch{if(!controller.signal.aborted)setError('Passkey request was not completed. Use your password or try again.');}finally{if(request.current===controller){request.current=null;if(!controller.signal.aborted)setBusy(false);}}};
 return <div className="mt-4 space-y-3">{error&&<Alert tone="info">{error}</Alert>}<Button type="button" variant="secondary" className="w-full" loading={busy} onClick={start}>Sign in with a passkey</Button>{busy&&<Button type="button" variant="link" onClick={()=>{request.current?.abort();request.current=null;setBusy(false);}}>Cancel passkey request</Button>}</div>;
}
