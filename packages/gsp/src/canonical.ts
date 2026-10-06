import {createHash} from 'node:crypto';
import {Dec} from '@factoryos/core';
import {snapshotSchema,type DocumentSnapshot} from './contracts.js';
export function canonicalHash(value:unknown):string{
 const stable=(v:unknown):unknown=>{if(v===null||typeof v==='string'||typeof v==='boolean')return v;if(typeof v==='number'&&Number.isFinite(v))return v;if(Array.isArray(v))return v.map(stable);if(typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype)return Object.fromEntries(Object.keys(v as object).sort().map(k=>[k,stable((v as Record<string,unknown>)[k])]));throw new Error('Payload must contain only explicit JSON values')};
 return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function validateSnapshot(value:unknown):{path:string;message:string}[]{
 const r=snapshotSchema.safeParse(value);if(!r.success)return r.error.issues.map(x=>({path:x.path.join('.'),message:x.message}));const s=r.data,issues:{path:string;message:string}[]=[];
 if(!Dec.of(s.exchangeRate).gt('0'))issues.push({path:'exchangeRate',message:'Exchange rate must be positive'});
 if(s.currency==='INR'&&!Dec.of(s.exchangeRate).eq('1'))issues.push({path:'exchangeRate',message:'INR exchange rate must be one'});
 const sum=s.lines.reduce((t,l)=>t.add(l.taxable).add(l.cgst).add(l.sgst).add(l.igst).add(l.cess),Dec.ZERO);
 if(!sum.eq(s.total))issues.push({path:'total',message:'Stored total differs from line components'});
 const yr=Number(s.date.slice(0,4))-(Number(s.date.slice(5,7))<4?1:0),fy=`${String(yr).slice(-2)}-${String(yr+1).slice(-2)}`;
 if(s.fy!==fy)issues.push({path:'fy',message:'Financial year differs from document date'});
 if(!s.seller.gstin)issues.push({path:'seller.gstin',message:'Seller GSTIN required'});
 return issues;
}
export function toInrSnapshot(value:DocumentSnapshot):DocumentSnapshot{
 const issues=validateSnapshot(value);if(issues.length)throw new Error(issues.map(x=>`${x.path}: ${x.message}`).join('; '));const s=snapshotSchema.parse(value);
 const rate=Dec.of(s.exchangeRate),lines=s.lines.map(l=>({...l,...Object.fromEntries((['taxable','cgst','sgst','igst','cess'] as const).map(k=>[k,Dec.of(l[k]).mul(rate).toFixed(2)]))}));
 const total=lines.reduce((t,l)=>t.add(l.taxable).add(l.cgst).add(l.sgst).add(l.igst).add(l.cess),Dec.ZERO).toFixed(2);
 return {...s,currency:'INR',exchangeRate:'1',lines,total};
}
