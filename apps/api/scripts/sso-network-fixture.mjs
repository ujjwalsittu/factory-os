// Test-only network boundary. Real provider verification, OAuth state, PKCE,
// adapter, hooks and session creation remain inside the installed framework.
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createHash,randomUUID} from 'node:crypto';
export const syntheticTenant='11111111-2222-4333-8444-555555555555';
export async function syntheticProviders(){
 const keys=await generateKeyPair('RS256',{extractable:true}),wrong=await generateKeyPair('RS256'),jwk={...await exportJWK(keys.publicKey),kid:'sso-fixture',alg:'RS256',use:'sig'},original=globalThis.fetch,registry=new Map(),exchanges=[];
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
 globalThis.fetch=async(input,init)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url==='https://www.googleapis.com/oauth2/v3/certs'||url===`https://login.microsoftonline.com/${syntheticTenant}/discovery/v2.0/keys`)return json({keys:[jwk]});
  const provider=url==='https://oauth2.googleapis.com/token'?'google':url===`https://login.microsoftonline.com/${syntheticTenant}/oauth2/v2.0/token`?'microsoft':null;
  if(!provider){if(new URL(url).hostname==='localhost'||new URL(url).hostname==='127.0.0.1')return original(input,init);throw new Error('Unexpected external request in SSO fixture');}
  const body=new URLSearchParams(init?.body??(input instanceof Request?await input.text():'')),code=body.get('code'),record=registry.get(code);
  if(!record||record.provider!==provider||record.used)return json({error:'invalid_grant'},400);
  record.used=true;
  const verifier=body.get('code_verifier');if(!verifier||createHash('sha256').update(verifier).digest('base64url')!==record.challenge||body.get('redirect_uri')!==record.redirectUri)return json({error:'invalid_grant'},400);
  exchanges.push({provider,pkce:true,scopes:record.scopes});
  const claims={iss:provider==='google'?'https://accounts.google.com':`https://login.microsoftonline.com/${syntheticTenant}/v2.0`,aud:provider==='google'?'synthetic-google':'synthetic-ms',sub:record.subject,oid:record.subject,tid:syntheticTenant,email:record.email,email_verified:provider==='google',name:'Provider name must not overwrite local',hd:'example.test',...record.claims};
  let jwt=new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'sso-fixture'}).setIssuedAt().setExpirationTime('5m');
  if(record.expired)jwt=jwt.setExpirationTime(Math.floor(Date.now()/1000)-60);
  const idToken=await jwt.sign(record.badSignature?wrong.privateKey:keys.privateKey);
  record.idToken=idToken;return json({access_token:'synthetic-access-token-canary',refresh_token:'synthetic-refresh-token-canary',id_token:idToken,token_type:'Bearer',expires_in:300,scope:'openid profile email'});
 };
 return {exchanges,registry,authorize(url,input={}){const u=new URL(url),provider=u.hostname==='accounts.google.com'?'google':'microsoft';const code=randomUUID(),record={provider,challenge:u.searchParams.get('code_challenge'),redirectUri:u.searchParams.get('redirect_uri'),scopes:u.searchParams.get('scope'),subject:input.subject??'synthetic-subject',email:input.email??'owner@example.test',...input};registry.set(code,record);return {code,state:u.searchParams.get('state'),record,callback:record.redirectUri+'?'+new URLSearchParams({code,state:u.searchParams.get('state')})};},close(){globalThis.fetch=original;}};
}
