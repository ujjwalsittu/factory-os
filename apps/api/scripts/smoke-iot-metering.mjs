// IoT metering (decision 063): an edge key shown once (hash only stored), rotate and revoke; taps mapped to machines
// (one active tap per machine); device-authenticated ingest with a result per event (accepted, duplicate, refused);
// the live machine grid and timeline; a booking stopped on a metered machine takes the occupied minutes when covered
// and within 10% of the timer, otherwise waits for a supervisor's review before it can be billed; machines without a
// tap behave as before; isolation. Booking start times are moved back in the local database (test-only time travel).
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-iot-metering.mjs   (DATABASE_URL from the env or ../../.env)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('IoT metering');
const fail = async (method, path, body, status, label, pattern, who = c) => {
  const r = await who.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const API = `${process.env.API ?? 'http://localhost:4000'}/api`;
const dbUrl = process.env.DATABASE_URL ?? fs.readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1];
/** Test-only: the booking's machine timer started `min` minutes ago. */
const startedAgo = (id, min) => execFileSync('psql', [dbUrl, '-qtAc', `update maas_booking set started_at = now() - interval '${min} minutes' where id = '${id}'`]);
const ingest = async (key, events) => {
  const r = await fetch(`${API}/iot/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) }, body: JSON.stringify({ events }) });
  c.checks++;
  return { status: r.status, data: await r.json() };
};
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
let seq = 1;
/** One event a minute from `a` minutes ago up to `b` minutes ago, in `state`. */
const beats = (device, a, b, state) => Array.from({ length: a - b }, (_, i) => ({ device, seq: seq++, state, at: ago(a - i) }));
const HOUR = 3600e3;
const base = Math.ceil(Date.now() / (15 * 60e3)) * 15 * 60e3;
const at = (h) => new Date(base + h * HOUR).toISOString();
const istDate = (d) => new Date(Date.now() + 5.5 * HOUR + d * 86400e3).toISOString().slice(0, 10);

// ── A rented 5-axis and a VMC with taps, a lathe whose tap is retired, a drill without one; a customer ──
await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) }, 201);
const uoms = await c.req('GET', '/uoms');
await c.req('POST', '/hsn-codes', { code: '998898', kind: 'sac', description: 'Other manufacturing services', gstRate: '18', effectiveFrom: '2017-07-01' }, 201);
const svc = await c.req('POST', '/items', { code: 'MAAS', name: 'Machine time', type: 'service', stockUomId: uoms.find((x) => x.code === 'HR').id, hsnCode: '998898' }, 201);
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' }, 201);
const m5 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M5X', name: 'Variaxis 5-axis' }, 201);
const vmc = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'VMC', name: 'VMC 3-axis' }, 201);
const lathe = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'LATHE', name: 'Lathe' }, 201);
const drill = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'DRILL', name: 'Drill' }, 201);
for (const m of [m5, vmc, drill]) await c.req('POST', '/services/rate-cards', { machineId: m.id, serviceItemId: svc.id, standardRate: '2500', minimumMinutes: 60, roundingMinutes: 15, validFrom: istDate(-30) }, 201);
const orbit = await c.req('POST', '/parties', { code: 'ORBIT', name: 'Orbit Space Pvt Ltd', isCustomer: true, gstin: gstin('27AABCO1234B1Z') }, 201);

// ── Edge key: shown once, only a hash kept; rotate; revoke ──
const edge = await c.req('POST', '/plant/edges', { code: 'PLANT-1', name: 'Navi Mumbai edge PC' }, 201);
assert.match(edge.key, /^fos_edge_/);
const edges = await c.req('GET', '/plant/edges');
assert.equal(JSON.stringify(edges).includes(edge.key), false);
assert.deepEqual(Object.keys(edges[0]).includes('keyHash'), false);
await fail('POST', '/plant/edges', { code: 'PLANT-1', name: 'Again' }, 409, 'edge codes are unique', /already exists/);
const spare = await c.req('POST', '/plant/edges', { code: 'SPARE', name: 'Spare edge' }, 201);
ok('the edge key is returned once and never listed');

// ── Taps ──
await fail('POST', '/plant/devices', { edgeId: edge.id, code: 'MT1-01', name: 'Tap', machineId: m5.id, heartbeatSeconds: 5 }, 400, 'the heartbeat is 10 to 600 seconds');
await c.req('POST', '/plant/devices', { edgeId: edge.id, code: 'MT1-01', name: '5-axis tap', machineId: m5.id }, 201);
await fail('POST', '/plant/devices', { edgeId: edge.id, code: 'MT1-09', name: 'Second tap', machineId: m5.id }, 409, 'one active tap per machine', /already meters this machine/);
await c.req('POST', '/plant/devices', { edgeId: edge.id, code: 'MT1-02', name: 'VMC tap', machineId: vmc.id }, 201);
const other = await c.req('POST', '/plant/devices', { edgeId: spare.id, code: 'MT1-03', name: 'Spare tap', machineId: lathe.id }, 201);
await c.req('POST', `/plant/devices/${other.id}/retire`, {}, 201);
ok('taps on the 5-axis and the VMC; the lathe’s tap retired');

// ── Ingest: a result per event ──
assert.equal((await ingest(null, beats('MT1-01', 2, 1, 'idle'))).status, 401);
assert.equal((await ingest('fos_edge_not-a-key', beats('MT1-01', 2, 1, 'idle'))).status, 401);
ok('ingest needs a valid edge key');
const mixed = [
  { device: 'MT1-01', seq: 900001, state: 'running', at: ago(1) },
  { device: 'MT1-01', seq: 900001, state: 'running', at: ago(1) },
  { device: 'NOPE', seq: 1, state: 'idle', at: ago(1) },
  { device: 'MT1-03', seq: 2, state: 'idle', at: ago(1) },
  { device: 'MT1-01', seq: 900002, state: 'idle', at: new Date(Date.now() + 3600e3).toISOString() },
  { device: 'MT1-01', seq: 900003, state: 'dancing', at: ago(1) },
];
const r1 = await ingest(edge.key, mixed);
assert.equal(r1.status, 200);
assert.deepEqual(r1.data.results.map((x) => x.status), ['accepted', 'duplicate', 'refused', 'refused', 'refused', 'refused']);
assert.deepEqual(r1.data.results.slice(2).map((x) => x.reason), ['Unknown device', 'The device belongs to another edge', 'Timestamp is in the future', 'Unknown state dancing']);
assert.deepEqual((await ingest(edge.key, [mixed[0]])).data.results[0].status, 'duplicate');
ok('accepted, duplicate and refused (with reasons) per (device, seq); a resent event is a duplicate');
await fail('POST', '/iot/ingest', { events: [] }, 401, 'a session cookie is not an edge key');

// ── Rotate: the old key stops at once ──
const rot = await c.req('POST', `/plant/edges/${edge.id}/rotate`, {}, 201);
assert.equal((await ingest(edge.key, beats('MT1-01', 2, 1, 'idle'))).status, 401);
const key = rot.key;
assert.equal((await ingest(key, beats('MT1-01', 2, 1, 'idle'))).status, 200);
ok('after rotation the old key is refused and the new one works');

// ── Booking 1 on the 5-axis: covered and within 10% → metered minutes become the usage ──
const b1 = await c.req('POST', '/services/bookings', { customerId: orbit.id, machineId: m5.id, startsAt: at(1), endsAt: at(3) }, 201);
await c.req('POST', `/services/bookings/${b1.id}/confirm`, {}, 201);
await c.req('POST', `/services/bookings/${b1.id}/start`, {}, 201);
startedAgo(b1.id, 60);
const r2 = await ingest(key, [...beats('MT1-01', 62, 50, 'setup'), ...beats('MT1-01', 50, 5, 'running'), ...beats('MT1-01', 5, 0, 'off')]);
assert.ok(r2.data.results.every((x) => x.status === 'accepted'));
const s1 = await c.req('POST', `/services/bookings/${b1.id}/stop`, {}, 201);
assert.deepEqual([s1.meterStatus, s1.meteredMinutes, s1.minutes], ['applied', 55, 60]);
let d1 = await c.req('GET', `/services/bookings/${b1.id}`);
assert.deepEqual([d1.usedMinutes, d1.usage.map((u) => [u.source, u.minutes]), d1.meter.covered, d1.billable], [55, [['timer', 60], ['meter', -5]], true, true]);
ok('timer 60, meter 55 (setup + running, off excluded): within 10%, usage is 55 and the booking is billable');

// ── Booking 2 on the VMC: a 20-minute gap → review before billing ──
const b2 = await c.req('POST', '/services/bookings', { customerId: orbit.id, machineId: vmc.id, startsAt: at(1), endsAt: at(3) }, 201);
await c.req('POST', `/services/bookings/${b2.id}/confirm`, {}, 201);
await c.req('POST', `/services/bookings/${b2.id}/start`, {}, 201);
startedAgo(b2.id, 90);
await ingest(key, [...beats('MT1-02', 91, 50, 'running'), ...beats('MT1-02', 30, 0, 'running')]);
const s2 = await c.req('POST', `/services/bookings/${b2.id}/stop`, {}, 201);
assert.equal(s2.meterStatus, 'review');
let d2 = await c.req('GET', `/services/bookings/${b2.id}`);
assert.deepEqual([d2.meter.covered, d2.billable, d2.usedMinutes], [false, false, 90]);
await fail('POST', `/services/bookings/${b2.id}/bill`, {}, 409, 'a booking waiting for review can’t be billed', /Usage needs review/);
await fail('POST', `/services/bookings/${b2.id}/usage`, { minutes: -5, note: 'trim' }, 409, 'manual usage waits for the review', /waiting for review/);
await fail('POST', `/services/bookings/${b2.id}/meter-review`, { choice: 'corrected', note: 'x' }, 400, 'a corrected review needs minutes and a note');
const rv = await c.req('POST', `/services/bookings/${b2.id}/meter-review`, { choice: 'corrected', minutes: 80, note: 'Tap lost Wi-Fi for 20 min; log sheet shows the spindle ran' }, 201);
assert.equal(rv.minutes, 80);
d2 = await c.req('GET', `/services/bookings/${b2.id}`);
assert.deepEqual([d2.meterStatus, d2.usedMinutes, d2.billable, d2.meterReviewedByName], ['applied', 80, true, 'IoT metering']);
await fail('POST', `/services/bookings/${b2.id}/meter-review`, { choice: 'timer', note: 'again' }, 409, 'a settled booking isn’t reviewed again', /isn’t waiting/);
ok('a gap sends the booking to review; the supervisor’s corrected 80 minutes are recorded and billing opens');

// ── A machine without a tap is unchanged ──
const b3 = await c.req('POST', '/services/bookings', { customerId: orbit.id, machineId: drill.id, startsAt: at(1), endsAt: at(3) }, 201);
await c.req('POST', `/services/bookings/${b3.id}/confirm`, {}, 201);
await c.req('POST', `/services/bookings/${b3.id}/start`, {}, 201);
startedAgo(b3.id, 45);
const s3 = await c.req('POST', `/services/bookings/${b3.id}/stop`, {}, 201);
assert.deepEqual([s3.meterStatus, s3.minutes], ['none', 45]);
ok('a machine that never had a tap keeps the timer as today');

// ── Live machines and timeline ──
const grid = await c.req('GET', '/plant/machines');
const row = (m) => grid.find((x) => x.id === m.id);
assert.deepEqual([row(m5).device.code, row(m5).state, row(m5).stale], ['MT1-01', 'off', false]);
assert.deepEqual([row(lathe).device, row(drill).device], [null, null]);
const tl = await c.req('GET', `/plant/machines/${m5.id}/timeline?from=${encodeURIComponent(ago(70))}&to=${encodeURIComponent(ago(0))}`);
assert.ok(tl.meter.segments.some((s) => s.state === 'running'));
await fail('GET', `/plant/machines/${m5.id}/timeline?from=${encodeURIComponent(ago(60 * 24 * 8))}`, undefined, 400, 'a timeline is up to 7 days', /7 days/);
ok('the machine grid shows each tap’s last state; the timeline shows the segments');

// ── Revoke and isolation ──
await c.req('POST', `/plant/edges/${edge.id}/revoke`, {}, 201);
assert.equal((await ingest(key, beats('MT1-01', 2, 1, 'idle'))).status, 401);
await fail('POST', `/plant/edges/${edge.id}/rotate`, {}, 409, 'a revoked edge stays revoked', /stays revoked/);
const outsider = await new Client().init('Elsewhere');
await fail('GET', '/plant/edges', undefined, 200, 'another tenant sees no edges', /^\[\]$/, outsider);
await fail('POST', `/plant/edges/${spare.id}/rotate`, {}, 404, 'or rotate ours', undefined, outsider);
const theirs = await outsider.req('POST', '/plant/edges', { code: 'THEIRS', name: 'Their edge' }, 201);
const cross = await ingest(theirs.key, [{ device: 'MT1-02', seq: 1, state: 'idle', at: ago(1) }]);
assert.equal(cross.data.results[0].reason, 'Unknown device');
ok('another tenant’s key can’t post to our taps');

console.log(`\nIoT metering smoke passed (${c.checks + outsider.checks} request checks).`);
