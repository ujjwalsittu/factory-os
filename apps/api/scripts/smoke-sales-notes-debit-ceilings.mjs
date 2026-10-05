import assert from 'node:assert/strict';
import {fixture} from './sales-notes-test-helpers.mjs';
for(const treatment of ['commercial','gst']){
 if(treatment==='gst')await new Promise(r=>setTimeout(r,12000));
 const {c,input,inv}=await fixture(`Debit cancellation ceilings ${treatment}`,treatment==='gst'?'18':'0');
 const debit=await c.req('POST','/sales-notes',input('100','debit',treatment),201);
 await c.req('POST',`/sales-notes/${debit.id}/submit`,{},201);
 let commercialDebit;
 if(treatment==='gst'){
  commercialDebit=await c.req('POST','/sales-notes',input('100','debit','commercial'),201);
  await c.req('POST',`/sales-notes/${commercialDebit.id}/submit`,{},201);
 }
 const credit=await c.req('POST','/sales-notes',input('200','credit',treatment),201);
 await c.req('POST',`/sales-notes/${credit.id}/submit`,{},201);
 const before=await c.req('GET',`/sales-notes/${debit.id}`),balance=await c.req('GET',`/sales-invoices/${inv.id}/balance`);
 await c.req('POST',`/sales-notes/${debit.id}/cancel`,{reason:'Credits still depend on this added ceiling'},409);
 assert.deepEqual(await c.req('GET',`/sales-notes/${debit.id}`),before);
 assert.deepEqual(await c.req('GET',`/sales-invoices/${inv.id}/balance`),balance);
 await c.req('POST',`/sales-notes/${credit.id}/cancel`,{reason:'Release the dependent credit first'},201);
 await c.req('POST',`/sales-notes/${debit.id}/cancel`,{reason:'Cancel after releasing dependent ceiling'},201);
 if(commercialDebit)await c.req('POST',`/sales-notes/${commercialDebit.id}/cancel`,{reason:'Reverse remaining commercial debit'},201);
 assert.ok((await c.req('GET','/accounts/trade-reconciliation')).every(r=>r.difference==='0.000000'));
 console.log(`PASS ${treatment} debit cancellation retains surviving credit ceilings`,c.checks);
}
