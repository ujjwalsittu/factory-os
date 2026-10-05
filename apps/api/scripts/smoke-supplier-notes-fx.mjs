import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {fixture} from './supplier-returns-test-helpers.mjs';
const {c,date,item,reg}=await fixture('Supplier foreign credits');
const db=createDb(process.env.DATABASE_URL);
try {
 const supplier=await c.req('POST','/parties',{code:'FOREIGN',name:'Foreign return supplier',isSupplier:true,gstTreatment:'overseas'},201);
 async function invoice(amount,rate,no){const n=await c.req('POST','/purchase-invoices',{supplierId:supplier.id,gstRegistrationId:reg.id,supplierInvoiceNo:no,supplierInvoiceDate:date,postingDate:date,currency:'USD',exchangeRate:rate,lines:[{itemId:item.id,qty:'1',rate:amount,gstRate:'0'}]},201);await c.req('POST',`/purchase-invoices/${n.id}/submit`,{},201);return c.req('GET',`/purchase-invoices/${n.id}`)}
 const original=await invoice('100','80','USD-001');
 const sourceBill=(await c.req('GET',`/accounts/bills?partyId=${supplier.id}&side=payable&currency=USD`)).find(x=>x.sourceId===original.id);
 const pay=await c.req('POST','/accounts/settlements',{direction:'payment',partyId:supplier.id,postingDate:date,currency:'USD',exchangeRate:'80',accountId:c.account('bank'),amount:'70',allocations:[{billId:sourceBill.id,amount:'70'}]},201);
 await c.req('POST',`/accounts/settlements/${pay.id}/submit`,{},200);
 const input={invoiceId:original.id,kind:'credit',taxTreatment:'commercial',supplierNoteNo:'USD-CN-001',supplierNoteDate:date,postingDate:date,reason:'Foreign supplier credit adjustment',taxEligibilityConfirmed:false,lines:[{invoiceLineId:original.lines[0].id,mode:'value',taxableAmount:'40'}]};
 const n=await c.req('POST','/buying/supplier-notes',input,201);const note=await c.req('POST',`/buying/supplier-notes/${n.id}/submit`,{},201);
 assert.equal(note.creditBalance.openAmount,'10.000000');assert.equal(note.creditBalance.carryingInr,'800.000000');
 const target=await invoice('10','83','USD-002');const bill=(await c.req('GET',`/accounts/bills?partyId=${supplier.id}&side=payable&currency=USD`)).find(x=>x.sourceId===target.id);
 const allocation={supplierNoteId:note.id,postingDate:date,reason:'Apply foreign supplier credit',allocations:[{billId:bill.id,amount:'4'}]};
 const preview=await c.req('POST','/accounts/settlement-allocations/preview',allocation,200);
 assert.equal(preview.forexInr,'-12.000000','Payable830 cleared with credit800 gives gain30, not loss');
 const first=await c.req('POST','/accounts/settlement-allocations',allocation,201);
 const second=await c.req('POST','/accounts/settlement-allocations',{...allocation,allocations:[{billId:bill.id,amount:'6'}]},201);
 const fx=(await db.$client.query("select sum(e.credit-e.debit)::text gain from gl_entry e join gl_account a on a.id=e.account_id where e.entity_id=$1 and a.role='forex'",[c.entityId])).rows[0];assert.equal(fx.gain,'30.000000');
 await c.req('POST',`/accounts/settlement-allocations/${second.id}/cancel`,{reason:'Reverse final foreign allocation'},200);
 await c.req('POST',`/accounts/settlement-allocations/${first.id}/cancel`,{reason:'Reverse partial foreign allocation'},200);
 assert.equal((await c.req('GET',`/buying/supplier-notes/${note.id}`)).creditBalance.carryingInr,'800.000000');
 console.log(`PASS supplier original-rate foreign credit ${c.checks} request checks`);
}finally{await db.$client.end();}
