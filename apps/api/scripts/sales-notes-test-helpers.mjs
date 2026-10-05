import { Client, gstin } from './accounting-test-helpers.mjs';
export async function fixture(name='Sales notes', tax='0',cess='0'){
 const c=await new Client().init(name);
 const customer=await c.req('POST','/parties',{code:'CUS',name:'Note customer',isCustomer:true,gstTreatment:'unregistered',stateCode:'27'},201);
 const reg=await c.req('POST',`/entities/${c.entityId}/gst-registrations`,{gstin:gstin('27AAACA1234B1Z')},201);
 const uom=(await c.req('GET','/uoms')).find(x=>x.code==='NOS');
 await c.req('POST','/hsn-codes',{code:'9983',kind:'sac',description:'Note service',gstRate:tax,cessRate:cess,effectiveFrom:'2025-04-01'},201);
 const item=await c.req('POST','/items',{code:'SVC',name:'Note service',type:'service',stockUomId:uom.id,hsnCode:'9983'},201);
 await c.activate();
 async function invoice(rate='100'){
  const d=await c.req('POST','/sales-invoices',{customerId:customer.id,gstRegistrationId:reg.id,invoiceDate:c.settings.cutoverDate,placeOfSupplyStateCode:'27',lines:[{itemId:item.id,qty:'1',rate,gstRate:tax}]},201);
  await c.req('POST',`/sales-invoices/${d.id}/submit`,{},201);
  return c.req('GET',`/sales-invoices/${d.id}`);
 }
 const inv=await invoice();
 const input=(amount='40',kind='credit',taxTreatment='gst')=>({invoiceId:inv.id,kind,taxTreatment,postingDate:c.settings.cutoverDate,reason:'Correct original invoice value',taxEligibilityConfirmed:true,lines:[{invoiceLineId:inv.lines[0].id,mode:'value',taxableAmount:amount}]});
 return {c,customer,reg,item,inv,input,invoice};
}
