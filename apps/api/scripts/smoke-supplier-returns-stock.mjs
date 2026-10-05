import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {stockFixture} from './supplier-returns-test-helpers.mjs';
const {c,date,claim,receipt,wh,inv,po}=await stockFixture();
const db=createDb(process.env.DATABASE_URL);
try {
 const allocation=(await db.$client.query('select id from receipt_invoice_allocation where invoice_id=$1 and reversal_of is null',[inv.id])).rows[0];
 const input={postingDate:date,reason:'Dispatch claim goods to supplier',lines:[{claimLineId:claim.lines[0].id,receiptAllocationId:allocation.id,receiptLineId:receipt.lines[0].id,warehouseId:wh.id,qty:'4'}]};
 const p=await c.req('POST',`/buying/return-claims/${claim.id}/dispatch-preview`,input,201);
 assert.equal(p.valueInr,'240.000000');
 const movement=await c.req('POST',`/buying/return-claims/${claim.id}/dispatch`,input,201);
 assert.equal(movement.valueInr,'240.000000');
 const effect=(await db.$client.query('select * from supplier_return_effect where stock_entry_id=$1',[movement.stockEntryId])).rows[0];
 assert.equal(effect.qty,'4.000000');assert.equal(effect.value_inr,'240.000000');assert.equal(effect.invoice_line_id,inv.lines[0].id);
 await assert.rejects(db.$client.query('update supplier_return_effect set qty=0 where id=$1',[effect.id]),/append-only/);
 const posted=(await db.$client.query("select e.debit,e.credit,a.role from gl_entry e join journal_voucher v on v.id=e.voucher_id join gl_account a on a.id=e.account_id where v.source_type='purchase_return' and v.source_id=$1",[movement.stockEntryId])).rows;
 assert.ok(posted.some(x=>x.role==='pending_returns'&&x.debit==='240.000000'));
 assert.ok(posted.some(x=>x.role==='inventory'&&x.credit==='240.000000'));
 const original=await c.req('GET',`/purchase-orders/${po.id}`);assert.equal(original.lines[0].receivedQty,'10.000000');assert.equal(original.lines[0].billedQty,'10.000000');
 await c.req('POST',`/buying/return-claims/${claim.id}/dispatch`,{...input,lines:[{...input.lines[0],qty:'7'}]},409);
 await c.req('POST','/stock-entries',{purpose:'purchase_return',postingDate:date,lines:[]},400);
 console.log(`PASS supplier physical dispatch ${c.checks} request checks`);
}finally{await db.$client.end();}
