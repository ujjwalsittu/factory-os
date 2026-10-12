// The plant edge agent (decision 063): subscribes to the taps' state topics on the local broker, queues every valid
// message to disk, and forwards the queue to FactoryOS over HTTPS. Decision 064 adds the taps' settings (published as
// retained config messages), their status reports, and signed firmware updates served on the plant network.
import { deviceFromStatusTopic, deviceFromTopic, otaTopic, parseTapMessage, plantStateFilter, plantStatusFilter } from '@factoryos/iot-protocol';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import { ConfigSync } from './config-sync.js';
import { Forwarder } from './forwarder.js';
import { type OtaOptions, OtaServer } from './ota.js';
import { PrintRelay } from './printer.js';
import { FileQueue } from './queue.js';
import { StatusRelay } from './status-relay.js';

export interface AgentConfig {
  mqttUrl: string;
  apiUrl: string;
  key: string;
  tenant: string;
  plant: string;
  dataDir: string;
  flushMs?: number | undefined;
  /** How often to fetch the taps' settings and post their status (default a minute). */
  syncMs?: number | undefined;
  /** TLS to the broker with the agent's own certificate from the plant CA (PEM strings). */
  mqttTls?: { ca: string; cert: string; key: string } | undefined;
  /** Signed firmware updates; off when absent. */
  ota?: Omit<OtaOptions, 'log'> | undefined;
  /** Label printing (decision 065): how often to ask for jobs (default 3 s; 0 turns printing off), and the allowed printers. */
  printMs?: number | undefined;
  printerPorts?: number[] | undefined;
  printerHosts?: string[] | undefined;
  log?: ((msg: string) => void) | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export class EdgeAgent {
  readonly queue: FileQueue;
  readonly forwarder: Forwarder;
  readonly configs: ConfigSync;
  readonly statuses: StatusRelay;
  readonly ota: OtaServer | null;
  readonly printing: PrintRelay;
  private client: MqttClient | null = null;
  private timer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private printTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly cfg: AgentConfig) {
    this.queue = new FileQueue(cfg.dataDir);
    this.forwarder = new Forwarder(this.queue, { apiUrl: cfg.apiUrl, key: cfg.key, log: cfg.log, fetchImpl: cfg.fetchImpl });
    const publish = async (topic: string, payload: string) => void (await this.client!.publishAsync(topic, payload, { qos: 1, retain: true }));
    this.configs = new ConfigSync({ apiUrl: cfg.apiUrl, key: cfg.key, tenant: cfg.tenant, plant: cfg.plant, publish, fetchImpl: cfg.fetchImpl, log: cfg.log });
    this.statuses = new StatusRelay({ apiUrl: cfg.apiUrl, key: cfg.key, fetchImpl: cfg.fetchImpl, log: cfg.log });
    this.ota = cfg.ota ? new OtaServer({ ...cfg.ota, log: cfg.log }) : null;
    this.printing = new PrintRelay({ apiUrl: cfg.apiUrl, key: cfg.key, ports: cfg.printerPorts, hosts: cfg.printerHosts, fetchImpl: cfg.fetchImpl, log: cfg.log });
  }

  async start() {
    const log = this.cfg.log ?? (() => {});
    const opts: IClientOptions = { clientId: `factoryos-edge-${this.cfg.plant}`, clean: false, reconnectPeriod: 2000, ...this.cfg.mqttTls };
    const client = mqtt.connect(this.cfg.mqttUrl, opts);
    this.client = client;
    client.on('message', (topic, payload) => {
      const tap = deviceFromStatusTopic(topic, this.cfg.tenant, this.cfg.plant);
      if (tap) return this.statuses.receive(tap, payload);
      const device = deviceFromTopic(topic, this.cfg.tenant, this.cfg.plant);
      if (!device) return;
      const m = parseTapMessage(payload);
      if ('error' in m) return log(`ignored message on ${topic}: ${m.error}`);
      this.queue.push({ device, ...m });
    });
    client.on('error', (e) => log(`mqtt: ${e.message}`));
    await new Promise<void>((resolve) => client.once('connect', () => resolve()));
    await client.subscribeAsync([plantStateFilter(this.cfg.tenant, this.cfg.plant), plantStatusFilter(this.cfg.tenant, this.cfg.plant)], { qos: 1 });
    log(`subscribed to ${plantStateFilter(this.cfg.tenant, this.cfg.plant)}; ${this.queue.size} queued from before`);
    if (this.ota) log(`firmware server on port ${await this.ota.start()}`);
    this.schedule(0);
    this.scheduleSync(0);
    if (this.cfg.printMs !== 0) this.schedulePrint(0);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.printTimer) clearTimeout(this.printTimer);
    await this.ota?.stop();
    await this.client?.endAsync();
  }

  /** One round of the slow loop: settings out, status in, firmware announcement. Each part fails on its own. */
  async syncOnce() {
    const log = this.cfg.log ?? (() => {});
    await this.configs.sync().catch((e: Error) => log(`config: ${e.message}`));
    await this.statuses.flush();
    if (this.ota) {
      const { manifest, changed } = this.ota.refresh();
      if (changed) {
        // Retained, so a tap that connects later still sees it; an empty payload withdraws the announcement.
        await this.client!.publishAsync(otaTopic(this.cfg.tenant, this.cfg.plant), manifest ? JSON.stringify(manifest) : '', { qos: 1, retain: true });
        log(manifest ? `announced firmware ${manifest.version}` : 'no valid firmware; announcement withdrawn');
      }
    }
  }

  private schedulePrint(ms: number) {
    if (this.stopped) return;
    this.printTimer = setTimeout(async () => {
      await this.printing.poll().catch((e: Error) => this.cfg.log?.(`printing: ${e.message}`));
      this.schedulePrint(this.cfg.printMs ?? 3000);
    }, ms);
  }

  private scheduleSync(ms: number) {
    if (this.stopped) return;
    this.syncTimer = setTimeout(async () => {
      await this.syncOnce();
      this.scheduleSync(this.cfg.syncMs ?? 60_000);
    }, ms);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      const out = await this.forwarder.flush().catch(() => ({ retryAfterMs: 5000, sent: 0, settled: 0 }));
      const more = out.retryAfterMs === null && this.queue.size > 0;
      this.schedule(out.retryAfterMs ?? (more ? 0 : (this.cfg.flushMs ?? 2000)));
    }, ms);
  }
}
