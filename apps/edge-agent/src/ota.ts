// Decision 064: signed firmware updates through the edge. Builds signed by Azeonics are dropped in FIRMWARE_DIR as
// `<name>.bin` with `<name>.bin.manifest.json` ({version, size, sha256, signature}). The agent checks size, hash and
// the Ed25519 signature itself, serves the newest valid build over HTTPS on the plant network, and announces it as
// the retained `ota` manifest. The taps check the signature again before installing.
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { basename, join } from 'node:path';
import { compareFwVersions, type OtaManifest, otaSigningPayload } from '@factoryos/iot-protocol';

const FILE = /^[A-Za-z0-9._-]{1,100}\.bin$/;

/** The Ed25519 public key from its raw 32 bytes in base64 (as `sign.mjs` prints it). */
export function ed25519PublicKey(raw: string): KeyObject {
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32) throw new Error('The OTA public key must be 32 bytes in base64');
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: bytes.toString('base64url') }, format: 'jwk' });
}

export type FirmwareBuild = { file: string; manifest: Omit<OtaManifest, 'url'> };

/** Every build in `dir`, checked: valid ones, and the reasons the others were skipped. */
export function scanFirmware(dir: string, publicKey: KeyObject): { valid: FirmwareBuild[]; skipped: { file: string; reason: string }[] } {
  const valid: FirmwareBuild[] = [];
  const skipped: { file: string; reason: string }[] = [];
  if (!existsSync(dir)) return { valid, skipped };
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.bin.manifest.json')).sort()) {
    const file = name.slice(0, -'.manifest.json'.length);
    const skip = (reason: string) => void skipped.push({ file, reason });
    if (!FILE.test(file)) { skip('Bad file name'); continue; }
    const path = join(dir, file);
    if (!existsSync(path)) { skip('The .bin file is missing'); continue; }
    let m: Partial<OtaManifest>;
    try {
      m = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Partial<OtaManifest>;
    } catch {
      skip('The manifest is not JSON');
      continue;
    }
    if (typeof m.version !== 'string' || compareFwVersions(m.version, m.version) === null) { skip('Bad version'); continue; }
    if (!Number.isSafeInteger(m.size) || typeof m.sha256 !== 'string' || typeof m.signature !== 'string') { skip('Incomplete manifest'); continue; }
    const bin = readFileSync(path);
    if (bin.length !== m.size) { skip('Size differs from the manifest'); continue; }
    if (createHash('sha256').update(bin).digest('hex') !== m.sha256) { skip('SHA-256 differs from the manifest'); continue; }
    const manifest = { version: m.version, size: m.size as number, sha256: m.sha256 };
    const sig = Buffer.from(m.signature, 'base64');
    if (sig.length !== 64 || !verify(null, Buffer.from(otaSigningPayload(manifest)), publicKey, sig)) { skip('Bad signature'); continue; }
    valid.push({ file, manifest: { ...manifest, signature: m.signature } });
  }
  valid.sort((a, b) => compareFwVersions(b.manifest.version, a.manifest.version) ?? 0);
  return { valid, skipped };
}

export interface OtaOptions {
  dir: string;
  publicKey: string;
  /** How taps reach this server, e.g. `https://edge.nm1.plant:8443`. */
  baseUrl: string;
  port: number;
  /** PEM key and certificate issued by the plant CA. Plain HTTP only when absent (tests). */
  tls?: { key: string; cert: string } | undefined;
  log?: ((msg: string) => void) | undefined;
}

export class OtaServer {
  private readonly key: KeyObject;
  private current: FirmwareBuild | null = null;
  private server: Server | null = null;
  private lastSkipped = '';

  constructor(private readonly opts: OtaOptions) {
    this.key = ed25519PublicKey(opts.publicKey);
  }

  /** Rescans the directory. Returns the manifest to announce (null when there is no valid build) and whether it changed. */
  refresh(): { manifest: OtaManifest | null; changed: boolean } {
    const { valid, skipped } = scanFirmware(this.opts.dir, this.key);
    const note = skipped.map((s) => `${s.file}: ${s.reason}`).join('; ');
    if (note && note !== this.lastSkipped) this.opts.log?.(`firmware skipped: ${note}`);
    this.lastSkipped = note;
    const next = valid[0] ?? null;
    const changed = next?.manifest.sha256 !== this.current?.manifest.sha256;
    this.current = next;
    return { manifest: this.manifest(), changed };
  }

  manifest(): OtaManifest | null {
    if (!this.current) return null;
    return { ...this.current.manifest, url: `${this.opts.baseUrl.replace(/\/$/, '')}/firmware/${this.current.file}` };
  }

  async start() {
    const handler = (req: IncomingMessage, res: ServerResponse) => this.handle(req, res);
    this.server = this.opts.tls ? createHttpsServer({ key: this.opts.tls.key, cert: this.opts.tls.cert }, handler) : createHttpServer(handler);
    await new Promise<void>((r) => this.server!.listen(this.opts.port, r));
    return (this.server.address() as { port: number }).port;
  }

  async stop() {
    await new Promise((r) => (this.server ? this.server.close(r) : r(null)));
  }

  /** Serves only the announced build; nothing else in the directory is reachable. */
  private handle(req: IncomingMessage, res: ServerResponse) {
    const c = this.current;
    const want = req.url?.startsWith('/firmware/') ? basename(req.url) : '';
    if (req.method !== 'GET' || !c || want !== c.file) {
      res.writeHead(404).end();
      return;
    }
    const path = join(this.opts.dir, c.file);
    if (statSync(path).size !== c.manifest.size) {
      res.writeHead(409).end(); // replaced since it was checked; the next refresh decides
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': c.manifest.size });
    createReadStream(path).pipe(res);
  }
}
