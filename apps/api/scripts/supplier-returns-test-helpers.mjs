import {Dec} from '../../../packages/core/dist/index.js';
import { Client, gstin } from './accounting-test-helpers.mjs';
export async function fixture(name='Supplier returns') {
 const c=await new Client().init(name);
 const supplier=await c.req('POST','/parties',{code:'SUP',name:'Return supplier',isSupplier:true,gstTreatment:'registered',gstin:gstin('27AAACB1234C1Z'),stateCode:'27'},201);
 const reg=await c.req('POST',`/entities/${c.entityId}/gst-registrations`,{gstin:gstin('27AAACA1234B1Z')},201);
 const uom=(await c.req('GET','/uoms')).find(x=>x.code==='NOS');
 await c.req('POST','/hsn-codes',{code:'9983',kind:'sac',description:'Supplier service',gstRate:'18',effectiveFrom:'2025-04-01'},201);
 const item=await c.req('POST','/items',{code:'SVC',name:'Supplier service',type:'service',stockUomId:uom.id,hsnCode:'9983'},201);
 await c.activate();
 const date=c.settings.cutoverDate;
 const d=await c.req('POST','/purchase-invoices',{supplierId:supplier.id,gstRegistrationId:reg.id,supplierInvoiceNo:'SRC-001',supplierInvoiceDate:date,postingDate:date,lines:[{itemId:item.id,qty:'1',rate:'100',gstRate:'18'}]},201);
 await c.req('POST',`/purchase-invoices/${d.id}/submit`,{acceptRateVariance:true},201);
 const inv=await c.req('GET',`/purchase-invoices/${d.id}`);
 const claimInput={invoiceId:inv.id,postingDate:date,reason:'Supplier adjustment claim',lines:[{invoiceLineId:inv.lines[0].id,qty:'0',taxableAmount:'40'}]};
 return {c,supplier,reg,item,inv,date,claimInput};
}
export async function stockFixture(name='Supplier stock returns', rate='60') {
 const f=await fixture(name),{c,supplier,reg,date}=f;
 const uom=(await c.req('GET','/uoms')).find(x=>x.code==='NOS');
 await c.req('POST','/hsn-codes',{code:'7601',kind:'hsn',description:'Purchased metal',gstRate:'0',effectiveFrom:'2025-04-01'},201);
 const good=await c.req('POST','/items',{code:'GOOD',name:'Purchased return goods',type:'raw_material',tracking:'batch',stockUomId:uom.id,hsnCode:'7601'},201);
 const wh=await c.req('POST','/warehouses',{code:'STORES',name:'Purchased stores',type:'stores'},201);
 const po=await c.req('POST','/purchase-orders',{supplierId:supplier.id,gstRegistrationId:reg.id,orderDate:date,lines:[{itemId:good.id,qty:'10',rate,gstRate:'0'}]},201);
 await c.req('POST',`/purchase-orders/${po.id}/submit`,{},201);
 const order=await c.req('GET',`/purchase-orders/${po.id}`);
 const receipt=await c.req('POST','/stock-entries',{purpose:'receipt',postingDate:date,purchaseOrderId:po.id,partyId:supplier.id,lines:[{itemId:good.id,qty:'10',poLineId:order.lines[0].id,toWarehouseId:wh.id,newBatchNo:'ORIGINAL'}]},201);
 await c.req('POST',`/stock-entries/${receipt.id}/submit`,{},201);
 const received=await c.req('GET',`/stock-entries/${receipt.id}`);
 const invoiceRate=rate==='0'?'1':rate;
 const d=await c.req('POST','/purchase-invoices',{supplierId:supplier.id,gstRegistrationId:reg.id,purchaseOrderId:po.id,supplierInvoiceNo:'GOODS-001',supplierInvoiceDate:date,postingDate:date,lines:[{itemId:good.id,poLineId:order.lines[0].id,qty:'10',rate:invoiceRate,gstRate:'0'}]},201);
 await c.req('POST',`/purchase-invoices/${d.id}/submit`,{acceptRateVariance:true},201);
 const inv=await c.req('GET',`/purchase-invoices/${d.id}`);
 const input={invoiceId:inv.id,postingDate:date,reason:'Return purchased material',lines:[{invoiceLineId:inv.lines[0].id,qty:'10',taxableAmount:Dec.of(invoiceRate).mul('10').toString()}]};
 const claim=await c.req('POST','/buying/return-claims',input,201);
 await c.req('POST',`/buying/return-claims/${claim.id}/submit`,{},201);
 await c.req('POST',`/buying/return-claims/${claim.id}/approve`,{reason:'Approve physical supplier return'},201);
 const submitted=await c.req('GET',`/buying/return-claims/${claim.id}`);
 return {...f,good,wh,po:order,receipt:received,inv,claim:submitted};
}
