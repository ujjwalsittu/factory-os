import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {fixture} from './sales-notes-test-helpers.mjs';
const {c,input,inv,customer,reg,invoice}=await fixture('Concurrent customer credit ceilings');
const a=await c.req('POST','/sales-notes',input('70'),201),b=await c.req('POST','/sales-notes',input('70'),201);
async function barrier(actions){
 const db=createDb(process.env.DATABASE_URL),hold=await db.$client.connect();
 let pending,results;
 try{
  await hold.query('begin');
  await hold.query('select pg_advisory_xact_lock(hashtext($1))',[`accounting:${c.entityId}`]);
  pending=Promise.all(actions.map(action=>action()));
  const deadline=Date.now()+5000;
  let waiting=0;
  while(Date.now()<deadline){
   waiting=(await db.$client.query("select count(*)::int n from pg_locks where locktype='advisory' and not granted and objid::bigint=(hashtext($1)::bigint & 4294967295)",[`accounting:${c.entityId}`])).rows[0].n;
   if(waiting===actions.length)break;
   await new Promise(r=>setTimeout(r,25));
  }
  assert.equal(waiting,actions.length,'All competing operations must wait at the real PostgreSQL entity barrier');
 }finally{
  await hold.query('rollback');hold.release();
  if(pending)results=await pending;
  await db.$client.end();
 }
 return results;
}
const results=await barrier([a,b].map(n=>()=>c.raw('POST',`/sales-notes/${n.id}/submit`,{})));
assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
assert.equal((await c.req('GET',`/sales-invoices/${inv.id}/balance`)).openAmount,'30.000000');
const winner=results.find(r=>r.status===201).data;
await c.req('POST',`/sales-notes/${winner.id}/cancel`,{reason:'Reverse concurrency winner'},201);
assert.equal((await c.req('GET',`/sales-invoices/${inv.id}/balance`)).openAmount,'100.000000');
const other=await c.req('POST','/entities',{legalName:'Other note entity',shortName:'Other',code:'OTHER'},201);
const originalEntity=c.entityId;c.entityId=other.id;
await c.req('GET',`/sales-notes/${winner.id}`,undefined,404);
c.entityId=originalEntity;
// Competing physical returns must not restore the same dispatched quantity twice.
const uom=(await c.req('GET','/uoms')).find(x=>x.code==='NOS');
await c.req('POST','/hsn-codes',{code:'7601',kind:'hsn',description:'Raced return metal',gstRate:'0',effectiveFrom:'2025-04-01'},201);
const good=await c.req('POST','/items',{code:'RACE',name:'Raced goods',type:'raw_material',stockUomId:uom.id,hsnCode:'7601'},201);
const wh=await c.req('POST','/warehouses',{code:'RACE',name:'Raced destination',type:'stores'},201);
const stock=await c.req('POST','/stock-entries',{purpose:'receipt',postingDate:c.settings.cutoverDate,lines:[{itemId:good.id,qty:'2',toWarehouseId:wh.id,rate:'10'}]},201);
await c.req('POST',`/stock-entries/${stock.id}/submit`,{},201);
let shipped=await c.req('POST','/sales-invoices',{customerId:customer.id,gstRegistrationId:reg.id,invoiceDate:c.settings.cutoverDate,placeOfSupplyStateCode:'27',lines:[{itemId:good.id,qty:'2',rate:'50',gstRate:'0',warehouseId:wh.id}]},201);
await c.req('POST',`/sales-invoices/${shipped.id}/submit`,{},201);
shipped=await c.req('GET',`/sales-invoices/${shipped.id}`);
const returned={invoiceId:shipped.id,kind:'credit',taxTreatment:'gst',taxEligibilityConfirmed:true,postingDate:c.settings.cutoverDate,reason:'Race the last dispatched quantity',lines:[{invoiceLineId:shipped.lines[0].id,mode:'quantity',qty:'2',returnQty:'2',warehouseId:wh.id}]};
const r1=await c.req('POST','/sales-notes',returned,201),r2=await c.req('POST','/sales-notes',returned,201);
const returnRace=await barrier([r1,r2].map(n=>()=>c.raw('POST',`/sales-notes/${n.id}/submit`,{})));
assert.deepEqual(returnRace.map(r=>r.status).sort(),[201,409]);
const evidenceDb=createDb(process.env.DATABASE_URL);
try{
 const totals=(await evidenceDb.$client.query('select sum(qty)::text qty,sum(value)::text value from sales_return_effect where entity_id=$1',[c.entityId])).rows[0];
 assert.equal(totals.qty,'2.000000');assert.equal(totals.value,'20.000000');
}finally{await evidenceDb.$client.end();}
// A debit's bill cannot be paid and cancelled by incompatible concurrent operations.
const debitDraft=await c.req('POST','/sales-notes',input('25','debit'),201);
const debit=await c.req('POST',`/sales-notes/${debitDraft.id}/submit`,{},201);
const payment=await c.req('POST','/accounts/settlements',{direction:'receipt',partyId:customer.id,postingDate:c.settings.cutoverDate,currency:'INR',exchangeRate:'1',accountId:c.account('bank'),amount:'25',allocations:[{billId:debit.billId,amount:'25'}]},201);
const cancelPay=await barrier([()=>c.raw('POST',`/sales-notes/${debit.id}/cancel`,{reason:'Race debit cancellation against its payment'}),()=>c.raw('POST',`/accounts/settlements/${payment.id}/submit`,{})]);
assert.equal(cancelPay.filter(r=>r.status>=200&&r.status<300).length,1);
assert.equal(cancelPay.filter(r=>[400,409].includes(r.status)).length,1,JSON.stringify(cancelPay));
if(cancelPay[1].status===200){
 await c.req('POST',`/accounts/settlements/${payment.id}/cancel`,{reason:'Release raced receipt'});
 await c.req('POST',`/sales-notes/${debit.id}/cancel`,{reason:'Reverse after releasing raced receipt'},201);
}
// Two later applications cannot each spend the same remaining customer credit.
const sourceBill=(await c.req('GET',`/accounts/bills?partyId=${customer.id}&side=receivable`)).find(b=>b.sourceId===inv.id);
const paid=await c.req('POST','/accounts/settlements',{direction:'receipt',partyId:customer.id,postingDate:c.settings.cutoverDate,currency:'INR',exchangeRate:'1',accountId:c.account('bank'),amount:'100',allocations:[{billId:sourceBill.id,amount:'100'}]},201);
await c.req('POST',`/accounts/settlements/${paid.id}/submit`,{});
const creditDraft=await c.req('POST','/sales-notes',input('40'),201);
const credit=await c.req('POST',`/sales-notes/${creditDraft.id}/submit`,{},201);
assert.equal(credit.creditBalance.openAmount,'40.000000');
const targets=[await invoice('40'),await invoice('40')];
const bills=await c.req('GET',`/accounts/bills?partyId=${customer.id}&side=receivable`);
const allocations=targets.map(target=>({creditNoteId:credit.id,postingDate:c.settings.cutoverDate,reason:'Race the same remaining customer credit',allocations:[{billId:bills.find(b=>b.sourceId===target.id).id,amount:'40'}]}));
const spent=await barrier(allocations.map(body=>()=>c.raw('POST','/accounts/settlement-allocations',body)));
assert.deepEqual(spent.map(r=>r.status).sort(),[201,409]);
assert.equal((await c.req('GET',`/sales-notes/${credit.id}`)).creditBalance.openAmount,'0.000000');
const targetBalances=await Promise.all(targets.map(n=>c.req('GET',`/sales-invoices/${n.id}/balance`)));
assert.deepEqual(targetBalances.map(b=>b.openAmount).sort(),['0.000000','40.000000']);
const rows=await c.req('GET','/accounts/trade-reconciliation');assert.ok(rows.every(r=>r.difference==='0.000000'));
console.log('PASS PostgreSQL credit/physical-return/payment/residual-spend races and scoped reads',c.checks);
