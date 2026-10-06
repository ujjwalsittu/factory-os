import {describe,it,expect} from 'vitest';
import * as api from './index.js';
const snapshot={documentType:'INV',number:'TEST-001',date:'2026-10-06',fy:'26-27',supplyType:'regular',currency:'USD',exchangeRate:'80',seller:{name:'Seller',gstin:'27AAACA1234B1Z5',stateCode:'27',address:'Factory',city:'Mumbai',pincode:'400001'},buyer:{name:'Buyer',gstin:'27AAACB1234C1Z2',stateCode:'27',address:'Office',city:'Mumbai',pincode:'400001'},lines:[{description:'Service',hsn:'9983',uqc:'OTH',isService:true,qty:'1',taxable:'100',cgst:'9',sgst:'9',igst:'0',cess:'0'}],total:'118',provenance:{kind:'sample',reason:'Sandbox test only'}};
const scope={tenantId:'t',entityId:'e',registrationId:'r',gstin:snapshot.seller.gstin,environment:'sandbox' as const};
// Dynamic lookup proves the absent public behavior, rather than a missing module import.
const f=()=>api as unknown as Record<string,(...args:unknown[])=>unknown>;
describe('canonical sandbox evidence',()=>{
 it('foreign snapshot keeps exact INR components',()=>{expect(f().toInrSnapshot).toBeTypeOf('function');const out=f().toInrSnapshot!(snapshot) as typeof snapshot;expect(out.lines[0]!.taxable).toBe('8000.00');expect(out.total).toBe('9440.00')});
 it('canonical hash is independent of object key order',()=>{expect(f().canonicalHash).toBeTypeOf('function');expect(f().canonicalHash!({b:2,a:1})).toBe(f().canonicalHash!({a:1,b:2}))});
 it('invalid totals refuse without recomputing tax',()=>{expect(f().validateSnapshot).toBeTypeOf('function');expect(f().validateSnapshot!({...snapshot,total:'119'})).not.toEqual([])});
 it('redacts nested secret variants',()=>{expect(f().redactEvidence).toBeTypeOf('function');expect(JSON.stringify(f().redactEvidence!({nested:{AuthToken:'SECRET',client_secret:'SECRET',sek:'SECRET',password:'SECRET'},message:'password=SECRET'}))).not.toContain('SECRET')});
 it('hash rejects undefined payload fields',()=>{expect(f().canonicalHash).toBeTypeOf('function');expect(()=>f().canonicalHash!({a:undefined})).toThrow()});
});
describe('mock sandbox protocol',()=>{
 it('timeout after acceptance resolves original identity',async()=>{expect(api).toHaveProperty('MockSandboxProvider');const {MockSandboxProvider}=api as unknown as {MockSandboxProvider:new()=>{execute:(c:unknown,a:unknown)=>Promise<{kind:string;evidence?:{externalId:string}}>}};const p=new MockSandboxProvider(),access={scope,provider:'mock',scenario:'timeout_after_success'};const command={action:'irn.generate',snapshot};expect((await p.execute(command,access)).kind).toBe('unknown');const lookup=await p.execute({...command,action:'irn.lookup'},access);expect(lookup.kind).toBe('confirmed');expect((await p.execute(command,{...access,scenario:'normal'})).evidence?.externalId).toBe(lookup.evidence?.externalId)});
 it('production access refuses before provider mutation',async()=>{expect(api).toHaveProperty('MockSandboxProvider');const P=(api as unknown as {MockSandboxProvider:new()=>{execute:(c:unknown,a:unknown)=>Promise<unknown>}}).MockSandboxProvider;await expect(new P().execute({action:'irn.generate',snapshot},{scope:{...scope,environment:'production'},provider:'mock',scenario:'normal'})).rejects.toThrow(/sandbox/i)});
});
export {snapshot,scope};
