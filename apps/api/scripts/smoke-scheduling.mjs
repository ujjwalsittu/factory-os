// Finite capacity scheduling (decision 049): placement by priority on the machine that finishes first, routing order,
// outsourced lead days, late orders, unscheduled operations, moves with pinning and their refusals, unpin, running
// job cards anchored, downtime, priority changes and the stale-run check.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-scheduling.mjs
import assert from 'node:assert/strict';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Scheduling');
const fail = async (method, path, body, status, label, pattern) => {
  const r = await c.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const min = (iso) => Math.floor(new Date(iso).getTime() / 60000);
const iso = (m) => new Date(m * 60000).toISOString();
const istDate = (offsetDays) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

// Round the clock, every day: placements start at the minute the run starts.
await c.req('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const bar = await c.req('POST', '/items', { code: 'AL6061', name: 'Aluminium bar', type: 'raw_material', tracking: 'none', stockUomId: u('KG'), hsnCode: '76042910' }, 201);
const part = await c.req('POST', '/items', { code: 'BRKT', name: 'Bracket', type: 'finished_good', tracking: 'none', stockUomId: u('NOS'), hsnCode: '88073000' }, 201);
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const fg = await c.req('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' }, 201);
const anod = await c.req('POST', '/parties', { code: 'ANOD', name: 'Anodisers', isSupplier: true, isJobWorker: true, gstin: gstin('27AAACP1234B1Z') }, 201);
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' }, 201);
const grind = await c.req('POST', '/manufacturing/work-centres', { code: 'GRIND', name: 'Grinding', hourlyRate: '900' }, 201);
const edm = await c.req('POST', '/manufacturing/work-centres', { code: 'EDM', name: 'Wire EDM', hourlyRate: '1500' }, 201);
const m1 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M1', name: 'VMC 1' }, 201);
const m2 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M2', name: 'VMC 2' }, 201);
const g1 = await c.req('POST', `/manufacturing/work-centres/${grind.id}/machines`, { code: 'G1', name: 'Surface grinder' }, 201);
const bom = await c.req('POST', '/manufacturing/boms', {
  itemId: part.id,
  revision: 'A',
  materials: [{ itemId: bar.id, qty: '0.5' }],
  operations: [
    { seq: 10, name: 'Mill', workCentreId: cnc.id, runMinutesPerUnit: '60' },
    { seq: 20, name: 'Grind', workCentreId: grind.id, runMinutesPerUnit: '30' },
    { seq: 30, name: 'Anodise', outsourced: true, supplierId: anod.id, leadDays: 2 },
  ],
}, 201);
await c.req('POST', `/manufacturing/boms/${bom.id}/activate`, {}, 201);
assert.equal((await c.req('GET', `/manufacturing/boms/${bom.id}`)).operations[2].leadDays, 2);
ok('BOM operations carry outsourced lead days');
const wo = async (qty, extra = {}) => {
  const w = await c.req('POST', '/manufacturing/work-orders', { itemId: part.id, plannedQty: qty, sourceWarehouseId: sto.id, targetWarehouseId: fg.id, ...extra }, 201);
  return c.req('POST', `/manufacturing/work-orders/${w.id}/release`, {}, 201);
};
const A = await wo('2', { priority: 1 });
const B = await wo('1');
const C = await wo('1', { priority: 2, plannedStart: istDate(-2), plannedEnd: istDate(-1) });
assert.equal(A.operations.find((o) => o.seq === 30).leadDays ?? 2, 2);

let s = await c.req('POST', '/manufacturing/schedule/run', {}, 201);
const at = (wo, seq) => {
  const b = s.bars.find((x) => x.workOrderId === wo.id && x.seq === seq);
  assert.ok(b, `bar ${wo.number}/${seq}`);
  return b;
};
const t0 = min(at(A, 10).startsAt);
const rel = (b) => [b.machineId, min(b.startsAt) - t0, min(b.endsAt) - t0];
assert.deepEqual(rel(at(A, 10)), [m1.id, 0, 120]);
assert.deepEqual(rel(at(A, 20)), [g1.id, 120, 180]);
assert.deepEqual(rel(at(C, 10)), [m2.id, 0, 60]);
assert.deepEqual(rel(at(C, 20)), [g1.id, 60, 90]);
assert.deepEqual(rel(at(B, 10)), [m2.id, 60, 120]);
assert.deepEqual(rel(at(B, 20)), [g1.id, 180, 210]);
ok('priority 1 first, then 2, then 3; each operation on the CNC machine that finishes first, in routing order');
assert.deepEqual(rel(at(A, 30)), [null, 180, 180 + 2 * 1440]);
ok('anodising takes its two lead days off-machine after grinding');
assert.deepEqual(s.late.map((l) => l.number), [C.number]);
assert.equal(at(C, 10).late, true);
assert.equal(at(A, 10).noMaterial, true);
assert.equal(s.stale, false);
assert.equal(s.run.placed, 9);
ok('C is late against yesterday’s planned end; no material is issued yet; the run is current');
const wa = await c.req('GET', `/manufacturing/work-orders/${A.id}`);
assert.equal(min(wa.scheduledFinish ?? (await c.req('GET', '/manufacturing/work-orders')).find((w) => w.id === A.id).scheduledFinish), t0 + 180 + 2880);
ok('the work order records its scheduled finish');

// ── Moves ──
const runId = s.run.id;
const move = (wo, seq, machineId, startMin, rid = runId) => ({ operationId: at(wo, seq).operationId, machineId, start: iso(startMin), runId: rid });
await fail('POST', '/manufacturing/schedule/move', move(B, 10, m1.id, t0 + 60), 409, 'a move can’t overlap another bar', /Overlaps another operation/);
await fail('POST', '/manufacturing/schedule/move', move(B, 10, g1.id, t0 + 600), 400, 'a move stays in the operation’s work centre', /work centre/);
await fail('POST', '/manufacturing/schedule/move', move(B, 10, m1.id, t0 - 120), 400, 'a move can’t start in the past', /past/);
await fail('POST', '/manufacturing/schedule/move', move(B, 10, m1.id, t0 + 300), 409, 'a move can’t pass the next operation', /Operation 20 starts before this finishes/);
await fail('POST', '/manufacturing/schedule/move', move(B, 20, g1.id, t0 + 30), 409, 'a move can’t start before the previous operation finishes', /Operation 10 finishes after this start/);
await fail('POST', '/manufacturing/schedule/move', { ...move(B, 10, m1.id, t0 + 300), runId: '00000000-0000-4000-8000-000000000000' }, 409, 'a move on an old run is refused', /reload/);
let moved = await c.req('POST', '/manufacturing/schedule/move', move(B, 20, g1.id, t0 + 400), 201);
assert.equal(moved.pinned, true);
moved = await c.req('POST', '/manufacturing/schedule/move', move(B, 10, m1.id, t0 + 300), 201);
assert.deepEqual([moved.machineId, min(moved.startsAt) - t0, min(moved.endsAt) - t0, moved.pinned], [m1.id, 300, 360, true]);
ok('grinding moved later, then milling onto M1 after A; both pinned');

s = await c.req('POST', '/manufacturing/schedule/run', {}, 201);
const t1 = min(s.run.runAt);
assert.ok(Math.abs(t1 - t0) <= 2);
assert.deepEqual(rel(at(B, 10)), [m1.id, 300, 360]);
assert.deepEqual(rel(at(B, 20)), [g1.id, 400, 430]);
assert.equal(at(B, 10).pinned, true);
ok('pinned bars keep their place on the next run');
await c.req('POST', `/manufacturing/schedule/${at(B, 10).operationId}/unpin`, {}, 201);
await c.req('POST', `/manufacturing/schedule/${at(B, 20).operationId}/unpin`, {}, 201);
s = await c.req('POST', '/manufacturing/schedule/run', {}, 201);
assert.deepEqual(rel(at(B, 10)), [m2.id, 60, 120]);
ok('unpinned, B goes back to the earliest finish');

// ── Priority, unscheduled and stale ──
await c.req('POST', `/manufacturing/work-orders/${B.id}/priority`, { priority: 1 }, 201);
s = await c.req('GET', '/manufacturing/schedule');
assert.equal(s.stale, true);
ok('changing a priority marks the schedule out of date');
s = await c.req('POST', '/manufacturing/schedule/run', {}, 201);
assert.equal(min(at(B, 10).startsAt) - t0 <= 1, true);
ok('B, now priority 1 and released before C, starts at once');
const bomE = await c.req('POST', '/manufacturing/boms', { itemId: part.id, revision: 'B', materials: [{ itemId: bar.id, qty: '0.5' }], operations: [{ seq: 10, name: 'Wire cut', workCentreId: edm.id, runMinutesPerUnit: '45' }, { seq: 20, name: 'Grind', workCentreId: grind.id, runMinutesPerUnit: '10' }] }, 201);
await c.req('POST', `/manufacturing/boms/${bomE.id}/activate`, {}, 201);
const E = await wo('1', { bomId: bomE.id });
s = await c.req('POST', '/manufacturing/schedule/run', {}, 201);
assert.deepEqual(s.unscheduled.filter((x) => x.workOrderId === E.id).map((x) => [x.seq, x.reason]), [[10, 'No active machine in the work centre'], [20, 'A previous operation could not be scheduled']]);
ok('an operation on a centre with no machines is listed as unscheduled, with what follows it');

// ── Running job card and downtime ──
const card = await c.req('POST', '/manufacturing/job-cards', { operationId: at(A, 10).operationId, machineId: m2.id }, 201);
await c.req('POST', '/manufacturing/machine-blocks', { machineId: m1.id, kind: 'maintenance', startsAt: iso(t0), endsAt: iso(t0 + 600), reason: 'Ball screw replacement' }, 201);
s = await c.req('POST', '/manufacturing/schedule/run', {}, 201);
const t2 = min(s.run.runAt);
const a10 = at(A, 10);
assert.equal(a10.running, true);
assert.equal(a10.machineId, m2.id);
assert.ok(min(a10.startsAt) <= t2 && min(a10.endsAt) >= t2 + 118);
ok('the running job card anchors A’s milling on M2, where it started');
assert.ok(s.bars.filter((b) => b.machineId === m1.id).every((b) => min(b.startsAt) >= t0 + 600));
ok('nothing is placed on M1 during its maintenance');
await fail('POST', '/manufacturing/schedule/move', { operationId: a10.operationId, machineId: m1.id, start: iso(t2 + 700), runId: s.run.id }, 409, 'a running operation stays where it is', /running operation/);
await fail('POST', '/manufacturing/schedule/move', { ...move(C, 10, m1.id, t0 + 300), runId: s.run.id }, 409, 'a move into downtime is refused', /downtime/);
void card;

console.log(`\nScheduling smoke passed (${c.checks} request checks).`);
