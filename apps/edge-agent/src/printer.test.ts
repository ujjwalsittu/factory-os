import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { PrintRelay, sendZpl } from './printer.js';

/** A fake Zebra printer: collects what each connection sends. */
async function fakePrinter() {
  const received: string[] = [];
  const server = createServer((s) => {
    let buf = '';
    s.on('data', (d) => (buf += d.toString()));
    s.on('end', () => {
      received.push(buf);
      s.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, received, port: (server.address() as { port: number }).port };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('label printing (decision 065)', () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise((r) => (server ? server.close(r) : r(null)));
    server = null;
  });

  it('sends ZPL over raw TCP', async () => {
    const p = await fakePrinter();
    server = p.server;
    await sendZpl('127.0.0.1', p.port, '^XA^FDhello^FS^XZ');
    await new Promise((r) => setTimeout(r, 50));
    expect(p.received).toEqual(['^XA^FDhello^FS^XZ']);
  });

  it('fails when the printer is unreachable', async () => {
    const p = await fakePrinter();
    const port = p.port;
    await new Promise((r) => p.server.close(r));
    await expect(sendZpl('127.0.0.1', port, '^XA^XZ', 2000)).rejects.toThrow();
  });

  it('prints claimed jobs, refuses printers outside the allowed ports and hosts, and reports each result', async () => {
    const p = await fakePrinter();
    server = p.server;
    const results: { id: string; ok: boolean; error: string | null }[] = [];
    const jobs = [
      { id: 'a', host: '127.0.0.1', port: p.port, zpl: '^XA^FDone^FS^XZ' },
      { id: 'b', host: '127.0.0.1', port: 22, zpl: 'ssh-probe' },
      { id: 'c', host: '10.0.0.9', port: p.port, zpl: '^XA^XZ' },
      { id: 'd', host: '127.0.0.1', port: p.port, zpl: '^XA^FDtwo^FS^XZ' },
    ];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/iot/print-jobs')) return json({ jobs });
      const id = url.split('/').at(-2)!;
      results.push({ id, ...(JSON.parse(String(init!.body)) as { ok: boolean; error: string | null }) });
      return json({ id, status: 'printed' });
    }) as unknown as typeof fetch;
    const relay = new PrintRelay({ apiUrl: 'http://api', key: 'k', ports: [p.port], hosts: ['127.0.0.1'], fetchImpl });
    expect(await relay.poll()).toEqual({ printed: 2, failed: 2 });
    await new Promise((r) => setTimeout(r, 50));
    expect(p.received).toEqual(['^XA^FDone^FS^XZ', '^XA^FDtwo^FS^XZ']);
    expect(results.map((r) => [r.id, r.ok])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
      ['d', true],
    ]);
    expect(results[1]!.error).toMatch(/not a printer port/);
    expect(results[2]!.error).toMatch(/not an allowed printer/);
  });

  it('only port 9100 by default', () => {
    const relay = new PrintRelay({ apiUrl: 'http://api', key: 'k' });
    expect(relay.refusal({ host: 'zt-1', port: 9100 })).toBeNull();
    expect(relay.refusal({ host: 'zt-1', port: 5432 })).toMatch(/PRINTER_PORTS/);
  });
});
