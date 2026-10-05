import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {fixture} from './supplier-returns-test-helpers.mjs';
const {c,date,item,reg,supplier}=await fixture('Supplier ITC guard');const db=createDb(process.env.DATABASE_URL);
try{async function invoice(no,fields){const d=await c.req('POST','/purchase-invoices',{supplierId:supplier.id,gstRegistrationId:reg.id,supplierInvoiceNo:no,supplierInvoiceDate:date,postingDate:date,lines:[{itemId:item.id,qty:'1',rate:'100',gstRate:'18'}],...fields},201);await c.req('POST',`/purchase-invoices/${d.id}/submit`,{},201);return c.req('GET',`/purchase-invoices/${d.id}`)}
 const original=await invoice('NONITC',{itcEligible:false});const input=inv=>({invoiceId:inv.id,kind:'credit',taxTreatment:'gst',supplierNoteNo:'TAX-'+inv.supplierInvoiceNo,supplierNoteDate:date,postingDate:date,reason:'Documented supplier tax adjustment',taxEligibilityConfirmed:true,lines:[{invoiceLineId:inv.lines[0].id,mode:'value',taxableAmount:'40'}]});
 const d=await c.req('POST','/buying/supplier-notes',input(original),201);const n=await c.req('POST',`/buying/supplier-notes/${d.id}/submit`,{},201);const rows=(await db.$client.query('select a.role from gl_entry g join gl_account a on a.id=g.account_id where g.voucher_id=$1',[n.voucherId])).rows;assert.equal(rows.some(x=>x.role?.startsWith('input_')),false);
 const rcm=await invoice('RCM',{reverseCharge:true});await c.req('POST','/buying/supplier-notes/preview',input(rcm),409);await c.req('POST','/buying/supplier-notes/preview',{...input(rcm),taxTreatment:'commercial'},201);
 const foreign=await c.req('POST','/parties',{code:'IMPORT',name:'Imported supplier',isSupplier:true,gstTreatment:'overseas'},201);const imported=await invoice('IMPORT',{supplierId:foreign.id,currency:'USD',exchangeRate:'80',lines:[{itemId:item.id,qty:'1',rate:'100',gstRate:'0'}]});await c.req('POST','/buying/supplier-notes/preview',input(imported),409);await c.req('POST','/buying/supplier-notes/preview',{...input(imported),taxTreatment:'commercial'},201);
 console.log(`PASS noncreditable tax RCM and imported adjustment guards ${c.checks} request checks`)
}finally{await db.$client.end()}
