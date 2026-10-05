import {Dec} from '../../../packages/core/dist/index.js';
import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {stockFixture} from './supplier-returns-test-helpers.mjs';
const first=process.argv[2]??'dispatch';
const {c,date,claim,inv,receipt,wh}=await stockFixture(`Supplier ${first} first`);
const db=createDb(process.env.DATABASE_URL);
try {
 const allocation=(await db.$client.query('select id from receipt_invoice_allocation where invoice_id=$1 and reversal_of is null',[inv.id])).rows[0];
 const dispatch={postingDate:date,reason:'Dispatch accepted supplier goods',lines:[{claimLineId:claim.lines[0].id,receiptAllocationId:allocation.id,receiptLineId:receipt.lines[0].id,warehouseId:wh.id,qty:'4'}]};
 const input={invoiceId:inv.id,kind:'credit',taxTreatment:'commercial',supplierNoteNo:'RETURN-001',supplierNoteDate:date,postingDate:date,reason:'Supplier accepted physical return',taxEligibilityConfirmed:false,lines:[{invoiceLineId:inv.lines[0].id,claimLineId:claim.lines[0].id,mode:'quantity',qty:'4',taxableAmount:'240'}]};
 const move=async()=>c.req('POST',`/buying/return-claims/${claim.id}/dispatch`,dispatch,201);
 const accept=async()=>{const n=await c.req('POST','/buying/supplier-notes',input,201);return c.req('POST',`/buying/supplier-notes/${n.id}/submit`,{},201)};
 let accepted;if(first==='multi'){input.lines[0].qty='2';input.lines[0].taxableAmount='120';accepted=await accept();input.supplierNoteNo='RETURN-002';input.lines[0].qty='6';input.lines[0].taxableAmount='360';await accept();await move();}else if(first==='dispatch'){await move();accepted=await accept();}else{accepted=await accept();await move();}
 const pending=(await db.$client.query("select coalesce(sum(e.debit-e.credit),0)::text balance from gl_entry e join gl_account a on a.id=e.account_id where e.entity_id=$1 and a.role='pending_returns'",[c.entityId])).rows[0];
 assert.equal(Dec.of(pending.balance).toFixed(6),'0.000000','Accepted and dispatched goods leave no pending value in either order');
 assert.equal((await db.$client.query("select count(*)::int n from trade_bill where entity_id=$1 and source_type='supplier_note'",[c.entityId])).rows[0].n,first==='multi'?2:1);
 assert.equal((await db.$client.query('select count(*)::int n from supplier_return_effect where entity_id=$1',[c.entityId])).rows[0].n,1);
 await c.req('POST',`/buying/supplier-notes/${accepted.id}/cancel`,{reason:'Reverse acceptance without inventing stock arrival'},201);
 const reopened=(await db.$client.query("select coalesce(sum(e.debit-e.credit),0)::text balance from gl_entry e join gl_account a on a.id=e.account_id where e.entity_id=$1 and a.role='pending_returns'",[c.entityId])).rows[0];assert.equal(Dec.of(reopened.balance).toFixed(6),first==='multi'?'120.000000':'240.000000');
 console.log(`PASS supplier ${first}-first acceptance ${c.checks} request checks`);
}finally{await db.$client.end();}
