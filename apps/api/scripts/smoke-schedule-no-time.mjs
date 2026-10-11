// Operations without routing time (decision 054): an in-house operation with 0 planned minutes is still skipped by
// the scheduler (no machine time, it doesn't block what follows) but the schedule view lists it and marks its order's
// bars; once its quantity is made it drops off; a rework order's 0-minute operation is listed as rework.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-schedule-no-time.mjs
import assert from 'node:assert/strict';
import { Client } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Schedule no time');
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

await c.req('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const bar = await c.req('POST', '/items', { code: 'AL6061', name: 'Aluminium bar', type: 'raw_material', tracking: 'none', stockUomId: u('KG'), hsnCode: '76042910' }, 201);
const part = await c.req('POST', '/items', { code: 'BRKT', name: 'Bracket', type: 'finished_good', tracking: 'none', stockUomId: u('NOS'), hsnCode: '88073000' }, 201);
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const fg = await c.req('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' }, 201);
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' }, 201);
const qc = await c.req('POST', '/manufacturing/work-centres', { code: 'QC', name: 'Inspection', hourlyRate: '600' }, 201);
const m1 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M1', name: 'VMC 1' }, 201);
await c.req('POST', `/manufacturing/work-centres/${qc.id}/machines`, { code: 'Q1', name: 'Inspection bench' }, 201);
const bom = await c.req('POST', '/manufacturing/boms', {
  itemId: part.id,
  revision: 'A',
  materials: [{ itemId: bar.id, qty: '0.5' }],
  operations: [
    { seq: 10, name: 'Mill', workCentreId: cnc.id, runMinutesPerUnit: '60' },
    { seq: 20, name: 'Inspect', workCentreId: qc.id },
    { seq: 30, name: 'Deburr', workCentreId: cnc.id, runMinutesPerUnit: '10' },
  ],
}, 201);
await c.req('POST', `/manufacturing/boms/${bom.id}/activate`, {}, 201);
const draft = await c.req('POST', '/manufacturing/work-orders', { itemId: part.id, plannedQty: '2', sourceWarehouseId: sto.id, targetWarehouseId: fg.id }, 201);
const A = await c.req('POST', `/manufacturing/work-orders/${draft.id}/release`, {}, 201);
const opA = (seq) => A.operations.find((o) => o.seq === seq);

let s = await c.req('POST', '/manufacturing/schedule/run', {}, 201);
const barsA = s.bars.filter((b) => b.workOrderId === A.id);
assert.deepEqual(barsA.map((b) => b.seq).sort(), [10, 30]);
assert.equal(barsA[0].machineId, m1.id);
assert.ok(barsA.every((b) => b.noTime === true));
ok('the 0-minute operation takes no machine time; the order’s other bars are placed and marked');
assert.equal(s.unscheduled.filter((x) => x.workOrderId === A.id).length, 0);
ok('it does not block the operations after it');
assert.deepEqual(
  s.noTime.map((n) => [n.number, n.seq, n.name, n.workCentre, n.itemCode, n.rework]),
  [[A.number, 20, 'Inspect', 'QC', 'BRKT', false]],
);
ok('the schedule view lists it with its order, work centre and item');

const card = await c.req('POST', '/manufacturing/job-cards', { operationId: opA(20).id }, 201);
s = await c.req('GET', '/manufacturing/schedule');
assert.equal(s.noTime.length, 0);
ok('while a job card is running on it, it is not listed');
await c.req('POST', `/manufacturing/job-cards/${card.id}/stop`, { goodQty: '1' }, 201);
s = await c.req('GET', '/manufacturing/schedule');
assert.deepEqual(s.noTime.map((n) => n.seq), [20]);
ok('with 1 of 2 made it is listed again');
const card2 = await c.req('POST', '/manufacturing/job-cards', { operationId: opA(20).id }, 201);
await c.req('POST', `/manufacturing/job-cards/${card2.id}/stop`, { goodQty: '1' }, 201);
s = await c.req('GET', '/manufacturing/schedule');
assert.equal(s.noTime.length, 0);
assert.ok(s.bars.filter((b) => b.workOrderId === A.id).every((b) => b.noTime === false));
ok('once the whole quantity is made it drops off and the bars are no longer marked');

const rec = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: today, lines: [{ itemId: bar.id, qty: '5', toWarehouseId: sto.id, rate: '400' }] }, 201);
await c.req('POST', `/stock-entries/${rec.id}/submit`, {}, 201);
const n = await c.req('POST', '/quality/ncrs', { itemId: bar.id, qty: '1', fromWarehouseId: sto.id, description: 'Bent bar' }, 201);
await c.req('POST', `/quality/ncrs/${n.id}/dispositions`, { lines: [{ kind: 'rework', qty: '1', note: 'Straighten' }] }, 201);
const approved = await c.req('POST', `/quality/ncrs/${n.id}/approve`, { reworkWorkCentreId: cnc.id, reworkTargetWarehouseId: sto.id }, 201);
const rw = approved.dispositions.find((d) => d.kind === 'rework');
s = await c.req('GET', '/manufacturing/schedule');
assert.deepEqual(
  s.noTime.map((n) => [n.workOrderId, n.workCentre, n.itemCode, n.rework]),
  [[rw.workOrderId, 'CNC', 'AL6061', true]],
);
ok('a rework order’s operation, which has no routing time, is listed as rework');

const other = await new Client().init('Schedule no time other');
await other.req('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) }, 201);
assert.equal((await other.req('GET', '/manufacturing/schedule')).noTime.length, 0);
ok('another tenant does not see them');

console.log(`\nSchedule no-time smoke passed (${c.checks} request checks).`);
