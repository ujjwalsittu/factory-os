import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {fixture} from './sales-notes-test-helpers.mjs';
const {c,customer,reg}=await fixture('Original cost sales returns');
const uom=(await c.req('GET','/uoms')).find(x=>x.code==='NOS');
await c.req('POST','/hsn-codes',{code:'7601',kind:'hsn',description:'Return metal',gstRate:'0',effectiveFrom:'2025-04-01'},201);
const good=await c.req('POST','/items',{code:'GOOD',name:'Returned company material',type:'raw_material',tracking:'batch',stockUomId:uom.id,hsnCode:'7601'},201);
const wh=await c.req('POST','/warehouses',{code:'RET',name:'Return destination',type:'stores'},201);
let originalBatch,receiptNumber=0;
async function stock(qty,rate,purpose='receipt'){
 const d=await c.req('POST','/stock-entries',{purpose,postingDate:c.settings.cutoverDate,lines:[{itemId:good.id,qty,...(purpose==='receipt'?{toWarehouseId:wh.id,rate,newBatchNo:`LOT${++receiptNumber}`}:{fromWarehouseId:wh.id,batchId:originalBatch})}]},201);
 await c.req('POST',`/stock-entries/${d.id}/submit`,{},201);return d;
}
const originalReceipt=await stock('10','60');
originalBatch=(await c.req('GET',`/stock-entries/${originalReceipt.id}`)).lines[0].batchId;
let inv=await c.req('POST','/sales-invoices',{customerId:customer.id,gstRegistrationId:reg.id,invoiceDate:c.settings.cutoverDate,placeOfSupplyStateCode:'27',lines:[{itemId:good.id,qty:'10',rate:'100',gstRate:'0',warehouseId:wh.id,batchId:originalBatch}]},201);
await c.req('POST',`/sales-invoices/${inv.id}/submit`,{},201);inv=await c.req('GET',`/sales-invoices/${inv.id}`);
await stock('1','120');
const input=qty=>({invoiceId:inv.id,kind:'credit',taxTreatment:'gst',taxEligibilityConfirmed:true,postingDate:c.settings.cutoverDate,reason:'Return originally dispatched goods',lines:[{invoiceLineId:inv.lines[0].id,mode:'quantity',qty,returnQty:qty,warehouseId:wh.id}]});
const other=await c.req('POST','/entities',{legalName:'Other return entity',shortName:'Other',code:'OTHRET'},201);
const sourceEntity=c.entityId;c.entityId=other.id;
const otherWh=await c.req('POST','/warehouses',{code:'OTHER',name:'Other entity destination',type:'stores'},201);
c.entityId=sourceEntity;
await c.req('POST','/sales-notes/preview',{...input('4'),lines:[{...input('4').lines[0],warehouseId:otherWh.id}]},404);
const past=new Date(`${c.settings.cutoverDate}T12:00:00Z`);past.setUTCDate(past.getUTCDate()-1);
await c.req('POST','/sales-notes/preview',{...input('4'),postingDate:past.toISOString().slice(0,10)},400);
await c.req('POST','/stock-entries',{purpose:'sales_return',postingDate:c.settings.cutoverDate,lines:[{itemId:good.id,qty:'1',toWarehouseId:wh.id,rate:'60'}]},400);
const valueDraft=await c.req('POST','/sales-notes',{...input('4'),lines:[{invoiceLineId:inv.lines[0].id,mode:'value',taxableAmount:'1000'}]},201);
const valueOnly=await c.req('POST',`/sales-notes/${valueDraft.id}/submit`,{},201);
assert.equal(valueOnly.stockEntryId,null,'A financial-only credit does not restore any stock');
await c.req('POST','/sales-notes/preview',input('4'),409);
await c.req('POST',`/sales-notes/${valueDraft.id}/cancel`,{reason:'Release financial ceiling before physical return'},201);
const p=await c.req('POST','/sales-notes/preview',input('4'),201);assert.equal(p.returnValueInr,'240.000000');
const note=await c.req('POST','/sales-notes',input('4'),201);const read=await c.req('POST',`/sales-notes/${note.id}/submit`,{},201);assert.ok(read.stockEntryId);
const returnEntry=await c.req('GET',`/stock-entries/${read.stockEntryId}`);
assert.equal(returnEntry.lines[0].batchId,originalBatch);
assert.equal(returnEntry.lines[0].toWarehouseId,wh.id);
assert.equal(returnEntry.postingDate,c.settings.cutoverDate);
const db=createDb(process.env.DATABASE_URL);
try{
 const effect=(await db.$client.query('select qty,value,original_value,layer_id from sales_return_effect where note_id=$1',[note.id])).rows[0];
 assert.equal(effect.qty,'4.000000');assert.equal(effect.value,'240.000000');assert.equal(effect.original_value,'600.000000');
 await assert.rejects(db.$client.query('update sales_return_effect set value=0 where note_id=$1',[note.id]),/append-only/);
 await assert.rejects(db.$client.query('delete from sales_return_effect where note_id=$1',[note.id]),/append-only/);
 const second=await c.req('POST','/sales-notes',input('6'),201);await c.req('POST',`/sales-notes/${second.id}/submit`,{},201);
 assert.equal((await db.$client.query('select sum(value)::text v from sales_return_effect where entity_id=$1',[c.entityId])).rows[0].v,'600.000000');
 await c.req('POST','/sales-notes/preview',input('1'),409);
 await stock('2',undefined,'issue');
 const ledgerSnapshot=async()=>(await db.$client.query(`select
 (select count(*)::int from gl_entry where entity_id=$1) gl,
 (select count(*)::int from trade_bill_effect where entity_id=$1) bills,
 (select count(*)::int from stock_ledger_entry where entity_id=$1) stock,
 (select count(*)::int from sales_return_effect where entity_id=$1) returns`,[c.entityId])).rows[0];
 const beforeConsumedCancel=await ledgerSnapshot();
 const snapshot=await c.req('GET',`/sales-invoices/${inv.id}/balance`);
 await c.req('POST',`/sales-notes/${note.id}/cancel`,{reason:'Consumed return layer must block cancellation'},409);
 assert.deepEqual(await c.req('GET',`/sales-invoices/${inv.id}/balance`),snapshot);
 assert.deepEqual(await ledgerSnapshot(),beforeConsumedCancel,'All stock, bill and GL append attempts roll back together');
 assert.equal((await c.req('GET',`/sales-notes/${note.id}`)).status,'submitted');
 // Direct isolated evidence fixture: current landed-cost UI accepts purchase receipts only.
 // This exercises the return reversal boundary against persisted future/imported changes.
 const returned=(await db.$client.query('select e.layer_id,s.voucher_line_id as source_line_id from sales_return_effect e join fifo_layer l on l.id=e.layer_id join stock_ledger_entry s on s.seq=l.source_seq where e.note_id=$1',[second.id])).rows[0];
 const cost=(await db.$client.query("insert into landed_cost_voucher(tenant_id,entity_id,status,posting_date,created_by) select tenant_id,entity_id,'submitted',posting_date,created_by from sales_note where id=$1 returning id",[second.id])).rows[0];
 await db.$client.query('insert into landed_cost_layer_change(voucher_id,receipt_line_id,layer_id,qty_remaining,old_rate,new_rate,amount,on_hand_value,variance_value) values($1,$2,$3,6,60,61,6,6,0)',[cost.id,returned.source_line_id,returned.layer_id]);
 const beforeCostCancel=await c.req('GET',`/sales-invoices/${inv.id}/balance`);
 const beforeCostLedgers=await ledgerSnapshot();
 await c.req('POST',`/sales-notes/${second.id}/cancel`,{reason:'Changed return acquisition cost must block reversal'},409);
 assert.deepEqual(await c.req('GET',`/sales-invoices/${inv.id}/balance`),beforeCostCancel);
 assert.deepEqual(await ledgerSnapshot(),beforeCostLedgers,'Cost dependency also rolls back every immutable ledger');
 await db.$client.query("update landed_cost_voucher set status='cancelled' where id=$1",[cost.id]);
 await c.req('POST',`/sales-notes/${second.id}/cancel`,{reason:'Reverse untouched final return'},201);
 assert.equal((await c.req('GET',`/sales-invoices/${inv.id}/balance`)).openAmount,'600.000000');
 const quarantine=await c.req('POST','/warehouses',{code:'QUAR-RET',name:'Returned goods awaiting inspection',type:'quarantine'},201);
 const quarantineInput={...input('1'),lines:[{...input('1').lines[0],warehouseId:quarantine.id}]};
 const quarantineDraft=await c.req('POST','/sales-notes',quarantineInput,201);
 await c.req('POST',`/sales-notes/${quarantineDraft.id}/submit`,{},201);
 const quarantineIssue=await c.req('POST','/stock-entries',{purpose:'issue',postingDate:c.settings.cutoverDate,lines:[{itemId:good.id,qty:'1',fromWarehouseId:quarantine.id,batchId:originalBatch}]},201);
 const beforeQuarantineIssue=await ledgerSnapshot();
 await c.req('POST',`/stock-entries/${quarantineIssue.id}/submit`,{},400);
 assert.deepEqual(await ledgerSnapshot(),beforeQuarantineIssue,'Quarantined returns never reach an issued stock or GL ledger');
 await c.req('POST',`/sales-notes/${quarantineDraft.id}/cancel`,{reason:'Reverse untouched quarantined return'},201);
 console.log('PASS original-cost return and cancellation rollback',c.checks);
}finally{await db.$client.end();}
