// Decision 065: label printing on the plant network. The agent claims its printers' jobs from FactoryOS, sends each
// job's ZPL to the printer over raw TCP (port 9100 on Zebra-compatible printers) and reports the result.
//
// The printer address comes from FactoryOS, so the agent only connects to printer ports (PRINTER_PORTS, default 9100)
// and, when PRINTER_HOSTS is set, only to those hosts: a FactoryOS account can't turn the edge into a way to reach
// other machines on the plant network.
import { connect } from 'node:net';

export interface PrintJob {
  id: string;
  host: string;
  port: number;
  zpl: string;
}

/** Sends the bytes and waits for the printer to close or the socket to finish; fails on error or timeout. */
export function sendZpl(host: string, port: number, zpl: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error(`Printer ${host}:${port} timed out`)));
    socket.once('error', (e) => finish(e));
    socket.once('connect', () => socket.end(zpl, 'utf8'));
    socket.once('close', (hadError) => finish(hadError ? new Error(`Printer ${host}:${port} closed with an error`) : undefined));
  });
}

export interface PrintRelayOptions {
  apiUrl: string;
  key: string;
  /** Ports the agent may print to; default [9100]. */
  ports?: number[] | undefined;
  /** Hosts the agent may print to; any host on an allowed port when unset. */
  hosts?: string[] | undefined;
  fetchImpl?: typeof fetch | undefined;
  send?: typeof sendZpl | undefined;
  log?: ((msg: string) => void) | undefined;
}

export class PrintRelay {
  constructor(private readonly opts: PrintRelayOptions) {}

  /** Why a job's printer is not allowed from this edge, or null. */
  refusal(job: Pick<PrintJob, 'host' | 'port'>): string | null {
    const ports = this.opts.ports?.length ? this.opts.ports : [9100];
    if (!ports.includes(job.port)) return `Port ${job.port} is not a printer port on this edge (PRINTER_PORTS)`;
    if (this.opts.hosts?.length && !this.opts.hosts.includes(job.host)) return `${job.host} is not an allowed printer on this edge (PRINTER_HOSTS)`;
    return null;
  }

  /** One round: claim jobs, print them in order, report each. Returns how many were printed and failed. */
  async poll(): Promise<{ printed: number; failed: number }> {
    const api = this.opts.apiUrl.replace(/\/$/, '');
    const f = this.opts.fetchImpl ?? fetch;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.key}` };
    const res = await f(`${api}/iot/print-jobs`, { headers });
    if (!res.ok) throw new Error(`GET /iot/print-jobs answered ${res.status}`);
    const { jobs } = (await res.json()) as { jobs: PrintJob[] };
    let printed = 0;
    let failed = 0;
    for (const job of jobs) {
      let error = this.refusal(job);
      if (!error) {
        try {
          await (this.opts.send ?? sendZpl)(job.host, job.port, job.zpl);
        } catch (e) {
          error = (e as Error).message;
        }
      }
      if (error) {
        failed++;
        this.opts.log?.(`print job ${job.id} failed: ${error}`);
      } else printed++;
      // A lost report is fine: the lease runs out and the job is handed out again.
      await f(`${api}/iot/print-jobs/${job.id}/result`, { method: 'POST', headers, body: JSON.stringify({ ok: !error, error }) }).catch((e: Error) => this.opts.log?.(`print result for ${job.id} not sent: ${e.message}`));
    }
    return { printed, failed };
  }
}
