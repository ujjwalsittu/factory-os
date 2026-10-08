// Synthetic authenticator only: genuine P-256/COSE/CBOR and DER signatures.
import {generateKeyPairSync,randomBytes,createHash,sign} from 'node:crypto';
const b64=value=>Buffer.from(value).toString('base64url');
const sha=value=>createHash('sha256').update(value).digest();
function head(major,n){if(n<24)return Buffer.from([major*32+n]);if(n<256)return Buffer.from([major*32+24,n]);const b=Buffer.alloc(3);b[0]=major*32+25;b.writeUInt16BE(n,1);return b;}
function cbor(value){
 if(Buffer.isBuffer(value))return Buffer.concat([head(2,value.length),value]);
 if(typeof value==='string'){const b=Buffer.from(value);return Buffer.concat([head(3,b.length),b]);}
 if(typeof value==='number')return head(value<0?1:0,value<0?-1-value:value);
 const entries=value instanceof Map?[...value]:Object.entries(value);return Buffer.concat([head(5,entries.length),...entries.flatMap(([k,v])=>[cbor(k),cbor(v)])]);
}
export function authenticator(){
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32),cose=cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));let handle;
 function authData(rp,counter,uv,backup,attest){const count=Buffer.alloc(4);count.writeUInt32BE(counter);return Buffer.concat([sha(rp),Buffer.from([1|(uv?4:0)|(backup?24:0)|(attest?64:0)]),count,...(attest?[Buffer.alloc(16),Buffer.from([0,id.length]),id,cose]:[])]);}
 return {id:b64(id),cose,publicKey,registration(options,{uv=true,rp=options.rp.id,origin='http://localhost:3000',challenge=options.challenge,counter=0,backup=false}={}){handle=options.user.id;const clientDataJSON=b64(JSON.stringify({type:'webauthn.create',challenge,origin,crossOrigin:false}));return {id:b64(id),rawId:b64(id),type:'public-key',authenticatorAttachment:'cross-platform',clientExtensionResults:{},response:{clientDataJSON,attestationObject:b64(cbor({fmt:'none',attStmt:{},authData:authData(rp,counter,uv,backup,true)})),transports:['usb']}};},assertion(options,{uv=true,rp=options.rpId,origin='http://localhost:3000',challenge=options.challenge,counter=1,backup=false,userHandle=handle,badSignature=false}={}){const clientData=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,origin,crossOrigin:false})),data=authData(rp,counter,uv,backup,false),signature=sign('sha256',Buffer.concat([data,sha(clientData)]),privateKey);if(badSignature)signature[signature.length-1]^=1;return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(clientData),authenticatorData:b64(data),signature:b64(signature),userHandle}};}};
}
export async function enrollment(f,owner,key=authenticator(),name='Personal key',overrides={}){
 const grant=await f.request('/api/passkeys/actions',{kind:'register',password:'Synthetic-password-123'},owner.cookies);
 const headers={'x-factoryos-passkey-action':grant.data?.nonce};
 const options=await f.request('/passkey/generate-register-options',undefined,owner.cookies,headers);
 if(options.status!==200)return {key,grant,options,result:options};
 const response=key.registration(options.data,overrides);
 const result=await f.request('/passkey/verify-registration',{response,...(name===null?{}:{name})},owner.cookies,headers);
 return {key,grant,options,response,result};
}
export async function primary(f,key,overrides={},cookies=new Map(),next='/app'){
 const headers={'x-factoryos-passkey-return':next},options=await f.request('/passkey/generate-authenticate-options',undefined,cookies,headers);
 if(options.status!==200)return {options,result:options,cookies};
 const response=key.assertion(options.data,overrides),result=await f.request('/passkey/verify-authentication',{response},cookies,headers);return {options,response,result,cookies};
}
