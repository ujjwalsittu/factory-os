// Decision 064: forwards the taps' latest status reports to FactoryOS. Only the latest report per tap matters, so it
// is kept in memory (the broker retains each tap's last status and resends it after a restart).
import { parseTapStatus, type TapStatus } from '@factoryos/iot-protocol';

export interface StatusRelayOptions {
  apiUrl: string;
  key: string;
  fetchImpl?: typeof fetch | undefined;
  log?: ((msg: string) => void) | undefined;
}

type Report = TapStatus & { device: string };

export class StatusRelay {
  private readonly pending = new Map<string, Report>();

  constructor(private readonly opts: StatusRelayOptions) {}

  get size() {
    return this.pending.size;
  }

  receive(device: string, payload: Uint8Array | string) {
    if (!payload.length) return; // a cleared retained message
    const s = parseTapStatus(payload);
    if ('error' in s) return this.opts.log?.(`ignored status from ${device}: ${s.error}`);
    this.pending.set(device, { device, ...s });
  }

  /** Posts every pending report; keeps them all when the API can't be reached, drops refused ones with a log line. */
  async flush(): Promise<{ sent: number; ok: boolean }> {
    const batch = [...this.pending.values()];
    if (!batch.length) return { sent: 0, ok: true };
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.apiUrl.replace(/\/$/, '')}/iot/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.key}` },
        body: JSON.stringify({ statuses: batch }),
      });
    } catch (e) {
      this.opts.log?.(`status: API unreachable (${(e as Error).message})`);
      return { sent: batch.length, ok: false };
    }
    if (!res.ok) {
      this.opts.log?.(`status: API answered ${res.status}`);
      // A 400 means a report the API can't take; drop the batch rather than resend it forever.
      if (res.status === 400) for (const r of batch) this.settle(r);
      return { sent: batch.length, ok: false };
    }
    const { results } = (await res.json()) as { results: { device: string; status: 'accepted' | 'refused'; reason?: string }[] };
    batch.forEach((r, i) => {
      const out = results[i];
      if (out?.status === 'refused') this.opts.log?.(`status from ${r.device} refused: ${out.reason ?? ''}`);
      this.settle(r);
    });
    return { sent: batch.length, ok: true };
  }

  /** Removes a report unless a newer one arrived while it was in flight. */
  private settle(r: Report) {
    if (this.pending.get(r.device) === r) this.pending.delete(r.device);
  }
}
