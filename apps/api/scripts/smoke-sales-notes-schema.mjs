import assert from 'node:assert/strict';
import { createDb } from '../../../packages/db/dist/index.js';
const db = createDb(process.env.DATABASE_URL);
try {
  const p = db.$client;
  const legacy = await p.query("select id,settlement_id,allocations,status from settlement_allocation_document where settlement_id is not null order by created_at limit 1");
  assert.ok(legacy.rowCount, 'Existing shared settlement allocation fixture required');
  const tables = await p.query("select to_regclass('sales_note') note,to_regclass('sales_note_line') line,to_regclass('sales_return_effect') effect");
  assert.equal(tables.rows[0].note,'sales_note','Additive customer note table must exist');
  assert.equal(tables.rows[0].line,'sales_note_line'); assert.equal(tables.rows[0].effect,'sales_return_effect');
  assert.equal((await p.query('select credit_note_id from settlement_allocation_document where id=$1',[legacy.rows[0].id])).rows[0].credit_note_id,null);
  const unchanged = (await p.query('select id,settlement_id,allocations,status from settlement_allocation_document where id=$1',[legacy.rows[0].id])).rows[0];
  assert.deepEqual(unchanged,legacy.rows[0]);
  for (const sql of ['update settlement_allocation_document set settlement_id=null where id=$1','update settlement_allocation_document set credit_note_id=id where id=$1']) {
    await assert.rejects(p.query(sql,[legacy.rows[0].id]), /source|foreign key/, 'Exactly one valid allocation source');
  }
  const triggers = await p.query("select tgname from pg_trigger where tgrelid='sales_return_effect'::regclass and not tgisinternal");
  assert.ok(triggers.rows.some(r=>r.tgname.includes('immutable')));
  assert.equal((await p.query("select count(*)::int n from pg_enum where enumtypid='stock_entry_purpose'::regtype and enumlabel='sales_return'")).rows[0].n,1);
  console.log('PASS sales note additive schema and legacy allocation compatibility');
} finally { await db.$client.end(); }
