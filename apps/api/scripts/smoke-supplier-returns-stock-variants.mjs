import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {stockFixture} from './supplier-returns-test-helpers.mjs';
const mode=process.argv[2]??'landed';
const {c,date,claim,receipt,wh,inv,good}=await stockFixture(`Supplier ${mode}`,mode==='zero'?'0':'60');
const db=createDb(process.env.DATABASE_URL);
try {
 const a=(await db.$client.query('select id from receipt_invoice_allocation where invoice_id=$1 and reversal_of is null',[inv.id])).rows[0];
 let warehouseId=wh.id;
 if(mode==='landed') {
 const lcv=await c.req('POST','/landed-costs',{postingDate:date,receiptIds:[receipt.id],charges:[{chargeType:'freight',amount:'200',basis:'value'}]},201);
 await c.req('POST',`/landed-costs/${lcv.id}/submit`,{},201);
 }
 if(mode==='fifo') {
 const issue=await c.req('POST','/stock-entries',{purpose:'issue',postingDate:date,lines:[{itemId:good.id,batchId:receipt.lines[0].batchId,qty:'8',fromWarehouseId:wh.id}]},201);
 await c.req('POST',`/stock-entries/${issue.id}/submit`,{},201);
 const later=await c.req('POST','/stock-entries',{purpose:'receipt',postingDate:date,lines:[{itemId:good.id,batchId:receipt.lines[0].batchId,qty:'4',rate:'120',toWarehouseId:wh.id}]},201);
 await c.req('POST',`/stock-entries/${later.id}/submit`,{},201);
 }
 if(mode==='quarantine') {
 const quar=await c.req('POST','/warehouses',{code:'QUAR',name:'Return quarantine',type:'quarantine'},201);warehouseId=quar.id;
 const transfer=await c.req('POST','/stock-entries',{purpose:'transfer',postingDate:date,lines:[{itemId:good.id,batchId:receipt.lines[0].batchId,qty:'10',fromWarehouseId:wh.id,toWarehouseId:quar.id}]},201);
 await c.req('POST',`/stock-entries/${transfer.id}/submit`,{},201);
 const issue=await c.req('POST','/stock-entries',{purpose:'issue',postingDate:date,lines:[{itemId:good.id,batchId:receipt.lines[0].batchId,qty:'1',fromWarehouseId:quar.id}]},201);
 await c.req('POST',`/stock-entries/${issue.id}/submit`,{},400);
 }
 const input={postingDate:date,reason:'Variant supplier goods dispatch',lines:[{claimLineId:claim.lines[0].id,receiptAllocationId:a.id,receiptLineId:receipt.lines[0].id,warehouseId,qty:'4'}]};
 const p=await c.req('POST',`/buying/return-claims/${claim.id}/dispatch-preview`,input,201);
 const expected=mode==='zero'?'0.000000':mode==='landed'?'320.000000':mode==='fifo'?'360.000000':'240.000000';assert.equal(p.valueInr,expected);
 const r=await c.req('POST',`/buying/return-claims/${claim.id}/dispatch`,input,201);assert.equal(r.valueInr,expected);
 if(mode==='zero')assert.equal((await db.$client.query("select reason from gl_disposition where source_type='purchase_return' and source_id=$1",[r.stockEntryId])).rows[0].reason,'no_value_change');
 if(mode==='policy') {
 const holder=await db.$client.connect();let results;try{
 await holder.query('begin');await holder.query('select pg_advisory_xact_lock(hashtext($1))',[`accounting:${c.entityId}`]);
 const current=claim.policySnapshot;
 const pending=Promise.all([c.raw('PUT','/buying/return-policy',{...current,dispatchApproval:'acceptance_required'}),c.raw('POST',`/buying/return-claims/${claim.id}/dispatch`,input)]);
 const deadline=Date.now()+5000;let waiting=0;while(Date.now()<deadline){waiting=(await db.$client.query("select count(*)::int n from pg_locks where locktype='advisory' and not granted and objid::bigint=(hashtext($1)::bigint & 4294967295)",[`accounting:${c.entityId}`])).rows[0].n;if(waiting===2)break;await new Promise(r=>setTimeout(r,25));}
 assert.equal(waiting,2);await holder.query('rollback');results=await pending;
 }finally{await holder.query('rollback');holder.release()}
 assert.deepEqual(results.map(x=>x.status),[200,201]);
 const persisted=await c.req('GET',`/buying/return-claims/${claim.id}`);assert.equal(persisted.policySnapshot.dispatchApproval,'pending_allowed');
 assert.equal((await c.req('GET','/buying/return-policy')).dispatchApproval,'acceptance_required');
 }
 console.log(`PASS supplier stock ${mode} ${c.checks} request checks`);
}finally{await db.$client.end();}
