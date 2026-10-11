// Phase 3a machine-hour MaaS (decision 055): rate cards with standard/member rates, minimum and rounding; bookings
// tentative → confirmed (a `booking` machine block the scheduler plans around, refused over maintenance, another
// booking or pinned production) → in use → completed; usage by timer and by hand (append-only, corrections); a draft
// tax invoice at the rate card through the sales invoice path, once per booking; tenant isolation.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-maas.mjs
import assert from 'node:assert/strict';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('MaaS');
const fail = async (method, path, body, status, label, pattern) => {
  const r = await c.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const HOUR = 3600e3;
// Whole quarter hours from now, so spans line up with the Gantt's snap.
const base = Math.ceil(Date.now() / (15 * 60e3)) * 15 * 60e3;
const at = (h) => new Date(base + h * HOUR).toISOString();
const istDate = (offsetDays) => new Date(Date.now() + 5.5 * HOUR + offsetDays * 86400e3).toISOString().slice(0, 10);

await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
await c.req('POST', '/hsn-codes', { code: '998898', kind: 'sac', description: 'Other manufacturing services', gstRate: '18', effectiveFrom: '2017-07-01' }, 201);
const svc = await c.req('POST', '/items', { code: 'MAAS-5AX', name: '5-axis machine time', type: 'service', stockUomId: u('HR'), hsnCode: '998898' }, 201);
const bar = await c.req('POST', '/items', { code: 'AL6061', name: 'Aluminium bar', type: 'raw_material', tracking: 'none', stockUomId: u('KG'), hsnCode: '76042910' }, 201);
const part = await c.req('POST', '/items', { code: 'BRKT', name: 'Bracket', type: 'finished_good', tracking: 'none', stockUomId: u('NOS'), hsnCode: '88073000' }, 201);
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const fg = await c.req('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' }, 201);
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' }, 201);
const m1 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M03', name: 'Variaxis 5-axis' }, 201);
const m2 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M04', name: 'VMC' }, 201);
const startup = await c.req('POST', '/parties', { code: 'ORBIT', name: 'Orbit Startup Pvt Ltd', isCustomer: true, gstin: gstin('27AABCO1234B1Z') }, 201);
const member = await c.req('POST', '/parties', { code: 'STUDIO', name: 'Studio Member LLP', isCustomer: true, gstin: gstin('27AAFFS1234B1Z'), maasMember: true }, 201);
assert.equal((await c.req('GET', `/parties/${member.id}`)).maasMember, true);
ok('a customer can be marked as a studio member');

// ── Rate cards ──
const card = { machineId: m1.id, serviceItemId: svc.id, standardRate: '2500', memberRate: '2000', minimumMinutes: 120, roundingMinutes: 15, validFrom: istDate(-30) };
await fail('POST', '/services/rate-cards', { ...card, roundingMinutes: 7 }, 400, 'rounding must give exact hours', /Rounding/);
await fail('POST', '/services/rate-cards', { ...card, minimumMinutes: 100 }, 400, 'the minimum is a multiple of the rounding', /multiple/);
await fail('POST', '/services/rate-cards', { ...card, serviceItemId: bar.id }, 400, 'machine time is billed as a service item', /not a service item/);
const rc = await c.req('POST', '/services/rate-cards', card, 201);
await fail('POST', '/services/rate-cards', { ...card, validFrom: istDate(10) }, 409, 'a second card over the same dates is refused', /covers these dates/);
await c.req('POST', `/services/rate-cards/${rc.id}/end`, { validTo: istDate(60) }, 201);
await c.req('POST', '/services/rate-cards', { ...card, standardRate: '2750', memberRate: null, validFrom: istDate(61) }, 201);
assert.equal((await c.req('GET', '/services/rate-cards')).length, 2);
ok('ending a card lets the next price start the day after');

// ── Production with a pinned operation on M03 ──
const bom = await c.req('POST', '/manufacturing/boms', { itemId: part.id, revision: 'A', materials: [{ itemId: bar.id, qty: '0.5' }], operations: [{ seq: 10, name: 'Mill', workCentreId: cnc.id, runMinutesPerUnit: '120' }] }, 201);
await c.req('POST', `/manufacturing/boms/${bom.id}/activate`, {}, 201);
const draft = await c.req('POST', '/manufacturing/work-orders', { itemId: part.id, plannedQty: '1', sourceWarehouseId: sto.id, targetWarehouseId: fg.id }, 201);
const wo = await c.req('POST', `/manufacturing/work-orders/${draft.id}/release`, {}, 201);
let s = await c.req('POST', '/manufacturing/schedule/run', {}, 201);
await c.req('POST', '/manufacturing/schedule/move', { operationId: wo.operations[0].id, machineId: m1.id, start: at(30), runId: s.run.id }, 201);

// ── Bookings ──
await fail('POST', '/services/bookings', { customerId: startup.id, machineId: m1.id, startsAt: at(-5), endsAt: at(-1) }, 400, 'a booking in the past is refused', /past/);
await fail('POST', '/services/bookings', { customerId: startup.id, machineId: m1.id, startsAt: at(5), endsAt: at(4) }, 400, 'a booking must end after it starts', /end after/);
const b1 = await c.req('POST', '/services/bookings', { customerId: startup.id, machineId: m1.id, startsAt: at(2), endsAt: at(8), purpose: 'Bracket prototypes, own CAM' }, 201);
assert.match(b1.number, /\/MB\//);
assert.equal(b1.status, 'tentative');
s = await c.req('GET', '/manufacturing/schedule');
assert.equal(s.stale, false);
assert.equal(s.bookings.find((b) => b.id === b1.id).status, 'tentative');
assert.equal(s.blocks.filter((x) => x.kind === 'booking').length, 0);
ok('a tentative booking shows on the schedule without reserving the machine or making it out of date');
await fail('POST', `/services/bookings/${b1.id}/start`, {}, 409, 'a tentative booking can’t be started', /Confirm the booking/);

await c.req('POST', `/services/bookings/${b1.id}/confirm`, {}, 201);
s = await c.req('GET', '/manufacturing/schedule');
const blk = s.blocks.find((x) => x.kind === 'booking');
assert.equal(blk.machineId, m1.id);
assert.match(blk.reason, new RegExp(`Booking ${b1.number} · Orbit Startup`));
assert.equal(s.stale, true);
ok('confirming reserves the machine as a booking block and marks the schedule out of date');
s = await c.req('POST', '/manufacturing/schedule/run', {}, 201);
const t1 = Date.parse(at(2)),
  t2 = Date.parse(at(8));
assert.ok(s.bars.filter((b) => b.machineId === m1.id && !b.pinned).every((b) => Date.parse(b.endsAt) <= t1 || Date.parse(b.startsAt) >= t2));
ok('the next Reschedule plans production around the booking');
await fail('PUT', `/manufacturing/machine-blocks/${blk.id}`, { machineId: m1.id, kind: 'maintenance', startsAt: at(2), endsAt: at(3), reason: 'hijack' }, 409, 'the booking block is changed only from the booking', /from the booking/);

const b2 = await c.req('POST', '/services/bookings', { customerId: member.id, machineId: m1.id, startsAt: at(7), endsAt: at(9) }, 201);
await fail('POST', `/services/bookings/${b2.id}/confirm`, {}, 409, 'a booking over another confirmed booking is refused', new RegExp(`Overlaps Booking ${b1.number.replace(/\//g, '\\/')}`));
await c.req('POST', '/manufacturing/machine-blocks', { machineId: m1.id, kind: 'maintenance', startsAt: at(20), endsAt: at(22), reason: 'Spindle service' }, 201);
await c.req('PUT', `/services/bookings/${b2.id}`, { customerId: member.id, machineId: m1.id, startsAt: at(21), endsAt: at(23) }, 200);
await fail('POST', `/services/bookings/${b2.id}/confirm`, {}, 409, 'a booking over maintenance is refused', /maintenance/);
await c.req('PUT', `/services/bookings/${b2.id}`, { customerId: member.id, machineId: m1.id, startsAt: at(30), endsAt: at(31) }, 200);
await fail('POST', `/services/bookings/${b2.id}/confirm`, {}, 409, 'a booking over pinned production is refused', /pinned/);
await c.req('PUT', `/services/bookings/${b2.id}`, { customerId: member.id, machineId: m2.id, startsAt: at(30), endsAt: at(31) }, 200);
await c.req('POST', `/services/bookings/${b2.id}/confirm`, {}, 201);
await fail('PUT', `/services/bookings/${b2.id}`, { customerId: member.id, machineId: m1.id, startsAt: at(7), endsAt: at(9) }, 409, 'moving a confirmed booking re-checks clashes', /Overlaps/);
ok('a booking moved to M04 confirms there');

// ── Usage and billing ──
await c.req('POST', `/services/bookings/${b1.id}/start`, {}, 201);
let d = await c.req('GET', `/services/bookings/${b1.id}`);
assert.equal(d.status, 'in_use');
const stop = await c.req('POST', `/services/bookings/${b1.id}/stop`, {}, 201);
assert.equal(stop.minutes, 0);
d = await c.req('GET', `/services/bookings/${b1.id}`);
assert.equal(d.status, 'completed');
assert.equal(d.machineBlockId, null);
assert.equal((await c.req('GET', '/manufacturing/schedule')).blocks.filter((x) => x.kind === 'booking' && x.machineId === m1.id).length, 0);
ok('stopping before the reserved time began completes the booking and frees the machine');
await fail('POST', `/services/bookings/${b1.id}/usage`, { minutes: 300 }, 400, 'manual usage needs a note');
await c.req('POST', `/services/bookings/${b1.id}/usage`, { minutes: 330, note: 'Timer not used; operator log sheet' }, 201);
await fail('POST', `/services/bookings/${b1.id}/usage`, { minutes: -400, note: 'wrong' }, 400, 'a correction can’t take usage below zero', /Only 330 minutes/);
await c.req('POST', `/services/bookings/${b1.id}/usage`, { minutes: -6, note: 'Setup counted twice' }, 201);
d = await c.req('GET', `/services/bookings/${b1.id}`);
assert.equal(d.usedMinutes, 324);
assert.deepEqual(d.charge, { actualMinutes: 324, billableMinutes: 330, hours: '5.50', rate: '2500.00', amount: '13750.00', memberRate: false });
assert.equal(d.billable, true);
ok('324 minutes used bill as 5.5 h at the standard rate (15-minute rounding)');

const inv = await c.req('POST', `/services/bookings/${b1.id}/invoice`, {}, 201);
const si = await c.req('GET', `/sales-invoices/${inv.invoiceId}`);
assert.equal(si.status, 'draft');
assert.equal(si.customerId, startup.id);
assert.equal(si.lines.length, 1);
assert.equal(Number(si.lines[0].qty), 5.5);
assert.equal(Number(si.lines[0].rate), 2500);
assert.match(si.lines[0].description, /324 min used, 330 min billed/);
ok('a draft tax invoice is raised through the sales invoice path');
d = await c.req('GET', `/services/bookings/${b1.id}`);
assert.equal(d.invoiceStatus, 'draft');
assert.equal(d.billable, false);
await fail('POST', `/services/bookings/${b1.id}/invoice`, {}, 409, 'a booking is invoiced once', /Already invoiced/);
await fail('POST', `/services/bookings/${b1.id}/usage`, { minutes: 10, note: 'late entry' }, 409, 'usage is frozen while invoiced', /invoiced/);
await c.req('DELETE', `/sales-invoices/${inv.invoiceId}`, undefined, 200);
d = await c.req('GET', `/services/bookings/${b1.id}`);
assert.equal(d.salesInvoiceId, null);
assert.equal(d.billable, true);
ok('deleting the draft invoice frees the booking');

const b3 = await c.req('POST', '/services/bookings', { customerId: member.id, machineId: m1.id, startsAt: at(40), endsAt: at(41) }, 201);
await c.req('POST', `/services/bookings/${b3.id}/confirm`, {}, 201);
await c.req('POST', `/services/bookings/${b3.id}/start`, {}, 201);
await c.req('POST', `/services/bookings/${b3.id}/stop`, {}, 201);
await c.req('POST', `/services/bookings/${b3.id}/usage`, { minutes: 50, note: 'Probe calibration only' }, 201);
d = await c.req('GET', `/services/bookings/${b3.id}`);
assert.deepEqual([d.charge.billableMinutes, d.charge.hours, d.charge.rate, d.charge.amount], [120, '2.00', '2000.00', '4000.00']);
await c.req('POST', `/services/bookings/${b3.id}/invoice`, {}, 201);
s = await c.req('POST', '/manufacturing/schedule/run', {}, 201);
const b5 = await c.req('POST', '/services/bookings', { customerId: startup.id, machineId: m2.id, startsAt: at(60), endsAt: at(61) }, 201);
await c.req('POST', `/services/bookings/${b5.id}/confirm`, {}, 201);
await c.req('POST', `/services/bookings/${b5.id}/cancel`, { reason: 'Customer postponed' }, 201);
s = await c.req('POST', '/manufacturing/schedule/run', {}, 201);
await c.req('DELETE', `/sales-invoices/${(await c.req('GET', `/services/bookings/${b3.id}`)).salesInvoiceId}`, undefined, 200);
await c.req('POST', `/services/bookings/${b3.id}/invoice`, {}, 201);
assert.equal((await c.req('GET', '/manufacturing/schedule')).stale, false);
ok('invoicing a booking doesn’t mark the schedule out of date');
ok('a member pays the member rate, and short use bills the 2-hour minimum');

// ── Cancel and isolation ──
const b4 = await c.req('POST', '/services/bookings', { customerId: startup.id, machineId: m1.id, startsAt: at(50), endsAt: at(52) }, 201);
await c.req('POST', `/services/bookings/${b4.id}/confirm`, {}, 201);
await fail('POST', `/services/bookings/${b4.id}/cancel`, {}, 400, 'cancelling needs a reason');
await c.req('POST', `/services/bookings/${b4.id}/cancel`, { reason: 'Customer postponed' }, 201);
assert.equal((await c.req('GET', '/manufacturing/schedule')).blocks.filter((x) => x.kind === 'booking' && x.machineId === m1.id).length, 0);
await fail('POST', `/services/bookings/${b1.id}/cancel`, { reason: 'too late' }, 409, 'a completed booking can’t be cancelled', /completed/);
ok('cancelling a confirmed booking releases the machine');
const list = await c.req('GET', `/services/bookings?machineId=${m1.id}`);
assert.deepEqual(list.map((b) => b.number), [b1.number, b3.number, b4.number]);
assert.equal(list.find((b) => b.id === b1.id).usedMinutes, 324);

const other = await new Client().init('MaaS other');
assert.equal((await other.raw('GET', `/services/bookings/${b1.id}`)).status, 404);
assert.equal((await other.req('GET', '/services/bookings')).length, 0);
c.checks++;
ok('another tenant neither sees nor opens the bookings');

console.log(`\nMaaS smoke passed (${c.checks} request checks).`);
