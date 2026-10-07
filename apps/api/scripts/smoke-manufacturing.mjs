// Manufacturing slice 2a (decision 044): work centres, BOM revisions, work orders, issue/return, backflush,
// job cards, actual-cost outputs, close/reopen, cancellation order, traceability and Stock → WIP → FG GL.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-manufacturing.mjs
import assert from 'node:assert/strict';
import { absorptionValue, Dec } from '../../../packages/core/dist/index.js';
import { Client } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const fail = async (c, method, path, body, status, label, pattern) => {
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

/** Items, warehouses, a work centre and stock: Ti bar in two heats, screws, and the bracket we make. */
async function setup(c, date) {
  const uoms = await c.req('GET', '/uoms');
  const u = (code) => uoms.find((x) => x.code === code).id;
  const item = (code, name, type, tracking, uom) => c.req('POST', '/items', { code, name, type, tracking, stockUomId: u(uom), hsnCode: '76041010' }, 201);
  const bar = await item('TI-BAR-50', 'Ti-6Al-4V bar Ø50', 'raw_material', 'batch', 'KG');
  const screw = await item('M4-SCREW', 'M4 screw A4', 'component', 'none', 'NOS');
  const brk = await item('BRK-001', 'Satellite bracket', 'finished_good', 'batch', 'NOS');
  const wh = (code, name, type, availableForIssue) => c.req('POST', '/warehouses', { code, name, type, ...(availableForIssue === undefined ? {} : { availableForIssue }) }, 201);
  const stores = await wh('STO', 'Main stores', 'stores');
  const fg = await wh('FG', 'Finished goods', 'finished_goods');
  const qua = await wh('QUA', 'Quarantine', 'quarantine', false);
  const rec = await c.req('POST', '/stock-entries', {
    purpose: 'receipt',
    postingDate: date,
    lines: [
      { itemId: bar.id, qty: '10', toWarehouseId: stores.id, newBatchNo: 'HN-1', heatNo: 'HN-1', rate: '2000' },
      { itemId: bar.id, qty: '10', toWarehouseId: stores.id, newBatchNo: 'HN-2', heatNo: 'HN-2', rate: '2500' },
      { itemId: screw.id, qty: '100', toWarehouseId: stores.id, rate: '5' },
    ],
  }, 201);
  await c.req('POST', `/stock-entries/${rec.id}/submit`, {}, 201);
  return { bar, screw, brk, stores, fg, qua };
}

const balances = async (c) => Object.fromEntries((await c.req('GET', '/accounts/reports/trial-balance')).accounts.filter((a) => a.role).map((a) => [a.role, a.balance]));

// ─────────────────────────── Books active ───────────────────────────
const c = await new Client().init('Manufacturing');
await c.activate();
const date = c.settings.cutoverDate;
const { bar, screw, brk, stores, fg, qua } = await setup(c, date);
ok('items, warehouses and raw material received (₹45,500)');

// Work centre and machine
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC5', name: '5-axis milling', hourlyRate: '1200' }, 201);
await fail(c, 'POST', '/manufacturing/work-centres', { code: 'CNC5', name: 'Duplicate', hourlyRate: '1' }, 409, 'duplicate work centre code refused');
const m03 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M-03', name: 'DMG Mori DMU 50' }, 201);
const centres = await c.req('GET', '/manufacturing/work-centres');
assert.equal(centres[0].machines[0].code, 'M-03');
ok('work centre with machine');

// BOM
const bomBody = (o = {}) => ({
  itemId: brk.id,
  revision: 'A',
  quantity: '1',
  materials: [
    { itemId: bar.id, qty: '0.5' },
    { itemId: screw.id, qty: '4', backflush: true },
  ],
  operations: [{ seq: 10, name: 'Mill complete', workCentreId: cnc.id, setupMinutes: '30', runMinutesPerUnit: '6' }],
  ...o,
});
await fail(c, 'POST', '/manufacturing/boms', bomBody({ materials: [{ itemId: bar.id, qty: '0.5', backflush: true }] }), 400, 'batch-tracked material cannot be backflushed', /issue it by batch/);
await fail(c, 'POST', '/manufacturing/boms', bomBody({ materials: [{ itemId: brk.id, qty: '1' }] }), 400, 'an item cannot be made from itself');
let bomA = await c.req('POST', '/manufacturing/boms', bomBody(), 201);
assert.equal(bomA.status, 'draft');
bomA = await c.req('POST', `/manufacturing/boms/${bomA.id}/activate`, {}, 201);
assert.deepEqual([bomA.status, bomA.isDefault], ['active', true]);
ok('BOM rev A active and default');
await fail(c, 'PUT', `/manufacturing/boms/${bomA.id}`, bomBody(), 409, 'active BOMs are frozen');
const bomB = await c.req('POST', `/manufacturing/boms/${bomA.id}/copy`, { revision: 'B' }, 201);
assert.deepEqual([bomB.status, bomB.materials.length, bomB.operations.length], ['draft', 2, 1]);
ok('engineering change: rev B drafted from rev A');

// Work order
await fail(c, 'POST', '/manufacturing/work-orders', { itemId: brk.id, plannedQty: '10', sourceWarehouseId: qua.id, targetWarehouseId: fg.id }, 400, 'quarantine is not a source for production', /not available for issue/);
await fail(c, 'POST', '/manufacturing/work-orders', { itemId: brk.id, bomId: bomB.id, plannedQty: '10', sourceWarehouseId: stores.id, targetWarehouseId: fg.id }, 400, 'draft BOM revisions cannot be used');
let wo = await c.req('POST', '/manufacturing/work-orders', { itemId: brk.id, plannedQty: '10', sourceWarehouseId: stores.id, targetWarehouseId: fg.id }, 201);
assert.deepEqual([wo.status, wo.revision, wo.number], ['draft', 'A', null]);
await fail(c, 'POST', `/manufacturing/work-orders/${wo.id}/issue`, { lines: [{ itemId: bar.id, batchId: null, qty: '1' }] }, 409, 'nothing moves before release');
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/release`, {}, 201);
assert.match(wo.number, /^GL\/WO\/\d\d-\d\d\/00001$/);
assert.deepEqual(
  wo.materials.map((m) => [m.itemCode, m.requiredQty, m.backflush]),
  [['TI-BAR-50', '5.000000', false], ['M4-SCREW', '40.000000', true]],
);
eq(wo.operations[0].plannedMinutes, '90', `released ${wo.number}: BOM frozen, 5 kg bar + 40 screws, 90 planned minutes`);
// Later activation of rev B doesn't change the released order.
await c.req('POST', `/manufacturing/boms/${bomB.id}/activate`, { makeDefault: true }, 201);
eq((await c.req('GET', `/manufacturing/work-orders/${wo.id}`)).materials[0].requiredQty, '5', 'released work order keeps rev A after rev B becomes default');

// Issue by heat
const avail = await c.req('GET', `/manufacturing/work-orders/${wo.id}/availability`);
assert.deepEqual(avail.filter((a) => a.itemId === bar.id).map((a) => a.batchNo), ['HN-1', 'HN-2']);
ok('availability lists heats oldest first');
const hn1 = avail.find((a) => a.batchNo === 'HN-1').batchId;
const hn2 = avail.find((a) => a.batchNo === 'HN-2').batchId;
await fail(c, 'POST', `/manufacturing/work-orders/${wo.id}/issue`, { lines: [{ itemId: bar.id, qty: '1' }] }, 400, 'batch-tracked issue needs the heat', /choose the batch/);
await fail(c, 'POST', `/manufacturing/work-orders/${wo.id}/issue`, { lines: [{ itemId: bar.id, batchId: hn1, qty: '11' }] }, 400, 'cannot issue more than is in the bin');
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/issue`, { lines: [{ itemId: bar.id, batchId: hn1, qty: '3' }, { itemId: bar.id, batchId: hn2, qty: '2' }] }, 201);
eq(wo.cost.wip, '11000', 'issue HN-1 3 kg (₹6,000) + HN-2 2 kg (₹5,000) → WIP ₹11,000');
let tb = await balances(c);
eq(tb.wip, '11000', 'GL: WIP debited ₹11,000');
eq(tb.inventory, '34500', 'GL: inventory credited (₹45,500 − ₹11,000)');

// Return
await fail(c, 'POST', `/manufacturing/work-orders/${wo.id}/return`, { lines: [{ itemId: bar.id, batchId: hn2, qty: '3' }] }, 400, 'cannot return more than was issued', /only 2\.000/);
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/return`, { lines: [{ itemId: bar.id, batchId: hn2, qty: '0.5' }] }, 201);
eq(wo.cost.wip, '9750', 'return 0.5 kg of HN-2 at its issue cost ₹2,500/kg → WIP ₹9,750');
eq(wo.materials[0].issuedQty, '4.5', 'net issued bar 4.5 kg');

// Job cards
const op = wo.operations[0];
const card = await c.req('POST', '/manufacturing/job-cards', { operationId: op.id, machineId: m03.id }, 201);
assert.equal(card.status, 'running');
await fail(c, 'POST', '/manufacturing/job-cards', { operationId: op.id }, 409, 'one open job card per operator', /already have a job card open/);
await fail(c, 'POST', `/manufacturing/job-cards/${card.id}/pause`, {}, 400, 'pause needs a reason');
await c.req('POST', `/manufacturing/job-cards/${card.id}/pause`, { reason: 'Tool change' }, 201);
const board = await c.req('GET', '/manufacturing/shop-floor');
assert.deepEqual([board.mine.status, board.mine.pauseReason, board.operations.length], ['paused', 'Tool change', 1]);
ok('shop floor shows my paused card and its reason');
await fail(c, 'POST', `/manufacturing/job-cards/${card.id}/pause`, { reason: 'again' }, 409, 'a paused card cannot pause again', /can only resume or stop/);
await c.req('POST', `/manufacturing/job-cards/${card.id}/resume`, {}, 201);
await fail(c, 'POST', `/manufacturing/job-cards/${card.id}/stop`, {}, 400, 'stopping needs the quantity made');
const done = await c.req('POST', `/manufacturing/job-cards/${card.id}/stop`, { goodQty: '10' }, 201);
assert.equal(done.status, 'completed');
eq(done.value, absorptionValue(done.minutes, '1200'), `job card absorbed ${done.minutes} min × ₹1,200/h`);
const absorbed1 = done.value;
wo = await c.req('GET', `/manufacturing/work-orders/${wo.id}`);
eq(wo.cost.wip, Dec.of('9750').add(absorbed1), 'WIP includes absorbed time');
eq((await balances(c)).overhead_absorbed, Dec.of(absorbed1).neg(), 'GL: overhead absorbed credited');

// Output 1: backflush 16 screws (₹80), then 4 of 10 take 40% of WIP.
let wip = Dec.of('9750').add(absorbed1).add('80');
const share = wip.mul('4').div('10');
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/output`, { qty: '4' }, 201);
const out1 = wo.movements.find((m) => m.purpose === 'production_output');
assert.equal(out1.lines[0].batchNo, wo.number);
eq(out1.lines[0].value, share, `output 4 at actual cost into lot ${wo.number}`);
const bf1 = wo.movements.find((m) => m.backflush);
eq(bf1.lines[0].qty, '16', 'backflush issued 16 screws (4 per bracket)');
eq(wo.producedQty, '4', 'produced 4');
await fail(c, 'POST', `/manufacturing/work-orders/${wo.id}/movements/${wo.movements[0].id}/cancel`, { reason: 'wrong heat' }, 409, 'issues cannot be cancelled while output stands', /Cancel the outputs first/);
await fail(c, 'POST', `/manufacturing/work-orders/${wo.id}/return`, { lines: [{ itemId: bar.id, batchId: hn1, qty: '0.1' }] }, 409, 'no returns after output');
await fail(c, 'POST', `/stock-entries/${out1.id}/cancel`, { reason: 'Wrong quantity booked' }, 409, 'system movements cancel only through the work order', /cancel that document/);

// Output 2: the rest — takes everything left in WIP after backflushing 24 screws (₹120).
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/output`, { qty: '6' }, 201);
const outs = wo.movements.filter((m) => m.purpose === 'production_output');
assert.equal(outs[1].lines[0].batchNo, `${wo.number}-2`);
eq(Dec.of(outs[0].lines[0].value).add(outs[1].lines[0].value), Dec.of('9950').add(absorbed1), 'outputs carry all material, screws and time (₹9,950 + absorbed)');
eq(wo.cost.wip, '0', 'final output empties WIP');
tb = await balances(c);
eq(tb.wip, '0', 'GL: WIP cleared');
eq(Dec.of(tb.inventory).add(tb.overhead_absorbed), '45500', 'GL: inventory = receipts + absorbed time (value moved, none lost)');
await fail(c, 'POST', `/manufacturing/work-orders/${wo.id}/movements/${outs[0].id}/cancel`, { reason: 'Wrong lot booked' }, 409, 'outputs cancel newest first', /later outputs first/);

// Time after the last output goes to variance on close.
const card2 = await c.req('POST', '/manufacturing/job-cards', { operationId: op.id }, 201);
const done2 = await c.req('POST', `/manufacturing/job-cards/${card2.id}/stop`, { reworkQty: '1', remarks: 'Deburr rework' }, 201);
wo = await c.req('GET', `/manufacturing/work-orders/${wo.id}`);
eq(wo.cost.wip, done2.value, 'rework time after output stays in WIP');
await fail(c, 'POST', `/manufacturing/job-cards/${card2.id}/cancel`, { reason: 'Recorded twice' }, 409, 'completed cards cannot be cancelled once output stands');
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/close`, {}, 201);
assert.equal(wo.status, 'completed');
eq(wo.cost.variance, done2.value, 'close: leftover WIP to manufacturing variance');
tb = await balances(c);
eq(tb.production_variance, done2.value, 'GL: manufacturing variance debited');
eq(tb.wip, '0', 'GL: WIP zero after close');
await fail(c, 'POST', `/manufacturing/work-orders/${wo.id}/issue`, { lines: [{ itemId: screw.id, qty: '1' }] }, 409, 'closed work orders accept nothing', /reopen it first/);

// Reopen, cancel the last output (with its backflush), produce again, close.
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/reopen`, { reason: 'Last lot failed CMM' }, 201);
eq(wo.cost.wip, done2.value, 'reopen reverses the variance');
eq((await balances(c)).production_variance, '0', 'GL: variance reversed');
const screwsBefore = (await c.req('GET', `/manufacturing/work-orders/${wo.id}/availability?itemId=${screw.id}`))[0].qty;
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/movements/${outs[1].id}/cancel`, { reason: 'Lot scrapped at CMM' }, 201);
eq(wo.producedQty, '4', 'cancelled output: produced back to 4');
const screwsAfter = (await c.req('GET', `/manufacturing/work-orders/${wo.id}/availability?itemId=${screw.id}`))[0].qty;
eq(Dec.of(screwsAfter).sub(screwsBefore), '24', 'its 24 backflushed screws returned to stock');
eq(wo.cost.wip, Dec.of(outs[1].lines[0].value).add(done2.value).sub('120'), 'WIP holds the cancelled output value less its backflush');
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/output`, { qty: '6', batchNo: 'LOT-B' }, 201);
// qty × rate is rounded to 6 places on the stock line, so a micro-rupee residue may stay for the close.
const residue = wo.cost.wip;
assert.ok(Dec.of(residue).abs().lt('0.0001'), `re-output takes the whole balance (residue ${residue})`);
ok('re-output takes the whole balance again (rounding residue < ₹0.0001)');
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/close`, {}, 201);
eq(wo.cost.variance, residue, 'only the rounding residue goes to variance');
const unit = Dec.of(wo.cost.output).div('10');
eq(wo.cost.unitCost, unit, `actual unit cost ₹${unit.toFixed(2)}`);

// Traceability
const [lotB] = wo.movements.filter((m) => m.purpose === 'production_output' && m.status === 'submitted').slice(-1);
const trace = await c.req('GET', `/manufacturing/trace/${lotB.lines[0].batchId}`);
assert.deepEqual(trace.backward.consumed.filter((x) => x.batchNo).map((x) => x.heatNo).sort(), ['HN-1', 'HN-2']);
ok('backward trace: LOT-B made from heats HN-1 and HN-2');
const fwd = await c.req('GET', `/manufacturing/trace/${hn1}`);
assert.ok(fwd.forward.produced.some((x) => x.batchNo === 'LOT-B'));
ok('forward trace: HN-1 went into LOT-B');

// Cancelling a work order
const wo2 = await c.req('POST', '/manufacturing/work-orders', { itemId: brk.id, bomId: bomA.id, plannedQty: '2', sourceWarehouseId: stores.id, targetWarehouseId: fg.id }, 201);
await c.req('POST', `/manufacturing/work-orders/${wo2.id}/release`, {}, 201);
const issued = await c.req('POST', `/manufacturing/work-orders/${wo2.id}/issue`, { lines: [{ itemId: screw.id, qty: '8' }] }, 201);
await fail(c, 'POST', `/manufacturing/work-orders/${wo2.id}/cancel`, { reason: 'Customer cancelled' }, 409, 'cannot cancel with material on it', /cancel those movements first/);
await c.req('POST', `/manufacturing/work-orders/${wo2.id}/movements/${issued.movements[0].id}/cancel`, { reason: 'Customer cancelled' }, 201);
const cancelled = await c.req('POST', `/manufacturing/work-orders/${wo2.id}/cancel`, { reason: 'Customer cancelled' }, 201);
assert.equal(cancelled.status, 'cancelled');
eq(cancelled.cost.wip, '0', 'issue reversed, work order cancelled, WIP zero');
tb = await balances(c);
eq(tb.wip, '0', 'GL: WIP still zero');
const list = await c.req('GET', '/manufacturing/work-orders');
assert.deepEqual(list.map((w) => w.status).sort(), ['cancelled', 'completed']);
ok('work order list');

// ─────────────────────────── Books inactive ───────────────────────────
const d = await new Client().init('Manufacturing inactive');
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const s = await setup(d, today);
const wc = await d.req('POST', '/manufacturing/work-centres', { code: 'LATHE', name: 'Lathe', hourlyRate: '600' }, 201);
const b2 = await d.req('POST', '/manufacturing/boms', { itemId: s.brk.id, revision: 'A', materials: [{ itemId: s.screw.id, qty: '2', backflush: true }], operations: [{ seq: 10, name: 'Turn', workCentreId: wc.id }] }, 201);
await d.req('POST', `/manufacturing/boms/${b2.id}/activate`, {}, 201);
let w = await d.req('POST', '/manufacturing/work-orders', { itemId: s.brk.id, plannedQty: '5', sourceWarehouseId: s.stores.id, targetWarehouseId: s.fg.id }, 201);
w = await d.req('POST', `/manufacturing/work-orders/${w.id}/release`, {}, 201);
w = await d.req('POST', `/manufacturing/work-orders/${w.id}/output`, { qty: '5' }, 201);
eq(w.movements.find((m) => m.purpose === 'production_output').lines[0].value, '50', 'inactive books: backflushed screws value the output (₹50)');
w = await d.req('POST', `/manufacturing/work-orders/${w.id}/close`, {}, 201);
const tbInactive = await d.req('GET', '/accounts/reports/trial-balance');
assert.ok(tbInactive.accounts.every((a) => Dec.of(a.balance).isZero()));
ok('inactive books: no GL postings (decision 034)');

console.log(`\nManufacturing smoke passed: ${c.checks + d.checks} checks`);
