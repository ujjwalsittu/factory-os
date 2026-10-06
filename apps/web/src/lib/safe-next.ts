/** Auth navigation stays on the current origin, including escaped input. */
export function safeNextPath(value:string|null|undefined,fallback='/app'):string{
 if(!value||!value.startsWith('/')||value.startsWith('//')||value.includes('\\'))return fallback;
 try{const target=new URL(value,'https://factoryos.invalid');return target.origin==='https://factoryos.invalid'?target.pathname+target.search+target.hash:fallback;}catch{return fallback;}
}
