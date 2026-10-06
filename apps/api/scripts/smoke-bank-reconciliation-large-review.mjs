import assert from 'node:assert/strict';
import {bankFixture,stage,submitImport} from './bank-reconciliation-test-helpers.mjs';
const f=await bankFixture('Large duplicate review'),{c,db,path,date}=f;
try {
 const profile=await c.req('GET',path);await c.req('PUT',path,{mapping:{...profile.mapping.mapping,transactionIdColumn:undefined}});
 const count=Number(process.env.ROW_COUNT??1000),header='Date,Ref,ID,Amount\n',csv=header+Array.from({length:count},()=>`${date},SAME,,1`).join('\n');
 const first=await stage(f,csv,String(count));await submitImport(f,first);
 const overlap=await stage(f,'\uFEFF'+csv,String(count)),review=await c.req('GET',`${path}/imports/${overlap.id}/review`);
 if(process.env.CHECK_TRANSPORT==='1'){
  const payload={reviewedHash:review.previewHash,decisions:Array.from({length:10000},(_,i)=>({ordinal:i+2,decision:'link',movementId:'11111111-1111-4111-8111-111111111111',reason:'\\'.repeat(2000)}))};
  assert.ok(Buffer.byteLength(JSON.stringify(payload))>1024*1024);
  // A valid transport reaches semantic validation (not 413), then refuses nonexistent occurrence IDs atomically.
  await c.req('POST',`${path}/imports/${overlap.id}/submit`,payload,400);
  await c.req('POST','/accounts/journals',payload,413);
  await c.req('POST',`${path}/matches/preview`,{padding:'x'.repeat(2*1024*1024)},413);
 } else {
  assert.ok(Buffer.byteLength(JSON.stringify(review))<count*2000+256*1024,'Repeated candidate review must grow linearly, not repeat every pool per ordinal');
  console.log(`Shared-pool review bytes: ${Buffer.byteLength(JSON.stringify(review))} for ${count} rows`);
  assert.equal(review.ambiguities.length,count);const pool=review.candidatePools[review.ambiguities[0].poolId];assert.equal(pool.length,count);
  const decisions=review.ambiguities.map((a,i)=>({ordinal:a.ordinal,decision:'link',movementId:review.candidatePools[a.poolId][i],reason:'Confirmed identical occurrence'}));
  const invalid=decisions.map((d,i)=>i===1?{...d,movementId:decisions[0].movementId}:d);
  await c.req('POST',`${path}/imports/${overlap.id}/submit`,{reviewedHash:review.previewHash,decisions:invalid},409);
  const submitted=await c.req('POST',`${path}/imports/${overlap.id}/submit`,{reviewedHash:review.previewHash,decisions},201);
  assert.equal((await c.req('POST',`${path}/imports/${overlap.id}/submit`,{reviewedHash:review.previewHash,decisions},201)).id,submitted.id);
  const result=await db.$client.query('select count(*)::int n from bank_statement_movement where entity_id=$1',[c.entityId]);assert.equal(result.rows[0].n,count);
 }
 console.log(`PASS bounded duplicate review/transport (${count} rows, ${c.checks} HTTP checks)`);
} finally {await db.$client.end();}
