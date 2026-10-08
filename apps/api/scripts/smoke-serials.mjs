// Serials and remnants (decision 046): a serial is a batch of one; bars in kg are cut into remnant pieces.
// Receipts, transfers, sales delivery and cancel by serial; cut moves value exactly with no GL; remnant search.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-serials.mjs
import assert from 'node:assert/strict';
import { Dec } from '../../../packages/core/dist/index.js';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Serials');
const fail = async (method, path, body, status, label, pattern) => {
  const r = await c.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const eq = (a, b, label) => {
  assert.equal(Dec.of(a).toString(), Dec.of(b).toString(), `${label}: ${a} ≠ ${b}`);
  ok(label);
};

await c.activate();
const date = c.settings.cutoverDate;
await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/hsn-codes', { code: '85015210', kind: 'hsn', description: 'Servo motors', gstRate: '18', effectiveFrom: '2025-04-01' }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const servo = await c.req('POST', '/items', { code: 'SERVO-60', name: 'Servo motor 60 mm', type: 'component', tracking: 'serial', stockUomId: u('NOS'), hsnCode: '85015210', serialPrefix: 'SV' }, 201);
assert.equal(servo.serialPrefix, 'SV');
const bar = await c.req('POST', '/items', { code: 'IN718-40', name: 'Inconel 718 bar Ø40', type: 'raw_material', tracking: 'batch', stockUomId: u('KG'), hsnCode: '85015210' }, 201);
const plain = await c.req('POST', '/items', { code: 'WASHER', name: 'Washer', type: 'consumable', stockUomId: u('NOS'), hsnCode: '85015210' }, 201);
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const fg = await c.req('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' }, 201);
const cus = await c.req('POST', '/parties', { code: 'CUS', name: 'Skyroot', isCustomer: true, gstin: gstin('27AAACS1234B1Z'), addresses: [{ label: 'Works', line1: 'Road 1', city: 'Pune', stateCode: '27', pincode: '411001' }] }, 201);

const entry = async (body) => {
  const e = await c.req('POST', '/stock-entries', { postingDate: date, ...body }, 201);
  return c.raw('POST', `/stock-entries/${e.id}/submit`, {});
};
const posted = async (body, label) => {
  const r = await entry(body);
  assert.equal(r.status, 201, `${label}: ${JSON.stringify(r.data)}`);
  c.checks++;
  ok(label);
  return r.data;
};
const refused = async (body, label, pattern) => {
  const r = await entry(body);
  assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
};
const serialLine = (no, rate = '1000') => ({ itemId: servo.id, qty: '1', toWarehouseId: sto.id, newBatchNo: no, rate });

// ── Serials ──
await refused({ purpose: 'receipt', lines: [{ itemId: servo.id, qty: '2', toWarehouseId: sto.id, newBatchNo: 'SV-A', rate: '1000' }] }, 'serial lines move exactly one unit', /one line per serial/);
await refused({ purpose: 'receipt', lines: [{ itemId: servo.id, qty: '1', toWarehouseId: sto.id, rate: '1000' }] }, 'a serial receipt needs the serial number', /enter a serial number/);
await posted({ purpose: 'receipt', lines: [serialLine('SV-1001', '1000'), serialLine('SV-1002', '1100'), serialLine('SV-1003', '1200')] }, 'three serials received, each at its own cost');
const serials = await c.req('GET', `/batches?itemId=${servo.id}&inStock=true`);
assert.deepEqual(serials.map((s) => [s.batchNo, s.kind, s.qty]).sort(), [['SV-1001', 'serial', '1.000000'], ['SV-1002', 'serial', '1.000000'], ['SV-1003', 'serial', '1.000000']]);
ok('serials are batches of kind serial with stock 1');
const id = (no) => serials.find((s) => s.batchNo === no).id;
await refused({ purpose: 'receipt', lines: [serialLine('SV-1001')] }, 'a serial number cannot be received twice', /already exists/);
await refused({ purpose: 'adjustment', lines: [{ itemId: servo.id, qty: '1', toWarehouseId: fg.id, batchId: id('SV-1001'), rate: '1000' }] }, 'an existing serial cannot be added while in stock', /already in stock/);
await posted({ purpose: 'transfer', lines: [{ itemId: servo.id, qty: '1', fromWarehouseId: sto.id, toWarehouseId: fg.id, batchId: id('SV-1001') }] }, 'serial transferred to finished goods');
await refused({ purpose: 'transfer', lines: [{ itemId: servo.id, qty: '1', fromWarehouseId: sto.id, toWarehouseId: fg.id, batchId: id('SV-1001') }] }, 'a serial can only move from where it is', /only 0\.000/);

// Sales invoice ships one serial per line.
await fail('POST', '/sales-invoices', { customerId: cus.id, invoiceDate: date, lines: [{ itemId: servo.id, qty: '2', rate: '2000', warehouseId: sto.id, batchId: id('SV-1002') }] }, 400, 'invoice lines for serials carry quantity 1', /One serial per line/);
const inv = await c.req('POST', '/sales-invoices', { customerId: cus.id, invoiceDate: date, lines: [{ itemId: servo.id, qty: '1', rate: '2000', warehouseId: sto.id, batchId: id('SV-1002') }, { itemId: servo.id, qty: '1', rate: '2000', warehouseId: fg.id, batchId: id('SV-1001') }] }, 201);
await c.req('POST', `/sales-invoices/${inv.id}/submit`, {}, 201);
let left = await c.req('GET', `/batches?itemId=${servo.id}&inStock=true`);
assert.deepEqual(left.map((s) => s.batchNo), ['SV-1003']);
ok('invoice shipped SV-1001 and SV-1002; SV-1003 remains');
let tb = await c.req('GET', '/accounts/reports/trial-balance');
const bal = (role) => tb.accounts.find((a) => a.role === role).balance;
eq(bal('cogs'), '2100', 'cost of goods sold is the two serials’ own costs (₹1,000 + ₹1,100)');
await c.req('POST', `/sales-invoices/${inv.id}/cancel`, { reason: 'Wrong customer' }, 201);
left = await c.req('GET', `/batches?itemId=${servo.id}&inStock=true`);
assert.deepEqual(left.map((s) => s.batchNo).sort(), ['SV-1001', 'SV-1002', 'SV-1003']);
ok('cancelling the invoice brings both serials back');

// ── Remnants ──
await posted({ purpose: 'receipt', lines: [{ itemId: bar.id, qty: '10', toWarehouseId: sto.id, newBatchNo: 'HN-9', heatNo: 'HN-9', rate: '2000' }, { itemId: bar.id, qty: '2', toWarehouseId: sto.id, newBatchNo: 'HN-9B', heatNo: 'HN-9', rate: '2500' }] }, 'bar received: HN-9 10 kg at ₹2,000/kg');
const hn9 = (await c.req('GET', `/batches?itemId=${bar.id}`)).find((b) => b.batchNo === 'HN-9');
tb = await c.req('GET', '/accounts/reports/trial-balance');
const inventoryBefore = bal('inventory');
const cutBody = (o) => ({ postingDate: date, itemId: bar.id, warehouseId: sto.id, batchId: hn9.id, qty: '4.2', lengthMm: '660', ...o });
await fail('POST', '/stock/cuts', cutBody({ itemId: servo.id, batchId: id('SV-1003'), qty: '1' }), 400, 'serials cannot be cut', /batch-tracked material/);
await fail('POST', '/stock/cuts', cutBody({ itemId: plain.id, batchId: hn9.id }), 400, 'untracked items cannot be cut', /batch-tracked material/);
await fail('POST', '/stock/cuts', cutBody({ qty: '11' }), 400, 'cannot cut more than the bar holds', /only 10\.000/);
await fail('POST', '/stock/cuts', cutBody({ lengthMm: '0' }), 400, 'a remnant needs its length');
const cut1 = await c.req('POST', '/stock/cuts', cutBody({}), 201);
assert.equal(cut1.remnantNo, 'HN-9-R1');
eq(cut1.value, '8400', 'cut 4.2 kg off HN-9: remnant HN-9-R1 carries ₹8,400 (by weight at FIFO cost)');
const bars = await c.req('GET', `/batches?itemId=${bar.id}&inStock=true`);
const r1 = bars.find((b) => b.batchNo === 'HN-9-R1');
assert.deepEqual([r1.kind, r1.heatNo, r1.parentBatchId, r1.lengthMm, r1.qty], ['remnant', 'HN-9', hn9.id, '660.000000', '4.200000']);
eq(bars.find((b) => b.batchNo === 'HN-9').qty, '5.8', 'HN-9 keeps 5.8 kg');
tb = await c.req('GET', '/accounts/reports/trial-balance');
eq(bal('inventory'), inventoryBefore, 'GL: a cut changes no balance');
const balance = await c.req('GET', `/stock/balance?itemId=${bar.id}`);
const value = (no) => balance.filter((r) => r.batchNo === no).reduce((s, r) => s.add(r.value ?? '0'), Dec.ZERO);
eq(value('HN-9').add(value('HN-9-R1')), '20000', 'stock value of HN-9 plus its remnant is still ₹20,000');

let found = await c.req('GET', `/stock/remnants?itemId=${bar.id}&minLengthMm=600`);
assert.deepEqual(found.map((r) => [r.batchNo, r.parentBatchNo, r.lengthMm]), [['HN-9-R1', 'HN-9', '660.000000']]);
ok('remnant search finds pieces at least 600 mm');
assert.equal((await c.req('GET', `/stock/remnants?itemId=${bar.id}&minLengthMm=700`)).length, 0);
ok('no remnant of 700 mm or more');
const cut2 = await c.req('POST', '/stock/cuts', cutBody({ batchId: r1.id, qty: '1.4', lengthMm: '220', remnantNo: null }), 201);
assert.equal(cut2.remnantNo, 'HN-9-R1-R1');
eq(cut2.value, '2800', 'a remnant can be cut again (grandchild HN-9-R1-R1, ₹2,800)');
await fail('POST', `/stock-entries/${cut1.id}/cancel`, { reason: 'Measured wrong' }, 409, 'the first cut cannot be cancelled after its remnant was cut', /already been issued/);
await c.req('POST', `/stock-entries/${cut2.id}/cancel`, { reason: 'Measured wrong' }, 201);
await c.req('POST', `/stock-entries/${cut1.id}/cancel`, { reason: 'Measured wrong' }, 201);
const after = await c.req('GET', `/batches?itemId=${bar.id}&inStock=true`);
assert.deepEqual(after.map((b) => [b.batchNo, b.qty]).sort(), [['HN-9', '10.000000'], ['HN-9B', '2.000000']]);
ok('cancelling both cuts in reverse order restores HN-9 to 10 kg');
tb = await c.req('GET', '/accounts/reports/trial-balance');
eq(bal('inventory'), inventoryBefore, 'GL still unchanged after the cancels');

console.log(`\nSerials and remnants smoke passed: ${c.checks} checks`);
