import {canonicalHash,validateSnapshot} from './canonical.js';
import type {SandboxProvider,ProviderCommand,ProviderAccess,ProviderOutcome,MockRemoteStore,ProviderEvidence} from './contracts.js';
export class MockSandboxProvider implements SandboxProvider{
 private readonly store:MockRemoteStore;
 constructor(store?:MockRemoteStore){const map=new Map<string,ProviderEvidence>();this.store=store??{get:async k=>map.get(k)??null,put:async(k,v)=>{map.set(k,v)}}}
 async execute(c:ProviderCommand,a:ProviderAccess):Promise<ProviderOutcome>{
  if(a.scope.environment!=='sandbox'||a.provider!=='mock')throw new Error('Only mock sandbox access is supported');
  if(validateSnapshot(c.snapshot).length)return {kind:'rejected',code:'INVALID_SNAPSHOT'};
  if(a.scope.gstin!==c.snapshot.seller.gstin)return {kind:'rejected',code:'SELLER_MISMATCH'};
  const family=c.action.startsWith('irn.')?'irn':'ewb',key=canonicalHash({scope:a.scope,family,type:c.snapshot.documentType,number:c.snapshot.number,fy:c.snapshot.fy}),hash=canonicalHash(c.snapshot),prior=await this.store.get(key);
  if(c.action.endsWith('lookup')){if(a.scenario==='unsupported_lookup')return {kind:'unsupported'};if(!prior)return {kind:'not_found'};return {kind:'confirmed',evidence:a.scenario==='mismatched_lookup'?{...prior,documentHash:'mismatch'}:prior}}
  if(a.scenario==='rejected')return {kind:'rejected',code:'MOCK_REJECTED'};
  if(prior&&prior.documentHash!==hash)return {kind:'rejected',code:'IDENTITY_PAYLOAD_CONFLICT'};
  if(c.action.endsWith('generate')||c.action==='ewb.from_irn'){
   if(prior)return {kind:'confirmed',evidence:prior};
   if(family==='ewb'&&!c.transport)return {kind:'rejected',code:'TRANSPORT_REQUIRED'};
   if(c.action==='ewb.from_irn'&&!c.irn)return {kind:'rejected',code:'IRN_REQUIRED'};
   const evidence:ProviderEvidence={externalId:family==='irn'?key:BigInt('0x'+key.slice(0,12)).toString(),documentHash:hash,gstin:a.scope.gstin,documentNumber:c.snapshot.number,documentType:c.snapshot.documentType,issuedAt:new Date().toISOString(),status:'active',simulated:true,signatureStatus:'simulated',...(c.transport?{transport:c.transport}:{})};await this.store.put(key,evidence);return a.scenario==='timeout_after_success'?{kind:'unknown'}:{kind:'confirmed',evidence};
  }
  if(!prior||!c.externalId||prior.externalId!==c.externalId)return {kind:'rejected',code:'ORIGINAL_REQUIRED'};
  if(prior.status==='cancelled')return c.action.endsWith('cancel')?{kind:'confirmed',evidence:prior}:{kind:'rejected',code:'ALREADY_CANCELLED'};
  const evidence:ProviderEvidence={...prior,...(c.action.endsWith('cancel')?{status:'cancelled' as const}:{}),...(c.transport?{transport:c.transport}:{})};await this.store.put(key,evidence);return {kind:'confirmed',evidence};
 }
}
