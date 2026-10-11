// CAPA (decision 061): a major CAPA raised from two NCRs, its 5-Why, root cause and 8D sections, containment,
// corrective and preventive actions, start/submit gates, the effectiveness check after its wait by someone other than
// the owner (not effective reopens it; effective closes it with D8), a minor standalone CAPA, cancel, and isolation.
// The wait is at least 30 days, so the smoke moves the due date back in the local database (test-only time travel).
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-capa.mjs   (DATABASE_URL from the env or ../../.env)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { Client } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('CAPA');
const fail = async (method, path, body, status, label, pattern, who = c) => {
  const r = await who.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const dbUrl = process.env.DATABASE_URL ?? fs.readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1];
/** Test-only: bring a CAPA's effectiveness check due date to today. */
const dueToday = (id) => execFileSync('psql', [dbUrl, '-qtAc', `update capa set verify_due_on = (now() at time zone 'Asia/Kolkata')::date where id = '${id}'`]);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const inDays = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + n * 86400e3));

// ── Masters, NCRs and a second person ──
const uoms = await c.req('GET', '/uoms');
const bar = await c.req('POST', '/items', { code: 'AL-BAR', name: 'Aluminium bar', type: 'raw_material', tracking: 'none', stockUomId: uoms.find((x) => x.code === 'KG').id, hsnCode: '76042910' }, 201);
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Main stores', type: 'stores' }, 201);
const rec = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: today, lines: [{ itemId: bar.id, qty: '10', toWarehouseId: sto.id, rate: '400' }] }, 201);
await c.req('POST', `/stock-entries/${rec.id}/submit`, {}, 201);
const n1 = await c.req('POST', '/quality/ncrs', { itemId: bar.id, qty: '2', fromWarehouseId: sto.id, description: 'Surface cracks after heat treatment' }, 201);
const n2 = await c.req('POST', '/quality/ncrs', { itemId: bar.id, qty: '1', fromWarehouseId: sto.id, description: 'Cracks again on the next lot' }, 201);
const role = await c.req('POST', '/roles', { name: 'QA verifier', permissions: ['quality.capa.read', 'quality.capa.approve', 'quality.ncr.read'] }, 201);
const qa = new Client();
const email = `qa-${Date.now()}@example.com`;
const inv = await c.req('POST', '/invitations', { email, roles: [{ roleId: role.id, entityIds: [c.entityId] }] }, 201);
await qa.req('POST', '/auth/sign-up/email', { name: 'Quality Head', email, password: 'Sup3r-secret-pw' });
await qa.req('POST', '/invitations/accept', { token: inv.inviteUrl.split('/').at(-1) }, 201);
qa.tenantId = c.tenantId;
qa.entityId = c.entityId;
const people = await c.req('GET', '/quality/capa-people');
const me = people.find((p) => p.name === 'CAPA');
const head = people.find((p) => p.name === 'Quality Head');
assert.ok(me && head);

// ── Raise from NCRs ──
const draft = { source: 'ncr', title: 'Cracking after heat treatment', problem: 'Two lots of Ti bar cracked after solution treatment', severity: 'major', ownerUserId: me.id, verifyAfterDays: 30, ncrIds: [n1.id] };
await fail('POST', '/quality/capas', { ...draft, ncrIds: [] }, 400, 'a CAPA from an NCR links it', /Link the NCR/);
await fail('POST', '/quality/capas', { ...draft, verifyAfterDays: 10 }, 400, 'the wait is 30 to 180 days');
const k = await c.req('POST', '/quality/capas', draft, 201);
assert.match(k.number, /\/CAPA\//);
await c.req('POST', `/quality/capas/${k.id}/ncrs`, { ncrId: n2.id }, 201);
assert.deepEqual((await c.req('GET', `/quality/capas?ncrId=${n2.id}`)).map((x) => x.id), [k.id]);
ok('a major CAPA raised from one NCR, the repeat NCR linked to it too');

// ── Plan and start ──
await fail('POST', `/quality/capas/${k.id}/start`, {}, 400, 'no start before root cause, 8D team/containment and a corrective action', /two whys, the root-cause statement, the team \(D1\), the containment \(D3\), a corrective action/);
const analysis = {
  title: draft.title,
  problem: draft.problem,
  ownerUserId: me.id,
  verifyAfterDays: 30,
  whys: ['Cracks are quench cracks', 'Quench delay exceeded 8 s', 'Basket transfer is manual', 'Fixture was redesigned without a time study'],
  rootCause: 'Manual basket transfer after the fixture change lets the quench delay exceed the 8 s limit',
  team: 'Quality head, heat-treat lead, process engineer',
  containment: 'All bars from both lots quarantined and 100% dye-penetrant tested',
};
await c.req('PUT', `/quality/capas/${k.id}`, analysis);
const contain = await c.req('POST', `/quality/capas/${k.id}/actions`, { kind: 'containment', description: 'Dye-penetrant test both lots', ownerUserId: me.id, dueOn: inDays(2) }, 201);
const fix = await c.req('POST', `/quality/capas/${k.id}/actions`, { kind: 'corrective', description: 'Add a timed pneumatic transfer to the quench', ownerUserId: me.id, dueOn: inDays(14) }, 201);
const prevent = await c.req('POST', `/quality/capas/${k.id}/actions`, { kind: 'preventive', description: 'Time study required for any fixture change (PFMEA update)', ownerUserId: head.id, dueOn: inDays(30) }, 201);
await fail('POST', `/quality/capa-actions/${fix.id}/done`, { note: 'early' }, 409, 'actions are done once the CAPA is started', /Start the actions/);
await c.req('POST', `/quality/capas/${k.id}/start`, {}, 201);
ok('started with a 4-why chain, root cause, 8D team and containment, and three actions');

// ── Actions and submit ──
await fail('POST', `/quality/capas/${k.id}/submit`, {}, 409, 'submit waits for every action', /3 actions are still open/);
await fail('POST', `/quality/capa-actions/${fix.id}/done`, { note: 'Fitted', doneOn: inDays(1) }, 400, 'no completion in the future', /future/);
for (const a of [contain, fix, prevent]) await c.req('POST', `/quality/capa-actions/${a.id}/done`, { note: 'Done and recorded' }, 201);
const sub = await c.req('POST', `/quality/capas/${k.id}/submit`, {}, 201);
assert.equal(sub.verifyDueOn, inDays(30));
await fail('PUT', `/quality/capas/${k.id}`, analysis, 409, 'the CAPA is fixed while it waits for the check', /waits for its effectiveness check/);
ok(`all actions done; the effectiveness check falls due on ${sub.verifyDueOn}`);

// ── Verify: not yet, not the owner, not effective, then effective ──
await fail('POST', `/quality/capas/${k.id}/verify`, { effective: true, note: 'Looks fine' }, 409, 'not before the verification date', /is due on/, qa);
dueToday(k.id);
await fail('POST', `/quality/capas/${k.id}/verify`, { effective: true, note: 'My own check' }, 403, 'the owner doesn’t verify their own CAPA', /other than the owner/);
await qa.req('POST', `/quality/capas/${k.id}/verify`, { effective: false, note: 'One more cracked bar on lot 3; transfer time still 9 s on night shift' }, 201);
let d = await c.req('GET', `/quality/capas/${k.id}`);
assert.deepEqual([d.status, d.verifyDueOn, d.verifications.length], ['in_action', null, 1]);
ok('not effective: the CAPA returns to action with the evidence kept');
const fix2 = await c.req('POST', `/quality/capas/${k.id}/actions`, { kind: 'corrective', description: 'Interlock the quench door to the transfer timer', ownerUserId: me.id, dueOn: inDays(7) }, 201);
await c.req('POST', `/quality/capa-actions/${fix2.id}/done`, { note: 'Interlock commissioned' }, 201);
await c.req('POST', `/quality/capas/${k.id}/submit`, {}, 201);
dueToday(k.id);
await fail('POST', `/quality/capas/${k.id}/verify`, { effective: true, note: 'Three lots crack-free' }, 400, 'a major CAPA closes with D8 recognition', /D8 recognition/, qa);
await qa.req('POST', `/quality/capas/${k.id}/verify`, { effective: true, note: 'Three lots since, crack-free; transfer under 5 s on all shifts', recognition: 'Heat-treat team thanked at the monthly review' }, 201);
d = await c.req('GET', `/quality/capas/${k.id}`);
assert.deepEqual([d.status, d.verifications.map((v) => v.effective), d.ncrs.length], ['closed', [false, true], 2]);
ok('effective on the second check: closed with recognition, both checks kept');
await fail('POST', `/quality/capas/${k.id}/cancel`, { reason: 'late' }, 409, 'a closed CAPA can’t be cancelled', /closed CAPA/);
await fail('POST', `/quality/capas/${k.id}/ncrs`, { ncrId: n1.id }, 409, 'a closed CAPA’s links are fixed', /fixed/);

// ── Minor standalone CAPA, cancel ──
const k2 = await c.req('POST', '/quality/capas', { source: 'audit', title: 'Gauge labels missing', problem: 'Internal audit: 3 gauges without calibration labels', severity: 'minor', ownerUserId: head.id }, 201);
await c.req('PUT', `/quality/capas/${k2.id}`, { title: 'Gauge labels missing', problem: 'Internal audit: 3 gauges without calibration labels', ownerUserId: head.id, verifyAfterDays: 60, whys: ['Labels fall off in the coolant area', 'Paper labels are used'], rootCause: 'Paper labels are not coolant resistant' });
await c.req('POST', `/quality/capas/${k2.id}/actions`, { kind: 'corrective', description: 'Switch to engraved tags', ownerUserId: head.id, dueOn: inDays(10) }, 201);
await c.req('POST', `/quality/capas/${k2.id}/start`, {}, 201);
ok('a minor standalone CAPA starts without the 8D sections');
const list = await c.req('GET', '/quality/capas');
assert.deepEqual(list.find((x) => x.id === k2.id).openActions, 1);
await fail('POST', `/quality/capas/${k2.id}/cancel`, {}, 400, 'cancelling needs a reason');
await c.req('POST', `/quality/capas/${k2.id}/cancel`, { reason: 'Covered by the calibration register project' }, 201);
assert.equal((await c.req('GET', `/quality/capas/${k2.id}`)).status, 'cancelled');

// ── Permissions and isolation ──
await fail('POST', '/quality/capas', { ...draft, title: 'Not allowed' }, 403, 'a verifier without create permission can’t raise one', undefined, qa);
const outsider = await new Client().init('Elsewhere');
await fail('GET', `/quality/capas/${k.id}`, undefined, 404, 'another tenant can’t see the CAPA', undefined, outsider);
await fail('POST', '/quality/capas', { ...draft, ownerUserId: me.id }, 400, 'another tenant can’t name our people as owner', /active member/, outsider);

console.log(`\nCAPA smoke passed (${c.checks + qa.checks} request checks).`);
