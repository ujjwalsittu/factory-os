// The plant edge agent (decision 063): subscribes to the taps' state topics on the local broker, queues every valid
// message to disk, and forwards the queue to FactoryOS over HTTPS.
import { deviceFromTopic, parseTapMessage, plantStateFilter } from '@factoryos/iot-protocol';
import mqtt, { type MqttClient } from 'mqtt';
import { Forwarder } from './forwarder.js';
import { FileQueue } from './queue.js';

export interface AgentConfig {
  mqttUrl: string;
  apiUrl: string;
  key: string;
  tenant: string;
  plant: string;
  dataDir: string;
  flushMs?: number | undefined;
  log?: ((msg: string) => void) | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export class EdgeAgent {
  readonly queue: FileQueue;
  readonly forwarder: Forwarder;
  private client: MqttClient | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly cfg: AgentConfig) {
    this.queue = new FileQueue(cfg.dataDir);
    this.forwarder = new Forwarder(this.queue, { apiUrl: cfg.apiUrl, key: cfg.key, log: cfg.log, fetchImpl: cfg.fetchImpl });
  }

  async start() {
    const log = this.cfg.log ?? (() => {});
    const client = mqtt.connect(this.cfg.mqttUrl, { clientId: `factoryos-edge-${this.cfg.plant}`, clean: false, reconnectPeriod: 2000 });
    this.client = client;
    client.on('message', (topic, payload) => {
      const device = deviceFromTopic(topic, this.cfg.tenant, this.cfg.plant);
      if (!device) return;
      const m = parseTapMessage(payload);
      if ('error' in m) return log(`ignored message on ${topic}: ${m.error}`);
      this.queue.push({ device, ...m });
    });
    client.on('error', (e) => log(`mqtt: ${e.message}`));
    await new Promise<void>((resolve) => client.once('connect', () => resolve()));
    await client.subscribeAsync(plantStateFilter(this.cfg.tenant, this.cfg.plant), { qos: 1 });
    log(`subscribed to ${plantStateFilter(this.cfg.tenant, this.cfg.plant)}; ${this.queue.size} queued from before`);
    this.schedule(0);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.client?.endAsync();
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
