// Entry point: configuration from the environment (see README).
import { mkdirSync } from 'node:fs';
import { EdgeAgent } from './agent.js';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k}`);
  return v;
};
const dataDir = process.env.FACTORYOS_DATA_DIR ?? './data';
mkdirSync(dataDir, { recursive: true });
const agent = new EdgeAgent({
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
  apiUrl: need('FACTORYOS_API_URL'),
  key: need('FACTORYOS_EDGE_KEY'),
  tenant: need('FACTORYOS_TENANT'),
  plant: need('FACTORYOS_PLANT'),
  dataDir,
  log: (m) => console.log(new Date().toISOString(), m),
});
await agent.start();
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void agent.stop().then(() => process.exit(0)));
