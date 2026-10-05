import {Dec} from '../../../packages/core/dist/index.js';
import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {stockFixture} from './supplier-returns-test-helpers.mjs';
const {c,date,claim,inv,receipt,wh}=await stockFixture('Supplier real lock races');const db=createDb(process.env.DATABASE_URL);
async function barrier(actions){const hold=await db.$client.connect();let pending,results;try{await hold.query('begin');await hold.query('select pg_advisory_xact_lock(hashtext($1))',[`accounting:${c.entityId}`]);pending=Promise.all(actions.map(x=>x()));const deadline=Date.now()+5000;let n=0;while(Date.now()<deadline){n=(await db.$client.query("select count(*)::int n from pg_locks where locktype='advisory' and not granted and objid::bigint=(hashtext($1)::bigint & 4294967295)",[`accounting:${c.entityId}`])).rows[0].n;if(n===actions.length)break;await new Promise(r=>setTimeout(r,25));}assert.equal(n,actions.length);}finally{await hold.query('rollback');hold.release();if(pending)results=await pending;}return results;}
try {
 const a=(await db.$client.query('select id from receipt_invoice_allocation where invoice_id=$1 and reversal_of is null',[inv.id])).rows[0];
 const dispatch=qty=>({postingDate:date,reason:'Competing supplier return dispatch',lines:[{claimLineId:claim.lines[0].id,receiptAllocationId:a.id,receiptLineId:receipt.lines[0].id,warehouseId:wh.id,qty}]});
 const r=await barrier([()=>c.raw('POST',`/buying/return-claims/${claim.id}/dispatch`,dispatch('6')),()=>c.raw('POST',`/buying/return-claims/${claim.id}/dispatch`,dispatch('6'))]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);
 const input=no=>({invoiceId:inv.id,kind:'credit',taxTreatment:'commercial',supplierNoteNo:no,supplierNoteDate:date,postingDate:date,reason:'Concurrent partial supplier acceptance',taxEligibilityConfirmed:false,lines:[{invoiceLineId:inv.lines[0].id,claimLineId:claim.lines[0].id,mode:'quantity',qty:'7',taxableAmount:'420'}]});
 const notes=await Promise.all(['RACE-001','RACE-002'].map(no=>c.req('POST','/buying/supplier-notes',input(no),201)));
 const accepted=await barrier(notes.map(n=>()=>c.raw('POST',`/buying/supplier-notes/${n.id}/submit`,{})));assert.deepEqual(accepted.map(x=>x.status).sort(),[201,409]);
 const winner=accepted.find(x=>x.status===201).data;await c.req('POST',`/buying/supplier-notes/${winner.id}/cancel`,{reason:'Release acceptance before claim cancellation race'},201);
 const own=await c.req('POST','/buying/return-claims',{invoiceId:inv.id,postingDate:date,reason:'Claim the remaining goods',lines:[{invoiceLineId:inv.lines[0].id,qty:'4',taxableAmount:'240'}]},201);await c.req('POST',`/buying/return-claims/${own.id}/submit`,{},201);const approved=await c.req('POST',`/buying/return-claims/${own.id}/approve`,{reason:'Approve remaining goods claim'},201);
 const body={...dispatch('4'),lines:[{...dispatch('4').lines[0],claimLineId:approved.lines[0].id}]};
 const cancel=await barrier([()=>c.raw('POST',`/buying/return-claims/${own.id}/cancel`,{reason:'Cancel before physical dispatch'}),()=>c.raw('POST',`/buying/return-claims/${own.id}/dispatch`,body)]);assert.deepEqual(cancel.map(x=>x.status).sort(),[201,409]);
 const policy=await c.req('GET','/buying/return-policy');await c.req('PUT','/buying/return-policy',{...policy,creditApplication:'manual'});
 const valueNote=await c.req('POST','/buying/supplier-notes',{...input('VALUE-RACE'),lines:[{invoiceLineId:inv.lines[0].id,mode:'value',taxableAmount:'100'}]},201);const credit=await c.req('POST',`/buying/supplier-notes/${valueNote.id}/submit`,{},201);
 const bill=(await c.req('GET',`/accounts/bills?partyId=${credit.supplierId}&side=payable&currency=INR`)).find(x=>x.sourceId===inv.id);
 const allocation={supplierNoteId:credit.id,postingDate:date,reason:'Competing last supplier credit',allocations:[{billId:bill.id,amount:'100'}]};
 const lastCredit=await barrier([()=>c.raw('POST','/accounts/settlement-allocations',allocation),()=>c.raw('POST','/accounts/settlement-allocations',allocation)]);assert.deepEqual(lastCredit.map(x=>x.status).sort(),[201,409]);
 await c.req('PUT','/buying/return-policy',{...policy,creditApplication:'automatic'});
 const second=await c.req('POST','/buying/supplier-notes',{...input('PAY-RACE'),lines:[{invoiceLineId:inv.lines[0].id,mode:'value',taxableAmount:'100'}]},201);
 const open=(await c.req('GET',`/accounts/bills?partyId=${credit.supplierId}&side=payable&currency=INR`)).find(x=>x.id===bill.id).openAmount;
 const pay=await c.req('POST','/accounts/settlements',{direction:'payment',partyId:credit.supplierId,postingDate:date,currency:'INR',exchangeRate:'1',accountId:c.account('bank'),amount:Dec.of(open).toFixed(2),allocations:[{billId:bill.id,amount:Dec.of(open).toFixed(2)}]},201);
 const paymentRace=await barrier([()=>c.raw('POST',`/accounts/settlements/${pay.id}/submit`,{}),()=>c.raw('POST',`/buying/supplier-notes/${second.id}/submit`,{})]);assert.equal(paymentRace[1].status,201);assert.ok([200,409].includes(paymentRace[0].status));
 const after=await c.req('GET',`/buying/supplier-notes/${second.id}`);const sourceAfter=(await c.req('GET',`/accounts/bills?partyId=${credit.supplierId}&side=payable&currency=INR`)).find(x=>x.id===bill.id);if(paymentRace[0].status===200){assert.equal(after.creditBalance.openAmount,'100.000000');assert.equal(sourceAfter?.openAmount??'0.000000','0.000000');}else{assert.equal(after.creditBalance.openAmount,'0.000000');assert.equal(sourceAfter.openAmount,Dec.of(open).sub('100').toFixed(6));}assert.ok((await c.req('GET','/accounts/trade-reconciliation')).every(x=>x.difference==='0.000000'));
 console.log(`PASS supplier PostgreSQL last-credit, paid-source, last-return, last-acceptance and cancellation barriers ${c.checks} request checks`);
}finally{await db.$client.end();}
