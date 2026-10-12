import { createHash, generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deviceTopic, type OtaManifest, otaSigningPayload, otaTopic, type TapConfigMessage } from '@factoryos/iot-protocol';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { afterEach, describe, expect, it } from 'vitest';
import { EdgeAgent } from './agent.js';
import { ConfigSync } from './config-sync.js';
import { ed25519PublicKey, OtaServer, scanFirmware } from './ota.js';
import { StatusRelay } from './status-relay.js';

const dir = () => mkdtempSync(join(tmpdir(), 'edge-'));
const cfg = (version: number, runAmps = 3): TapConfigMessage => ({ version, heartbeatSeconds: 60, offAmps: 0.5, runAmps, ctAmpsPerVolt: 30, debounceSeconds: 5, lights: { red: 'alarm', amber: 'idle', green: 'running' } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const status = (extra = {}) => JSON.stringify({ fwVersion: '1.0.0', configVersion: 2, uptime: 10, rssi: -60, outbox: 0, lastError: null, at: new Date().toISOString(), ...extra });

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64');
  return { raw, privateKey };
}
/** Writes `<name>.bin` and its signed manifest, as `firmware/scripts/sign.mjs` does. */
function build(d: string, name: string, version: string, privateKey: KeyObject, tamper?: (m: Record<string, unknown>) => void) {
  const bin = Buffer.from(`firmware ${version} ${'x'.repeat(1000)}`);
  writeFileSync(join(d, `${name}.bin`), bin);
  const m: Record<string, unknown> = { version, size: bin.length, sha256: createHash('sha256').update(bin).digest('hex') };
  m.signature = sign(null, Buffer.from(otaSigningPayload(m as Pick<OtaManifest, 'version' | 'size' | 'sha256'>)), privateKey).toString('base64');
  tamper?.(m);
  writeFileSync(join(d, `${name}.bin.manifest.json`), JSON.stringify(m));
  return bin;
}

describe('tap settings (decision 064)', () => {
  it('publishes each changed config once and clears a tap that left', async () => {
    let taps = [{ device: 'MT1-01', config: cfg(1) }, { device: 'MT1-02', config: cfg(1) }];
    const sent: [string, string][] = [];
    const s = new ConfigSync({ apiUrl: 'http://api', key: 'k', tenant: 'azeonics', plant: 'NM1', publish: async (t, p) => void sent.push([t, p]), fetchImpl: (async () => json({ taps })) as unknown as typeof fetch });
    expect(await s.sync()).toEqual({ published: 2, cleared: 0 });
    expect(await s.sync()).toEqual({ published: 0, cleared: 0 });
    taps = [{ device: 'MT1-01', config: cfg(2, 6.5) }];
    expect(await s.sync()).toEqual({ published: 1, cleared: 1 });
    expect(sent.slice(2)).toEqual([
      [deviceTopic('azeonics', 'NM1', 'MT1-01', 'config'), JSON.stringify(cfg(2, 6.5))],
      [deviceTopic('azeonics', 'NM1', 'MT1-02', 'config'), ''],
    ]);
  });

  it('fails loudly when the API refuses the key', async () => {
    const s = new ConfigSync({ apiUrl: 'http://api', key: 'k', tenant: 'azeonics', plant: 'NM1', publish: async () => {}, fetchImpl: (async () => json({}, 401)) as unknown as typeof fetch });
    await expect(s.sync()).rejects.toThrow(/401/);
  });
});

describe('tap status relay (decision 064)', () => {
  it('sends the latest report per tap, keeps them through an outage, and ignores bad ones', async () => {
    let up = false;
    const posted: unknown[] = [];
    const r = new StatusRelay({
      apiUrl: 'http://api',
      key: 'k',
      fetchImpl: (async (_u: string, init: RequestInit) => {
        if (!up) throw new Error('ECONNREFUSED');
        const { statuses } = JSON.parse(String(init.body)) as { statuses: { device: string }[] };
        posted.push(...statuses);
        return json({ results: statuses.map((x) => ({ device: x.device, status: x.device === 'GONE' ? 'refused' : 'accepted' })) });
      }) as unknown as typeof fetch,
    });
    r.receive('MT1-01', status({ outbox: 5 }));
    r.receive('MT1-01', status({ outbox: 1 }));
    r.receive('MT1-02', 'garbage');
    r.receive('GONE', status());
    expect((await r.flush()).ok).toBe(false);
    expect(r.size).toBe(2);
    up = true;
    expect(await r.flush()).toEqual({ sent: 2, ok: true });
    expect(r.size).toBe(0);
    expect(posted).toMatchObject([{ device: 'MT1-01', outbox: 1 }, { device: 'GONE' }]);
  });
});

describe('signed firmware (decision 064)', () => {
  it('takes the newest build whose size, hash and signature check out', () => {
    const d = dir();
    const { raw, privateKey } = keys();
    const other = keys();
    build(d, 'mt1-1.0.0', '1.0.0', privateKey);
    build(d, 'mt1-1.1.0', '1.1.0', privateKey);
    build(d, 'mt1-1.2.0-dev', '1.2.0-dev', privateKey);
    build(d, 'mt1-9.0.0', '9.0.0', other.privateKey); // signed with another key
    build(d, 'mt1-8.0.0', '8.0.0', privateKey, (m) => (m.version = '8.0.1')); // signature over another version
    build(d, 'mt1-7.0.0', '7.0.0', privateKey, (m) => (m.size = (m.size as number) + 1));
    const bad = build(d, 'mt1-6.0.0', '6.0.0', privateKey);
    writeFileSync(join(d, 'mt1-6.0.0.bin'), Buffer.from(bad.toString().replace('firmware', 'FIRMWARE')));
    const { valid, skipped } = scanFirmware(d, ed25519PublicKey(raw));
    expect(valid.map((b) => b.manifest.version)).toEqual(['1.2.0-dev', '1.1.0', '1.0.0']);
    expect(Object.fromEntries(skipped.map((s) => [s.file, s.reason]))).toEqual({
      'mt1-6.0.0.bin': 'SHA-256 differs from the manifest',
      'mt1-7.0.0.bin': 'Size differs from the manifest',
      'mt1-8.0.0.bin': 'Bad signature',
      'mt1-9.0.0.bin': 'Bad signature',
    });
  });

  it('serves only the announced build', async () => {
    const d = dir();
    const { raw, privateKey } = keys();
    const bin = build(d, 'mt1-1.0.0', '1.0.0', privateKey);
    writeFileSync(join(d, 'secret.txt'), 'nope');
    const ota = new OtaServer({ dir: d, publicKey: raw, baseUrl: 'http://edge:8443', port: 0 });
    expect(ota.refresh()).toMatchObject({ changed: true, manifest: { version: '1.0.0', url: 'http://edge:8443/firmware/mt1-1.0.0.bin' } });
    expect(ota.refresh().changed).toBe(false);
    const port = await ota.start();
    try {
      const get = (p: string) => fetch(`http://127.0.0.1:${port}${p}`);
      const ok = await get('/firmware/mt1-1.0.0.bin');
      expect(Buffer.from(await ok.arrayBuffer())).toEqual(bin);
      for (const p of ['/firmware/secret.txt', '/firmware/..%2Fsecret.txt', '/firmware/mt1-1.0.0.bin.manifest.json', '/']) expect((await get(p)).status).toBe(404);
    } finally {
      await ota.stop();
    }
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => ed25519PublicKey('AAAA')).toThrow(/32 bytes/);
  });
});

describe('edge agent with settings, status and firmware over MQTT', () => {
  let server: Server | null = null;
  let agent: EdgeAgent | null = null;
  afterEach(async () => {
    await agent?.stop();
    await new Promise((r) => server?.close(r));
  });

  it('publishes retained configs and the firmware manifest, and forwards tap status', async () => {
    const broker = await Aedes.createBroker();
    server = createServer(broker.handle);
    await new Promise<void>((r) => server!.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const fw = join(dir(), 'fw');
    mkdirSync(fw);
    const { raw, privateKey } = keys();
    build(fw, 'mt1-1.0.0', '1.0.0', privateKey);
    const statuses: unknown[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/iot/config')) return json({ taps: [{ device: 'MT1-01', config: cfg(3) }] });
      if (url.endsWith('/iot/status')) {
        const body = JSON.parse(String(init!.body)) as { statuses: { device: string }[] };
        statuses.push(...body.statuses);
        return json({ results: body.statuses.map((s) => ({ device: s.device, status: 'accepted' })) });
      }
      return json({ results: [] });
    }) as unknown as typeof fetch;
    agent = new EdgeAgent({ mqttUrl: `mqtt://127.0.0.1:${port}`, apiUrl: 'http://api', key: 'k', tenant: 'azeonics', plant: 'NM1', dataDir: dir(), syncMs: 60_000, fetchImpl, ota: { dir: fw, publicKey: raw, baseUrl: 'http://edge:8443', port: 0 } });
    await agent.start();
    // The tap reports, then (as after a reboot) subscribes and gets the retained config and manifest.
    const tap = await mqtt.connectAsync(`mqtt://127.0.0.1:${port}`);
    await tap.publishAsync(deviceTopic('azeonics', 'NM1', 'MT1-01', 'status'), status({ configVersion: 2 }), { qos: 1, retain: true });
    await new Promise((r) => setTimeout(r, 100));
    await agent.syncOnce();
    const got = new Map<string, string>();
    tap.on('message', (t, p) => got.set(t, p.toString()));
    await tap.subscribeAsync([deviceTopic('azeonics', 'NM1', 'MT1-01', 'config'), otaTopic('azeonics', 'NM1')], { qos: 1 });
    for (let i = 0; i < 40 && got.size < 2; i++) await new Promise((r) => setTimeout(r, 25));
    await tap.endAsync();
    expect(JSON.parse(got.get(deviceTopic('azeonics', 'NM1', 'MT1-01', 'config'))!)).toEqual(cfg(3));
    expect(JSON.parse(got.get(otaTopic('azeonics', 'NM1'))!)).toMatchObject({ version: '1.0.0', url: 'http://edge:8443/firmware/mt1-1.0.0.bin' });
    expect(statuses).toMatchObject([{ device: 'MT1-01', configVersion: 2, fwVersion: '1.0.0' }]);
    await new Promise<void>((r) => broker.close(() => r()));
  });
});
