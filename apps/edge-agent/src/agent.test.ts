import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateTopic, type IngestEvent, type IngestResult } from '@factoryos/iot-protocol';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { afterEach, describe, expect, it } from 'vitest';
import { EdgeAgent } from './agent.js';
import { Forwarder } from './forwarder.js';
import { FileQueue } from './queue.js';

const dir = () => mkdtempSync(join(tmpdir(), 'edge-'));
const ev = (seq: number, state = 'running'): IngestEvent => ({ device: 'MT1-01', seq, state: state as IngestEvent['state'], at: new Date().toISOString() });

/** A fake ingest API: answers per event, can be switched off to simulate an outage. */
function fakeApi() {
  const stored = new Set<string>();
  const api = { up: true, calls: 0, refuse: new Set<number>() };
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    api.calls++;
    if (!api.up) throw new Error('ECONNREFUSED');
    const { events } = JSON.parse(String(init.body)) as { events: IngestEvent[] };
    const results: IngestResult[] = events.map((e) => {
      if (api.refuse.has(e.seq)) return { device: e.device, seq: e.seq, status: 'refused', reason: 'Unknown state' };
      const k = `${e.device}#${e.seq}`;
      const dup = stored.has(k);
      stored.add(k);
      return { device: e.device, seq: e.seq, status: dup ? 'duplicate' : 'accepted' };
    });
    return new Response(JSON.stringify({ results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { api, stored, fetchImpl };
}

describe('edge queue and forwarder (decision 063)', () => {
  it('keeps events across a restart until the API answers for them', () => {
    const d = dir();
    const q = new FileQueue(d);
    q.push(ev(1));
    q.push(ev(2));
    expect(new FileQueue(d).size).toBe(2);
  });

  it('removes accepted and duplicate events and quarantines refused ones', async () => {
    const d = dir();
    const q = new FileQueue(d);
    for (const s of [1, 2, 3]) q.push(ev(s));
    const { api, fetchImpl } = fakeApi();
    api.refuse.add(3);
    const f = new Forwarder(q, { apiUrl: 'http://api', key: 'k', fetchImpl });
    expect((await f.flush()).settled).toBe(3);
    expect(q.size).toBe(0);
    q.push(ev(1));
    await f.flush();
    expect(q.size).toBe(0); // a duplicate is settled too
    expect(new FileQueue(d).size).toBe(0);
  });

  it('keeps the whole batch through an outage and catches up with backoff', async () => {
    const q = new FileQueue(dir());
    for (const s of [1, 2]) q.push(ev(s));
    const { api, stored, fetchImpl } = fakeApi();
    api.up = false;
    const f = new Forwarder(q, { apiUrl: 'http://api', key: 'k', fetchImpl });
    const a = await f.flush();
    const b = await f.flush();
    expect([q.size, a.retryAfterMs, b.retryAfterMs]).toEqual([2, 1000, 2000]);
    api.up = true;
    await f.flush();
    expect([q.size, stored.size]).toEqual([0, 2]);
  });
});

describe('edge agent over MQTT', () => {
  let server: Server | null = null;
  let agent: EdgeAgent | null = null;
  afterEach(async () => {
    await agent?.stop();
    await new Promise((r) => server?.close(r));
  });

  it('queues tap messages from the plant topics and forwards them', async () => {
    const broker = await Aedes.createBroker();
    server = createServer(broker.handle);
    await new Promise<void>((r) => server!.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const { stored, fetchImpl } = fakeApi();
    agent = new EdgeAgent({ mqttUrl: `mqtt://127.0.0.1:${port}`, apiUrl: 'http://api', key: 'k', tenant: 'azeonics', plant: 'NM1', dataDir: dir(), flushMs: 50, fetchImpl });
    await agent.start();
    const tap = await mqtt.connectAsync(`mqtt://127.0.0.1:${port}`);
    const at = new Date().toISOString();
    await tap.publishAsync(stateTopic('azeonics', 'NM1', 'MT1-01'), JSON.stringify({ seq: 1, state: 'running', at }), { qos: 1 });
    await tap.publishAsync(stateTopic('azeonics', 'NM1', 'MT1-02'), JSON.stringify({ seq: 1, state: 'idle', at }), { qos: 1 });
    await tap.publishAsync(stateTopic('azeonics', 'NM1', 'MT1-03'), 'garbage', { qos: 1 });
    await tap.publishAsync(stateTopic('other', 'NM1', 'MT1-04'), JSON.stringify({ seq: 1, state: 'idle', at }), { qos: 1 });
    await tap.endAsync();
    for (let i = 0; i < 50 && stored.size < 2; i++) await new Promise((r) => setTimeout(r, 50));
    expect([...stored].sort()).toEqual(['MT1-01#1', 'MT1-02#1']);
    await new Promise<void>((r) => broker.close(() => r()));
  });
});
