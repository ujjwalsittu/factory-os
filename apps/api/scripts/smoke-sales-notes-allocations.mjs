import assert from 'node:assert/strict';
import {fixture} from './sales-notes-test-helpers.mjs';
const {c,input,inv}=await fixture('Exact statutory note components','18','1');
const p=await c.req('POST','/sales-notes/preview',input('33.33'),201);
assert.equal(p.cgst,'3.00');assert.equal(p.sgst,'3.00');assert.equal(p.cess,'0.33');
for(const role of ['output_cgst','output_sgst']){
 const l=p.ledgerLines.find(l=>l.accountId===c.account(role));
 assert.equal(l.debit,'3.000000','Printed GST and the original component account must agree exactly');
}
const commercial=await c.req('POST','/sales-notes/preview',input('10','credit','commercial'),201);
assert.equal(commercial.cgst,'0.00');assert.equal(commercial.grandTotal,'10.00');
await c.req('POST','/sales-notes/preview',{...input('120')},409);
await c.req('POST','/sales-notes/preview',{...input(),taxEligibilityConfirmed:false},400);
await c.req('POST','/sales-notes/preview',{...input(),lines:[input().lines[0],input().lines[0]]},400);
const debit=await c.req('POST','/sales-notes',input('10','debit','commercial'),201);
await c.req('POST',`/sales-notes/${debit.id}/submit`,{},201);
const afterCommercialDebit=await c.req('POST','/sales-notes/preview',input('33.33'),201);
assert.equal(afterCommercialDebit.cgst,'3.00','A commercial-only debit cannot dilute the original GST rate');
console.log('PASS exact note GST, commercial treatment and value/eligibility guards',c.checks);
