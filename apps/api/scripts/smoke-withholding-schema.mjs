import assert from 'node:assert/strict';
import { createDb } from '../../../packages/db/dist/index.js';
import { randomUUID } from 'node:crypto';
const db = createDb(process.env.DATABASE_URL);
const p = await db.$client.connect();
try {
  await p.query('begin');
  const legacy = (await p.query('select * from party_settlement order by created_at limit 3')).rows;
  assert.ok(legacy.length, 'Existing isolated legacy settlement fixture required');
  for (const name of ['tax_configuration','tax_profile_revision','taxpayer_identity','tax_party_evidence','tax_certificate','tax_opening','tax_source_history','tax_assessment','tax_event','tax_base_consumption','tax_certificate_use','tax_advice','tax_remittance','tax_remittance_allocation','tax_correction','tax_external_reference','bank_charge_document']) {
    assert.equal((await p.query('select to_regclass($1)::text name', [name])).rows[0].name, name, `${name} exists`);
  }
  for (const row of legacy) {
    assert.equal(row.new_tax, '0.000000'); assert.equal(row.bank_charge, '0.000000'); assert.equal(row.component_snapshot, null);
    assert.ok(BigInt(row.amount.replace('.',''))>0n);
  }
  async function refuses(query, args, code) {
    await p.query('savepoint invalid');
    await assert.rejects(p.query(query,args), e => e.code===code);
    await p.query('rollback to savepoint invalid');
  }
  const uid=(await p.query('select id from "user" limit 1')).rows[0].id;
  const tid=(await p.query('insert into tenant (name,slug) values ($1,$2) returning id',['Withholding schema fixture',randomUUID()])).rows[0].id;
  const entities=[];
  for (const code of ['WT1','WT2']) entities.push((await p.query('insert into legal_entity (tenant_id,legal_name,short_name,code) values ($1,$2,$2,$2) returning id',[tid,code])).rows[0].id);
  const [eid,other]=entities;
  const identity=(await p.query("insert into taxpayer_identity (tenant_id,entity_id,identity_key,pan_status,evidence,created_by) values ($1,$2,'PAN:AAACA1234B','valid','{}',$3) returning id",[tid,eid,uid])).rows[0].id;
  await refuses("insert into taxpayer_identity (tenant_id,entity_id,identity_key,pan_status,evidence,created_by) values ($1,$2,'PAN:AAACA1234B','valid','{}',$3)",[tid,eid,uid],'23505');
  const profile=(await p.query("insert into tax_profile_revision (tenant_id,entity_id,profile_key,revision,definition,evidence,status,created_by) values ($1,$2,'fixture',1,'{}','{}','draft',$3) returning id",[tid,eid,uid])).rows[0].id;
  const assessment=(await p.query("insert into tax_assessment (tenant_id,entity_id,source_type,source_id,purpose,identity_id,profile_id,posting_date,tax_year,snapshot,preview_hash,created_by) values ($1,$2,'schema_fixture',$3,'recognition',$4,$5,'2026-10-06','2026-27','{}','fixture',$6) returning id",[tid,eid,randomUUID(),identity,profile,uid])).rows[0].id;
  await refuses('update tax_assessment set entity_id=$1 where id=$2',[other,assessment],'23503');
  const event=(await p.query("insert into tax_event (tenant_id,entity_id,assessment_id,identity_id,category,posting_date,tax_year,base_amount,tax_amount,event_key,created_by) values ($1,$2,$3,$4,'tds','2026-10-06','2026-27',100,1,'schema-event',$5) returning id",[tid,eid,assessment,identity,uid])).rows[0].id;
  await refuses('update tax_event set tax_amount=2 where id=$1',[event],'P0001');
  await refuses('delete from tax_event where id=$1',[event],'P0001');
  await refuses('update tax_profile_revision set definition=$1 where id=$2',['{"rate":1}',profile],'P0001');
  await refuses("insert into tax_event (tenant_id,entity_id,assessment_id,identity_id,category,posting_date,tax_year,base_amount,tax_amount,event_key,created_by) values ($1,$2,$3,$4,'tds','2026-10-06','2026-27',100,1,'schema-event',$5)",[tid,eid,assessment,identity,uid],'23505');
  const charges=(await p.query("insert into bank_charge_document (tenant_id,entity_id,posting_date,bank_account_id,expense_account_id,base_amount,gst_amount,total_amount,reference_key,evidence,snapshot,created_by) select $1,$2,'2026-10-06',id,id,50,0,50,'fixture-bank-invoice','{}','{}',$3 from gl_account where entity_id=$2 limit 1 returning id",[legacy[0].tenant_id,legacy[0].entity_id,uid])).rows;
  assert.equal(charges.length,1);
  await refuses('update bank_charge_document set total_amount=49 where id=$1',[charges[0].id],'23514');
  console.log('PASS legacy upgrade, scoped tax identities, unique events, append-only evidence and charge checks');
} finally { await p.query('rollback'); p.release(); await db.$client.end(); }
