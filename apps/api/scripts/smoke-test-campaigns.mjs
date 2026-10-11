// Phase 3c test campaigns (decision 057): a TVAC campaign quoted as a lump sum, accepted with its test steps, the
// payload received into custody (not stock), the chamber booked for the campaign (never billed by the hour), results
// recorded and signed off, an extra added, one draft invoice, the payload returned on outward challans, closed;
// cancel rules and tenant isolation.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-test-campaigns.mjs
import assert from 'node:assert/strict';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Test campaigns');
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

await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/hsn-codes', { code: '998346', kind: 'sac', description: 'Technical testing and analysis services', gstRate: '18', effectiveFrom: '2017-07-01' }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const tvac = await c.req('POST', '/items', { code: 'TEST-TVAC', name: 'Thermal vacuum testing', type: 'service', stockUomId: u('NOS'), hsnCode: '998346' }, 201);
const bar = await c.req('POST', '/items', { code: 'AL6061', name: 'Aluminium bar', type: 'raw_material', tracking: 'none', stockUomId: u('KG'), hsnCode: '76042910' }, 201);
await c.req('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) }, 201);
const env = await c.req('POST', '/manufacturing/work-centres', { code: 'ENV', name: 'Environmental test', hourlyRate: '3000' }, 201);
const chamber = await c.req('POST', `/manufacturing/work-centres/${env.id}/machines`, { code: 'TVAC-1', name: 'Thermal vacuum chamber' }, 201);
const sat = await c.req('POST', '/parties', { code: 'ORBIT', name: 'Orbit Sat Pvt Ltd', isCustomer: true, gstin: gstin('27AABCO1234B1Z') }, 201);
const other = await c.req('POST', '/parties', { code: 'OTHER', name: 'Other Space LLP', isCustomer: true, gstin: gstin('27AAFFO1234B1Z') }, 201);

// ── Campaign, steps, accept ──
const draft = { customerId: sat.id, title: 'TVAC qualification of 6U bus', scope: '8 thermal cycles, -40 °C to +80 °C at 1e-5 mbar', customerRef: 'PO-ORB-117', serviceItemId: tvac.id, quotedAmount: '450000' };
await fail('POST', '/services/campaigns', { ...draft, serviceItemId: bar.id }, 400, 'a campaign is billed as a service item', /not a service item/);
const tc = await c.req('POST', '/services/campaigns', draft, 201);
assert.match(tc.number, /\/TC\//);
assert.equal(tc.status, 'draft');
await fail('POST', `/services/campaigns/${tc.id}/accept`, {}, 400, 'a campaign needs its test steps before it is accepted', /test steps/);
const s1 = await c.req('POST', `/services/campaigns/${tc.id}/steps`, { name: 'Pump-down', requirement: '≤ 1e-5 mbar within 4 h' }, 201);
const s2 = await c.req('POST', `/services/campaigns/${tc.id}/steps`, { name: 'Thermal cycling', requirement: '8 cycles, dwell 2 h at each extreme' }, 201);
const s3 = await c.req('POST', `/services/campaigns/${tc.id}/steps`, { name: 'Functional test after cycling', requirement: 'All telemetry nominal' }, 201);
assert.deepEqual([s1.seq, s2.seq, s3.seq], [10, 20, 30]);
await fail('POST', `/services/campaigns/${tc.id}/steps`, { name: 'Dup', seq: 20 }, 409, 'step numbers are unique', /already exists/);
await fail('POST', `/services/steps/${s1.id}/result`, { result: 'pass' }, 409, 'results wait for acceptance', /Accept the campaign/);
await fail('POST', `/services/campaigns/${tc.id}/custody`, { description: 'Bus', inwardChallanNo: '1', receivedCondition: 'Good' }, 409, 'the payload is received once accepted', /Accept the campaign/);
await c.req('POST', `/services/campaigns/${tc.id}/accept`, {}, 201);
ok('a campaign with three steps is accepted');

// ── Custody ──
await fail('POST', `/services/campaigns/${tc.id}/custody`, { description: '6U satellite bus', receivedCondition: 'Sealed crate' }, 400, 'custody needs the customer’s inward challan');
const p1 = await c.req('POST', `/services/campaigns/${tc.id}/custody`, { description: '6U satellite bus (flight model)', serialNo: 'ORB-FM-01', inwardChallanNo: 'ORB/DC/0042', receivedCondition: 'Crate sealed, shock indicator not tripped' }, 201);
const p2 = await c.req('POST', `/services/campaigns/${tc.id}/custody`, { description: 'Test harness', qty: 2, inwardChallanNo: 'ORB/DC/0042', receivedCondition: 'Good' }, 201);
let d = await c.req('GET', `/services/campaigns/${tc.id}`);
assert.equal(d.inCustody, 2);
assert.equal(d.custody[0].serialNo, 'ORB-FM-01');
ok('the payload and harness are held in custody against the customer’s challan, outside stock');

// ── Chamber booking ──
await fail('POST', '/services/bookings', { customerId: other.id, machineId: chamber.id, startsAt: at(2), endsAt: at(50), campaignId: tc.id }, 400, 'a campaign booking is for the campaign’s customer', /another customer/);
const bk = await c.req('POST', '/services/bookings', { customerId: sat.id, machineId: chamber.id, startsAt: at(2), endsAt: at(50), purpose: 'TVAC campaign', campaignId: tc.id }, 201);
await c.req('POST', `/services/bookings/${bk.id}/confirm`, {}, 201);
await c.req('POST', `/services/bookings/${bk.id}/start`, {}, 201);
await c.req('POST', `/services/bookings/${bk.id}/stop`, {}, 201);
const bd = await c.req('GET', `/services/bookings/${bk.id}`);
assert.deepEqual([bd.campaignNumber, bd.billable], [tc.number, false]);
await fail('POST', `/services/bookings/${bk.id}/bill`, {}, 409, 'a campaign’s chamber booking is never billed by the hour', /Billed with test campaign/);
await fail('PUT', `/services/bookings/${bk.id}`, { customerId: other.id, machineId: chamber.id, startsAt: at(2), endsAt: at(50) }, 409, 'a completed campaign booking can’t move to another customer');
assert.deepEqual((await c.req('GET', `/services/campaigns/${tc.id}`)).bookings.map((b) => b.number), [bk.number]);
ok('the chamber booking is listed on the campaign');

// ── Results and sign-off ──
await fail('POST', `/services/campaigns/${tc.id}/invoice`, {}, 409, 'no invoice before the report is approved', /report is approved/);
await c.req('POST', `/services/steps/${s1.id}/result`, { result: 'pass', measured: '7.8e-6 mbar at 3 h 10 min' }, 201);
await c.req('POST', `/services/steps/${s2.id}/result`, { result: 'pass', measured: '8 cycles, -40.6 / +80.3 °C' }, 201);
await fail('POST', `/services/campaigns/${tc.id}/approve`, { summary: 'All good' }, 400, 'every step needs a result before sign-off', /1 step has no result/);
await c.req('POST', `/services/steps/${s3.id}/result`, { result: 'fail', measured: 'EPS bus voltage 7.1 V', notes: 'Below 7.4 V spec after cycle 6' }, 201);
await fail('POST', `/services/campaigns/${tc.id}/approve`, {}, 400, 'the report needs a summary');
await c.req('POST', `/services/campaigns/${tc.id}/approve`, { summary: 'Pump-down and cycling met spec; functional test failed on EPS voltage (see step 30).' }, 201);
d = await c.req('GET', `/services/campaigns/${tc.id}`);
assert.equal(d.status, 'reported');
assert.ok(d.reportApprovedAt && d.approvedByName);
assert.deepEqual(d.steps.map((s) => s.result), ['pass', 'pass', 'fail']);
ok('the report is signed off with results per step and a summary');
await fail('POST', `/services/steps/${s3.id}/result`, { result: 'pass' }, 409, 'results are frozen once approved', /frozen/);
await fail('POST', `/services/campaigns/${tc.id}/steps`, { name: 'Late step' }, 409, 'steps are frozen once approved', /frozen/);

// ── Extras, invoice, return, close ──
const ex = await c.req('POST', `/services/campaigns/${tc.id}/extras`, { description: 'Additional chamber time (re-test after EPS fix)', qty: '8', rate: '5000' }, 201);
d = await c.req('GET', `/services/campaigns/${tc.id}`);
assert.equal(d.totalAmount, '490000.00');
const r = await c.req('POST', `/services/campaigns/${tc.id}/invoice`, {}, 201);
const inv = await c.req('GET', `/sales-invoices/${r.invoiceId}`);
assert.equal(inv.status, 'draft');
assert.equal(inv.customerPoNo, 'PO-ORB-117');
assert.deepEqual(inv.lines.map((l) => [Number(l.qty), Number(l.rate)]), [[1, 450000], [8, 5000]]);
assert.match(inv.lines[0].description, new RegExp(`TVAC qualification of 6U bus \\(campaign ${tc.number.replace(/\//g, '\\/')}, your ref PO-ORB-117\\)`));
ok('one draft invoice carries the quoted amount and the extra');
await fail('POST', `/services/campaigns/${tc.id}/invoice`, {}, 409, 'a campaign is invoiced once', /Already invoiced/);
await fail('DELETE', `/services/extras/${ex.id}`, undefined, 409, 'extras are fixed once invoiced', /fixed/);
await fail('POST', `/services/campaigns/${tc.id}/close`, {}, 409, 'a campaign closes only when the payload is back', /still in custody/);
const ret = await c.req('POST', `/services/custody/${p1.id}/return`, { returnCondition: 'Repacked in original crate, indicator intact' }, 201);
assert.match(ret.outwardChallanNo, /\/RDC\//);
await fail('POST', `/services/custody/${p1.id}/return`, { returnCondition: 'again' }, 409, 'an item is returned once', /Already returned/);
await c.req('POST', `/services/custody/${p2.id}/return`, { returnCondition: 'Good' }, 201);
ok('the payload goes back on outward challans with its condition');
await c.req('POST', `/services/campaigns/${tc.id}/close`, {}, 201);
d = await c.req('GET', `/services/campaigns/${tc.id}`);
assert.deepEqual([d.status, d.inCustody], ['closed', 0]);
ok('the campaign is closed once invoiced and returned');
await fail('POST', `/services/campaigns/${tc.id}/cancel`, { reason: 'late' }, 409, 'a closed campaign can’t be cancelled', /closed campaign/);

// ── Cancel ──
const tc2 = await c.req('POST', '/services/campaigns', { ...draft, title: 'Vibration survey' }, 201);
await c.req('POST', `/services/campaigns/${tc2.id}/steps`, { name: 'Sine sweep' }, 201);
await c.req('POST', `/services/campaigns/${tc2.id}/accept`, {}, 201);
const p3 = await c.req('POST', `/services/campaigns/${tc2.id}/custody`, { description: 'Bracket', inwardChallanNo: 'ORB/DC/0050', receivedCondition: 'Good' }, 201);
await fail('POST', `/services/campaigns/${tc2.id}/cancel`, { reason: 'Customer withdrew' }, 409, 'a campaign holding goods can’t be cancelled', /Return the payload/);
await c.req('POST', `/services/custody/${p3.id}/return`, { returnCondition: 'Unused' }, 201);
const bk2 = await c.req('POST', '/services/bookings', { customerId: sat.id, machineId: chamber.id, startsAt: at(70), endsAt: at(72), campaignId: tc2.id }, 201);
await c.req('POST', `/services/bookings/${bk2.id}/confirm`, {}, 201);
await fail('POST', `/services/campaigns/${tc2.id}/cancel`, { reason: 'Customer withdrew' }, 409, 'a campaign with an open chamber booking can’t end', /still confirmed/);
await c.req('POST', `/services/bookings/${bk2.id}/cancel`, { reason: 'Campaign withdrawn' }, 201);
await c.req('POST', `/services/campaigns/${tc2.id}/cancel`, { reason: 'Customer withdrew' }, 201);
await fail('POST', '/services/bookings', { customerId: sat.id, machineId: chamber.id, startsAt: at(60), endsAt: at(62), campaignId: tc2.id }, 409, 'a cancelled campaign takes no bookings', /cancelled/);
const list = await c.req('GET', '/services/campaigns');
assert.deepEqual(list.map((x) => x.status).sort(), ['cancelled', 'closed']);

const stranger = await new Client().init('Test campaigns other');
assert.equal((await stranger.raw('GET', `/services/campaigns/${tc.id}`)).status, 404);
assert.equal((await stranger.req('GET', '/services/campaigns')).length, 0);
c.checks++;
ok('another tenant neither sees nor opens campaigns');

console.log(`\nTest campaigns smoke passed (${c.checks} request checks).`);
