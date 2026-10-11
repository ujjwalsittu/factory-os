// Phase 3b studio memberships (decision 056): plans as a pool of machine-hours with a fee invoiced upfront; a
// membership makes its customer a member; billing a completed booking draws hours first and invoices only the excess
// at the member rate; reversal frees a booking (append-only draws); overlapping terms refused; expired or cancelled
// memberships don't cover; tenant isolation.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-maas-memberships.mjs
import assert from 'node:assert/strict';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('MaaS memberships');
const fail = async (method, path, body, status, label, pattern) => {
  const r = await c.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const HOUR = 3600e3;
const base = Math.ceil(Date.now() / (15 * 60e3)) * 15 * 60e3;
const at = (h) => new Date(base + h * HOUR).toISOString();
const istDate = (offsetDays) => new Date(Date.now() + 5.5 * HOUR + offsetDays * 86400e3).toISOString().slice(0, 10);

await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/hsn-codes', { code: '998898', kind: 'sac', description: 'Other manufacturing services', gstRate: '18', effectiveFrom: '2017-07-01' }, 201);
await c.req('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const svc = await c.req('POST', '/items', { code: 'MAAS-5AX', name: '5-axis machine time', type: 'service', stockUomId: u('HR'), hsnCode: '998898' }, 201);
const planItem = await c.req('POST', '/items', { code: 'STUDIO', name: 'Studio membership', type: 'service', stockUomId: u('NOS'), hsnCode: '998898' }, 201);
const bar = await c.req('POST', '/items', { code: 'AL6061', name: 'Aluminium bar', type: 'raw_material', tracking: 'none', stockUomId: u('KG'), hsnCode: '76042910' }, 201);
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' }, 201);
const m1 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M03', name: 'Variaxis 5-axis' }, 201);
const party = (code, name, g) => c.req('POST', '/parties', { code, name, isCustomer: true, gstin: gstin(g) }, 201);
const orbit = await party('ORBIT', 'Orbit Startup Pvt Ltd', '27AABCO1234B1Z');
const lab = await party('LAB', 'Lab Works LLP', '27AAFFL1234B1Z');
const old = await party('OLD', 'Old Member Pvt Ltd', '27AABCD1234B1Z');
await c.req('POST', '/services/rate-cards', { machineId: m1.id, serviceItemId: svc.id, standardRate: '2500', memberRate: '2000', minimumMinutes: 120, roundingMinutes: 15, validFrom: istDate(-800) }, 201);

// ── Plans and memberships ──
await fail('POST', '/services/plans', { code: 'X', name: 'Bad', includedHours: 10, termMonths: 12, fee: '1000', serviceItemId: bar.id }, 400, 'the plan fee is billed as a service item', /not a service item/);
const plan = await c.req('POST', '/services/plans', { code: 'STUDIO-10', name: 'Studio 10 hours', includedHours: 10, termMonths: 12, fee: '50000', serviceItemId: planItem.id }, 201);
assert.equal(plan.includedMinutes, 600);
await fail('POST', '/services/plans', { code: 'STUDIO-10', name: 'Again', includedHours: 5, termMonths: 6, fee: '1', serviceItemId: planItem.id }, 409, 'plan codes are unique', /already exists/);

const ms = await c.req('POST', '/services/memberships', { customerId: orbit.id, planId: plan.id, startsOn: istDate(-1) }, 201);
assert.match(ms.number, /\/MM\//);
assert.equal(ms.includedMinutes, 600);
const fee = await c.req('GET', `/sales-invoices/${ms.salesInvoiceId}`);
assert.equal(fee.status, 'draft');
assert.equal(fee.customerId, orbit.id);
assert.deepEqual([Number(fee.lines[0].qty), Number(fee.lines[0].rate)], [1, 50000]);
assert.match(fee.lines[0].description, /10 machine-hours/);
ok('a membership raises its fee as a draft tax invoice and runs for the plan term');
await fail('POST', '/services/memberships', { customerId: orbit.id, planId: plan.id, startsOn: istDate(100) }, 409, 'overlapping terms for one customer are refused', /already holds/);

// ── Bookings drawing hours ──
let slot = 0;
const used = async (customer, minutes) => {
  slot += 3;
  const b = await c.req('POST', '/services/bookings', { customerId: customer.id, machineId: m1.id, startsAt: at(slot), endsAt: at(slot + 2) }, 201);
  await c.req('POST', `/services/bookings/${b.id}/confirm`, {}, 201);
  await c.req('POST', `/services/bookings/${b.id}/start`, {}, 201);
  await c.req('POST', `/services/bookings/${b.id}/stop`, {}, 201);
  await c.req('POST', `/services/bookings/${b.id}/usage`, { minutes, note: 'Log sheet' }, 201);
  return b;
};

const b1 = await used(orbit, 324);
let d = await c.req('GET', `/services/bookings/${b1.id}`);
assert.equal(d.member, true);
assert.equal(d.membership.number, ms.number);
assert.deepEqual([d.split.coveredMinutes, d.split.overageMinutes], [330, 0]);
ok('the membership makes its holder a member and would cover the whole booking');
let r = await c.req('POST', `/services/bookings/${b1.id}/bill`, {}, 201);
assert.equal(r.invoiceId, null);
d = await c.req('GET', `/services/bookings/${b1.id}`);
assert.deepEqual([d.billed, d.billable, d.drawnMinutes], [true, false, 330]);
assert.equal((await c.req('GET', `/services/memberships/${ms.id}`)).remainingMinutes, 270);
ok('billing a covered booking draws 5.5 h from the membership and raises no invoice');
await fail('POST', `/services/bookings/${b1.id}/bill`, {}, 409, 'a booking is billed once', /Already billed to the membership/);
await fail('POST', `/services/bookings/${b1.id}/usage`, { minutes: 6, note: 'late' }, 409, 'usage is frozen once billed', /billed or invoiced/);

const b2 = await used(orbit, 330);
r = await c.req('POST', `/services/bookings/${b2.id}/bill`, {}, 201);
assert.deepEqual([r.coveredMinutes, r.overageMinutes, r.hours, r.rate, r.amount], [270, 60, '1.00', '2000.00', '2000.00']);
let inv = await c.req('GET', `/sales-invoices/${r.invoiceId}`);
assert.deepEqual([Number(inv.lines[0].qty), Number(inv.lines[0].rate)], [1, 2000]);
assert.match(inv.lines[0].description, new RegExp(`270 min from membership ${ms.number.replace(/\//g, '\\/')}, 60 min beyond it at member rate`));
assert.equal((await c.req('GET', `/services/memberships/${ms.id}`)).remainingMinutes, 0);
ok('the remaining 4.5 h are drawn and the excess hour is invoiced at the member rate');

const b3 = await used(orbit, 60);
d = await c.req('GET', `/services/bookings/${b3.id}`);
assert.deepEqual([d.split.coveredMinutes, d.split.overageMinutes, d.split.overageAmount], [0, 120, '4000.00']);
ok('with the pool empty, the 2-hour minimum is invoiced at the member rate');

// ── Reversal ──
await fail('POST', `/services/bookings/${b2.id}/unbill`, { reason: 'Wrong machine logged' }, 409, 'billing is reversed only after its invoice is deleted or cancelled', /invoice first/);
await c.req('DELETE', `/sales-invoices/${r.invoiceId}`, undefined, 200);
d = await c.req('GET', `/services/bookings/${b2.id}`);
assert.deepEqual([d.billed, d.drawnMinutes], [true, 270]);
await fail('POST', `/services/bookings/${b2.id}/bill`, {}, 409, 'hours stay drawn until the billing is reversed', /Already billed/);
await fail('POST', `/services/bookings/${b2.id}/unbill`, {}, 400, 'reversal needs a reason');
await c.req('POST', `/services/bookings/${b2.id}/unbill`, { reason: 'Wrong machine logged' }, 201);
d = await c.req('GET', `/services/bookings/${b2.id}`);
assert.deepEqual([d.billed, d.billable, d.drawnMinutes], [false, true, 0]);
let m = await c.req('GET', `/services/memberships/${ms.id}`);
assert.equal(m.remainingMinutes, 270);
assert.deepEqual(m.draws.map((x) => x.minutes), [330, 270, -270]);
ok('reversing frees the booking and returns its hours with a negative draw (append-only)');
await fail('POST', `/services/bookings/${b2.id}/unbill`, { reason: 'again' }, 409, 'a reversal is not repeated', /Nothing billed/);
r = await c.req('POST', `/services/bookings/${b2.id}/bill`, {}, 201);
assert.deepEqual([r.coveredMinutes, r.overageMinutes], [270, 60]);
ok('the booking bills again the same way');
await fail('POST', `/services/memberships/${ms.id}/cancel`, { reason: 'Customer left' }, 409, 'a membership with drawn hours can’t be cancelled', /already drawn/);

// ── Cancelled and expired memberships ──
const msLab = await c.req('POST', '/services/memberships', { customerId: lab.id, planId: plan.id, startsOn: istDate(0) }, 201);
await c.req('POST', `/services/memberships/${msLab.id}/cancel`, { reason: 'Signed up by mistake' }, 201);
const b4 = await used(lab, 324);
d = await c.req('GET', `/services/bookings/${b4.id}`);
assert.deepEqual([d.member, d.membership, d.charge.rate], [false, null, '2500.00']);
ok('a cancelled membership neither covers hours nor gives the member rate');
await c.req('POST', '/services/memberships', { customerId: old.id, planId: plan.id, startsOn: istDate(-400) }, 201);
const b5 = await used(old, 324);
d = await c.req('GET', `/services/bookings/${b5.id}`);
assert.deepEqual([d.member, d.membership, d.split.coveredMinutes, d.split.overageMinutes], [false, null, 0, 330]);
ok('hours of an expired term are not available to later bookings');
const list = await c.req('GET', '/services/memberships');
assert.equal(list.length, 3);
assert.equal(list.find((x) => x.id === ms.id).usedMinutes, 600);

const other = await new Client().init('MaaS memberships other');
assert.equal((await other.raw('GET', `/services/memberships/${ms.id}`)).status, 404);
assert.equal((await other.req('GET', '/services/plans')).length, 0);
c.checks++;
ok('another tenant neither sees nor opens memberships and plans');

console.log(`\nMaaS memberships smoke passed (${c.checks} request checks).`);
