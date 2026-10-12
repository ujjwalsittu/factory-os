// Tap simulator (decision 063): publishes MT-1-shaped state messages to the plant broker, one per heartbeat, following a
// script of states, with optional dropouts. Usage:
//   node scripts/simulate-tap.mjs --tenant azeonics --plant NM1 --device MT1-01 --script "idle:5,running:30,idle:5"
//     [--mqtt mqtt://localhost:1883] [--heartbeat 60] [--speed 60] [--drop 10-15] [--seq 1]
// --speed compresses time for testing (60 = a minute per second), while the `at` timestamps stay real-time minutes.
import { stateTopic } from '@factoryos/iot-protocol';
import mqtt from 'mqtt';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const tenant = arg('tenant');
const plant = arg('plant');
const device = arg('device');
if (!tenant || !plant || !device) throw new Error('Give --tenant, --plant and --device');
const heartbeat = Number(arg('heartbeat', '60'));
const speed = Number(arg('speed', '1'));
const [dropFrom, dropTo] = (arg('drop', '') || '-1--1').split('-').map(Number);
const steps = arg('script', 'idle:5,running:30,idle:5')
  .split(',')
  .flatMap((p) => {
    const [state, minutes] = p.split(':');
    return Array.from({ length: Math.round((Number(minutes) * 60) / heartbeat) }, () => state);
  });
let seq = Number(arg('seq', String(Date.now())));
const client = await mqtt.connectAsync(arg('mqtt', 'mqtt://localhost:1883'));
const topic = stateTopic(tenant, plant, device);
const t0 = Date.now() - steps.length * heartbeat * 1000;
for (const [i, state] of steps.entries()) {
  const minute = (i * heartbeat) / 60;
  if (minute >= dropFrom && minute < dropTo) continue; // the tap was offline
  await client.publishAsync(topic, JSON.stringify({ seq: seq++, state, at: new Date(t0 + i * heartbeat * 1000).toISOString() }), { qos: 1 });
  if (speed > 0) await new Promise((r) => setTimeout(r, (heartbeat * 1000) / speed));
}
await client.endAsync();
console.log(`published ${steps.length} heartbeats for ${device} on ${topic}`);
