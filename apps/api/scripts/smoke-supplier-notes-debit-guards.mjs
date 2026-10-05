import assert from 'node:assert/strict';
import {fixture} from './supplier-returns-test-helpers.mjs';
const {c,date,inv}=await fixture('Supplier debit guards');
const input=(amount,kind='credit',taxTreatment='commercial',no=kind+amount)=>({invoiceId:inv.id,kind,taxTreatment,supplierNoteNo:no,supplierNoteDate:date,postingDate:date,reason:'Supplier note ceiling correction',taxEligibilityConfirmed:true,lines:[{invoiceLineId:inv.lines[0].id,mode:'value',taxableAmount:amount}]});
async function submit(body){const d=await c.req('POST','/buying/supplier-notes',body,201);return c.req('POST',`/buying/supplier-notes/${d.id}/submit`,{},201)}
const large=await c.req('POST','/buying/supplier-notes/preview',input('200','debit','gst'),201);assert.equal(large.cgst,'18.00');assert.equal(large.grandTotal,'236.00');
const debit=await submit(input('100','debit'));const credit=await submit(input('150'));
await c.req('POST',`/buying/supplier-notes/${debit.id}/cancel`,{reason:'Dependent credit must block debit cancellation'},409);
await c.req('POST',`/buying/supplier-notes/${credit.id}/cancel`,{reason:'Release the dependent credit ceiling'},201);
await c.req('POST',`/buying/supplier-notes/${debit.id}/cancel`,{reason:'Cancel unneeded supplier debit'},201);
const gstDebit=await submit(input('100','debit','gst','GST-DN'));
const paid=await c.req('POST','/accounts/settlements',{direction:'payment',partyId:inv.supplierId,postingDate:date,currency:'INR',exchangeRate:'1',accountId:c.account('bank'),amount:'10',allocations:[{billId:gstDebit.billId,amount:'10'}]},201);
await c.req('POST',`/accounts/settlements/${paid.id}/submit`,{},200);
await c.req('POST',`/buying/supplier-notes/${gstDebit.id}/cancel`,{reason:'Paid debit must preserve payment dependency'},409);
console.log(`PASS supplier debit ceilings and payment dependencies ${c.checks} request checks`);
