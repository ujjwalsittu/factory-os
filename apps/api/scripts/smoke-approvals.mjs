// Approvals inbox (decision 076): GET /approvals lists what waits on the signed-in person in every entity they can
// access ("needsMe"), and what they sent that waits on someone else ("waitingOnOthers"). Each kind uses the approve
// permission and separation-of-duties rule of its own endpoint, per entity.
// Built through the real endpoints: timesheets, maintenance verification, purchase return claim, GST returns.
// Seeded in the database in their waiting state (their own smokes cover how they get there): NCR dispositions, FAI,
// CAPA effectiveness check, test campaign report, booking usage review.
// Run with: node --env-file=../../.env scripts/smoke-approvals.mjs (API on http://localhost:4000 or $API).
import assert from 'node:assert/strict';
import { createDb } from '../../../packages/db/dist/index.js';
import { Client } from './accounting-test-helpers.mjs';
import { fixture } from './supplier-returns-test-helpers.mjs';

const db = createDb(process.env.DATABASE_URL);
const q = async (text, params = []) => (await db.$client.query(text, params)).rows;
const ok = (label) => console.log(`✓ ${label}`);
const pause = () => new Promise((r) => setTimeout(r, 11000));
const as = (who, entityId) => Object.assign(Object.create(Object.getPrototypeOf(who)), who, { entityId });
const inbox = async (who) => who.req('GET', '/approvals');
const keys = (rows, kind) => rows.filter((r) => !kind || r.kind === kind).map((r) => r.key).sort();
try {
  // ── Owner, entity A (activated books, a GST registration, a purchase invoice) ──
  const { c, reg, item, claimInput, date } = await fixture('Approvals owner');
  const A = c.entityId;
  const me = (await c.req('GET', '/me')).user ?? (await c.req('GET', '/me'));
  const ownerId = me.id;
  const uom = (await c.req('GET', '/uoms')).find((x) => x.code === 'NOS');
  const customer = await c.req('POST', '/parties', { code: 'CUST', name: 'Satellite startup', isCustomer: true, gstTreatment: 'unregistered', stateCode: '27' }, 201);
  await c.req('POST', '/hsn-codes', { code: '998346', kind: 'sac', description: 'Testing services', gstRate: '18', effectiveFrom: '2025-04-01' }, 201);
  const svc = await c.req('POST', '/items', { code: 'SVC-TEST', name: 'Testing services', type: 'service', stockUomId: uom.id, hsnCode: '998346' }, 201);

  // ── Entity B, and the other two people ──
  const B = (await c.req('POST', '/entities', { legalName: 'EarthNow Private Limited', shortName: 'EarthNow', code: 'EN', pan: 'AAACE1234F' }, 201)).id;
  const approverRole = await c.req('POST', '/roles', {
    name: 'Approver',
    permissions: [
      'compliance.gst_return.read', 'compliance.gst_return.approve', 'quality.ncr.read', 'quality.ncr.approve', 'quality.fai.read', 'quality.fai.approve',
      'quality.capa.read', 'quality.capa.approve', 'maintenance.order.read', 'maintenance.order.approve', 'services.timesheet.read', 'services.timesheet.approve',
      'services.timesheet.create', 'buying.return_claim.read', 'buying.return_claim.approve', 'services.campaign.read', 'services.campaign.approve',
      'services.booking.read', 'services.usage.approve', 'services.project.read',
    ],
  }, 201);
  const techRole = await c.req('POST', '/roles', { name: 'Maintenance tech', permissions: ['maintenance.order.read', 'maintenance.order.update', 'maintenance.breakdown.create'] }, 201);
  const join = async (name, roles) => {
    await pause();
    const who = new Client();
    const email = `approvals-${name.toLowerCase().replace(/\W/g, '')}-${Date.now()}@example.com`;
    const inv = await c.req('POST', '/invitations', { email, roles }, 201);
    await who.req('POST', '/auth/sign-up/email', { name, email, password: 'Sup3r-secret-pw' });
    await who.req('POST', '/invitations/accept', { token: inv.inviteUrl.split('/').at(-1) }, 201);
    who.tenantId = c.tenantId;
    return who;
  };
  const ap = await join('Asha Approver', [{ roleId: approverRole.id, entityIds: [A] }]);
  const tech = await join('Tariq Tech', [{ roleId: techRole.id, entityIds: [B] }]);
  ok('owner, approver (entity A only) and technician (entity B only)');

  // ── Entity A: one of each kind, sent by the owner ──
  // Timesheets: a week of the owner's hours.
  const p = await c.req('POST', '/services/projects', { customerId: customer.id, title: 'Payload structure', serviceItemId: svc.id, contractValue: '100000', retentionPct: '0', dlpMonths: 0 }, 201);
  await c.req('POST', `/services/projects/${p.id}/milestones`, { name: 'Delivery', amount: '100000' }, 201);
  await c.req('POST', `/services/projects/${p.id}/activate`, {}, 201);
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  await c.req('POST', '/services/cost-rates', { userId: ownerId, hourlyRate: '900', effectiveFrom: date }, 201);
  const t1 = await c.req('POST', '/services/timesheets', { projectId: p.id, workDate: today, hours: '6', notes: 'Design' }, 201);
  await c.req('POST', '/services/timesheets/submit', { from: today, to: today }, 201);
  // Maintenance: a breakdown on a critical machine, signed off by the owner.
  const wc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' }, 201);
  const vmc = await c.req('POST', `/manufacturing/work-centres/${wc.id}/machines`, { code: 'VMC', name: 'VMC 3-axis', critical: true }, 201);
  const bd = await c.req('POST', '/maintenance/breakdowns', { machineId: vmc.id, symptom: 'Spindle alarm', failedAt: new Date(Date.now() - 3600e3).toISOString() }, 201);
  await c.req('POST', `/maintenance/orders/${bd.id}/done`, { cause: 'Encoder cable', action: 'Replaced cable' }, 201);
  // Purchase return claim: the default policy needs every claim approved.
  const claim = await c.req('POST', '/buying/return-claims', claimInput, 201);
  await c.req('POST', `/buying/return-claims/${claim.id}/submit`, {}, 201);
  // GST returns of the cut-over month, prepared and reviewed by the owner.
  const prepared = await c.req('POST', '/gst-returns/prepare', { gstRegistrationId: reg.id, period: date.slice(0, 7) }, 200);
  for (const r of prepared) await c.req('POST', `/gst-returns/${r.id}/review`, {}, 200);
  // Seeded in their waiting state.
  const [n] = await q("insert into ncr (tenant_id, entity_id, number, item_id, qty, description, created_by) values ($1, $2, 'NCR-1', $3, 1, 'Burr on the flange', $4) returning id", [c.tenantId, A, item.id, ownerId]);
  await q("insert into ncr_disposition (ncr_id, line_no, kind, qty, proposed_by) values ($1, 1, 'use_as_is', 1, $2)", [n.id, ownerId]);
  const [f] = await q("insert into fai (tenant_id, entity_id, number, item_id, reason, status, submitted_by, submitted_at, created_by) values ($1, $2, 'FAI-1', $3, 'first_build', 'submitted', $4, now(), $4) returning id", [c.tenantId, A, item.id, ownerId]);
  const [k1] = await q("insert into capa (tenant_id, entity_id, number, source, title, problem, severity, owner_user_id, status, verify_due_on, created_by) values ($1, $2, 'CAPA-1', 'other', 'Loose fixture', 'Fixture moved in cut', 'minor', $3, 'verifying', $4, $3) returning id", [c.tenantId, A, ownerId, today]);
  const [k2] = await q("insert into capa (tenant_id, entity_id, number, source, title, problem, severity, owner_user_id, status, verify_due_on, created_by) values ($1, $2, 'CAPA-2', 'other', 'Coolant mix', 'Mix drifted', 'minor', $3, 'verifying', $4::date + 30, $3) returning id", [c.tenantId, A, ownerId, today]);
  const [tc] = await q("insert into test_campaign (tenant_id, entity_id, number, customer_id, title, service_item_id, quoted_amount, status, created_by) values ($1, $2, 'TC-1', $3, 'Thermal vacuum', $4, 0, 'active', $5) returning id", [c.tenantId, A, customer.id, svc.id, ownerId]);
  await q("insert into test_campaign_step (campaign_id, seq, name, result, recorded_at) values ($1, 1, 'Pump-down', 'pass', now())", [tc.id]);
  const [tc2] = await q("insert into test_campaign (tenant_id, entity_id, number, customer_id, title, service_item_id, quoted_amount, status, created_by) values ($1, $2, 'TC-2', $3, 'Vibration', $4, 0, 'active', $5) returning id", [c.tenantId, A, customer.id, svc.id, ownerId]);
  await q("insert into test_campaign_step (campaign_id, seq, name) values ($1, 1, 'Sine sweep')", [tc2.id]);
  const [bk] = await q("insert into maas_booking (tenant_id, entity_id, number, customer_id, machine_id, starts_at, ends_at, started_at, stopped_at, status, meter_status, created_by) values ($1, $2, 'BK-1', $3, $4, now() - interval '3 hours', now() - interval '1 hour', now() - interval '3 hours', now() - interval '1 hour', 'completed', 'review', $5) returning id", [c.tenantId, A, customer.id, vmc.id, ownerId]);
  ok('entity A: one of each kind, sent by the owner');

  // ── Entity B: a breakdown signed off by the technician ──
  const cB = as(c, B);
  const wcB = await cB.req('POST', '/manufacturing/work-centres', { code: 'GS', name: 'Ground station', hourlyRate: '900' }, 201);
  const antenna = await cB.req('POST', `/manufacturing/work-centres/${wcB.id}/machines`, { code: 'ANT', name: 'Antenna', critical: true }, 201);
  const techB = as(tech, B);
  const bdB = await techB.req('POST', '/maintenance/breakdowns', { machineId: antenna.id, symptom: 'Rotator stalls', failedAt: new Date(Date.now() - 7200e3).toISOString() }, 201);
  await techB.req('POST', `/maintenance/orders/${bdB.id}/done`, { cause: 'Gearbox', action: 'Re-greased' }, 201);
  ok('entity B: a breakdown signed off by the technician');

  // ── The approver: entity A only ──
  const apA = as(ap, A);
  let box = await inbox(ap);
  assert.deepEqual(box.errors, []);
  assert.deepEqual([...new Set(box.needsMe.map((r) => r.kind))].sort(), ['campaign_report', 'capa', 'fai', 'gst_return', 'maintenance', 'ncr', 'return_claim', 'timesheet', 'usage_review']);
  assert.ok(box.needsMe.every((r) => r.entityId === A && r.entityName), 'nothing from entity B, where the approver has no access');
  assert.equal(box.needsMe.filter((r) => r.kind === 'gst_return').length, 2);
  assert.deepEqual(keys(box.needsMe, 'capa'), [`capa:${k1.id}`], 'a CAPA before its check date is not waiting yet');
  assert.deepEqual(keys(box.needsMe, 'campaign_report'), [`campaign_report:${tc.id}`], 'a campaign with a pending step is not ready');
  assert.deepEqual(keys(box.needsMe, 'fai'), [`fai:${f.id}`]);
  assert.deepEqual(keys(box.needsMe, 'ncr'), [`ncr:${n.id}`]);
  assert.deepEqual(keys(box.needsMe, 'return_claim'), [`return_claim:${claim.id}`]);
  assert.deepEqual(keys(box.needsMe, 'usage_review'), [`usage_review:${bk.id}`]);
  const ts = box.needsMe.find((r) => r.kind === 'timesheet');
  assert.deepEqual(ts.action, { kind: 'timesheets', entryIds: [t1.id], hours: '6.00' });
  assert.match(ts.title, /6\.00 h/);
  const mo = box.needsMe.find((r) => r.kind === 'maintenance');
  assert.deepEqual(mo.action, { kind: 'verify', orderId: bd.id });
  assert.equal(mo.href, `/app/maintenance/orders/${bd.id}`);
  assert.ok(box.needsMe.every((r) => r.from), 'every row says who sent it');
  assert.deepEqual(box.waitingOnOthers, []);
  ok('approver: all nine kinds in entity A, none from entity B, nothing of their own waiting');

  // ── The owner: separation of duties, and entity B ──
  box = await inbox(c);
  assert.deepEqual(box.errors, []);
  const ownerNeeds = box.needsMe.map((r) => `${r.entityName}:${r.kind}`).sort();
  // The owner may approve what has no separation rule (NCR, return claim, test report, usage review), and B's order.
  const nameA = box.needsMe.find((r) => r.entityId === A).entityName;
  assert.deepEqual(ownerNeeds, ['EarthNow:maintenance', ...['campaign_report', 'ncr', 'return_claim', 'usage_review'].map((k) => `${nameA}:${k}`)].sort());
  assert.equal(box.needsMe.find((r) => r.kind === 'maintenance').entityId, B);
  assert.equal(box.needsMe.find((r) => r.kind === 'maintenance').from, 'Tariq Tech');
  // Waiting on others: what the owner sent and may not approve themselves, shown once.
  assert.deepEqual([...new Set(box.waitingOnOthers.map((r) => r.kind))].sort(), ['capa', 'fai', 'gst_return', 'maintenance', 'timesheet']);
  assert.deepEqual(keys(box.waitingOnOthers, 'capa'), [`capa:${k1.id}`, `capa:${k2.id}`].sort(), 'the owner sees a CAPA from the start');
  assert.ok(box.waitingOnOthers.find((r) => r.key === `capa:${k2.id}`).dueOn, 'with the date its check is due');
  assert.ok(box.waitingOnOthers.every((r) => !r.action), 'nothing to do on your own items');
  const both = new Set(box.needsMe.map((r) => r.key));
  assert.ok(box.waitingOnOthers.every((r) => !both.has(r.key)), 'never in both tabs');
  ok('owner: separation of duties kept, entity B included, own items waiting on others');

  // ── The technician: nothing to approve, their order waiting ──
  box = await inbox(tech);
  assert.deepEqual(box.needsMe, []);
  assert.deepEqual(keys(box.waitingOnOthers), [`maintenance:${bdB.id}`]);
  ok('technician: nothing to approve, their sign-off waiting in entity B');

  // ── Acting from the list ──
  await apA.req('POST', `/services/timesheets/${t1.id}/reject`, {}, 400);
  await apA.req('POST', `/services/timesheets/${t1.id}/approve`, {}, 201);
  await apA.req('POST', `/maintenance/orders/${bd.id}/verify`, {}, 201);
  // Entity B's order, verified by the owner in B's scope.
  await cB.req('POST', `/maintenance/orders/${bdB.id}/verify`, {}, 201);
  box = await inbox(ap);
  assert.deepEqual(keys(box.needsMe, 'timesheet'), []);
  assert.deepEqual(keys(box.needsMe, 'maintenance'), []);
  box = await inbox(c);
  assert.deepEqual(keys(box.waitingOnOthers, 'timesheet'), []);
  assert.deepEqual(keys(box.waitingOnOthers, 'maintenance'), []);
  assert.deepEqual(keys(box.needsMe, 'maintenance'), []);
  assert.deepEqual(keys((await inbox(tech)).waitingOnOthers), []);
  ok('approve and verify from the list: the items leave both tabs');

  // ── Isolation ──
  await pause();
  const stranger = await new Client().init('Approvals stranger');
  box = await inbox(stranger);
  assert.deepEqual([box.needsMe, box.waitingOnOthers], [[], []]);
  assert.equal((await new Client().raw('GET', '/approvals')).status, 401);
  ok('another workspace sees nothing; signed out is refused');

  console.log('PASS approvals', c.checks + ap.checks + tech.checks + stranger.checks);
} finally {
  await db.$client.end();
}
