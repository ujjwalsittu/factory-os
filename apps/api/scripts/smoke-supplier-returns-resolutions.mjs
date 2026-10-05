import assert from 'node:assert/strict';
import {Dec} from '../../../packages/core/dist/index.js';
import {createDb} from '../../../packages/db/dist/index.js';
import {stockFixture} from './supplier-returns-test-helpers.mjs';
const variant=process.argv[3]??'normal';const mode=process.argv[2]??'write_off';
const {c,date,claim,inv,receipt,wh,good}=await stockFixture(`Supplier ${mode} resolution`,variant==='zero'?'0':'60');
const db=createDb(process.env.DATABASE_URL);
try {
 const a=(await db.$client.query('select id from receipt_invoice_allocation where invoice_id=$1 and reversal_of is null',[inv.id])).rows[0];
 if(variant==='landed'){const lcv=await c.req('POST','/landed-costs',{postingDate:date,receiptIds:[receipt.id],charges:[{chargeType:'freight',amount:'200',basis:'value'}]},201);await c.req('POST',`/landed-costs/${lcv.id}/submit`,{},201);}
 const movement=await c.req('POST',`/buying/return-claims/${claim.id}/dispatch`,{postingDate:date,reason:'Return rejected purchase goods',lines:[{claimLineId:claim.lines[0].id,receiptAllocationId:a.id,receiptLineId:receipt.lines[0].id,warehouseId:wh.id,qty:'4'}]},201);
 const input={invoiceId:inv.id,kind:'credit',taxTreatment:'commercial',supplierNoteNo:'PART-001',supplierNoteDate:date,postingDate:date,reason:'Supplier accepts only half the return',taxEligibilityConfirmed:false,lines:[{invoiceLineId:inv.lines[0].id,claimLineId:claim.lines[0].id,mode:'quantity',qty:'2',taxableAmount:variant==='zero'?'2':'120'}]};
 const d=await c.req('POST','/buying/supplier-notes',input,201);const note=await c.req('POST',`/buying/supplier-notes/${d.id}/submit`,{},201);
 const body={kind:mode,claimLineId:claim.lines[0].id,returnEffectId:movement.evidenceIds[0],postingDate:date,qty:'2',reason:'Resolve supplier rejected balance',...(mode==='receive_back'?{warehouseId:wh.id}:{})};
 const result=await c.req('POST',`/buying/return-claims/${claim.id}/resolutions`,body,201);
 const expected=variant==='zero'?'0.000000':variant==='landed'?'160.000000':'120.000000';assert.equal(result.valueInr,expected);
 const pending=(await db.$client.query("select coalesce(sum(e.debit-e.credit),0)::text v from gl_entry e join gl_account a on a.id=e.account_id where e.entity_id=$1 and a.role='pending_returns'",[c.entityId])).rows[0];assert.ok(Dec.of(pending.v).isZero());
 await c.req('POST',`/purchase-invoices/${inv.id}/cancel`,{reason:'Source must retain live claim evidence'},409);
 if(mode==='receive_back'){assert.ok(result.stockEntryId);const r=await c.req('GET',`/stock-entries/${result.stockEntryId}`);assert.equal(r.lines[0].batchId,receipt.lines[0].batchId);assert.equal(r.lines[0].value,expected);}
 if(variant==='consumed'){
 const snapshot=async()=> (await db.$client.query('select (select count(*) from gl_entry where entity_id=$1)::int gl,(select count(*) from trade_bill_effect where entity_id=$1)::int bills,(select count(*) from stock_ledger_entry where entity_id=$1)::int stock,(select count(*) from supplier_resolution_effect where entity_id=$1)::int effects',[c.entityId])).rows[0];
 const issue=await c.req('POST','/stock-entries',{purpose:'issue',postingDate:date,lines:[{itemId:good.id,batchId:receipt.lines[0].batchId,qty:'8',fromWarehouseId:wh.id}]},201);await c.req('POST',`/stock-entries/${issue.id}/submit`,{},201);const before=await snapshot();await c.req('POST',`/buying/return-resolutions/${result.id}/cancel`,{reason:'Consumed received-back must refuse'},409);assert.deepEqual(await snapshot(),before);await c.req('POST',`/stock-entries/${issue.id}/cancel`,{reason:'Undo consumption to restore returned goods'},201);
 }
 await c.req('POST',`/buying/return-resolutions/${result.id}/cancel`,{reason:'Reverse unconsumed resolution'},201);
 const reopened=(await db.$client.query("select coalesce(sum(e.debit-e.credit),0)::text v from gl_entry e join gl_account a on a.id=e.account_id where e.entity_id=$1 and a.role='pending_returns'",[c.entityId])).rows[0];assert.equal(Dec.of(reopened.v).toFixed(6),expected);
 await c.req('POST',`/buying/supplier-notes/${note.id}/cancel`,{reason:'Reverse accepted half of return'},201);
 const restored=(await db.$client.query("select coalesce(sum(e.debit-e.credit),0)::text v from gl_entry e join gl_account a on a.id=e.account_id where e.entity_id=$1 and a.role='pending_returns'",[c.entityId])).rows[0];assert.equal(Dec.of(restored.v).toFixed(6),Dec.of(expected).mul('2').toFixed(6));
 console.log(`PASS supplier ${mode}/${variant} and reversals ${c.checks} request checks`);
}finally{await db.$client.end();}
