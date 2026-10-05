import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {fixture} from './sales-notes-test-helpers.mjs';
const {c,customer,reg}=await fixture('Original cost sales returns');
const uom=(await c.req('GET','/uoms')).find(x=>x.code==='NOS');
await c.req('POST','/hsn-codes',{code:'7601',kind:'hsn',description:'Return metal',gstRate:'0',effectiveFrom:'2025-04-01'},201);
const good=await c.req('POST','/items',{code:'GOOD',name:'Returned company material',type:'raw_material',stockUomId:uom.id,hsnCode:'7601'},201);
const wh=await c.req('POST','/warehouses',{code:'RET',name:'Return destination',type:'stores'},201);
async function stock(qty,rate,purpose='receipt'){
 const d=await c.req('POST','/stock-entries',{purpose,postingDate:c.settings.cutoverDate,lines:[{itemId:good.id,qty,...(purpose==='receipt'?{toWarehouseId:wh.id,rate}:{fromWarehouseId:wh.id})}]},201);
 await c.req('POST',`/stock-entries/${d.id}/submit`,{},201);return d;
}
await stock('10','60');
let inv=await c.req('POST','/sales-invoices',{customerId:customer.id,gstRegistrationId:reg.id,invoiceDate:c.settings.cutoverDate,placeOfSupplyStateCode:'27',lines:[{itemId:good.id,qty:'10',rate:'100',gstRate:'0',warehouseId:wh.id}]},201);
await c.req('POST',`/sales-invoices/${inv.id}/submit`,{},201);inv=await c.req('GET',`/sales-invoices/${inv.id}`);
await stock('1','120');
const input=qty=>({invoiceId:inv.id,kind:'credit',taxTreatment:'gst',taxEligibilityConfirmed:true,postingDate:c.settings.cutoverDate,reason:'Return originally dispatched goods',lines:[{invoiceLineId:inv.lines[0].id,mode:'quantity',qty,returnQty:qty,warehouseId:wh.id}]});
const p=await c.req('POST','/sales-notes/preview',input('4'),201);assert.equal(p.returnValueInr,'240.000000');
const note=await c.req('POST','/sales-notes',input('4'),201);const read=await c.req('POST',`/sales-notes/${note.id}/submit`,{},201);assert.ok(read.stockEntryId);
const db=createDb(process.env.DATABASE_URL);
try{
 const effect=(await db.$client.query('select qty,value,original_value,layer_id from sales_return_effect where note_id=$1',[note.id])).rows[0];
 assert.equal(effect.qty,'4.000000');assert.equal(effect.value,'240.000000');assert.equal(effect.original_value,'600.000000');
 await assert.rejects(db.$client.query('update sales_return_effect set value=0 where note_id=$1',[note.id]),/append-only/);
 const second=await c.req('POST','/sales-notes',input('6'),201);await c.req('POST',`/sales-notes/${second.id}/submit`,{},201);
 assert.equal((await db.$client.query('select sum(value)::text v from sales_return_effect where entity_id=$1',[c.entityId])).rows[0].v,'600.000000');
 await c.req('POST','/sales-notes/preview',input('1'),409);
 await stock('2',undefined,'issue');
 const snapshot=await c.req('GET',`/sales-invoices/${inv.id}/balance`);
 await c.req('POST',`/sales-notes/${note.id}/cancel`,{reason:'Consumed return layer must block cancellation'},409);
 assert.deepEqual(await c.req('GET',`/sales-invoices/${inv.id}/balance`),snapshot);
 assert.equal((await c.req('GET',`/sales-notes/${note.id}`)).status,'submitted');
 // Direct isolated evidence fixture: current landed-cost UI accepts purchase receipts only.
 // This exercises the return reversal boundary against persisted future/imported changes.
 const returned=(await db.$client.query('select e.layer_id,s.voucher_line_id as source_line_id from sales_return_effect e join fifo_layer l on l.id=e.layer_id join stock_ledger_entry s on s.seq=l.source_seq where e.note_id=$1',[second.id])).rows[0];
 const cost=(await db.$client.query("insert into landed_cost_voucher(tenant_id,entity_id,status,posting_date,created_by) select tenant_id,entity_id,'submitted',posting_date,created_by from sales_note where id=$1 returning id",[second.id])).rows[0];
 await db.$client.query('insert into landed_cost_layer_change(voucher_id,receipt_line_id,layer_id,qty_remaining,old_rate,new_rate,amount,on_hand_value,variance_value) values($1,$2,$3,6,60,61,6,6,0)',[cost.id,returned.source_line_id,returned.layer_id]);
 const beforeCostCancel=await c.req('GET',`/sales-invoices/${inv.id}/balance`);
 await c.req('POST',`/sales-notes/${second.id}/cancel`,{reason:'Changed return acquisition cost must block reversal'},409);
 assert.deepEqual(await c.req('GET',`/sales-invoices/${inv.id}/balance`),beforeCostCancel);
 await db.$client.query("update landed_cost_voucher set status='cancelled' where id=$1",[cost.id]);
 await c.req('POST',`/sales-notes/${second.id}/cancel`,{reason:'Reverse untouched final return'},201);
 assert.equal((await c.req('GET',`/sales-invoices/${inv.id}/balance`)).openAmount,'600.000000');
 console.log('PASS original-cost return and cancellation rollback',c.checks);
}finally{await db.$client.end();}
