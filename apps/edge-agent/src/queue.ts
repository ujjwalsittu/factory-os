// Store-and-forward queue (decision 063): every tap message is appended to a JSON-lines file before anything else, so
// it survives a restart or an internet outage; it leaves the queue only when the API has answered for it. Refused
// events move to a quarantine file with the reason and are never resent.
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IngestEvent, IngestResult } from '@factoryos/iot-protocol';

const key = (e: { device: string; seq: number }) => `${e.device}#${e.seq}`;

export class FileQueue {
  private items: IngestEvent[];
  private readonly file: string;
  private readonly quarantineFile: string;

  constructor(dir: string) {
    this.file = join(dir, 'queue.jsonl');
    this.quarantineFile = join(dir, 'quarantine.jsonl');
    this.items = existsSync(this.file)
      ? readFileSync(this.file, 'utf8')
          .split('\n')
          .filter((l) => l.trim())
          .flatMap((l) => {
            try {
              return [JSON.parse(l) as IngestEvent];
            } catch {
              return []; // a line cut short by a power loss
            }
          })
      : [];
  }

  get size() {
    return this.items.length;
  }

  push(e: IngestEvent) {
    appendFileSync(this.file, `${JSON.stringify(e)}\n`);
    this.items.push(e);
  }

  peek(max: number) {
    return this.items.slice(0, max);
  }

  /** Apply the API's per-event results: accepted and duplicate leave, refused go to quarantine, the rest stay. */
  settle(batch: IngestEvent[], results: IngestResult[]) {
    const byKey = new Map(results.map((r) => [key(r), r]));
    const done = new Set<string>();
    for (const e of batch) {
      const r = byKey.get(key(e));
      if (!r) continue;
      if (r.status === 'refused') appendFileSync(this.quarantineFile, `${JSON.stringify({ ...e, reason: r.reason ?? 'refused', at_quarantine: new Date().toISOString() })}\n`);
      done.add(key(e));
    }
    if (!done.size) return 0;
    this.items = this.items.filter((e) => !done.has(key(e)));
    this.rewrite();
    return done.size;
  }

  /** A whole batch the API rejected as malformed: quarantined so it can't block the queue forever. */
  quarantine(batch: IngestEvent[], reason: string) {
    this.settle(batch, batch.map((e) => ({ device: e.device, seq: e.seq, status: 'refused' as const, reason })));
  }

  private rewrite() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.items.map((e) => `${JSON.stringify(e)}\n`).join(''));
    renameSync(tmp, this.file);
  }
}
