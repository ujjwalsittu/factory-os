// Entry point: configuration from the environment (see README).
import { mkdirSync, readFileSync } from 'node:fs';
import { EdgeAgent } from './agent.js';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k}`);
  return v;
};
const dataDir = process.env.FACTORYOS_DATA_DIR ?? './data';
mkdirSync(dataDir, { recursive: true });
const file = (k: string) => readFileSync(need(k), 'utf8');
// TLS to the broker with the agent's own certificate (decision 064): set all three, or none on a plain local broker.
const mqttTls = process.env.MQTT_CA ? { ca: file('MQTT_CA'), cert: file('MQTT_CERT'), key: file('MQTT_KEY') } : undefined;
// Signed firmware updates: on when FIRMWARE_DIR is set; HTTPS with the edge's certificate from the plant CA.
const ota = process.env.FIRMWARE_DIR
  ? { dir: process.env.FIRMWARE_DIR, publicKey: need('OTA_PUBLIC_KEY'), baseUrl: need('OTA_BASE_URL'), port: Number(process.env.OTA_PORT ?? 8443), tls: { key: file('OTA_TLS_KEY'), cert: file('OTA_TLS_CERT') } }
  : undefined;
const agent = new EdgeAgent({
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
  apiUrl: need('FACTORYOS_API_URL'),
  key: need('FACTORYOS_EDGE_KEY'),
  tenant: need('FACTORYOS_TENANT'),
  plant: need('FACTORYOS_PLANT'),
  dataDir,
  mqttTls,
  ota,
  log: (m) => console.log(new Date().toISOString(), m),
});
await agent.start();
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void agent.stop().then(() => process.exit(0)));
