// The broker side of firmware/provision/test/check.sh: connects as the edge agent and as taps with the issued
// certificates and checks what the ACL and the CRL allow. Usage: node check.mjs before|after <port> <EDGE_DIR>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../apps/edge-agent/package.json', import.meta.url));
const mqtt = require('mqtt');
const [phase, port, dir] = process.argv.slice(2);
const pki = `${dir}/pki`;
const url = `mqtts://localhost:${port}`;
const base = 'factoryos/azeonics/NM1';
const ca = readFileSync(`${pki}/ca.crt`);
const as = (cert, key, extra = {}) => ({ ca, cert: readFileSync(cert), key: readFileSync(key), reconnectPeriod: 0, connectTimeout: 4000, ...extra });
const tap = (d) => as(`${pki}/taps/${d}/cert.pem`, `${pki}/taps/${d}/key.pem`, { clientId: d });
const connect = (opts) => mqtt.connectAsync(url, opts);
const refused = async (opts, label) => {
  await assert.rejects(connect(opts), undefined, label);
  console.log(`✓ ${label}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const agent = await connect(as(`${dir}/agent/mqtt-client.crt`, `${dir}/agent/mqtt-client.key`, { clientId: 'edge-agent' }));
const seen = [];
agent.on('message', (t, p) => seen.push(`${t} ${p}`));
await agent.subscribeAsync(`${base}/#`, { qos: 1 });

if (phase === 'before') {
  await refused({ ca, reconnectPeriod: 0, connectTimeout: 4000 }, 'no client certificate: refused');
  const t1 = await connect(tap('MT1-01'));
  await t1.publishAsync(`${base}/MT1-01/state`, 'own', { qos: 1 });
  await t1.publishAsync(`${base}/MT1-02/state`, 'spoofed', { qos: 1 });
  await t1.publishAsync(`${base}/MT1-01/config`, 'self-config', { qos: 1, retain: true });
  await wait(500);
  assert.deepEqual(seen, [`${base}/MT1-01/state own`]);
  console.log('✓ a tap publishes its own state, not another tap’s state or its own config');
  await agent.publishAsync(`${base}/MT1-01/config`, '{"version":2}', { qos: 1, retain: true });
  await agent.publishAsync(`${base}/MT1-02/config`, '{"version":7}', { qos: 1, retain: true });
  await agent.publishAsync(`${base}/ota`, '{"version":"1.0.0"}', { qos: 1, retain: true });
  const got = [];
  t1.on('message', (t, p) => got.push(`${t} ${p}`));
  const granted = await t1.subscribeAsync([`${base}/MT1-01/config`, `${base}/ota`, `${base}/MT1-02/config`, `${base}/#`], { qos: 1 });
  await wait(500);
  assert.deepEqual([...new Set(got)].sort(), [`${base}/MT1-01/config {"version":2}`, `${base}/ota {"version":"1.0.0"}`]);
  console.log('✓ a tap reads its own config and the plant’s firmware announcement only', granted.map((g) => g.qos).join(','));
  await t1.endAsync();
} else {
  await refused(tap('MT1-01'), 'the revoked tap is refused');
  const t2 = await connect(tap('MT1-02'));
  await t2.publishAsync(`${base}/MT1-02/state`, 'still here', { qos: 1 });
  await wait(500);
  assert.deepEqual(seen.filter((x) => x.includes('/state ')), [`${base}/MT1-02/state still here`]);
  console.log('✓ the other tap carries on');
  await t2.endAsync();
}
await agent.endAsync();
