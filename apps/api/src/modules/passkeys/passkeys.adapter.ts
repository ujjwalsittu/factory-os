import {AsyncLocalStorage} from 'node:async_hooks';
import {drizzleAdapter} from 'better-auth/adapters/drizzle';
import {getCurrentAdapter,runWithTransaction} from '@better-auth/core/context';
import type {Database} from '@factoryos/db';
import type {AuthTransaction,NativeAdapter,NativeAdapterFactory} from './passkeys.types.js';

type Scope={facade:NativeAdapter;native:NativeAdapter;tx:AuthTransaction;authorityWrite?:boolean;safeMfaFailure?:boolean;registration?:Extract<import('./passkeys.types.js').PasskeyFrame,{mode:'register'}>};
const transactions=new AsyncLocalStorage<Scope>();
type TransactionEntry=<T>(work:()=>Promise<T>)=>Promise<T>;
const entries=new WeakMap<NativeAdapter,TransactionEntry>();
export function isPasskeyAdapter(value:unknown):value is NativeAdapter{return typeof value==='object'&&value!==null&&entries.has(value as NativeAdapter);}
export function requirePasskeyTransaction():AuthTransaction{
 const scope=transactions.getStore();if(!scope)throw new Error('Passkey transaction required');return scope.tx;
}
export function getPasskeyTransaction():AuthTransaction|undefined{return transactions.getStore()?.tx;}
export function markNativeMfaFailure():void{const scope=transactions.getStore();if(!scope)throw new Error('Passkey transaction required');scope.safeMfaFailure=true;}
export function canPreserveNativeMfaFailure():boolean{const scope=transactions.getStore();return !!scope?.safeMfaFailure&&!scope.authorityWrite;}
export function stampVerifiedRegistration(frame:Extract<import('./passkeys.types.js').PasskeyFrame,{mode:'register'}>):void{
 const scope=transactions.getStore();if(!scope)throw new Error('Passkey transaction required');scope.registration=frame;
}
function scopedNative(native:NativeAdapter):NativeAdapter{
 return new Proxy(native,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);if(key!=='create')return value;
  return (input:Parameters<NativeAdapter['create']>[0])=>{const scope=transactions.getStore(),frame=scope?.registration;
   if(scope&&(input.model==='session'||input.model==='passkey'))scope.authorityWrite=true;
   if(input.model!=='passkey'||!frame)return target.create(input);
   if(input.data.userId!==frame.userId)throw new Error('Passkey owner refused');
   return target.create({...input,data:{...input.data,rpId:frame.rpId,userHandle:frame.userHandle,registrationActionId:frame.actionId,registrationCeremonyId:frame.ceremonyId}});
  };
 }});
}
export function createTransactionalAuthAdapter(db:Database,authSchema:NonNullable<Parameters<typeof drizzleAdapter>[1]>['schema']):NativeAdapterFactory{
 return options=>{
  const native=drizzleAdapter(db,{provider:'pg',schema:authSchema,transaction:false})(options);
  const facade:NativeAdapter=new Proxy(native,{
   get(target,key,receiver){
    if(key==='transaction')return async (work:Parameters<NativeAdapter['transaction']>[0])=>{
     const current=transactions.getStore();if(current?.facade===facade)return work(current.native);
     // Only explicitly scoped passkey calls gain the shared SQL transaction.
     return native.transaction(work);
    };
    const value=Reflect.get(target,key,receiver);if(typeof value!=='function')return value;
    return async (...args:unknown[])=>{
     const scope=transactions.getStore();let delegated:Awaited<ReturnType<typeof getCurrentAdapter>>=target;
     if(scope?.facade===facade){
      const current=await getCurrentAdapter(scope.native);
      // Native HTTP handling can reset its ALS to the facade. SQL scope still owns this request.
      delegated=current===facade?scope.native:current;
     }
     return Reflect.apply(Reflect.get(delegated,key),delegated,args);
    };
   },
  });
  entries.set(facade,async work=>{
   if(transactions.getStore()?.facade===facade)return await work();
   return await db.transaction(async tx=>{
    const scoped=scopedNative(drizzleAdapter(tx,{provider:'pg',schema:authSchema,transaction:false})(options));
    return await transactions.run({facade,native:scoped,tx},work);
   });
  });return facade;
 };
}
export async function withPasskeyTransaction<T>(adapter:NativeAdapter,work:()=>Promise<T>):Promise<T>{
 const enter=entries.get(adapter);if(!enter)throw new Error('Passkey transaction adapter required');
 return await enter(async()=>await runWithTransaction(adapter,work));
}
