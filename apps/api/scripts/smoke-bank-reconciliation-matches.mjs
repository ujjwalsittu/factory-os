import assert from 'node:assert/strict';
import { Client } from './accounting-test-helpers.mjs';
import { createDb } from '../../../packages/db/dist/index.js';
const c=await new Client().init('Bank reconciliation matching'),db=createDb(process.env.DATABASE_URL);
try {
 await c.activate();const date=c.settings.cutoverDate,previous=new Date(`${date}T00:00:00Z`);previous.setUTCDate(previous.getUTCDate()-1);const baselineDate=previous.toISOString().slice(0,10);
 // Only this newly created empty fixture gets a synthetic previous-day cutover; existing books are untouched.
 await db.$client.query('update accounting_settings set cutover_date=$1 where entity_id=$2',[baselineDate,c.entityId]);
 const customer=await c.req('POST','/parties',{code:'BANK-CUS',name:'Bank receipt customer',isCustomer:true,gstTreatment:'unregistered'},201);
 const base='/accounts/bank-reconciliation/profiles',mapping={delimiter:',',skipRows:0,dateFormat:'YYYY-MM-DD',dateColumn:'Date',referenceColumn:'Ref',amount:{mode:'signed',column:'Amount',polarity:'credit-positive'},decimalSeparator:'.',groupSeparator:null,order:'ascending'};
 const profile=await c.req('POST',base,{accountId:c.account('bank'),maskedIdentifier:'••1234',currency:'INR',mapping},201),path=`${base}/${profile.id}`;
 const baseline={date:baselineDate,bankBalance:'0',reference:'Prior day empty bank',evidence:'Isolated synthetic empty bank statement',outstanding:[]},bp=await c.req('POST',`${path}/baseline/preview`,baseline,201);await c.req('POST',`${path}/baseline/activate`,{...baseline,reviewedHash:bp.previewHash},201);
 const charge={postingDate:date,bankAccountId:c.account('bank'),expenseAccountId:c.account('bank_charges'),baseAmount:'100',gst:{cgst:'0',sgst:'0',igst:'0',cess:'0'},reference:'FEE-ORDINARY',evidence:{document:'Fee bank advice',reason:'Actual net receipt evidence'},itcEligible:false};
 const receipts=[];
 for(const reference of ['ORDINARY','NET']){const r=await c.req('POST','/accounts/settlements',{direction:'receipt',partyId:customer.id,postingDate:date,currency:'INR',exchangeRate:'1',accountId:c.account('bank'),amount:'90000',allocations:[],bankReference:reference,charge:{...charge,reference:`FEE-${reference}`}},201);await c.req('POST',`/accounts/settlements/${r.id}/submit`,{});receipts.push(await c.req('GET',`/accounts/settlements/${r.id}`));}
 const books=[];for(const amount of ['600','400']){const j=await c.req('POST','/accounts/journals',{postingDate:date,narration:'Bank group matching fixture',lines:[c.line('bank',amount),c.line('equity','0',amount)]},201);await c.req('POST',`/accounts/journals/${j.id}/submit`);const detail=await c.req('GET',`/accounts/journals/${j.id}`);books.push(detail.entries.find(x=>x.accountId===c.account('bank')));}
 const dayAfter=new Date(`${date}T00:00:00Z`);dayAfter.setUTCDate(dayAfter.getUTCDate()+1);const grossDate=dayAfter.toISOString().slice(0,10);dayAfter.setUTCDate(dayAfter.getUTCDate()+1);const feeDate=dayAfter.toISOString().slice(0,10);
 const csv=`Date,Ref,Amount\n${date},ORDINARY,89900\n${date},GROUP,1000\n${grossDate},NET,90000\n${feeDate},FEE-NET,-100`,context=await c.req('GET',path);
 const form=new FormData();form.set('metadata',JSON.stringify({startDate:date,endDate:feeDate,openingBalance:'0',closingBalance:'180800',mappingId:context.mapping.id}));form.set('file',new Blob([csv]),'statement.csv');
 const response=await fetch(c.base+`${path}/imports`,{method:'POST',headers:{Origin:c.origin,Cookie:c.cookie,'x-tenant-id':c.tenantId,'x-entity-id':c.entityId},body:form}),batch=await response.json();assert.equal(response.status,201);
 const review=await c.req('GET',`${path}/imports/${batch.id}/review`);await c.req('POST',`${path}/imports/${batch.id}/submit`,{reviewedHash:review.previewHash},201);
 const state=await c.req('GET',`${path}/matches`);
 assert.ok(state.sources?.some(x=>x.voucherId===receipts[0].voucherId),'Matching exposes scoped original voucher links');
 const row=ref=>state.statement.find(x=>x.reference===ref),bank=ref=>state.book.find(x=>x.reference===ref);
 assert.equal(bank('ORDINARY').signedAmount,'89900.000000');assert.ok(!state.book.some(x=>x.signedAmount==='90000.000000'));
 const candidates=await c.req('GET',`${path}/candidates?statementRowId=${row('ORDINARY').id}`);assert.equal(candidates[0].id,bank('ORDINARY').id);assert.equal(candidates.filter(x=>x.exactAmount).length,2,'Multiple exact amounts remain explicit candidates');
 const snapshot=async()=>Object.fromEntries(await Promise.all(['gl_entry','trade_bill','trade_bill_effect','stock_ledger_entry','fifo_layer'].map(async table=>[table,(await db.$client.query(`select * from ${table} where entity_id=$1 order by ${table==='stock_ledger_entry'?'seq':'id'}`,[c.entityId])).rows]))),before=await snapshot();
 const partial={kind:'ordinary',edges:[{statementRowId:row('GROUP').id,bookItemKind:'gl',bookItemId:books[0].id,amount:'250'}]},pp=await c.req('POST',`${path}/matches/preview`,partial,201);
 const group=await c.req('POST',`${path}/matches`,{...partial,reviewedHash:pp.previewHash},201);
 await c.req('POST',`${path}/matches`,{...partial,reviewedHash:pp.previewHash},409);
 await c.req('POST',`${path}/imports/${batch.id}/reverse`,{reason:'Active match prevents import reversal'},409);
 assert.ok((await c.req('GET',`${path}/candidates?statementRowId=${row('GROUP').id}`)).some(x=>x.id===books[0].id&&x.remaining==='350.000000'));
 const net={kind:'net',statementRowIds:[row('NET').id,row('FEE-NET').id],bankEntryId:bank('NET').id,reason:'Gross bank receipt plus actual separately displayed fee'},np=await c.req('POST',`${path}/matches/preview`,net,201);
 await c.req('POST',`${path}/matches/preview`,{...net,bankEntryId:books[0].id},409);
 const routineRole=await c.req('POST','/roles',{name:'Ordinary bank matcher',permissions:['accounts.bank_reconciliation.read','accounts.bank_reconciliation.submit','accounts.bank_reconciliation.cancel']},201),routine=new Client(),email=`bank-matcher-${Date.now()}@example.com`;
 const invitation=await c.req('POST','/invitations',{email,roles:[{roleId:routineRole.id,entityIds:[c.entityId]}]},201);
 await routine.req('POST','/auth/sign-up/email',{name:'Bank matcher',email,password:'Sup3r-secret-pw'});await routine.req('POST','/invitations/accept',{token:invitation.inviteUrl.split('/').at(-1)},201);routine.tenantId=c.tenantId;routine.entityId=c.entityId;
 await routine.req('POST',`${path}/matches`,{...net,reviewedHash:np.previewHash},403);
 const datedBefore=await Promise.all([date,grossDate,feeDate].map(asOf=>c.req('GET',`${path}/report?asOf=${asOf}`)));
 const netGroup=await c.req('POST',`${path}/matches`,{...net,reviewedHash:np.previewHash},201);
 const datedAfter=await Promise.all([date,grossDate,feeDate].map(asOf=>c.req('GET',`${path}/report?asOf=${asOf}`)));
 for(const i of [0,1]){assert.equal(datedAfter[i].U,datedBefore[i].U,'Future/cross-day net remains wholly outstanding');assert.equal(datedAfter[i].E,datedBefore[i].E,'Cross-day bank evidence remains uncleared until last date');}
 assert.equal(BigInt(datedBefore[2].U.replace('.',''))-BigInt(datedAfter[2].U.replace('.','')),89900000000n);assert.equal(BigInt(datedBefore[2].E.replace('.',''))-BigInt(datedAfter[2].E.replace('.','')),89900000000n);
 await c.req('POST',`/accounts/settlements/${receipts[1].id}/cancel`,{reason:'Net-matched settlement cannot reverse'},409);
 assert.deepEqual(await c.req('GET',`${path}/candidates?statementRowId=${row('NET').id}`),[],'Fully consumed bank row has no remaining candidate');
 await c.req('POST',`${path}/matches/${netGroup.id}/reverse`,{reason:'Reverse complete documented net group'},201);
 await c.req('POST',`${path}/matches/${netGroup.id}/reverse`,{reason:'Cannot reverse twice'},409);
 await c.req('POST',`/accounts/journals/${books[0].voucherId}/cancel`,{reason:'Matched source journal cannot reverse'},409);
 await c.req('POST',`${path}/matches/${group.id}/reverse`,{reason:'Restore partial capacities'},201);
 const full={kind:'ordinary',edges:books.map((book,index)=>({statementRowId:row('GROUP').id,bookItemKind:'gl',bookItemId:book.id,amount:index===0?'600':'400'}))},fp=await c.req('POST',`${path}/matches/preview`,full,201);
 const fullGroup=await c.req('POST',`${path}/matches`,{...full,reviewedHash:fp.previewHash},201);
 await c.req('POST',`${path}/matches/${fullGroup.id}/reverse`,{reason:'Restore full grouped capacities'},201);
 assert.deepEqual(await snapshot(),before,'Matching/unmatching leaves actual GL and bills/stock/FIFO unchanged');
 await c.req('POST',`/accounts/journals/${books[0].voucherId}/cancel`,{reason:'Unmatched source now may reverse'});
 const cancelled=await c.req('GET',`${path}/matches`);assert.ok(cancelled.book.some(x=>x.id===books[0].id&&x.signedAmount==='600.000000'),'Cancelled original stays visible');assert.ok(cancelled.book.some(x=>x.signedAmount==='-600.000000'),'Actual appended reversal is independently visible');
 console.log(`PASS actual net bank candidates, partial capacities, stale previews, Finance net source evidence and ledger invariance (${c.checks} HTTP checks)`);
}finally{await db.$client.end();}
