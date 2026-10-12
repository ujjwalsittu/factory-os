// Tap configuration and status (decision 064): each tap starts with the default settings at version 1; a validated
// change (or a new heartbeat) raises the version; the edge fetches its active taps' configs with its key and posts the
// taps' status reports with a result per tap; the Devices list shows what the tap applied; isolation.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-tap-config.mjs
import assert from 'node:assert/strict';
import { Client } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Tap config');
const fail = async (method, path, body, status, label, pattern, who = c) => {
  const r = await who.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const API = `${process.env.API ?? 'http://localhost:4000'}/api`;
const edgeCall = async (key, method, path, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) }, ...(body && { body: JSON.stringify(body) }) });
  c.checks++;
  return { status: r.status, data: await r.json() };
};
const now = () => new Date().toISOString();

// ── Two machines with taps on one edge, a third tap retired ──
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' }, 201);
const machines = [];
for (const code of ['M5X', 'VMC', 'LATHE']) machines.push(await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code, name: code }, 201));
const edge = await c.req('POST', '/plant/edges', { code: 'PLANT-1', name: 'Navi Mumbai edge PC' }, 201);
const t1 = await c.req('POST', '/plant/devices', { edgeId: edge.id, code: 'MT1-01', name: '5-axis tap', machineId: machines[0].id }, 201);
const t2 = await c.req('POST', '/plant/devices', { edgeId: edge.id, code: 'MT1-02', name: 'VMC tap', machineId: machines[1].id, heartbeatSeconds: 30 }, 201);
const t3 = await c.req('POST', '/plant/devices', { edgeId: edge.id, code: 'MT1-03', name: 'Lathe tap', machineId: machines[2].id }, 201);
await c.req('POST', `/plant/devices/${t3.id}/retire`, {}, 201);
assert.equal(t1.configVersion, 1);
assert.deepEqual(t1.config, { offAmps: 0.5, runAmps: 3, ctAmpsPerVolt: 30, debounceSeconds: 5, lights: { red: 'alarm', amber: 'idle', green: 'running' } });
ok('a new tap has the default settings at version 1');

// ── Settings: validated, each change raises the version ──
const good = { offAmps: 1, runAmps: 6.5, ctAmpsPerVolt: 50, debounceSeconds: 10, lights: { red: 'alarm', amber: 'setup', green: 'running' } };
await fail('PUT', `/plant/devices/${t1.id}/config`, { ...good, offAmps: 7 }, 400, 'the running threshold must be above the off threshold', /above the off threshold/);
await fail('PUT', `/plant/devices/${t1.id}/config`, { ...good, debounceSeconds: 0 }, 400, 'debounce is 1 to 120 seconds');
await fail('PUT', `/plant/devices/${t1.id}/config`, { ...good, lights: { ...good.lights, green: 'alarm' } }, 400, 'green means running or nothing');
await fail('PUT', `/plant/devices/${t3.id}/config`, good, 409, 'a retired tap is fixed', /retired/);
const v2 = await c.req('PUT', `/plant/devices/${t1.id}/config`, good);
assert.equal(v2.configVersion, 2);
assert.deepEqual(v2.config, good);
const same = await c.req('PUT', `/plant/devices/${t2.id}`, { name: 'VMC tap', machineId: machines[1].id, heartbeatSeconds: 30 });
assert.equal(same.configVersion, 1);
const hb = await c.req('PUT', `/plant/devices/${t2.id}`, { name: 'VMC tap', machineId: machines[1].id, heartbeatSeconds: 60 });
assert.equal(hb.configVersion, 2);
ok('a settings change or a new heartbeat raises the version; a rename does not');

// ── The edge fetches its taps' configs ──
assert.equal((await edgeCall(null, 'GET', '/iot/config')).status, 401);
assert.equal((await edgeCall('fos_edge_nope', 'GET', '/iot/config')).status, 401);
const cfg = await edgeCall(edge.key, 'GET', '/iot/config');
assert.equal(cfg.status, 200);
assert.deepEqual(cfg.data.taps.map((t) => t.device), ['MT1-01', 'MT1-02']);
assert.deepEqual(cfg.data.taps[0].config, { version: 2, heartbeatSeconds: 60, ...good });
assert.equal(cfg.data.taps[1].config.version, 2);
assert.equal(cfg.data.taps[1].config.heartbeatSeconds, 60);
ok('the edge gets its active taps’ configs with versions, not the retired one');

// ── Status reports: a result per tap ──
const report = (device, extra = {}) => ({ device, fwVersion: '1.0.0', configVersion: 2, uptime: 3600, rssi: -61, outbox: 0, lastError: null, at: now(), ...extra });
assert.equal((await edgeCall(null, 'POST', '/iot/status', { statuses: [report('MT1-01')] })).status, 401);
assert.equal((await edgeCall(edge.key, 'POST', '/iot/status', { statuses: [report('MT1-01', { rssi: 20 })] })).status, 400);
assert.equal((await edgeCall(edge.key, 'POST', '/iot/status', { statuses: [] })).status, 400);
ok('status needs the edge key and a valid report');
const st = await edgeCall(edge.key, 'POST', '/iot/status', {
  statuses: [report('MT1-01'), report('MT1-02', { configVersion: 1, outbox: 42, lastError: 'config v2 rejected: bad lights' }), report('MT1-03'), report('NOPE'), report('MT1-01', { at: new Date(Date.now() + 3600e3).toISOString() })],
});
assert.equal(st.status, 200);
assert.deepEqual(
  st.data.results.map((r) => r.status),
  ['accepted', 'accepted', 'refused', 'refused', 'refused'],
);
assert.match(st.data.results[2].reason, /Not an active tap/);
assert.match(st.data.results[4].reason, /Bad timestamp/);
ok('accepted for its active taps; refused for a retired or unknown tap or a future time');
const list = await c.req('GET', '/plant/devices');
const d1 = list.find((d) => d.code === 'MT1-01');
const d2 = list.find((d) => d.code === 'MT1-02');
assert.equal(d1.fwVersion, '1.0.0');
assert.equal(d1.appliedConfigVersion, d1.configVersion);
assert.equal(d1.rssi, -61);
assert.equal(d2.appliedConfigVersion, 1);
assert.equal(d2.configVersion, 2);
assert.equal(d2.outbox, 42);
assert.match(d2.lastError, /rejected/);
assert.ok(d2.statusAt);
ok('Devices shows firmware, applied versus current config, signal, outbox and the last error');

// ── Isolation ──
const outsider = await new Client().init('Elsewhere');
await fail('PUT', `/plant/devices/${t1.id}/config`, good, 404, 'another tenant can’t change our tap', undefined, outsider);
const theirs = await outsider.req('POST', '/plant/edges', { code: 'THEIRS', name: 'Their edge' }, 201);
const theirCfg = await edgeCall(theirs.key, 'GET', '/iot/config');
assert.deepEqual(theirCfg.data.taps, []);
const theirSt = await edgeCall(theirs.key, 'POST', '/iot/status', { statuses: [report('MT1-01', { fwVersion: '6.6.6' })] });
assert.equal(theirSt.data.results[0].status, 'refused');
assert.equal((await c.req('GET', '/plant/devices')).find((d) => d.code === 'MT1-01').fwVersion, '1.0.0');
ok('another tenant’s key sees none of our configs and can’t report for our taps');

console.log(`\nTap config smoke passed (${c.checks + outsider.checks} request checks).`);
