import {it,expect} from 'vitest';
import * as api from './index.js';
import {randomBytes} from 'node:crypto';
it('envelope uses distinct data key and refuses tampering',()=>{
 const a=api as unknown as {sealCredential:(v:unknown,version:string,key:string)=>Record<string,string>;openCredential:(v:unknown,keys:Record<string,string>)=>unknown};expect(a.sealCredential).toBeTypeOf('function');const key=randomBytes(32).toString('base64'),one=a.sealCredential({password:'secret'},'v1',key),two=a.sealCredential({password:'secret'},'v1',key);expect(one).not.toEqual(two);expect(JSON.stringify(one)).not.toContain('secret');expect(a.openCredential(one,{v1:key})).toEqual({password:'secret'});expect(()=>a.openCredential({...one,tag:'AAAA'},{v1:key})).toThrow();expect(()=>a.openCredential(one,{v2:key})).toThrow();
});
it('noncanonical or short keys refuse',()=>{const a=api as unknown as {sealCredential:(v:unknown,version:string,key:string)=>unknown};expect(a.sealCredential).toBeTypeOf('function');expect(()=>a.sealCredential({},'v1','wrong')).toThrow()});
