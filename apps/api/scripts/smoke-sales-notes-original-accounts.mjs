import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {fixture} from './sales-notes-test-helpers.mjs';
const {c,input,inv,customer}=await fixture('Notes preserve original inactive accounts','18');
const roles=['debtors','sales','output_cgst','output_sgst'];
const old=Object.fromEntries(roles.map(role=>[role,c.accounts.find(a=>a.role===role)]));
const mappings={...c.settings.mappings};
for(const role of roles){
 const replacement=await c.req('POST','/accounts/accounts',{code:`NEW_${role}`,name:`Replacement ${role}`,groupId:old[role].groupId},201);
 mappings[role]=replacement.id;
}
await c.req('PUT','/accounts/settings',{mappings});
for(const role of roles)await c.req('PUT',`/accounts/accounts/${old[role].id}`,{isActive:false});
const preview=await c.req('POST','/sales-notes/preview',input(),201);
assert.deepEqual(new Set(preview.ledgerLines.map(l=>l.accountId)),new Set(roles.map(role=>old[role].id)));
const draft=await c.req('POST','/sales-notes',input(),201);
const note=await c.req('POST',`/sales-notes/${draft.id}/submit`,{},201);
assert.equal((await c.req('GET',`/sales-invoices/${inv.id}/balance`)).openAmount,'70.800000');
const db=createDb(process.env.DATABASE_URL);
try{
 const accounts=(await db.$client.query('select distinct account_id from gl_entry where voucher_id=$1',[note.voucherId])).rows.map(r=>r.account_id);
 assert.deepEqual(new Set(accounts),new Set(roles.map(role=>old[role].id)));
}finally{await db.$client.end();}
await c.req('POST','/accounts/journals',{postingDate:c.settings.cutoverDate,narration:'Manual inactive accounts remain forbidden',lines:[{accountId:old.debtors.id,debit:'1',credit:'0',partyId:customer.id,billReference:'Inactive manual'},{accountId:old.sales.id,debit:'0',credit:'1'}]},400);
const bank=c.accounts.find(a=>a.role==='bank');
const unused=await c.req('POST','/accounts/accounts',{code:'INACTIVE_BANK',name:'Unrelated inactive bank',groupId:bank.groupId},201);
await c.req('PUT',`/accounts/accounts/${unused.id}`,{isActive:false});
await c.req('POST','/accounts/settlements/preview',{direction:'receipt',partyId:customer.id,postingDate:c.settings.cutoverDate,currency:'INR',exchangeRate:'1',accountId:unused.id,amount:'1',allocations:[]},400);
await c.req('POST','/sales-notes/preview',{...input(),accountId:unused.id},400);
await c.req('POST',`/sales-notes/${note.id}/cancel`,{reason:'Reverse recorded inactive accounts exactly'},201);
assert.equal((await c.req('GET',`/sales-invoices/${inv.id}/balance`)).openAmount,'118.000000');
assert.ok((await c.req('GET','/accounts/trade-reconciliation')).every(r=>r.difference==='0.000000'));
console.log('PASS original inactive control/revenue/tax corrections and narrow account guards',c.checks);
