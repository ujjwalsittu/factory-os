// Phase 3e EarthNow subscriptions (decision 059): a crop-health plan as a prepaid bundle of reports and alerts,
// a subscription back-dated two months, deliveries counted per period, each period's fee invoiced in advance with
// ended periods' overage, an upgrade prorated by days, a downgrade pending to the next period, cancel at period end,
// a free plan, and tenant isolation.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-subscriptions.mjs
import assert from 'node:assert/strict';
import { subscriptionPeriodEnd, subscriptionPeriodStart, subscriptionProration } from '../../../packages/core/dist/index.js';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Subscriptions');
const fail = async (method, path, body, status, label, pattern, who = c) => {
  const r = await who.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 86400e3));
const [ty, tm, td] = today.split('-').map(Number);
// Two months back, on a day every month has, so the periods line up with calendar arithmetic.
const day = Math.min(td, 28);
const start = new Date(Date.UTC(ty, tm - 3, day)).toISOString().slice(0, 10);
const P = (k) => subscriptionPeriodStart(start, 'month', k);
const E = (k) => subscriptionPeriodEnd(start, 'month', k);

// ── Masters ──
await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/hsn-codes', { code: '998399', kind: 'sac', description: 'Other professional, technical and business services', gstRate: '18', effectiveFrom: '2017-07-01' }, 201);
const uoms = await c.req('GET', '/uoms');
const nos = uoms.find((x) => x.code === 'NOS').id;
const svc = await c.req('POST', '/items', { code: 'SVC-EO', name: 'Earth observation analytics', type: 'service', stockUomId: nos, hsnCode: '998399' }, 201);
const bar = await c.req('POST', '/items', { code: 'AL6061', name: 'Aluminium bar', type: 'raw_material', tracking: 'none', stockUomId: uoms.find((x) => x.code === 'KG').id, hsnCode: '76042910' }, 201);
const agri = await c.req('POST', '/parties', { code: 'AGRI', name: 'Deccan Agri Co-op', isCustomer: true, gstin: gstin('27AAAAD1234B1Z') }, 201);

// ── Plans ──
const plan = (o) => ({ code: 'CROP-STD', name: 'Crop health standard', solution: 'Crop health', period: 'month', fee: '30000', includedReports: 4, includedAlerts: 10, reportRate: '5000', alertRate: '500', serviceItemId: svc.id, ...o });
await fail('POST', '/services/subscription-plans', plan({ serviceItemId: bar.id }), 400, 'a plan is billed as a service item', /not a service item/);
const std = await c.req('POST', '/services/subscription-plans', plan(), 201);
await fail('POST', '/services/subscription-plans', plan(), 409, 'plan codes are unique', /already exists/);
const pro = await c.req('POST', '/services/subscription-plans', plan({ code: 'CROP-PRO', name: 'Crop health pro', fee: '45000', includedReports: 8, includedAlerts: 30, reportRate: '4000', alertRate: '400' }), 201);
const qtr = await c.req('POST', '/services/subscription-plans', plan({ code: 'CROP-Q', name: 'Crop health quarterly', period: 'quarter', fee: '80000' }), 201);
const free = await c.req('POST', '/services/subscription-plans', plan({ code: 'ALERTS-ONLY', name: 'Alerts on demand', fee: '0', includedReports: 0, includedAlerts: 0, alertRate: '750' }), 201);
ok('plans: standard, pro, quarterly and a free alerts-only plan');

// ── Subscribe ──
const sub = { customerId: agri.id, planId: std.id, customerRef: 'DAC/PO/2026/44', aoiName: 'Nashik vineyards block A', aoiHectares: '1250', startDate: start };
await fail('POST', '/services/subscriptions', { ...sub, startDate: '2020-01-01' }, 400, 'a subscription starts at most a year back', /a year back/);
const s = await c.req('POST', '/services/subscriptions', sub, 201);
assert.match(s.number, /\/SUB\//);
await fail('POST', '/services/subscriptions', sub, 409, 'one active subscription per customer and AOI', /already subscribes/);
const race = await Promise.all([1, 2, 3].map(() => c.raw('POST', '/services/subscriptions', { ...sub, aoiName: 'Nashik vineyards block C' })));
assert.deepEqual(race.map((r) => r.status).sort(), [201, 409, 409], JSON.stringify(race.map((r) => r.data)));
assert.ok(race.filter((r) => r.status === 409).every((r) => /already subscribes/.test(JSON.stringify(r.data))));
c.checks++;
ok('three concurrent subscriptions for one AOI: one wins, the others get 409');
let d = await c.req('GET', `/services/subscriptions/${s.id}`);
assert.deepEqual(d.periods.map((p) => p.start).slice(0, 3), [P(0), P(1), P(2)]);
assert.deepEqual([d.next.start, d.next.due], [P(0), true]);
ok(`a back-dated monthly subscription from ${start}: periods anchored on the start date, the first fee due`);

// ── Deliveries ──
const deliver = (kind, deliveredOn, title) => c.req('POST', `/services/subscriptions/${s.id}/deliveries`, { kind, deliveredOn, title }, 201);
await fail('POST', `/services/subscriptions/${s.id}/deliveries`, { kind: 'report', deliveredOn: tomorrow, title: 'Future' }, 400, 'no deliveries dated in the future', /future/);
const before = new Date(Date.parse(`${start}T00:00:00Z`) - 86400e3).toISOString().slice(0, 10);
await fail('POST', `/services/subscriptions/${s.id}/deliveries`, { kind: 'report', deliveredOn: before, title: 'Too early' }, 400, 'no deliveries before the start', /starts on/);
const d0 = [];
for (let i = 1; i <= 6; i++) d0.push(await deliver('report', P(0), `Weekly crop health report ${i}`));
for (let i = 1; i <= 11; i++) await deliver('alert', E(0), `Water stress alert ${i}`);
for (let i = 1; i <= 5; i++) await deliver('report', P(1), `Weekly crop health report ${6 + i}`);
d = await c.req('GET', `/services/subscriptions/${s.id}`);
assert.deepEqual([d.periods[0].reports, d.periods[0].alerts, d.periods[0].overageReports, d.periods[0].overageAlerts, d.periods[0].overageAmount], [6, 11, 2, 1, '10500.00']);
ok('6 reports and 11 alerts against a 4 + 10 bundle: 2 reports and 1 alert over, ₹10,500');

// ── Invoicing ──
const invoice = async () => {
  const r = await c.req('POST', `/services/subscriptions/${s.id}/invoice`, {}, 201);
  return c.req('GET', `/sales-invoices/${r.invoiceId}`);
};
let inv = await invoice();
assert.deepEqual(inv.lines.map((l) => Number(l.rate)), [30000, 10500, 5000]);
assert.equal(inv.customerPoNo, 'DAC/PO/2026/44');
assert.match(inv.lines[0].description, new RegExp(`${P(0)} to ${E(0)}`));
assert.match(inv.lines[1].description, /2 reports and 1 alert/);
assert.match(inv.lines[2].description, new RegExp(`${P(1)} to ${E(1)}: 1 report`));
ok('first invoice: the first period’s fee in advance, and the overage of both ended periods');
await fail('POST', `/services/subscriptions/${s.id}/deliveries`, { kind: 'report', deliveredOn: P(0), title: 'Late report' }, 409, 'a period’s deliveries are fixed once its overage is invoiced', /already invoiced/);
await fail('POST', `/services/subscription-deliveries/${d0[0].id}/reverse`, { reason: 'Duplicate' }, 409, 'nor can they be reversed', /already invoiced/);
inv = await invoice();
assert.deepEqual(inv.lines.map((l) => [l.description.includes(P(1)), Number(l.rate)]), [[true, 30000]]);
ok('second invoice: the next period’s fee alone');
inv = await invoice();
assert.deepEqual(inv.lines.map((l) => [l.description.includes(P(2)), Number(l.rate)]), [[true, 30000]]);
await fail('POST', `/services/subscriptions/${s.id}/invoice`, {}, 409, 'the next period isn’t due until a week before it starts', /Nothing to invoice yet/);
ok('the current period is invoiced in advance; the next one waits');

// ── Plan changes ──
await fail('POST', `/services/subscriptions/${s.id}/change-plan`, { planId: qtr.id }, 400, 'a plan change keeps the billing period', /same billing period/);
const up = await c.req('POST', `/services/subscriptions/${s.id}/change-plan`, { planId: pro.id }, 201);
const expected = subscriptionProration('30000', '45000', P(2), E(2), today);
assert.deepEqual([up.effectiveOn, up.prorationAmount], [today, expected]);
d = await c.req('GET', `/services/subscriptions/${s.id}`);
assert.deepEqual([d.plan.code, d.periods[2].includedReports, d.periods[2].fee], ['CROP-PRO', 8, '30000.00']);
ok(`an upgrade applies today: the bigger bundle for this period and ₹${expected} prorated for the days left`);
const down = await c.req('POST', `/services/subscriptions/${s.id}/change-plan`, { planId: std.id }, 201);
assert.deepEqual([down.effectiveOn, down.prorationAmount], [P(3), '0.00']);
await fail('POST', `/services/subscriptions/${s.id}/change-plan`, { planId: pro.id }, 409, 'one pending change at a time', /already pending/);
d = await c.req('GET', `/services/subscriptions/${s.id}`);
assert.deepEqual([d.plan.code, d.pendingChange.effectiveOn], ['CROP-PRO', P(3)]);
ok('a downgrade waits for the next period: no credit note');
const r1 = await c.req('POST', `/services/subscriptions/${s.id}/invoice`, {}, 201);
inv = await c.req('GET', `/sales-invoices/${r1.invoiceId}`);
assert.deepEqual(inv.lines.map((l) => Number(l.rate)), [Number(expected)]);
assert.match(inv.lines[0].description, /Upgrade from Crop health standard to Crop health pro/);
await fail('POST', `/services/subscriptions/${s.id}/invoice`, {}, 409, 'the proration is charged once', /Nothing to invoice yet/);
await c.req('DELETE', `/sales-invoices/${r1.invoiceId}`);
const r2 = await c.req('POST', `/services/subscriptions/${s.id}/invoice`, {}, 201);
assert.equal((await c.req('GET', `/sales-invoices/${r2.invoiceId}`)).lines.length, 1);
ok('the upgrade is charged on the next invoice; deleting that draft frees it to be charged again');

// ── Cancel ──
await c.req('POST', `/services/subscriptions/${s.id}/deliveries`, { kind: 'alert', title: 'Hail damage alert' }, 201);
const cancel = await c.req('POST', `/services/subscriptions/${s.id}/cancel`, { reason: 'Season over' }, 201);
assert.equal(cancel.endDate, E(2));
d = await c.req('GET', `/services/subscriptions/${s.id}`);
assert.deepEqual([d.status, d.next], ['cancelled', null]);
await fail('POST', `/services/subscriptions/${s.id}/cancel`, { reason: 'again' }, 409, 'cancelled once', /Already cancelled/);
await fail('POST', `/services/subscriptions/${s.id}/change-plan`, { planId: std.id }, 409, 'a cancelled subscription keeps its plan', /keeps its plan/);
await fail('POST', `/services/subscriptions/${s.id}/invoice`, {}, 409, 'nothing more until the last period ends', /Nothing left to invoice/);
ok(`cancelled at the end of the invoiced period (${E(2)}); its overage goes on a final invoice after that`);

// ── A free plan: overage only ──
const s2 = await c.req('POST', '/services/subscriptions', { ...sub, planId: free.id, aoiName: 'Nashik vineyards block B', aoiHectares: null }, 201);
await fail('POST', `/services/subscriptions/${s2.id}/invoice`, {}, 409, 'a free plan has no fee to invoice', /Nothing to invoice yet/);
for (let i = 1; i <= 3; i++) await c.req('POST', `/services/subscriptions/${s2.id}/deliveries`, { kind: 'alert', deliveredOn: P(0), title: `Pest alert ${i}` }, 201);
const r3 = await c.req('POST', `/services/subscriptions/${s2.id}/invoice`, {}, 201);
inv = await c.req('GET', `/sales-invoices/${r3.invoiceId}`);
assert.deepEqual(inv.lines.map((l) => Number(l.rate)), [2250]);
ok('a free alerts-only plan bills only what was delivered: 3 alerts at ₹750');

// ── Isolation ──
const outsider = await new Client().init('Elsewhere');
await fail('GET', `/services/subscriptions/${s.id}`, undefined, 404, 'another tenant can’t see the subscription', undefined, outsider);
await fail('POST', `/services/subscriptions/${s.id}/deliveries`, { kind: 'report', title: 'Outside report' }, 404, 'another tenant can’t record against it', undefined, outsider);

console.log(`\nSubscriptions smoke passed (${c.checks} request checks).`);
