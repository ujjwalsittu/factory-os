// Decision 064: fetches the taps' settings from FactoryOS and publishes each changed one as a retained config message.
import { deviceTopic, type TapConfigsResponse } from '@factoryos/iot-protocol';

export interface ConfigSyncOptions {
  apiUrl: string;
  key: string;
  tenant: string;
  plant: string;
  publish: (topic: string, payload: string) => Promise<void>;
  fetchImpl?: typeof fetch | undefined;
  log?: ((msg: string) => void) | undefined;
}

export class ConfigSync {
  /** What this process last published per tap; empty after a restart, so everything is published once again. */
  private readonly published = new Map<string, string>();

  constructor(private readonly opts: ConfigSyncOptions) {}

  async sync(): Promise<{ published: number; cleared: number }> {
    const res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.apiUrl.replace(/\/$/, '')}/iot/config`, { headers: { Authorization: `Bearer ${this.opts.key}` } });
    if (!res.ok) throw new Error(`GET /iot/config answered ${res.status}`);
    const { taps } = (await res.json()) as TapConfigsResponse;
    const topic = (device: string) => deviceTopic(this.opts.tenant, this.opts.plant, device, 'config');
    let published = 0;
    let cleared = 0;
    for (const t of taps) {
      const payload = JSON.stringify(t.config);
      if (this.published.get(t.device) === payload) continue;
      await this.opts.publish(topic(t.device), payload);
      this.published.set(t.device, payload);
      this.opts.log?.(`config v${t.config.version} published to ${t.device}`);
      published++;
    }
    // A tap that is retired or moved to another edge: clear its retained config.
    for (const device of [...this.published.keys()]) {
      if (taps.some((t) => t.device === device)) continue;
      await this.opts.publish(topic(device), '');
      this.published.delete(device);
      cleared++;
    }
    return { published, cleared };
  }
}
