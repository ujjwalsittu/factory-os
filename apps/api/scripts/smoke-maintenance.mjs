// Machine maintenance (decision 066), end to end through the API:
//   - plans: intervals, checklist with limits and spares, the checklist fixed once used;
//   - due by calendar and by running hours (job cards on a machine without a tap, the tap's metered running time);
//   - orders: generate due, schedule (a maintenance block for the scheduler), results with readings and limits,
//     labour at the work centre rate, spares issued from stock (GL Dr repairs and maintenance), cancel spares;
//   - done: the checklist must be complete, and done moves the plan's baseline;
//   - verify on a critical machine (someone else); breakdowns block the machine until done;
//   - MTTR, MTBF and cost in the report; machine summary with an alarm suggestion; operators report; isolation.
// Times are moved back in the local database (test-only time travel).
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-maintenance.mjs   (DATABASE_URL from the env or ../../.env)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Maintenance');
const fail = async (method, path, body, status, label, pattern, who = c) => {
  const r = await who.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
// Sign-ups are rate-limited: space the extra people out.
const pause = () => new Promise((r) => setTimeout(r, 20e3));
const join = async (name, roleName) => {
  await pause();
  const roles = await c.req('GET', '/roles');
  const role = roles.find((r) => r.name === roleName);
  assert.ok(role, `role ${roleName}`);
  const who = new Client();
  const email = `${name.split(' ')[0].toLowerCase()}-${Date.now()}@example.com`;
  const inv = await c.req('POST', '/invitations', { email, roles: [{ roleId: role.id, entityIds: [c.entityId] }] }, 201);
  await who.req('POST', '/auth/sign-up/email', { name, email, password: 'Sup3r-secret-pw' });
  await who.req('POST', '/invitations/accept', { token: inv.inviteUrl.split('/').at(-1) }, 201);
  who.tenantId = c.tenantId;
  who.entityId = c.entityId;
  return who;
};
const API = `${process.env.API ?? 'http://localhost:4000'}/api`;
const dbUrl = process.env.DATABASE_URL ?? fs.readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1];
const psql = (q) => execFileSync('psql', [dbUrl, '-qtAc', q]).toString().trim();
const daysAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString();

// ── Masters ──
await c.activate();
const date = c.settings.cutoverDate;
await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/hsn-codes', { code: '84669390', kind: 'hsn', description: 'Machine tool parts', gstRate: '18', effectiveFrom: '2025-04-01' }, 201);
const uoms = await c.req('GET', '/uoms');
const nos = uoms.find((x) => x.code === 'NOS').id;
const belt = await c.req('POST', '/items', { code: 'SP-BELT', name: 'Spindle belt', type: 'consumable', stockUomId: nos, hsnCode: '84669390' }, 201);
const filter = await c.req('POST', '/items', { code: 'SP-FILTER', name: 'Coolant filter', type: 'consumable', tracking: 'batch', stockUomId: nos, hsnCode: '84669390' }, 201);
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const rec = await c.req('POST', '/stock-entries', { postingDate: date, purpose: 'receipt', lines: [{ itemId: belt.id, qty: '10', toWarehouseId: sto.id, rate: '2500' }, { itemId: filter.id, qty: '20', toWarehouseId: sto.id, newBatchNo: 'FL-1', rate: '400' }] }, 201);
await c.req('POST', `/stock-entries/${rec.id}/submit`, {}, 201);
const lot = (await c.req('GET', `/batches?itemId=${filter.id}`))[0];
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' }, 201);
const vmc = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'VMC', name: 'VMC 3-axis', critical: true }, 201);
const lathe = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'LATHE', name: 'CNC lathe' }, 201);
assert.equal(vmc.critical, true);
await c.req('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) }, 201);
ok('a critical VMC and a lathe; spares in stores; a 24×7 calendar');

// ── Plans ──
const plan = (o) => ({ machineId: vmc.id, name: 'Quarterly service', everyDays: 90, leadDays: 7, plannedMinutes: 120, items: [], ...o });
await fail('POST', '/maintenance/plans', plan({ everyDays: null }), 400, 'a plan needs an interval', /calendar interval, a running-hours interval/);
await fail('POST', '/maintenance/plans', plan({ items: [{ text: 'Spindle runout', min: '0', max: '0.005' }] }), 400, 'a reading with limits needs a unit', /needs its unit/);
const pVmc = await c.req('POST', '/maintenance/plans', plan({
  lastDoneAt: daysAgo(86),
  items: [
    { text: 'Spindle runout', unit: 'mm', min: '0', max: '0.005' },
    { text: 'Replace spindle belt', spareItemId: belt.id, spareQty: '1' },
    { text: 'Clean coolant tank' },
  ],
}), 201);
assert.deepEqual([pVmc.due.status, pVmc.due.by, pVmc.items.length], ['due_soon', 'calendar', 3]);
const pLathe = await c.req('POST', '/maintenance/plans', plan({ machineId: lathe.id, name: 'Way lube check', lastDoneAt: daysAgo(1), everyDays: null, everyRunHours: 2, items: [{ text: 'Top up way lube' }] }), 201);
assert.deepEqual([pLathe.due.status, pLathe.due.runHoursSource, pLathe.due.runHoursSince], ['ok', 'job_cards', 0]);
ok('plans: the VMC service due soon by calendar; the lathe on running hours from job cards');

// Running hours on the lathe from a completed job card of 150 minutes (test-only: inserted directly).
// A minimal work order for the job card's foreign keys.
const item = await c.req('POST', '/items', { code: 'SHAFT', name: 'Shaft', type: 'finished_good', stockUomId: nos, hsnCode: '84669390' }, 201);
const fg = await c.req('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' }, 201);
let bomRow = await c.req('POST', '/manufacturing/boms', { itemId: item.id, revision: 'A', quantity: '1', materials: [{ itemId: belt.id, qty: '1' }], operations: [{ seq: 10, name: 'Turn', workCentreId: cnc.id, setupMinutes: '0', runMinutesPerUnit: '1' }] }, 201);
bomRow = await c.req('POST', `/manufacturing/boms/${bomRow.id}/activate`, {}, 201);
let wo = await c.req('POST', '/manufacturing/work-orders', { itemId: item.id, plannedQty: '1', sourceWarehouseId: sto.id, targetWarehouseId: fg.id }, 201);
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/release`, {}, 201);
psql(`insert into job_card (tenant_id, entity_id, work_order_id, operation_id, machine_id, operator_id, status, minutes, completed_at)
      select wo.tenant_id, wo.entity_id, wo.id, op.id, '${lathe.id}', wo.created_by, 'completed', 150, now() - interval '1 hour'
      from work_order wo join work_order_operation op on op.work_order_id = wo.id where wo.id = '${wo.id}'`);
let due = await c.req('GET', '/maintenance/plans');
const lDue = due.find((p) => p.id === pLathe.id).due;
assert.deepEqual([lDue.status, lDue.runHoursSince, lDue.by], ['overdue', 2.5, 'hours']);
ok('2.5 running hours from job cards make the 2-hour lathe plan overdue');

// The checklist is fixed once the plan has an order.
await c.req('PUT', `/maintenance/plans/${pLathe.id}`, { name: 'Way lube check', everyRunHours: 2, items: [{ text: 'Top up way lube' }, { text: 'Check level glass' }] });
ok('the checklist can change before the first order');

// ── Due orders ──
const gen = await c.req('POST', '/maintenance/due/generate', {}, 201);
assert.equal(gen.created.length, 2);
assert.equal((await c.req('POST', '/maintenance/due/generate', {}, 201)).created.length, 0);
await fail('POST', `/maintenance/plans/${pVmc.id}/order`, {}, 409, 'one open order per plan', /already open/);
await fail('PUT', `/maintenance/plans/${pLathe.id}`, { name: 'Way lube check', everyRunHours: 2, items: [{ text: 'Only one item now' }] }, 409, 'the checklist is fixed once the plan has orders', /fixed once the plan has orders/);
const orders = await c.req('GET', '/maintenance/orders?status=open');
const oVmc = orders.find((o) => o.planId === pVmc.id);
const oLathe = orders.find((o) => o.planId === pLathe.id);
assert.match(oVmc.number, /\/MO\//);
ok('generate due opens one order per due plan, and only once');

// Schedule the VMC service: a maintenance block for the scheduler.
const start = new Date(Date.now() + 2 * 86400e3);
start.setUTCMinutes(0, 0, 0);
let d = await c.req('POST', `/maintenance/orders/${oVmc.id}/schedule`, { start: start.toISOString() }, 201);
let blocks = await c.req('GET', `/manufacturing/machine-blocks?machineId=${vmc.id}`);
assert.deepEqual(blocks.map((b) => [b.kind, b.startsAt, b.endsAt]), [['maintenance', start.toISOString(), new Date(start.getTime() + 120 * 60e3).toISOString()]]);
d = await c.req('POST', `/maintenance/orders/${oVmc.id}/schedule`, { start: new Date(start.getTime() + 86400e3).toISOString() }, 201);
blocks = await c.req('GET', `/manufacturing/machine-blocks?machineId=${vmc.id}`);
assert.equal(blocks.length, 1);
ok('scheduling an order reserves the machine for the planned 2 hours; rescheduling moves it');

// ── Checklist, labour, spares ──
const [runout, beltItem, tank] = d.checklist;
await fail('POST', `/maintenance/orders/${oVmc.id}/results`, { itemId: runout.id }, 400, 'a measured item needs its reading', /enter the reading in mm/);
await fail('POST', `/maintenance/orders/${oVmc.id}/results`, { itemId: runout.id, reading: '0.008' }, 400, 'a reading outside the limits needs a note', /outside 0–0.005/);
d = await c.req('POST', `/maintenance/orders/${oVmc.id}/results`, { itemId: runout.id, reading: '0.008', note: 'Re-seated tool holder, re-measured below' }, 201);
assert.equal(d.status, 'in_progress');
assert.equal(d.checklist[0].result.outside, true);
d = await c.req('POST', `/maintenance/orders/${oVmc.id}/results`, { itemId: runout.id, reading: '0.003' }, 201);
assert.equal(d.checklist[0].result.outside, false);
await fail('POST', `/maintenance/orders/${oVmc.id}/done`, {}, 409, 'done needs every checklist item', /Checklist not finished: Replace spindle belt; Clean coolant tank/);
d = await c.req('POST', `/maintenance/orders/${oVmc.id}/labour`, { minutes: 90, note: 'Belt change' }, 201);
assert.deepEqual([d.labour[0].rate, d.labour[0].cost], ['1800.00', '2700.00']);
await fail('POST', `/maintenance/orders/${oVmc.id}/spares`, { warehouseId: sto.id, lines: [{ itemId: belt.id, qty: '11' }] }, 400, 'spares cannot exceed the stock');
d = await c.req('POST', `/maintenance/orders/${oVmc.id}/spares`, { warehouseId: sto.id, lines: [{ itemId: belt.id, qty: '1' }, { itemId: filter.id, qty: '2', batchId: lot.id }] }, 201);
assert.equal(d.spares.length, 1);
assert.deepEqual([d.cost.spares, d.cost.labour, d.cost.total], ['3300.00', '2700.00', '6000.00']);
const glMaint = () => psql(`select coalesce(sum(e.debit) - sum(e.credit), 0) from gl_entry e join gl_account a on a.id = e.account_id where a.role = 'maintenance' and a.entity_id = '${c.entityId}'`);
assert.equal(Number(glMaint()), 3300);
ok('labour at the work centre rate; spares issued from stores by FIFO and expensed to repairs and maintenance (₹3,300)');
await fail('POST', `/stock-entries/${d.spares[0].id}/cancel`, { reason: 'wrong' }, 409, 'a maintenance issue cancels only through its order', /another document/);
d = await c.req('POST', `/maintenance/orders/${oVmc.id}/spares/${d.spares[0].id}/cancel`, { reason: 'Wrong filter lot' }, 201);
assert.equal(d.cost.spares, '0.00');
assert.equal(Number(glMaint()), 0);
d = await c.req('POST', `/maintenance/orders/${oVmc.id}/spares`, { warehouseId: sto.id, lines: [{ itemId: belt.id, qty: '1' }] }, 201);
assert.equal(d.cost.spares, '2500.00');
ok('cancelling an issue through the order reverses stock and GL; reissued');
for (const it of [beltItem, tank]) d = await c.req('POST', `/maintenance/orders/${oVmc.id}/results`, { itemId: it.id }, 201);
d = await c.req('POST', `/maintenance/orders/${oVmc.id}/done`, {}, 201);
assert.deepEqual([d.status, d.needsVerification], ['done', true]);
await fail('POST', `/maintenance/orders/${oVmc.id}/verify`, {}, 403, 'the technician cannot verify their own order', /Someone other than/);
const plans = await c.req('GET', '/maintenance/plans');
const after = plans.find((p) => p.id === pVmc.id);
assert.equal(after.due.status, 'ok');
assert.ok(Date.parse(after.lastDoneAt) > Date.now() - 60e3);
blocks = await c.req('GET', `/manufacturing/machine-blocks?machineId=${vmc.id}`);
assert.equal(blocks.length, 0);
ok('done: the plan counts from now and the unused reservation is released');

// A supervisor verifies.
const sup = await join('Maintenance supervisor', 'Maintenance');
const v = await sup.raw('POST', `/maintenance/orders/${oVmc.id}/verify`, {});
assert.equal(v.status, 201, JSON.stringify(v.data));
assert.equal(v.data.status, 'verified');
c.checks++;
ok('a supervisor verifies the critical machine’s order');

// ── Breakdowns ──
const bd = await c.req('POST', '/maintenance/breakdowns', { machineId: lathe.id, symptom: 'Spindle drive alarm 401, will not restart', failedAt: new Date(Date.now() - 3 * 3600e3).toISOString() }, 201);
await fail('POST', '/maintenance/breakdowns', { machineId: lathe.id, symptom: 'Again' }, 409, 'one open breakdown per machine', /already has an open breakdown/);
await fail('POST', '/maintenance/breakdowns', { machineId: lathe.id, symptom: 'Future', failedAt: new Date(Date.now() + 3600e3).toISOString() }, 400, 'a failure time in the future is refused');
blocks = await c.req('GET', `/manufacturing/machine-blocks?machineId=${lathe.id}`);
assert.equal(blocks[0].kind, 'breakdown');
assert.ok(Date.parse(blocks[0].endsAt) > Date.now() + 20 * 3600e3);
ok('a breakdown blocks the lathe from when it failed to a day ahead');
await fail('POST', `/maintenance/orders/${bd.id}/done`, { cause: 'Encoder cable' }, 400, 'a breakdown closes with its cause and action', /cause and the action/);
await c.req('POST', `/maintenance/orders/${bd.id}/labour`, { minutes: 120 }, 201);
d = await c.req('POST', `/maintenance/orders/${bd.id}/done`, { cause: 'Encoder cable chafed at the chain', action: 'Replaced cable, re-routed with a sleeve' }, 201);
assert.deepEqual([d.status, d.needsVerification], ['done', false]);
blocks = await c.req('GET', `/manufacturing/machine-blocks?machineId=${lathe.id}`);
assert.ok(Math.abs(Date.parse(blocks[0].endsAt) - Date.now()) < 60e3);
ok('done ends the breakdown block now: the real downtime');

// A second, older breakdown on the lathe for MTTR/MTBF (test-only: backdated).
const bd2 = await c.req('POST', '/maintenance/breakdowns', { machineId: lathe.id, symptom: 'Hydraulic leak', failedAt: daysAgo(2) }, 201);
await c.req('POST', `/maintenance/orders/${bd2.id}/done`, { cause: 'Fitting', action: 'Replaced fitting' }, 201);
psql(`update maintenance_order set done_at = failed_at + interval '1 hour' where id = '${bd2.id}'`);
const rep = await c.req('GET', '/maintenance/reports');
const lr = rep.machines.find((m) => m.machineCode === 'LATHE');
assert.equal(lr.breakdowns, 2);
assert.equal(lr.mttrHours, 2);
assert.equal(lr.mtbfHours, 1.25);
assert.equal(lr.labourCost, '3600.00');
assert.ok(lr.availability >= 0.98 && lr.availability < 1, String(lr.availability));
const vr = rep.machines.find((m) => m.machineCode === 'VMC');
assert.deepEqual([vr.preventive, vr.sparesCost, vr.labourCost], [1, '2500.00', '2700.00']);
ok('report: lathe MTTR 2 h (3 h and 1 h), MTBF 1.25 h, labour ₹3,600; VMC cost by machine');

// ── Cancel, operator, tap alarm, isolation ──
await fail('POST', `/maintenance/orders/${oLathe.id}/cancel`, { reason: 'No' }, 400, 'cancel needs a reason');
d = await c.req('POST', `/maintenance/orders/${oLathe.id}/cancel`, { reason: 'Lube system replaced; plan to be revised' }, 201);
assert.equal(d.status, 'cancelled');
await fail('POST', `/maintenance/orders/${oLathe.id}/results`, { itemId: d.checklist[0].id }, 409, 'a cancelled order is fixed', /cancelled/);
// The lathe plan retired: it leaves the due list but the plans page still lists it to reactivate.
await c.req('PUT', `/maintenance/plans/${pLathe.id}`, { name: 'Way lube check', everyRunHours: 2, items: [{ text: 'Top up way lube' }, { text: 'Check level glass' }], isActive: false });
assert.ok(!(await c.req('GET', '/maintenance/plans')).some((p) => p.id === pLathe.id));
assert.equal((await c.req('GET', '/maintenance/plans?all=1')).find((p) => p.id === pLathe.id).isActive, false);
ok('an inactive plan leaves the due list and stays on the plans page');
// An operator reports a breakdown but cannot work orders.
const op = await join('Line operator', 'Operator');
const opBd = await op.raw('POST', '/maintenance/breakdowns', { machineId: vmc.id, symptom: 'Coolant pump noisy' });
assert.equal(opBd.status, 201, JSON.stringify(opBd.data));
assert.equal((await op.raw('POST', `/maintenance/orders/${opBd.data.id}/done`, { cause: 'x', action: 'y' })).status, 403);
c.checks += 2;
ok('an operator reports a breakdown but does not close orders');
// Tap alarm suggestion on the machine page.
const edge = await c.req('POST', '/plant/edges', { code: 'NM1', name: 'Edge' }, 201);
await c.req('POST', '/plant/devices', { edgeId: edge.id, code: 'MT1-01', name: 'VMC tap', machineId: vmc.id }, 201);
const ev = (seq, state, minAgo) => ({ device: 'MT1-01', seq, state, at: new Date(Date.now() - minAgo * 60e3).toISOString() });
const ing = await fetch(`${API}/iot/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${edge.key}` }, body: JSON.stringify({ events: [ev(1, 'running', 30), ev(2, 'alarm', 15), ev(3, 'alarm', 14), ev(4, 'alarm', 1)] }) });
assert.equal(ing.status, 200);
const sum = await c.req('GET', `/maintenance/machines/${vmc.id}`);
assert.ok(Math.abs(Date.parse(sum.alarmSince) - (Date.now() - 15 * 60e3)) < 5000);
assert.equal(sum.open.length, 1);
assert.equal(sum.plans[0].due.runHoursSource, 'tap');
ok('the machine page shows the tap in alarm for 15 minutes, the open breakdown, and running hours from the tap');
await pause();
const outsider = await new Client().init('Elsewhere maintenance');
await fail('GET', `/maintenance/orders/${oVmc.id}`, undefined, 404, 'another tenant cannot read our orders', undefined, outsider);
await fail('POST', '/maintenance/breakdowns', { machineId: lathe.id, symptom: 'Not yours' }, 404, 'or report on our machines', undefined, outsider);

console.log(`\nMaintenance smoke passed (${c.checks + outsider.checks} request checks).`);
