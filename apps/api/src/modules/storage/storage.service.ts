// Object storage for certificates and attachments (decision 048): Cloudflare R2 through its S3 API in
// deployments, a local folder for development and tests only. Callers never see which driver runs.
// Decision 051: the platform owner may save the R2 settings on Platform → Storage; STORAGE_DRIVER, when set,
// overrides them. Saved settings are re-read at most every 30 seconds so every API instance follows a change.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type Database, platformStorageSetting } from '@factoryos/db';
import { Inject, Injectable, type OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { AppConfig } from '../../config.js';
import { CONFIG, DB } from '../../common/tokens.js';
import { openStorageSecret } from './storage-secret.js';

const RELOAD_MS = 30_000;

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** PDF, images, text/CSV and common CMM exports. */
export const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/csv',
  'text/plain',
  'application/xml',
  'text/xml',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

export interface StoredObject {
  key: string;
  size: number;
  sha256: string;
}

type Driver = { kind: 's3'; client: S3Client; bucket: string } | { kind: 'local'; root: string } | { kind: 'disabled'; reason: string };

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function s3Client(s: S3Settings, probe = false) {
  return new S3Client({
    endpoint: s.endpoint,
    region: s.region || 'auto',
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
    forcePathStyle: true,
    // A connection test must answer quickly and say what failed, not retry for a minute.
    ...(probe ? { maxAttempts: 1, requestHandler: { connectionTimeout: 5000, requestTimeout: 10000 } } : {}),
  });
}

/** Writes, reads back and deletes a small object; throws with the store's own error when any step fails. */
export async function probeS3(s: S3Settings) {
  const client = s3Client(s, true);
  const key = `_factoryos/probe/${randomUUID()}.txt`;
  const body = `FactoryOS storage test ${new Date().toISOString()}`;
  try {
    await client.send(new PutObjectCommand({ Bucket: s.bucket, Key: key, Body: body, ContentType: 'text/plain' }));
    const out = await client.send(new GetObjectCommand({ Bucket: s.bucket, Key: key }));
    const back = Buffer.from(await out.Body!.transformToByteArray()).toString('utf8');
    if (back !== body) throw new Error('the object read back differs from the one written');
    await client.send(new DeleteObjectCommand({ Bucket: s.bucket, Key: key }));
  } finally {
    client.destroy();
  }
}

@Injectable()
export class StorageService implements OnModuleInit {
  /** The STORAGE_DRIVER configuration; null when unset, so saved settings apply. */
  private readonly envDriver: Driver | null = configureFromEnv();
  private saved: Driver = { kind: 'disabled', reason: 'not loaded' };
  private loadedAt = 0;
  private savedStamp: string | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit() {
    if (!this.envDriver) await this.reload();
  }

  /** Where the active configuration comes from. */
  get source(): 'env' | 'saved' {
    return this.envDriver ? 'env' : 'saved';
  }

  async available() {
    return (await this.current()).kind !== 'disabled';
  }

  /** The active driver kind, and why it is disabled when it is. */
  async state() {
    const d = await this.current();
    return { kind: d.kind, reason: d.kind === 'disabled' ? d.reason : null, bucket: d.kind === 's3' ? d.bucket : null };
  }

  /** Re-reads the saved settings now (after a save on this instance); the client is rebuilt only when they changed. */
  async reload() {
    const [row] = await this.db.select({ updatedAt: platformStorageSetting.updatedAt }).from(platformStorageSetting).where(eq(platformStorageSetting.id, 'default'));
    const stamp = row ? row.updatedAt.toISOString() : 'none';
    // A key added or removed in the environment changes the outcome too, but needs a restart anyway.
    if (stamp !== this.savedStamp) {
      this.saved = await this.loadSaved();
      this.savedStamp = stamp;
    }
    this.loadedAt = Date.now();
  }

  private async current(): Promise<Driver> {
    if (this.envDriver) return this.envDriver;
    if (Date.now() - this.loadedAt > RELOAD_MS) await this.reload();
    return this.saved;
  }

  private async loadSaved(): Promise<Driver> {
    const [row] = await this.db.select().from(platformStorageSetting).where(eq(platformStorageSetting.id, 'default'));
    if (!row) return { kind: 'disabled', reason: 'a platform administrator must set up storage on Platform → Storage' };
    const key = this.config.STORAGE_CREDENTIAL_KEY_V1;
    if (!key) return { kind: 'disabled', reason: 'STORAGE_CREDENTIAL_KEY_V1 is not set, so the saved secret cannot be read' };
    let secretAccessKey: string;
    try {
      secretAccessKey = openStorageSecret(row.secret, key);
    } catch {
      return { kind: 'disabled', reason: 'the saved secret cannot be decrypted with STORAGE_CREDENTIAL_KEY_V1; save the settings again' };
    }
    return { kind: 's3', bucket: row.bucket, client: s3Client({ endpoint: row.endpoint, region: row.region, bucket: row.bucket, accessKeyId: row.accessKeyId, secretAccessKey }) };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const d = await this.require();
    const sha256 = createHash('sha256').update(body).digest('hex');
    if (d.kind === 's3') await d.client.send(new PutObjectCommand({ Bucket: d.bucket, Key: key, Body: body, ContentType: contentType, ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64') }));
    else {
      const path = localPath(d.root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body, { flag: 'wx' });
    }
    return { key, size: body.length, sha256 };
  }

  async get(key: string): Promise<Buffer> {
    const d = await this.require();
    if (d.kind === 'local') return readFile(localPath(d.root, key));
    const out = await d.client.send(new GetObjectCommand({ Bucket: d.bucket, Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  /** A five-minute download link (S3), or null when the API must stream the bytes itself (local). */
  async presign(key: string, fileName: string, contentType: string): Promise<string | null> {
    const d = await this.require();
    if (d.kind === 'local') return null;
    const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    return getSignedUrl(d.client, new GetObjectCommand({ Bucket: d.bucket, Key: key, ResponseContentDisposition: disposition, ResponseContentType: contentType }), { expiresIn: 300 });
  }

  private async require(): Promise<Exclude<Driver, { kind: 'disabled' }>> {
    const d = await this.current();
    if (d.kind === 'disabled') throw new ServiceUnavailableException(`File storage is not configured: ${d.reason}`);
    return d;
  }
}

function configureFromEnv(): Driver | null {
  const kind = (process.env.STORAGE_DRIVER ?? '').trim();
  if (!kind) return null;
  if (kind === 's3') {
    const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !process.env[k]);
    if (missing.length) return { kind: 'disabled', reason: `set ${missing.join(', ')}` };
    const settings = {
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION || 'auto',
      bucket: process.env.S3_BUCKET!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    };
    return { kind: 's3', bucket: settings.bucket, client: s3Client(settings) };
  }
  if (kind === 'local') {
    if (process.env.NODE_ENV === 'production') return { kind: 'disabled', reason: 'the local driver is for development only; use STORAGE_DRIVER=s3' };
    return { kind: 'local', root: resolve(process.env.STORAGE_LOCAL_DIR || '.storage') };
  }
  return { kind: 'disabled', reason: `unknown STORAGE_DRIVER "${kind}"; use s3, local, or leave it empty to use Platform → Storage` };
}

/** Keys are generated by the API (tenant/entity/uuid), never by users; refuse anything that escapes the root. */
function localPath(root: string, key: string) {
  const path = resolve(join(root, key));
  if (!path.startsWith(root + '/')) throw new Error('Invalid object key');
  return path;
}
