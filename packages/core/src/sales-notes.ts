import { Dec } from './decimal.js';
import { consumeCarryingValue } from './settlements.js';
export interface TaxComponents { taxableValue:string; cgst:string; sgst:string; igst:string; cess:string }
export function calculateReturnCost(input:{originalQty:string;originalValue:string;returnedQty:string;returnedValue:string;qty:string}):string {
 const q=Dec.of(input.originalQty).sub(input.returnedQty), v=Dec.of(input.originalValue).sub(input.returnedValue);
 if (Dec.of(input.returnedQty).lt('0') || Dec.of(input.returnedValue).lt('0') || !q.gt('0') || v.lt('0')) throw new Error('Invalid original return evidence');
 return consumeCarryingValue(q.toString(),v.toString(),input.qty);
}
export function allocateNoteComponents(original:TaxComponents,remaining:TaxComponents,share:string,total:string,final:boolean):TaxComponents {
 const value=Dec.of(share),base=Dec.of(total);
 if (!value.gt('0') || !base.gt('0') || value.gt(base) || value.gt(remaining.taxableValue)) throw new Error('Note exceeds original value');
 const out={} as TaxComponents;
 for(const key of ['taxableValue','cgst','sgst','igst','cess'] as const){
  const rem=Dec.of(remaining[key]);
  if(rem.lt('0'))throw new Error('Invalid remaining tax evidence');
  const portion=key==='taxableValue'?value:final?rem:Dec.of(original[key]).mul(value).div(base);
  const rounded=Dec.of(portion.toFixed(2)); out[key]=(rounded.gt(rem)?rem:rounded).toFixed(2);
 }
 return out;
}
export function gstCreditDeadline(invoiceDate:string):string {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate))throw new Error('Invalid invoice date');
 const year=Number(invoiceDate.slice(0,4)),month=Number(invoiceDate.slice(5,7));
 if(month<1||month>12)throw new Error('Invalid invoice month');
 return `${year+(month>=4?1:0)}-11-30`;
}
