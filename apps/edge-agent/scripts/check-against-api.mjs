// End-to-end check (decisions 063 and 064) against a running API: a fresh tenant registers an edge and a tap, an
// in-process MQTT broker stands in for Mosquitto, the built edge agent forwards the simulator's heartbeats, and the
// machine grid shows the tap's state; the tap's settings reach it as a retained config, and its status reaches Devices.
// Usage: API=http://localhost:4000 node scripts/check-against-api.mjs   (after pnpm build)
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { EdgeAgent } from '../dist/index.js';

const API = `${process.env.API ?? 'http://localhost:4000'}/api`;
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
let cookie = '';
const H = {};
const call = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, ...H }, ...(body && { body: JSON.stringify(body) }) });
  const set = r.headers.getSetCookie();
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const data = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
  return data;
};
await call('POST', '/auth/sign-up/email', { name: 'Edge check', email: `edge${Date.now()}@example.com`, password: 'Sup3r-secret-pw' });
const w = await call('POST', '/tenants', { name: 'Edge check', entity: { legalName: 'Edge Check Private Limited', shortName: 'EC', code: 'EC', pan: 'AAACE1234B' } });
H['x-tenant-id'] = w.tenant.id;
H['x-entity-id'] = w.entity.id;
const tenantSlug = w.tenant.slug;
const cnc = await call('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' });
const m = await call('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M5X', name: '5-axis' });
const edge = await call('POST', '/plant/edges', { code: 'NM1', name: 'Plant edge' });
await call('POST', '/plant/devices', { edgeId: edge.id, code: 'MT1-01', name: '5-axis tap', machineId: m.id });

const broker = await Aedes.createBroker();
const server = createServer(broker.handle);
await new Promise((r) => server.listen(0, r));
const mqttUrl = `mqtt://127.0.0.1:${server.address().port}`;
const agent = new EdgeAgent({ mqttUrl, apiUrl: API, key: edge.key, tenant: tenantSlug, plant: 'NM1', dataDir: mkdtempSync(join(tmpdir(), 'edge-')), flushMs: 200, log: (x) => console.log('  agent:', x) });
await agent.start();
await promisify(execFile)('node', [new URL('./simulate-tap.mjs', import.meta.url).pathname, '--mqtt', mqttUrl, '--tenant', tenantSlug, '--plant', 'NM1', '--device', 'MT1-01', '--script', 'idle:2,running:8', '--speed', '0']).then((r) => process.stdout.write(r.stdout));
let row;
for (let i = 0; i < 40; i++) {
  row = (await call('GET', '/plant/machines')).find((x) => x.id === m.id);
  if (row?.state === 'running' && agent.queue.size === 0) break;
  await new Promise((r) => setTimeout(r, 250));
}
assert.deepEqual([row.device.code, row.state, agent.queue.size], ['MT1-01', 'running', 0]);
const tl = await call('GET', `/plant/machines/${m.id}/timeline?from=${encodeURIComponent(new Date(Date.now() - 11 * 60_000).toISOString())}`);
assert.ok(tl.meter.minutes >= 9, `occupied ${tl.meter.minutes}`);

// Decision 064: settings out to the tap, status back.
const tapRow = (await call('GET', '/plant/devices')).find((d) => d.code === 'MT1-01');
await call('PUT', `/plant/devices/${tapRow.id}/config`, { offAmps: 1, runAmps: 6.5, ctAmpsPerVolt: 50, debounceSeconds: 10, lights: { red: 'alarm', amber: 'setup', green: 'running' } });
const tap = await mqtt.connectAsync(mqttUrl);
const base = `factoryos/${tenantSlug}/NM1/MT1-01`;
await tap.publishAsync(`${base}/status`, JSON.stringify({ fwVersion: '1.0.0', configVersion: 2, uptime: 60, rssi: -60, outbox: 0, lastError: null, at: new Date().toISOString() }), { qos: 1, retain: true });
await new Promise((r) => setTimeout(r, 200));
await agent.syncOnce();
const config = await new Promise((resolve) => {
  tap.on('message', (_t, p) => resolve(JSON.parse(p.toString())));
  void tap.subscribeAsync(`${base}/config`, { qos: 1 });
});
await tap.endAsync();
assert.equal(config.version, 2);
assert.equal(config.runAmps, 6.5);
const reported = (await call('GET', '/plant/devices')).find((d) => d.code === 'MT1-01');
assert.deepEqual([reported.fwVersion, reported.appliedConfigVersion, reported.configVersion], ['1.0.0', 2, 2]);
console.log('  settings v2 reached the tap as a retained config; its status reached Plant → Devices');

await agent.stop();
await new Promise((r) => broker.close(r));
server.close();
console.log(`Edge agent check passed: simulator → MQTT → edge agent → API; ${tl.meter.minutes} occupied minutes on M5X.`);
