import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {fixture} from './sales-notes-test-helpers.mjs';
const {c,customer,reg}=await fixture('Zero-cost physical sales returns');
const uom=(await c.req('GET','/uoms')).find(x=>x.code==='NOS');
await c.req('POST','/hsn-codes',{code:'7601',kind:'hsn',description:'Zero-cost metal',gstRate:'0',effectiveFrom:'2025-04-01'},201);
const good=await c.req('POST','/items',{code:'ZERO',name:'Zero-cost returned goods',type:'raw_material',stockUomId:uom.id,hsnCode:'7601'},201);
const wh=await c.req('POST','/warehouses',{code:'ZERO',name:'Zero-cost destination',type:'stores'},201);
const receipt=await c.req('POST','/stock-entries',{purpose:'receipt',postingDate:c.settings.cutoverDate,lines:[{itemId:good.id,qty:'2',toWarehouseId:wh.id,rate:'0'}]},201);
await c.req('POST',`/stock-entries/${receipt.id}/submit`,{},201);
const draft=await c.req('POST','/sales-invoices',{customerId:customer.id,gstRegistrationId:reg.id,invoiceDate:c.settings.cutoverDate,placeOfSupplyStateCode:'27',lines:[{itemId:good.id,qty:'2',rate:'100',gstRate:'0',warehouseId:wh.id}]},201);
await c.req('POST',`/sales-invoices/${draft.id}/submit`,{},201);
const inv=await c.req('GET',`/sales-invoices/${draft.id}`);
const input={invoiceId:inv.id,kind:'credit',taxTreatment:'gst',taxEligibilityConfirmed:true,postingDate:c.settings.cutoverDate,reason:'Return one zero-cost dispatched item',lines:[{invoiceLineId:inv.lines[0].id,mode:'quantity',qty:'1',returnQty:'1',warehouseId:wh.id}]};
assert.equal((await c.req('POST','/sales-notes/preview',input,201)).returnValueInr,'0.000000');
const note=await c.req('POST','/sales-notes',input,201);
const submitted=await c.req('POST',`/sales-notes/${note.id}/submit`,{},201);
const db=createDb(process.env.DATABASE_URL);
try{
 const disposition=(await db.$client.query("select reason from gl_disposition where entity_id=$1 and source_type='sales_return' and source_id=$2",[c.entityId,submitted.stockEntryId])).rows[0];
 assert.equal(disposition.reason,'no_value_change');
 const effect=(await db.$client.query('select qty,value,layer_id from sales_return_effect where note_id=$1',[note.id])).rows[0];
 assert.equal(effect.qty,'1.000000');assert.equal(effect.value,'0.000000');
 await c.req('POST',`/sales-notes/${note.id}/cancel`,{reason:'Reverse zero-cost return exactly'},201);
 assert.equal((await db.$client.query('select qty_remaining from fifo_layer where id=$1',[effect.layer_id])).rows[0].qty_remaining,'0.000000');
 assert.equal((await c.req('GET',`/sales-invoices/${inv.id}/balance`)).openAmount,'200.000000');
 assert.ok((await c.req('GET','/accounts/trade-reconciliation')).every(r=>r.difference==='0.000000'));
 console.log('PASS zero-cost physical return disposition and cancellation',c.checks);
}finally{await db.$client.end();}
