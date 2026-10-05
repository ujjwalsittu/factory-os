import assert from 'node:assert/strict';
import { createDb } from '../../../packages/db/dist/index.js';
import { Client } from './accounting-test-helpers.mjs';
process.loadEnvFile(new URL('../../../.env', import.meta.url));
const c = await new Client().init('Cancellation lock order');
await c.activate();
await c.req('POST', '/warehouses/standard', {}, 201);
const wh = (await c.req('GET', '/warehouses')).find((w) => w.code === 'STORES'),
  uom = (await c.req('GET', '/uoms')).find((u) => u.code === 'NOS');
const item = await c.req(
  'POST',
  '/items',
  {
    code: 'LOCK',
    name: 'Lock test material',
    type: 'raw_material',
    stockUomId: uom.id,
  },
  201,
);
const date = c.settings.cutoverDate,
  se = await c.req(
    'POST',
    '/stock-entries',
    {
      purpose: 'receipt',
      postingDate: date,
      lines: [{ itemId: item.id, qty: '1', rate: '1', toWarehouseId: wh.id }],
    },
    201,
  );
await c.req('POST', `/stock-entries/${se.id}/submit`, {}, 201);
const db = createDb(process.env.DATABASE_URL),
  hold = await db.$client.connect(),
  probe = await db.$client.connect();
let pending,
  blocked = false;
try {
  const existing = await probe.query(
    'select id from stock_entry where id=$1 and entity_id=$2',
    [se.id, c.entityId],
  );
  assert.equal(
    existing.rowCount,
    1,
    'API and DB must refer to the same local test entity',
  );
  await hold.query('begin');
  await hold.query('select pg_advisory_xact_lock(hashtext($1))', [
    `accounting:${c.entityId}`,
  ]);
  pending = c.raw('POST', `/stock-entries/${se.id}/cancel`, {
    reason: 'Verify entity before document lock',
  });
  const deadline = Date.now() + 5000;
  let waiting = false;
  while (Date.now() < deadline) {
    const r = await probe.query(
      "select 1 from pg_locks where locktype='advisory' and not granted and objid::bigint=(hashtext($1)::bigint & 4294967295)",
      [`accounting:${c.entityId}`],
    );
    if (r.rowCount) {
      waiting = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(waiting, true, 'cancellation must reach the accounting lock');
  await probe.query('begin');
  await probe.query("set local lock_timeout='200ms'");
  try {
    await probe.query('select id from stock_entry where id=$1 for update', [
      se.id,
    ]);
  } catch (e) {
    if (e.code === '55P03') blocked = true;
    else throw e;
  }
} finally {
  await probe.query('rollback');
  await hold.query('rollback');
  probe.release();
  hold.release();
  if (pending) assert.equal((await pending).status, 201);
  await db.$client.end();
}
assert.equal(
  blocked,
  false,
  'Cancellation must wait for the entity lock without holding the document lock',
);
console.log('Entity-first cancellation lock order passed.');
