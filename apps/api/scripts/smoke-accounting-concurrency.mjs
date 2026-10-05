import assert from 'node:assert/strict';
import { Client } from './accounting-test-helpers.mjs';
const c = await new Client().init('Cut-over Race');
const uoms = await c.req('GET', '/uoms');
const item = await c.req(
  'POST',
  '/items',
  {
    code: 'OPEN-STOCK',
    name: 'Opening stock',
    type: 'consumable',
    stockUomId: uoms.find((u) => u.code === 'NOS').id,
  },
  201,
);
await c.req('POST', '/warehouses/standard', {}, 201);
const warehouses = await c.req('GET', '/warehouses');
const stores = warehouses.find((w) => w.code === 'STORES');
const w = await c.req('PUT', '/accounts/opening', {
  lines: [],
  bills: [],
  receiptBaselines: [],
  settlements: [],
});
const first = await c.req('GET', '/accounts/opening/reconciliation');
const r = await c.req(
  'POST',
  '/stock-entries',
  {
    purpose: 'receipt',
    postingDate: first.cutoverDate,
    lines: [
      { itemId: item.id, qty: '10', rate: '10', toWarehouseId: stores.id },
    ],
  },
  201,
);
await c.req('POST', `/stock-entries/${r.id}/submit`, {}, 201);
await c.req(
  'POST',
  '/accounts/opening/activate',
  { worksheetId: w.id, reviewedToken: first.snapshotToken },
  409,
);
const changed = await c.req('GET', '/accounts/opening/reconciliation');
assert.equal(changed.inventoryValue, '100.000000');
assert.ok(changed.differences.length);
await c.req(
  'POST',
  '/accounts/opening/activate',
  { worksheetId: w.id, reviewedToken: changed.snapshotToken },
  409,
);
await c.req('PUT', '/accounts/opening', {
  lines: [c.line('inventory', '100'), c.line('equity', '0', '100')],
  bills: [],
  receiptBaselines: [],
  settlements: [],
});
const valid = await c.req('GET', '/accounts/opening/reconciliation');
assert.deepEqual(valid.differences, []);
const input = { worksheetId: w.id, reviewedToken: valid.snapshotToken };
const race = await Promise.all([
  c.raw('POST', '/accounts/opening/activate', input),
  c.raw('POST', '/accounts/opening/activate', input),
]);
assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
const journals = await c.req('GET', '/accounts/journals');
assert.equal(journals.filter((j) => j.sourceType === 'opening').length, 1);
await c.req(
  'PUT',
  '/accounts/opening',
  { lines: [], bills: [], receiptBaselines: [], settlements: [] },
  409,
);
await c.req(
  'POST',
  '/accounts/journals',
  {
    postingDate: '2026-01-01',
    narration: 'Backdated journal',
    lines: [c.line('cash', '1'), c.line('equity', '0', '1')],
  },
  400,
);
const formerEntity = c.entityId;
c.entityId = '00000000-0000-4000-8000-000000000000';
await c.req('GET', '/accounts/accounts', undefined, 403);
c.entityId = formerEntity;
console.log(`Cut-over and concurrency checks passed (${c.checks}).`);
