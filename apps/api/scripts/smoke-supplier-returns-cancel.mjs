import assert from 'node:assert/strict';
import {Dec} from '../../../packages/core/dist/index.js';
import {createDb} from '../../../packages/db/dist/index.js';
import {stockFixture} from './supplier-returns-test-helpers.mjs';
const {c,date,claim,inv,receipt,wh}=await stockFixture('Supplier dispatch cancellation');const db=createDb(process.env.DATABASE_URL);
try {
 const allocation=(await db.$client.query('select id from receipt_invoice_allocation where invoice_id=$1 and reversal_of is null',[inv.id])).rows[0];
 const body={postingDate:date,reason:'Supplier physical dispatch',lines:[{claimLineId:claim.lines[0].id,receiptAllocationId:allocation.id,receiptLineId:receipt.lines[0].id,warehouseId:wh.id,qty:'4'}]};
 const input={invoiceId:inv.id,kind:'credit',taxTreatment:'commercial',supplierNoteNo:'BEFORE-001',supplierNoteDate:date,postingDate:date,reason:'Acceptance before dispatch reversal',taxEligibilityConfirmed:false,lines:[{invoiceLineId:inv.lines[0].id,claimLineId:claim.lines[0].id,mode:'quantity',qty:'4',taxableAmount:'240'}]};
 const d=await c.req('POST','/buying/supplier-notes',input,201);const note=await c.req('POST',`/buying/supplier-notes/${d.id}/submit`,{},201);const move=await c.req('POST',`/buying/return-claims/${claim.id}/dispatch`,body,201);
 await c.req('POST',`/buying/return-claims/${claim.id}/cancel`,{reason:'Live dispatch and acceptance must block claim'},409);
 await c.req('POST',`/buying/return-movements/${move.stockEntryId}/cancel`,{reason:'Live acceptance must block dispatch cancellation'},409);
 await c.req('POST',`/buying/supplier-notes/${note.id}/cancel`,{reason:'Reverse supplier acceptance'},201);
 await c.req('POST',`/buying/return-movements/${move.stockEntryId}/cancel`,{reason:'Reverse mistaken physical dispatch'},201);
 const pending=(await db.$client.query("select coalesce(sum(e.debit-e.credit),0)::text v from gl_entry e join gl_account a on a.id=e.account_id where e.entity_id=$1 and a.role='pending_returns'",[c.entityId])).rows[0];assert.ok(Dec.of(pending.v).isZero(),'Dispatch cancellation reverses restored preaccepted pending carrying');
 await c.req('POST',`/buying/return-claims/${claim.id}/cancel`,{reason:'All dependencies reversed'},201);
 await c.req('POST',`/purchase-invoices/${inv.id}/cancel`,{reason:'Original source dependency released'},201);
 console.log(`PASS supplier claim and dispatch cancellation ${c.checks} request checks`);
}finally{await db.$client.end();}
