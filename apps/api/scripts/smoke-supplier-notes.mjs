import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {fixture} from './supplier-returns-test-helpers.mjs';
const {c,date,inv}=await fixture('Supplier note recognition');
const db=createDb(process.env.DATABASE_URL);
try {
 const input={invoiceId:inv.id,kind:'credit',taxTreatment:'gst',supplierNoteNo:'SUP-CN-001',supplierNoteDate:date,postingDate:date,reason:'Supplier accepts invoice correction',taxEligibilityConfirmed:true,lines:[{invoiceLineId:inv.lines[0].id,mode:'value',taxableAmount:'40'}]};
 const preview=await c.req('POST','/buying/supplier-notes/preview',input,201);
 assert.equal(preview.grandTotal,'47.20');assert.equal(preview.cgst,'3.60');assert.equal(preview.sgst,'3.60');
 const draft=await c.req('POST','/buying/supplier-notes',input,201);
 const note=await c.req('POST',`/buying/supplier-notes/${draft.id}/submit`,{},201);assert.ok(note.billId);
 assert.equal(note.stockEntryId??null,null);
 const balance=(await c.req('GET','/accounts/outstanding?side=payable')).bills.find(x=>x.sourceType==='purchase_invoice'&&x.sourceId===inv.id);
 assert.equal(balance.openAmount,'70.800000');
 const p=await db.$client.query('select sum(e.debit)::text debit,sum(e.credit)::text credit from gl_entry e where e.voucher_id=$1',[note.voucherId]);assert.equal(p.rows[0].debit,'47.200000');assert.equal(p.rows[0].credit,'47.200000');
 const duplicate=await c.req('POST','/buying/supplier-notes',{...input,supplierNoteNo:'sup-cn-001'},201);
 await c.req('POST',`/buying/supplier-notes/${duplicate.id}/submit`,{},409);
 await c.req('POST','/buying/supplier-notes/preview',{...input,lines:[{...input.lines[0],taxableAmount:'61'}]},409);
 const commercial=await c.req('POST','/buying/supplier-notes/preview',{...input,taxTreatment:'commercial'},201);assert.equal(commercial.cgst,'0.00');assert.equal(commercial.grandTotal,'40.00');
 await c.req('POST','/buying/supplier-notes/preview',{...input,taxEligibilityConfirmed:false},400);
 console.log(`PASS supplier note recognition ${c.checks} request checks`);
}finally{await db.$client.end();}
