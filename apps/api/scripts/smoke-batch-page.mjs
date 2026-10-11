// Batch and serial page (decision 053): search lots by number, heat or item code; one batch's details, stock by
// warehouse in the entity, and its quality records (inspections, NCRs) — tenant-scoped, read-only.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-batch-page.mjs
import assert from 'node:assert/strict';
import { Client } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Batch page');
await c.activate();
const date = c.settings.cutoverDate;
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const bar = await c.req('POST', '/items', { code: 'AL6061', name: 'Al 6061 bar', type: 'raw_material', tracking: 'batch', stockUomId: u('KG'), hsnCode: '76042910' }, 201);
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const wip = await c.req('POST', '/warehouses', { code: 'WIP', name: 'Shop floor', type: 'wip' }, 201);
const rec = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: date, lines: [{ itemId: bar.id, qty: '12', toWarehouseId: sto.id, newBatchNo: 'LOT-A1', heatNo: 'HT-9001', rate: '400' }] }, 201);
await c.req('POST', `/stock-entries/${rec.id}/submit`, {}, 201);
const tr = await c.req('POST', '/stock-entries', { purpose: 'transfer', postingDate: date, lines: [{ itemId: bar.id, qty: '5', fromWarehouseId: sto.id, toWarehouseId: wip.id, batchId: (await c.req('GET', `/batches?itemId=${bar.id}`))[0].id }] }, 201);
await c.req('POST', `/stock-entries/${tr.id}/submit`, {}, 201);

const byHeat = await c.req('GET', '/batches/search?q=HT-90');
assert.equal(byHeat.length, 1);
assert.equal(byHeat[0].batchNo, 'LOT-A1');
assert.equal(byHeat[0].itemCode, 'AL6061');
assert.equal(Number(byHeat[0].qty), 12);
ok('search finds the lot by heat number with its entity quantity');
assert.equal((await c.req('GET', '/batches/search?q=al6061')).length, 1);
ok('search by item code is case-insensitive');
assert.equal((await c.req('GET', '/batches/search?q=%25')).length, 0);
ok('a literal % matches nothing (wildcards escaped)');
assert.ok((await c.req('GET', '/batches/search')).length >= 1);
ok('no query lists recent batches');

const lot = byHeat[0];
let d = await c.req('GET', `/batches/${lot.id}`);
assert.equal(d.heatNo, 'HT-9001');
assert.equal(d.kind, 'lot');
assert.deepEqual(
  d.stock.map((s) => [s.warehouseCode, Number(s.qty)]),
  [['STO', 7], ['WIP', 5]],
);
ok('detail shows stock by warehouse (7 in stores, 5 on the shop floor)');
assert.deepEqual(d.ncrs, []);
assert.deepEqual(d.inspections, []);
ok('no quality records yet');

const n = await c.req('POST', '/quality/ncrs', { itemId: bar.id, batchId: lot.id, qty: '2', fromWarehouseId: sto.id, description: 'Surface pitting found at goods-in' }, 201);
d = await c.req('GET', `/batches/${lot.id}`);
assert.equal(d.ncrs.length, 1);
assert.equal(d.ncrs[0].number, n.number);
assert.equal(d.stock.find((s) => s.warehouseType === 'mrb')?.qty && Number(d.stock.find((s) => s.warehouseType === 'mrb').qty), 2);
ok('an NCR on the lot is listed and its held quantity shows in MRB');

const ledger = await c.req('GET', `/stock/ledger?itemId=${bar.id}&batchId=${lot.id}`);
assert.ok((ledger.rows ?? ledger).length >= 3);
ok('the stock ledger filters to this batch');

const r404 = await c.raw('GET', '/batches/00000000-0000-4000-8000-000000000000');
assert.equal(r404.status, 404);
ok('an unknown batch is not found');
const other = await new Client().init('Batch page other');
await other.activate();
const foreign = await other.raw('GET', `/batches/${lot.id}`);
assert.equal(foreign.status, 404);
assert.equal((await other.req('GET', '/batches/search?q=HT-9001')).length, 0);
ok('another tenant neither sees nor finds the lot');

console.log('\nBatch page smoke passed.');
