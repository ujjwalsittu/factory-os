// Posts queued events to the FactoryOS API in batches with backoff (decision 063).
import type { IngestEvent, IngestResult } from '@factoryos/iot-protocol';
import type { FileQueue } from './queue.js';

export interface ForwarderOptions {
  apiUrl: string;
  key: string;
  batchSize?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
  log?: ((msg: string) => void) | undefined;
}

export type FlushOutcome = { sent: number; settled: number; retryAfterMs: number | null };

export class Forwarder {
  private failures = 0;

  constructor(
    private readonly queue: FileQueue,
    private readonly opts: ForwarderOptions,
  ) {}

  /** One round: post the oldest batch and apply the results. Returns when to retry after a failure. */
  async flush(): Promise<FlushOutcome> {
    const batch = this.queue.peek(this.opts.batchSize ?? 500);
    if (!batch.length) return { sent: 0, settled: 0, retryAfterMs: null };
    const log = this.opts.log ?? (() => {});
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.apiUrl.replace(/\/$/, '')}/iot/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.key}` },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      log(`ingest unreachable: ${(e as Error).message}; ${this.queue.size} queued`);
      return { sent: batch.length, settled: 0, retryAfterMs: this.backoff() };
    }
    if (res.ok) {
      const { results } = (await res.json()) as { results: IngestResult[] };
      this.failures = 0;
      const settled = this.queue.settle(batch, results);
      const refused = results.filter((r) => r.status === 'refused');
      if (refused.length) log(`${refused.length} event(s) refused and quarantined, e.g. ${refused[0]!.device}#${refused[0]!.seq}: ${refused[0]!.reason}`);
      return { sent: batch.length, settled, retryAfterMs: null };
    }
    if (res.status === 400) {
      // The whole request was malformed: set it aside rather than retrying it forever.
      this.queue.quarantine(batch, `HTTP 400: ${await res.text()}`);
      log(`batch of ${batch.length} rejected as malformed and quarantined`);
      return { sent: batch.length, settled: batch.length, retryAfterMs: null };
    }
    log(`ingest answered ${res.status}${res.status === 401 ? ' (check the edge key)' : ''}; ${this.queue.size} queued`);
    return { sent: batch.length, settled: 0, retryAfterMs: this.backoff() };
  }

  private backoff() {
    this.failures++;
    return Math.min(60_000, 1000 * 2 ** Math.min(this.failures - 1, 6));
  }
}

export type { IngestEvent };
