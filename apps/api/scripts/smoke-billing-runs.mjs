// Phase 3f billing runs (decision 060): a subscription, a test campaign and a project milestone under one customer PO
// become one draft invoice; a booking of the same customer without a PO another; a booking covered by membership hours
// is settled without an invoice; a booking with no rate card is skipped; Submit all submits what passes the normal checks
// and leaves a customer over its credit limit as a draft; concurrent runs don't double-bill; tenant isolation.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-billing-runs.mjs
import assert from 'node:assert/strict';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Billing runs');
const fail = async (method, path, body, status, label, pattern, who = c) => {
  const r = await who.raw(method, path, body);
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
const today = istDate(0);

// ── Masters ──
await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/hsn-codes', { code: '998898', kind: 'sac', description: 'Other manufacturing services', gstRate: '18', effectiveFrom: '2017-07-01' }, 201);
await c.req('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const svc = await c.req('POST', '/items', { code: 'SVC', name: 'Engineering services', type: 'service', stockUomId: u('NOS'), hsnCode: '998898' }, 201);
const hours = await c.req('POST', '/items', { code: 'MAAS', name: 'Machine time', type: 'service', stockUomId: u('HR'), hsnCode: '998898' }, 201);
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' }, 201);
const m1 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M03', name: 'Variaxis 5-axis' }, 201);
const m2 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M04', name: 'Lathe without rate card' }, 201);
await c.req('POST', '/services/rate-cards', { machineId: m1.id, serviceItemId: hours.id, standardRate: '2500', memberRate: '2000', minimumMinutes: 60, roundingMinutes: 15, validFrom: istDate(-800) }, 201);
const party = (code, name, g, o = {}) => c.req('POST', '/parties', { code, name, isCustomer: true, gstin: gstin(g), ...o }, 201);
const orbit = await party('ORBIT', 'Orbit Space Pvt Ltd', '27AABCO1234B1Z');
const lab = await party('LAB', 'Lab Works LLP', '27AAFFL1234B1Z');
const tight = await party('TIGHT', 'Tight Credit Pvt Ltd', '27AABCT1234B1Z', { creditLimit: '1000' });

// ── Sources ──
let slot = 0;
const booking = async (customer, machine, minutes) => {
  slot += 3;
  const b = await c.req('POST', '/services/bookings', { customerId: customer.id, machineId: machine.id, startsAt: at(slot), endsAt: at(slot + 2) }, 201);
  for (const a of ['confirm', 'start', 'stop']) await c.req('POST', `/services/bookings/${b.id}/${a}`, {}, 201);
  await c.req('POST', `/services/bookings/${b.id}/usage`, { minutes, note: 'Log sheet' }, 201);
  return b;
};
const bOrbit = await booking(orbit, m1, 120);
const plan = await c.req('POST', '/services/plans', { code: 'STUDIO-10', name: 'Studio 10 hours', includedHours: 10, termMonths: 12, fee: '0', serviceItemId: hours.id }, 201);
await c.req('POST', '/services/memberships', { customerId: lab.id, planId: plan.id, startsOn: istDate(-1) }, 201);
const bLab = await booking(lab, m1, 90);
const bNoCard = await booking(orbit, m2, 60);
const bTight = await booking(tight, m1, 120);

const subPlan = await c.req('POST', '/services/subscription-plans', { code: 'CROP', name: 'Crop health', solution: 'Crop health', period: 'month', fee: '30000', includedReports: 4, includedAlerts: 10, reportRate: '5000', alertRate: '500', serviceItemId: svc.id }, 201);
const sub = await c.req('POST', '/services/subscriptions', { customerId: orbit.id, planId: subPlan.id, customerRef: 'PO-ORB-1', aoiName: 'Block A', startDate: today }, 201);

const tc = await c.req('POST', '/services/campaigns', { customerId: orbit.id, title: 'TVAC test', customerRef: 'PO-ORB-1', serviceItemId: svc.id, quotedAmount: '200000' }, 201);
await c.req('POST', `/services/campaigns/${tc.id}/steps`, { name: 'Pump-down' }, 201);
await c.req('POST', `/services/campaigns/${tc.id}/accept`, {}, 201);
const [step] = (await c.req('GET', `/services/campaigns/${tc.id}`)).steps;
await c.req('POST', `/services/steps/${step.id}/result`, { result: 'pass' }, 201);
await c.req('POST', `/services/campaigns/${tc.id}/approve`, { summary: 'Met the requirement' }, 201);

const prj = await c.req('POST', '/services/projects', { customerId: orbit.id, title: 'Payload structure', customerRef: 'PO-ORB-1', serviceItemId: svc.id, contractValue: '500000', retentionPct: '5', dlpMonths: 12 }, 201);
const ms = await c.req('POST', `/services/projects/${prj.id}/milestones`, { name: 'Design review', amount: '500000' }, 201);
await c.req('POST', `/services/projects/${prj.id}/activate`, {}, 201);
await c.req('POST', `/services/milestones/${ms.id}/achieve`, { acceptanceRef: 'MoM-1' }, 201);
ok('due: a booking each for three customers, a booking without a rate card, a subscription, a campaign and a milestone');

// ── Preview ──
const pv = await c.req('GET', '/services/billing-runs/preview');
const key = (g) => `${g.customerName}|${g.customerRef ?? ''}`;
assert.deepEqual(pv.groups.map(key), ['Lab Works LLP|', 'Orbit Space Pvt Ltd|', 'Orbit Space Pvt Ltd|PO-ORB-1', 'Tight Credit Pvt Ltd|']);
const po = pv.groups.find((g) => g.customerRef === 'PO-ORB-1');
assert.deepEqual(po.items.map((i) => i.kind).sort(), ['campaign', 'milestone', 'subscription']);
assert.equal(po.amount, '730000.00');
assert.deepEqual([pv.skipped.length, /No rate card for M04/.test(pv.skipped[0].message)], [1, true]);
assert.equal(pv.groups.find((g) => g.customerName === 'Lab Works LLP').amount, '0.00');
ok('preview: four groups by customer and PO, the PO group carrying subscription, campaign and milestone; one booking skipped');
const onlySubs = await c.req('GET', '/services/billing-runs/preview?kinds=subscription');
assert.deepEqual(onlySubs.groups.map(key), ['Orbit Space Pvt Ltd|PO-ORB-1']);

// ── Run ──
await fail('POST', '/services/billing-runs', { asOf: istDate(1) }, 400, 'a run is not dated in the future', /future/);
const run = await c.req('POST', '/services/billing-runs', { asOf: today }, 201);
assert.match(run.number, /\/BR\//);
assert.deepEqual([run.invoices, run.failures], [3, 1]);
let r = await c.req('GET', `/services/billing-runs/${run.id}`);
assert.equal(r.invoices.length, 4);
const covered = r.invoices.find((i) => i.customerId === lab.id);
assert.deepEqual([covered.salesInvoiceId, covered.items[0].kind], [null, 'booking']);
assert.match(r.failures[0].message, /No rate card/);
const poInv = r.invoices.find((i) => i.customerRef === 'PO-ORB-1');
const inv = await c.req('GET', `/sales-invoices/${poInv.salesInvoiceId}`);
assert.deepEqual([inv.status, inv.customerPoNo, inv.remarks, inv.lines.length], ['draft', 'PO-ORB-1', `Billing run ${run.number}`, 3]);
assert.deepEqual(inv.lines.map((l) => Number(l.rate)), [30000, 500000, 200000]);
ok('one draft invoice for the PO group (subscription, milestone, campaign, in that order) and one per customer without a PO');
assert.equal((await c.req('GET', `/services/bookings/${bLab.id}`)).billed, true);
ok('the booking covered by membership hours is settled without an invoice');
await fail('POST', `/services/campaigns/${tc.id}/invoice`, {}, 409, 'the campaign is invoiced by the run', /Already invoiced/);
await fail('POST', `/services/subscriptions/${sub.id}/invoice`, {}, 409, 'the subscription’s period is invoiced by the run', /Nothing to invoice yet/);
const pd = await c.req('GET', `/services/projects/${prj.id}`);
assert.deepEqual([pd.revenue, pd.retention.length, pd.retention[0].amount], ['500000.00', 1, '29500.00']);
ok('retention is 5% of the milestone’s own line (₹5,90,000 with GST), not of the whole run invoice');

// ── Nothing left; concurrent runs ──
await fail('POST', '/services/billing-runs', {}, 400, 'nothing more to bill but the skipped booking', /Nothing can be billed: .*No rate card/);
const b2 = await booking(orbit, m1, 60);
const b3 = await booking(lab, m1, 60);
const race = await Promise.all([1, 2].map(() => c.raw('POST', '/services/billing-runs', { kinds: ['booking'] })));
const made = race.filter((x) => x.status === 201).reduce((t, x) => t + x.data.invoices, 0);
assert.equal(made, 1, JSON.stringify(race.map((x) => x.data)));
const d2 = await c.req('GET', `/services/bookings/${b2.id}`);
const d3 = await c.req('GET', `/services/bookings/${b3.id}`);
assert.deepEqual([d2.billed, d3.billed], [true, true]);
c.checks++;
ok('two runs at once bill each booking once');

// ── Submit all ──
const sa = await c.req('POST', `/services/billing-runs/${run.id}/submit`, {}, 201);
assert.deepEqual(sa, { submitted: 2, refused: 1 });
r = await c.req('GET', `/services/billing-runs/${run.id}`);
const t = r.invoices.find((i) => i.customerId === tight.id);
assert.deepEqual([t.invoiceStatus, /Credit check/.test(t.submitError)], ['draft', true]);
assert.equal(r.invoices.find((i) => i.customerRef === 'PO-ORB-1').invoiceStatus, 'submitted');
ok('Submit all submits two invoices; the one over its credit limit stays a draft with the reason');
const list = await c.req('GET', '/services/billing-runs');
assert.equal(list.find((x) => x.id === run.id).drafts, 1);
await c.req('POST', `/services/billing-runs/${run.id}/submit`, {}, 201);

// ── Isolation ──
const outsider = await new Client().init('Elsewhere');
await fail('GET', `/services/billing-runs/${run.id}`, undefined, 404, 'another tenant can’t see the run', undefined, outsider);
assert.deepEqual((await outsider.req('GET', '/services/billing-runs/preview')).groups, []);
ok('another tenant’s preview is empty');
await fail('POST', '/services/billing-runs/' + run.id + '/submit', {}, 404, 'another tenant can’t submit the run', undefined, outsider);

console.log(`\nBilling runs smoke passed (${c.checks} request checks).`);
