import assert from 'node:assert/strict';
import { createDb } from '../../../packages/db/dist/index.js';
const db = createDb(process.env.DATABASE_URL);
const p = await db.$client.connect();
try {
  await p.query('begin');
  const legacy = (await p.query('select * from settlement_allocation_document order by created_at limit 2')).rows;
  for (const name of ['supplier_return_policy','supplier_return_claim','supplier_return_claim_line','supplier_note','supplier_note_line','supplier_return_effect','supplier_acceptance_effect','supplier_resolution_effect']) {
    assert.equal((await p.query('select to_regclass($1)::text name',[name])).rows[0].name,name,`${name} must exist`);
  }
  async function refuses(sql, args, code) {
    await p.query('savepoint invalid');
    await assert.rejects(p.query(sql,args),e=>e.code===code);
    await p.query('rollback to savepoint invalid');
  }
  assert.ok(legacy.length, 'Existing allocation compatibility fixture');
  for(const row of legacy) {
    assert.equal((await p.query('select supplier_note_id from settlement_allocation_document where id=$1',[row.id])).rows[0].supplier_note_id,null);
    await refuses('update settlement_allocation_document set settlement_id=null,credit_note_id=null,supplier_note_id=null where id=$1',[row.id],'23514');
    assert.deepEqual((await p.query('select * from settlement_allocation_document where id=$1',[row.id])).rows[0],{...row,supplier_note_id:null});
  }
  for(const name of ['supplier_return_effect','supplier_acceptance_effect','supplier_resolution_effect']) {
    assert.ok((await p.query('select tgname from pg_trigger where tgrelid=$1::regclass and not tgisinternal',[name])).rows.some(r=>r.tgname.includes('immutable')));
  }
  const [inv] = (await p.query('select * from purchase_invoice limit 1')).rows;
  assert.ok(inv,'Purchase fixture required');
  const params=[inv.tenant_id,inv.entity_id,inv.id,inv.supplier_id,inv.created_by];
  const insert="insert into supplier_note (tenant_id,entity_id,original_invoice_id,supplier_id,created_by,status,kind,tax_treatment,supplier_note_no,supplier_note_date,supplier_fy,posting_date,reason,currency,exchange_rate) values ($1,$2,$3,$4,$5,'submitted','credit','commercial','SCHEMA-NOTE','2026-10-06','26-27','2026-10-06','schema fixture','INR',1) returning id";
  const id=(await p.query(insert,params)).rows[0].id;
  await refuses(insert,params,'23505');
  const il=(await p.query('select id from purchase_invoice_line where invoice_id=$1 limit 1',[inv.id])).rows[0];
  assert.ok(il);
  const claim=(await p.query("insert into supplier_return_claim (tenant_id,entity_id,original_invoice_id,supplier_id,created_by,posting_date,reason,currency,exchange_rate) values ($1,$2,$3,$4,$5,'2026-10-06','schema claim','INR',1) returning id",params)).rows[0];
  const cl=(await p.query('insert into supplier_return_claim_line (tenant_id,entity_id,claim_id,original_invoice_id,invoice_line_id,line_no,qty,taxable_amount) values ($1,$2,$3,$4,$5,1,1,1) returning id',[inv.tenant_id,inv.entity_id,claim.id,inv.id,il.id])).rows[0];
  const nl=(await p.query("insert into supplier_note_line (tenant_id,entity_id,note_id,original_invoice_id,invoice_line_id,claim_line_id,line_no,mode,qty,taxable_amount) values ($1,$2,$3,$4,$5,$6,1,'quantity',1,1) returning id",[inv.tenant_id,inv.entity_id,id,inv.id,il.id,cl.id])).rows[0];
  const effect=(await p.query('insert into supplier_acceptance_effect (tenant_id,entity_id,claim_line_id,note_line_id,qty,taxable_amount) values ($1,$2,$3,$4,1,1) returning id',[inv.tenant_id,inv.entity_id,cl.id,nl.id])).rows[0];
  await refuses('update supplier_acceptance_effect set qty=2 where id=$1',[effect.id],'P0001');
  await refuses('delete from supplier_acceptance_effect where id=$1',[effect.id],'P0001');
  const wrongLine=(await p.query('select id from purchase_invoice_line where invoice_id<>$1 limit 1',[inv.id])).rows[0];
  assert.ok(wrongLine);
  await refuses('update supplier_return_claim_line set invoice_line_id=$1 where id=$2',[wrongLine.id,cl.id],'23503');
  const other=(await p.query('select id from legal_entity where id<>$1 limit 1',[inv.entity_id])).rows[0];
  assert.ok(other);
  await refuses('update supplier_note set entity_id=$1 where id=$2',[other.id,id],'23503');
  await refuses('update settlement_allocation_document set supplier_note_id=$1 where id=$2',[id,legacy[0].id],'23514');
  const enumRows=(await p.query("select enumlabel from pg_enum where enumtypid='stock_entry_purpose'::regtype")).rows;
  for(const purpose of ['purchase_return','purchase_return_receipt'])assert.ok(enumRows.some(r=>r.enumlabel===purpose));
  console.log('PASS supplier return additive schema, scoped identities and allocation compatibility');
} finally { await p.query('rollback'); p.release(); await db.$client.end(); }
