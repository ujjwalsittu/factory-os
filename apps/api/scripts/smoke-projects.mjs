// Phase 3d projects (decision 058): a project billed by milestones as full tax invoices with 5% retention withheld,
// a budget, linked work (a work order with issued material, a machine booking, a test campaign, a tagged purchase
// line) never billed on its own, analyst timesheets valued at a per-person cost rate seen only with its permission,
// completion, retention due and release, close; cancel rules and tenant isolation.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-projects.mjs
import assert from 'node:assert/strict';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Projects');
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
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 24 * HOUR));
const plusMonths = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  t.setUTCDate(Math.min(d, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()));
  return t.toISOString().slice(0, 10);
};

// ── Masters ──
await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/hsn-codes', { code: '998365', kind: 'sac', description: 'Other technical and scientific services', gstRate: '18', effectiveFrom: '2017-07-01' }, 201);
await c.req('POST', '/hsn-codes', { code: '998315', kind: 'sac', description: 'Hosting and IT infrastructure services', gstRate: '18', effectiveFrom: '2017-07-01' }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const svc = await c.req('POST', '/items', { code: 'SVC-PRJ', name: 'Satellite engineering services', type: 'service', stockUomId: u('NOS'), hsnCode: '998365' }, 201);
const cloud = await c.req('POST', '/items', { code: 'SVC-GPU', name: 'GPU cloud compute', type: 'service', stockUomId: u('NOS'), hsnCode: '998315' }, 201);
const bar = await c.req('POST', '/items', { code: 'AL6061', name: 'Aluminium bar', type: 'raw_material', tracking: 'none', stockUomId: u('KG'), hsnCode: '76042910' }, 201);
const panel = await c.req('POST', '/items', { code: 'SP-PANEL', name: 'Structure panel', type: 'finished_good', tracking: 'none', stockUomId: u('NOS'), hsnCode: '88033000' }, 201);
const stores = await c.req('POST', '/warehouses', { code: 'STO', name: 'Main stores', type: 'stores' }, 201);
const fg = await c.req('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' }, 201);
const rec = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: today, lines: [{ itemId: bar.id, qty: '20', toWarehouseId: stores.id, rate: '400' }] }, 201);
await c.req('POST', `/stock-entries/${rec.id}/submit`, {}, 201);
await c.req('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) }, 201);
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC milling', hourlyRate: '1800' }, 201);
const m03 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M-03', name: '5-axis mill' }, 201);
let bom = await c.req('POST', '/manufacturing/boms', { itemId: panel.id, revision: 'A', quantity: '1', materials: [{ itemId: bar.id, qty: '2' }], operations: [{ seq: 10, name: 'Mill', workCentreId: cnc.id, setupMinutes: '0', runMinutesPerUnit: '30' }] }, 201);
bom = await c.req('POST', `/manufacturing/boms/${bom.id}/activate`, {}, 201);
const isro = await c.req('POST', '/parties', { code: 'SAC-GOV', name: 'Space Applications Centre', isCustomer: true, gstin: gstin('24AAAGS1234B1Z') }, 201);
const other = await c.req('POST', '/parties', { code: 'OTHER', name: 'Other Space LLP', isCustomer: true, gstin: gstin('27AAFFO1234B1Z') }, 201);
const gpu = await c.req('POST', '/parties', { code: 'GPUCO', name: 'GPU Cloud Pvt Ltd', isCustomer: false, isSupplier: true, gstin: gstin('27AABCG1234B1Z') }, 201);

// ── Project, milestones, activation ──
const draft = { customerId: isro.id, title: 'Hyperspectral payload structure', customerRef: 'SAC/LoA/2026/117', serviceItemId: svc.id, contractValue: '1000000', retentionPct: '5', dlpMonths: 12 };
await fail('POST', '/services/projects', { ...draft, serviceItemId: bar.id }, 400, 'milestones are billed as a service item', /not a service item/);
await fail('POST', '/services/projects', { ...draft, retentionPct: '60' }, 400, 'retention is capped at 50%');
const p = await c.req('POST', '/services/projects', draft, 201);
assert.match(p.number, /\/PRJ\//);
assert.equal(p.status, 'draft');
await fail('POST', `/services/projects/${p.id}/activate`, {}, 400, 'a project needs milestones before it is activated', /Add the milestones/);
const m1 = await c.req('POST', `/services/projects/${p.id}/milestones`, { name: 'Design review (PDR)', amount: '300000', dueDate: tomorrow }, 201);
await fail('POST', `/services/projects/${p.id}/milestones`, { name: 'Too much', amount: '800000' }, 400, 'milestones never exceed the contract value', /more than the contract value/);
await fail('POST', `/services/projects/${p.id}/activate`, {}, 400, 'activation needs the milestones to add up to the contract value', /add up to ₹300000\.00/);
const m2 = await c.req('POST', `/services/projects/${p.id}/milestones`, { name: 'Flight structure delivered', amount: '700000' }, 201);
assert.deepEqual([m1.seq, m2.seq], [10, 20]);
await c.req('PUT', `/services/projects/${p.id}/budget`, { lines: [{ category: 'material', amount: '20000' }, { category: 'machine', amount: '30000' }, { category: 'labour', amount: '200000' }, { category: 'bought_in', amount: '50000' }] });
await c.req('POST', `/services/projects/${p.id}/activate`, {}, 201);
await fail('PUT', `/services/projects/${p.id}`, { ...draft, contractValue: '1200000' }, 409, 'commercial terms are fixed once active', /fixed once the project is active/);
await c.req('PUT', `/services/projects/${p.id}`, { ...draft, title: 'Hyperspectral payload primary structure' });
ok('a ₹10,00,000 project with two milestones and a budget is activated');

// ── Linked work: a booking, a campaign, a work order, a purchase line ──
await fail('POST', '/services/bookings', { customerId: other.id, machineId: m03.id, startsAt: at(2), endsAt: at(4), projectId: p.id }, 400, 'a project booking is for the project’s customer', /another customer/);
const bk = await c.req('POST', '/services/bookings', { customerId: isro.id, machineId: m03.id, startsAt: at(2), endsAt: at(4), purpose: 'Fit check', projectId: p.id }, 201);
for (const a of ['confirm', 'start', 'stop']) await c.req('POST', `/services/bookings/${bk.id}/${a}`, {}, 201);
await c.req('POST', `/services/bookings/${bk.id}/usage`, { minutes: 90, note: 'Fit check on the mill' }, 201);
const bd = await c.req('GET', `/services/bookings/${bk.id}`);
assert.deepEqual([bd.projectNumber, bd.billable], [p.number, false]);
await fail('POST', `/services/bookings/${bk.id}/bill`, {}, 409, 'a project booking is never billed by the hour', /Billed through project/);
const tc = await c.req('POST', '/services/campaigns', { customerId: isro.id, title: 'Vibration test of the structure', serviceItemId: svc.id, quotedAmount: '0', projectId: p.id }, 201);
assert.equal((await c.req('GET', `/services/campaigns/${tc.id}`)).projectNumber, p.number);
await fail('POST', `/services/campaigns/${tc.id}/invoice`, {}, 409, 'a project campaign is not invoiced on its own', /Billed through project/);
const wo = await c.req('POST', '/manufacturing/work-orders', { itemId: panel.id, plannedQty: '2', sourceWarehouseId: stores.id, targetWarehouseId: fg.id }, 201);
await c.req('POST', `/services/projects/${p.id}/links`, { kind: 'work_order', id: wo.id }, 201);
await c.req('POST', `/manufacturing/work-orders/${wo.id}/release`, {}, 201);
await c.req('POST', `/manufacturing/work-orders/${wo.id}/issue`, { lines: [{ itemId: bar.id, qty: '4' }] }, 201);
const pi = await c.req('POST', '/purchase-invoices', { supplierId: gpu.id, supplierInvoiceNo: 'GPU-0917', supplierInvoiceDate: today, postingDate: today, lines: [{ itemId: cloud.id, qty: '1', rate: '42000' }] }, 201);
const piLine = (await c.req('GET', `/purchase-invoices/${pi.id}`)).lines[0].id;
await c.req('POST', `/services/projects/${p.id}/links`, { kind: 'purchase_invoice_line', id: piLine }, 201);
let d = await c.req('GET', `/services/projects/${p.id}`);
assert.equal(d.budget.find((b) => b.category === 'bought_in').actual, '0.00', 'a draft purchase invoice is not cost yet');
await c.req('POST', `/purchase-invoices/${pi.id}/submit`, {}, 201);
d = await c.req('GET', `/services/projects/${p.id}`);
const actual = Object.fromEntries(d.budget.map((b) => [b.category, b.actual]));
const usedMinutes = (await c.req('GET', `/services/bookings/${bk.id}`)).usedMinutes;
assert.ok(usedMinutes >= 90);
const machineCost = ((usedMinutes * 1800) / 60).toFixed(2);
assert.deepEqual(actual, { material: '1600.00', machine: machineCost, labour: '0.00', bought_in: '42000.00', other: '0.00' });
assert.deepEqual([d.links.bookings.length, d.links.campaigns.length, d.links.workOrders.length, d.links.purchaseLines.length], [1, 1, 1, 1]);
ok('actual cost: material issued to the work order, 90 min of machine time at ₹1,800/h, the GPU bill (ITC-eligible, before GST)');
await fail('POST', `/services/projects/${p.id}/links`, { kind: 'booking', id: bk.id }, 201, 'linking twice is harmless');
const p2 = await c.req('POST', '/services/projects', { ...draft, title: 'Another project' }, 201);
await fail('POST', `/services/projects/${p2.id}/links`, { kind: 'purchase_invoice_line', id: piLine }, 409, 'a purchase line is a cost of one project', /another project/);

// ── Timesheets and cost rates ──
const role = await c.req('POST', '/roles', { name: 'Analyst', permissions: ['services.project.read', 'services.timesheet.read', 'services.timesheet.create'] }, 201);
const analyst = new Client();
const email = `analyst-${Date.now()}@example.com`;
const invitation = await c.req('POST', '/invitations', { email, roles: [{ roleId: role.id, entityIds: [c.entityId] }] }, 201);
await analyst.req('POST', '/auth/sign-up/email', { name: 'Priya Analyst', email, password: 'Sup3r-secret-pw' });
await analyst.req('POST', '/invitations/accept', { token: invitation.inviteUrl.split('/').at(-1) }, 201);
analyst.tenantId = c.tenantId;
analyst.entityId = c.entityId;
const people = await c.req('GET', '/services/projects-people');
const priya = people.find((x) => x.name === 'Priya Analyst');
await fail('GET', '/services/cost-rates', undefined, 403, 'cost rates need their own permission', undefined, analyst);
await fail('POST', '/services/timesheets', { projectId: p.id, workDate: tomorrow, hours: '8' }, 400, 'no hours for a future date', /future date/, analyst);
await fail('POST', '/services/timesheets', { projectId: p.id, workDate: today, hours: '7.3' }, 400, 'hours are in quarter hours', /Quarter hours/, analyst);
const t1 = await analyst.req('POST', '/services/timesheets', { projectId: p.id, milestoneId: m1.id, workDate: today, hours: '8', notes: 'FEA of the side panels' }, 201);
await fail('POST', '/services/timesheets', { projectId: p2.id, workDate: today, hours: '1' }, 409, 'hours go on active projects', /draft/, analyst);
await fail('POST', '/services/timesheets', { projectId: p.id, workDate: today, hours: '17' }, 400, 'a day has 24 hours across projects', /a day has 24/, analyst);
await analyst.req('POST', '/services/timesheets/submit', { from: today, to: today }, 201);
await fail('PUT', `/services/timesheets/${t1.id}`, { projectId: p.id, workDate: today, hours: '6' }, 409, 'submitted hours wait for approval', /wait for approval/, analyst);
await fail('POST', `/services/timesheets/${t1.id}/approve`, {}, 403, 'an analyst can’t approve hours', undefined, analyst);
await fail('POST', `/services/timesheets/${t1.id}/approve`, {}, 409, 'approval needs the person’s cost rate', /Set a cost rate for Priya Analyst/);
await c.req('POST', '/services/cost-rates', { userId: priya.id, hourlyRate: '900', effectiveFrom: plusMonths(today, -1) }, 201);
await fail('POST', '/services/cost-rates', { userId: priya.id, hourlyRate: '950', effectiveFrom: plusMonths(today, -1) }, 409, 'one rate per person per date', /already exists/);
await c.req('POST', `/services/timesheets/${t1.id}/approve`, {}, 201);
const own = await c.req('POST', '/services/timesheets', { projectId: p.id, workDate: today, hours: '2', notes: 'Customer review call' }, 201);
await c.req('POST', '/services/timesheets/submit', { from: today, to: today }, 201);
await fail('POST', `/services/timesheets/${own.id}/approve`, {}, 403, 'nobody approves their own hours', /Someone else/);
const mine = await analyst.req('GET', '/services/timesheets');
assert.deepEqual([mine.length, mine[0].status, mine[0].costAmount], [1, 'approved', null]);
await fail('GET', '/services/timesheets?scope=all', undefined, 403, 'only approvers see everyone’s hours', undefined, analyst);
d = await c.req('GET', `/services/projects/${p.id}`);
assert.equal(d.budget.find((b) => b.category === 'labour').actual, '7200.00');
assert.deepEqual(d.hours.find((h) => h.name === 'Priya Analyst'), { userId: priya.id, name: 'Priya Analyst', approvedHours: '8.00', pendingHours: '0.00', cost: '7200.00' });
const seen = await analyst.req('GET', `/services/projects/${p.id}`);
assert.deepEqual([seen.hours.find((h) => h.name === 'Priya Analyst').cost, seen.budget.find((b) => b.category === 'labour').actual], [null, '7200.00']);
ok('8 approved hours at ₹900/h are ₹7,200 of labour; the analyst sees hours and the labour total, not the rate');
const rev = await c.req('POST', `/services/timesheets/${t1.id}/reverse`, { reason: 'Logged against the wrong project' }, 201);
await fail('POST', `/services/timesheets/${t1.id}/reverse`, { reason: 'again' }, 409, 'a reversal happens once', /Already reversed/);
d = await c.req('GET', `/services/projects/${p.id}`);
assert.equal(d.budget.find((b) => b.category === 'labour').actual, '0.00');
assert.ok(rev.id);
ok('approved hours are corrected by a negative reversal, never edited');
await analyst.req('POST', '/services/timesheets', { projectId: p.id, workDate: today, hours: '6', notes: 'Re-logged' }, 201);
await analyst.req('POST', '/services/timesheets/submit', { from: today, to: today }, 201);
const pending = (await c.req('GET', '/services/timesheets?scope=all&status=submitted')).find((e) => e.personName === 'Priya Analyst');
await c.req('POST', `/services/timesheets/${pending.id}/approve`, {}, 201);

// ── Milestone invoices and retention ──
await fail('POST', `/services/milestones/${m1.id}/invoice`, {}, 409, 'a milestone is invoiced once achieved', /achieved before invoicing/);
await fail('POST', `/services/milestones/${m1.id}/achieve`, {}, 400, 'achievement needs the customer’s acceptance reference');
await c.req('POST', `/services/milestones/${m1.id}/achieve`, { acceptanceRef: 'SAC/PDR/MoM-14' }, 201);
await fail('PUT', `/services/milestones/${m1.id}`, { name: 'PDR', amount: '300000' }, 409, 'an achieved milestone is fixed', /can’t be changed/);
const i1 = await c.req('POST', `/services/milestones/${m1.id}/invoice`, {}, 201);
let inv = await c.req('GET', `/sales-invoices/${i1.invoiceId}`);
assert.deepEqual([inv.status, inv.customerPoNo, Number(inv.lines[0].rate), inv.grandTotal], ['draft', 'SAC/LoA/2026/117', 300000, '354000.00']);
assert.match(inv.remarks, /retention 5\.00% withheld/);
await fail('POST', `/services/milestones/${m1.id}/invoice`, {}, 409, 'a milestone is invoiced once', /Already invoiced/);
d = await c.req('GET', `/services/projects/${p.id}`);
assert.deepEqual([d.retention.length, d.retention[0].amount, d.retentionHeld, d.revenue], [1, '17700.00', '17700.00', '300000.00']);
ok('the PDR milestone is a full tax invoice of ₹3,54,000 (IGST); 5% retention of ₹17,700 is held');
await fail('POST', `/services/retention/${d.retention[0].id}/release`, { releaseRef: 'RCPT-1' }, 409, 'retention is released only on a submitted invoice', /Submit the milestone invoice/);
await c.req('DELETE', `/sales-invoices/${i1.invoiceId}`);
d = await c.req('GET', `/services/projects/${p.id}`);
assert.deepEqual([d.milestones[0].state, d.retention.length], ['achieved', 0]);
ok('deleting the draft frees the milestone and its retention');
const i1b = await c.req('POST', `/services/milestones/${m1.id}/invoice`, {}, 201);
await c.req('POST', `/sales-invoices/${i1b.invoiceId}/submit`, {}, 201);

// ── Complete, retention due, close ──
await fail('POST', `/services/projects/${p.id}/complete`, {}, 409, 'every milestone is achieved before completion', /1 milestone is not achieved/);
await c.req('POST', `/services/milestones/${m2.id}/achieve`, { acceptanceRef: 'SAC/DD/0042' }, 201);
await fail('POST', `/services/projects/${p.id}/complete`, {}, 409, 'linked campaigns are closed first', /Test campaign .* is still draft/);
await c.req('POST', `/services/campaigns/${tc.id}/cancel`, { reason: 'Covered by the customer’s own facility' }, 201);
await c.req('POST', `/services/projects/${p.id}/complete`, {}, 201);
d = await c.req('GET', `/services/projects/${p.id}`);
assert.deepEqual([d.status, d.completedOn, d.retentionDueOn], ['completed', today, plusMonths(today, 12)]);
ok('completion starts the 12-month defect liability period: retention falls due a year later');
await fail('POST', `/services/projects/${p.id}/close`, {}, 409, 'every milestone is invoiced before close', /Flight structure delivered” is not invoiced/);
const i2 = await c.req('POST', `/services/milestones/${m2.id}/invoice`, {}, 201);
await c.req('POST', `/sales-invoices/${i2.invoiceId}/submit`, {}, 201);
await fail('POST', `/services/projects/${p.id}/close`, {}, 409, 'held retention keeps a project open', /still held/);
d = await c.req('GET', `/services/projects/${p.id}`);
assert.deepEqual([d.retentionHeld, d.revenue], ['59000.00', '1000000.00']);
await fail('POST', `/services/retention/${d.retention[0].id}/release`, { releaseRef: 'RCPT-1', releasedOn: tomorrow }, 400, 'no release in the future', /future/);
await fail('POST', `/services/retention/${d.retention[0].id}/release`, { releaseRef: 'RCPT-1' }, 403, 'releasing retention needs project approval', undefined, analyst);
for (const r of d.retention) await c.req('POST', `/services/retention/${r.id}/release`, { releaseRef: `RCPT-${r.amount}` }, 201);
await fail('POST', `/services/projects/${p.id}/close`, {}, 409, 'hours awaiting approval keep a project open', /waits for approval/);
await fail('POST', `/services/timesheets/${own.id}/reject`, { reason: 'Not billable to the customer' }, 403, 'nobody sends back their own hours either', /Someone else/);
// The analyst becomes an approver and sends the lead's hours back as not billable.
await c.req('PATCH', `/roles/${role.id}`, { permissions: ['services.project.read', 'services.timesheet.read', 'services.timesheet.create', 'services.timesheet.approve'] });
await analyst.req('POST', `/services/timesheets/${own.id}/reject`, { reason: 'Not billable to the customer' }, 201);
await fail('POST', `/services/retention/${d.retention[0].id}/release`, { releaseRef: 'again' }, 409, 'retention is released once', /Already released/);
await c.req('POST', `/services/projects/${p.id}/close`, {}, 201);
d = await c.req('GET', `/services/projects/${p.id}`);
assert.deepEqual([d.status, d.retentionHeld, d.retentionReleased], ['closed', '0.00', '59000.00']);
const cost = (1600 + Number(machineCost) + 42000 + 6 * 900).toFixed(2);
assert.deepEqual([d.actualCost, d.margin], [cost, (1000000 - Number(cost)).toFixed(2)]);
ok(`closed: ₹10,00,000 invoiced, ₹59,000 retention received, ₹${cost} actual cost (incl. 6 h re-logged at ₹900/h)`);
await fail('POST', '/services/timesheets', { projectId: p.id, workDate: today, hours: '1' }, 409, 'a closed project takes no hours', /closed/, analyst);
await fail('DELETE', `/services/projects/${p.id}/links/work_order/${wo.id}`, undefined, 409, 'a closed project’s links are fixed', /fixed/);

// ── Cancel and isolation ──
await c.req('POST', `/services/milestones/${(await c.req('POST', `/services/projects/${p2.id}/milestones`, { name: 'All', amount: '1000000' }, 201)).id}/achieve`, { acceptanceRef: 'x' }, 409);
await c.req('POST', `/services/projects/${p2.id}/activate`, {}, 201);
const b2 = await c.req('POST', '/services/bookings', { customerId: isro.id, machineId: m03.id, startsAt: at(30), endsAt: at(32), projectId: p2.id }, 201);
await fail('POST', `/services/projects/${p2.id}/cancel`, { reason: 'Customer withdrew' }, 409, 'a project with an open booking can’t be cancelled', /still tentative/);
await c.req('POST', `/services/bookings/${b2.id}/cancel`, { reason: 'Project withdrawn' }, 201);
await c.req('POST', `/services/projects/${p2.id}/cancel`, { reason: 'Customer withdrew' }, 201);
assert.equal((await c.req('GET', `/services/projects/${p2.id}`)).status, 'cancelled');
ok('a project is cancelled once its open bookings are');
const outsider = await new Client().init('Elsewhere');
await fail('GET', `/services/projects/${p.id}`, undefined, 404, 'another tenant can’t see the project', undefined, outsider);
await fail('POST', `/services/projects/${p.id}/links`, { kind: 'booking', id: bk.id }, 404, 'another tenant can’t link to it', undefined, outsider);

console.log(`\nProjects smoke passed: ${c.checks + analyst.checks} request checks.`);
