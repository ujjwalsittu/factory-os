// Support access (decision 050) Task 5: the five catalogued readers are scoped, pure SELECTs on a separate READ ONLY
// pool. Runs against real data already in the local database (from the regular suites); it never writes to it.
// Usage: pnpm --filter @factoryos/api... build && node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-readers.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDb, createReadOnlyDb } from '../../../packages/db/dist/index.js';
import { readInventory } from '../dist/modules/readers/inventory.read.js';
import { readAccounting } from '../dist/modules/readers/accounting-reports.read.js';
import { readDocument } from '../dist/modules/readers/work-orders.read.js';
import { parseSupportQuery } from '../dist/modules/support-access/support-access.types.js';

let count = 0;
const test = async (name, fn) => {
  await fn();
  count++;
  console.log(`PASS ${name}`);
};
const control = createDb(process.env.DATABASE_URL, 2);
const pool = createReadOnlyDb(process.env.DATABASE_URL, { max: 2, connectionTimeoutMillis: 2000, deadlineMs: 5000 });
const q = (text, values) => control.$client.query(text, values).then((r) => r.rows);
const ALL = new Set(['inventory.report.read', 'selling.sales_invoice.read', 'buying.purchase_invoice.read', 'manufacturing.work_order.read', 'accounts.report.read']);
const scopeOf = (row, permissions = ALL) => ({ tenantId: row.tenant_id, entityId: row.id, membershipId: '00000000-0000-4000-8000-000000000000', subjectUserId: 'x', permissions });
const pick = async (where) => {
  const [row] = await q(`select e.id, e.tenant_id from legal_entity e where ${where} order by e.id limit 1`);
  assert.ok(row, `local data needed: ${where} (run the regular suites first)`);
  return row;
};
const read = (scope, area, query) => pool.run((db) => (area === 'inventory' ? readInventory(db, scope, parseSupportQuery(area, query)) : area === 'accounting' ? readAccounting(db, scope, parseSupportQuery(area, query)) : readDocument(db, scope, parseSupportQuery(area, query))));
const BOOKS = ['gl_entry', 'journal_voucher', 'trade_bill', 'trade_bill_effect', 'stock_ledger_entry', 'stock_bin', 'fifo_layer', 'fifo_consumption', 'accounting_settings', 'audit_event', 'support_access_event'];
const books = async () => {
  const out = {};
  for (const t of BOOKS) {
    const rows = (await q(`select row_to_json(x)::text v from ${t} x order by 1`)).map((r) => r.v);
    out[t] = `${rows.length}:${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`;
  }
  return out;
};

try {
  const before = await books();
  const inv = await pick(`exists (select 1 from stock_ledger_entry s where s.entity_id = e.id)`);
  const sales = await pick(`exists (select 1 from sales_invoice s where s.entity_id = e.id and s.status = 'submitted')`);
  const buys = await pick(`exists (select 1 from purchase_invoice p where p.entity_id = e.id and p.status = 'submitted')`);
  const wos = await pick(`exists (select 1 from work_order w where w.entity_id = e.id and w.bom_id is null)`);
  const cards = await pick(`exists (select 1 from job_card j join work_order w on w.id = j.work_order_id where w.entity_id = e.id)`);
  const gl = await pick(`exists (select 1 from gl_entry g where g.entity_id = e.id)`);
  const other = (await q(`select id, tenant_id from legal_entity where tenant_id <> $1 limit 1`, [gl.tenant_id]))[0];

  await test('inventory balance and a paginated ledger whose running totals include earlier rows', async () => {
    const bal = await read(scopeOf(inv), 'inventory', { panel: 'balance' });
    assert.equal(bal.kind, 'table');
    assert.ok(bal.table.rows.length > 0);
    assert.deepEqual(bal.table.columns.map((c) => c.key), ['itemCode', 'itemName', 'warehouseCode', 'batchNo', 'heatNo', 'ownerName', 'qty', 'uomCode', 'value']);
    const [{ item_id }] = await q(`select item_id from stock_ledger_entry where entity_id = $1 group by item_id order by count(*) desc limit 1`, [inv.id]);
    const full = await read(scopeOf(inv), 'inventory', { panel: 'ledger', itemId: item_id, limit: '500' });
    assert.ok(full.table.rows.length >= 2, 'an item with at least two movements');
    const second = await read(scopeOf(inv), 'inventory', { panel: 'ledger', itemId: item_id, limit: '1', cursor: (await read(scopeOf(inv), 'inventory', { panel: 'ledger', itemId: item_id, limit: '1' })).table.nextCursor });
    assert.deepEqual(second.table.rows[0], full.table.rows[1], 'page 2 keeps the running balance of the full ledger');
  });
  await test('sales invoices: list and frozen lines and tax; a foreign entity id is not found', async () => {
    const list = await read(scopeOf(sales), 'sales-invoices', { panel: 'list', status: 'submitted' });
    assert.ok(list.table.rows.length > 0);
    const [{ id }] = await q(`select id from sales_invoice where entity_id = $1 and status = 'submitted' limit 1`, [sales.id]);
    const doc = await read(scopeOf(sales), 'sales-invoices', { panel: 'detail', id });
    assert.equal(doc.kind, 'detail');
    assert.ok(doc.detail.tables[0].table.rows.length > 0);
    assert.ok(doc.detail.tables[0].table.columns.some((c) => c.key === 'cgst'));
    const foreign = (await q(`select id from sales_invoice where entity_id <> $1 limit 1`, [sales.id]))[0];
    if (foreign) await assert.rejects(read(scopeOf(sales), 'sales-invoices', { panel: 'detail', id: foreign.id }), (e) => e.code === 'SUPPORT_NOT_FOUND');
  });
  await test('purchase invoices: list and frozen detail; foreign ids are not found', async () => {
    const [{ id }] = await q(`select id from purchase_invoice where entity_id = $1 and status = 'submitted' limit 1`, [buys.id]);
    assert.ok((await read(scopeOf(buys), 'purchase-invoices', { panel: 'list' })).table.rows.some((r) => r.number));
    const doc = await read(scopeOf(buys), 'purchase-invoices', { panel: 'detail', id });
    assert.ok(doc.detail.tables[0].table.rows.length > 0);
    await assert.rejects(read(scopeOf(other), 'purchase-invoices', { panel: 'detail', id }), (e) => e.code === 'SUPPORT_NOT_FOUND');
  });
  await test('work orders: list shows NCR rework orders (no BOM) and detail carries routing, job cards and WIP only', async () => {
    const list = await read(scopeOf(wos), 'work-orders', { panel: 'list' });
    assert.ok(list.table.rows.some((r) => r.revision === 'Rework'));
    const [{ id }] = await q(`select w.id from work_order w join job_card j on j.work_order_id = w.id where w.entity_id = $1 limit 1`, [cards.id]);
    const doc = await read(scopeOf(cards), 'work-orders', { panel: 'detail', id });
    assert.deepEqual(doc.detail.tables.map((t) => t.label), ['Materials', 'Routing', 'Job cards', 'WIP by cost']);
    assert.ok(doc.detail.tables[2].table.rows.length > 0);
    const text = JSON.stringify(doc);
    for (const secret of ['operatorId', 'email', 'password', 'token']) assert.equal(text.includes(secret), false, secret);
  });
  await test('accounting: status, trial balance totals over all accounts, ledger and day book', async () => {
    const st = await read(scopeOf(gl), 'accounting', { panel: 'status' });
    assert.equal(st.detail.fields[0].label, 'Books active');
    const tb = await read(scopeOf(gl), 'accounting', { panel: 'trial-balance', limit: '1' });
    const full = await read(scopeOf(gl), 'accounting', { panel: 'trial-balance', limit: '500' });
    assert.deepEqual(tb.detail.fields, full.detail.fields, 'totals do not depend on the page');
    const [{ account_id }] = await q(`select account_id from gl_entry where entity_id = $1 group by account_id order by count(*) desc limit 1`, [gl.id]);
    const lg = await read(scopeOf(gl), 'accounting', { panel: 'ledger', accountId: account_id });
    assert.ok(lg.detail.tables[0].table.rows.length > 0);
    assert.ok((await read(scopeOf(gl), 'accounting', { panel: 'day-book' })).table.rows.length > 0);
    await assert.rejects(read(scopeOf(other), 'accounting', { panel: 'ledger', accountId: account_id }), (e) => e.code === 'SUPPORT_NOT_FOUND');
  });
  await test('reading an entity with no books never activates or seeds anything', async () => {
    const empty = (await q(`select e.id, e.tenant_id from legal_entity e where not exists (select 1 from accounting_settings s where s.entity_id = e.id) limit 1`))[0];
    if (!empty) return;
    const st = await read(scopeOf(empty), 'accounting', { panel: 'status' });
    assert.equal(st.detail.fields[0].value, false);
    assert.equal((await q('select count(*)::int n from accounting_settings where entity_id = $1', [empty.id]))[0].n, 0);
  });
  await test('a reader refuses an area the scope lacks permission for', async () => {
    await assert.rejects(read(scopeOf(gl, new Set(['inventory.report.read'])), 'accounting', { panel: 'status' }), (e) => e.code === 'SUPPORT_UNAVAILABLE');
  });
  await test('reads run in a READ ONLY transaction on their own backend; a write is refused with 25006', async () => {
    const [{ pid: controlPid }] = await q('select pg_backend_pid() as pid');
    const seen = await pool.run(async (db) => {
      const r = (await db.execute(`select pg_backend_pid() as pid, current_setting('transaction_read_only') as ro`)).rows[0];
      return r;
    });
    assert.notEqual(seen.pid, controlPid);
    assert.equal(seen.ro, 'on');
    await assert.rejects(pool.run((db) => db.execute(`insert into support_access_event(tenant_id, kind) values (gen_random_uuid(), 'read')`)), (e) => e.code === '25006' || e.cause?.code === '25006');
  });
  await test('the overall deadline cancels a long read and the connection is clean afterwards', async () => {
    const started = Date.now();
    await assert.rejects(pool.run((db) => db.execute('select pg_sleep(8)')));
    assert.ok(Date.now() - started < 7000, 'cancelled near the 5-second deadline');
    const r = await pool.run(async (db) => (await db.execute(`select current_setting('transaction_read_only') as ro`)).rows[0]);
    assert.equal(r.ro, 'on');
  });
  await test('with both pooled connections busy, a third read gives up after the 2-second wait', async () => {
    const hold = [pool.run((db) => db.execute('select pg_sleep(3)')), pool.run((db) => db.execute('select pg_sleep(3)'))];
    const started = Date.now();
    await assert.rejects(pool.run((db) => db.execute('select 1')), /timeout/i);
    const waited = Date.now() - started;
    assert.ok(waited >= 1900 && waited < 3000, `waited ${waited} ms`);
    await Promise.allSettled(hold);
  });
  await test('strict parsing stops arbitrary areas and fields before any reader runs', async () => {
    assert.throws(() => parseSupportQuery('attachments', { panel: 'list' }));
    assert.throws(() => parseSupportQuery('sales-invoices', { panel: 'list', sql: '1' }));
  });
  await test('nothing in the books, activations, audit or support evidence changed', async () => {
    assert.deepEqual(await books(), before);
  });
} finally {
  await pool.close();
  await control.$client.end();
}
console.log(`\nSupport access readers: ${count} checks passed.`);
