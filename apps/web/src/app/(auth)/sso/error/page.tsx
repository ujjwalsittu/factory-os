'use client';
import {useEffect,useState} from 'react';
import {Alert} from '@factoryos/ui';
import Link from 'next/link';
export default function SsoErrorPage(){
 const [ready,setReady]=useState(false);useEffect(()=>{window.history.replaceState(null,'','/sso/error');setReady(true);},[]);
 if(!ready)return <p className="text-sm text-muted">Returning to sign-in…</p>;
 return <><h1 className="text-2xl font-semibold">Sign-in incomplete</h1><Alert tone="warning" className="mt-6">Could not complete sign-in or connection. Try again or use your password.</Alert><Link href="/sign-in" className="mt-6 text-accent">Return to sign-in</Link></>;
}
