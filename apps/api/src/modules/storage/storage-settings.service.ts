// Platform → Storage (decision 051): the platform owner saves the deployment's R2 bucket. The secret is sealed
// with STORAGE_CREDENTIAL_KEY_V1, never returned, and every save is tested against the bucket first and audited.
import { type Database, platformStorageSetting, user } from '@factoryos/db';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { CONFIG, DB } from '../../common/tokens.js';
import type { AppConfig } from '../../config.js';
import { openStorageSecret, sealStorageSecret } from './storage-secret.js';
import { probeS3, type S3Settings, StorageService } from './storage.service.js';

export const storageSettingsInput = z.object({
  endpoint: z.url({ protocol: /^https?$/ }).trim().max(300),
  region: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/, 'Lowercase letters, digits and hyphens').default('auto'),
  bucket: z.string().trim().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'Bucket names are 3–63 lowercase letters, digits, dots or hyphens'),
  accessKeyId: z.string().trim().min(1).max(128).regex(/^\S+$/, 'No spaces'),
  /** Omit to keep the saved secret. */
  secretAccessKey: z.string().trim().min(1).max(256).regex(/^\S+$/, 'No spaces').optional(),
});
export type StorageSettingsInput = z.infer<typeof storageSettingsInput>;

@Injectable()
export class StorageSettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async view(ctx: RequestContext) {
    this.assertSuperadmin(ctx);
    const [row] = await this.db
      .select({
        endpoint: platformStorageSetting.endpoint,
        region: platformStorageSetting.region,
        bucket: platformStorageSetting.bucket,
        accessKeyId: platformStorageSetting.accessKeyId,
        updatedAt: platformStorageSetting.updatedAt,
        updatedBy: user.email,
      })
      .from(platformStorageSetting)
      .leftJoin(user, eq(user.id, platformStorageSetting.updatedBy))
      .where(eq(platformStorageSetting.id, 'default'));
    return {
      source: this.storage.source,
      envDriver: this.storage.source === 'env' ? (process.env.STORAGE_DRIVER ?? '').trim() : null,
      keyConfigured: !!this.config.STORAGE_CREDENTIAL_KEY_V1,
      saved: row ? { ...row, secretSet: true } : null,
      active: await this.storage.state(),
    };
  }

  /** Tests the given settings (or the saved secret when none is given) without saving anything. */
  async test(ctx: RequestContext, input: StorageSettingsInput) {
    this.assertSuperadmin(ctx);
    const settings = await this.resolve(input);
    const started = Date.now();
    await this.probe(settings);
    return { ok: true, ms: Date.now() - started };
  }

  async save(ctx: RequestContext, input: StorageSettingsInput) {
    this.assertSuperadmin(ctx);
    const key = this.config.STORAGE_CREDENTIAL_KEY_V1;
    if (!key) throw new ConflictException('Set STORAGE_CREDENTIAL_KEY_V1 in the deployment environment before saving storage settings');
    const settings = await this.resolve(input);
    await this.probe(settings);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform-storage'))`);
      const [before] = await tx.select().from(platformStorageSetting).where(eq(platformStorageSetting.id, 'default')).for('update');
      const values = {
        endpoint: settings.endpoint,
        region: settings.region,
        bucket: settings.bucket,
        accessKeyId: settings.accessKeyId,
        secret: sealStorageSecret(settings.secretAccessKey, key),
        updatedBy: ctx.user.id,
        updatedAt: new Date(),
      };
      await tx
        .insert(platformStorageSetting)
        .values({ id: 'default', ...values })
        .onConflictDoUpdate({ target: platformStorageSetting.id, set: values });
      const shown = (r: { endpoint: string; region: string; bucket: string; accessKeyId: string }) => ({ endpoint: r.endpoint, region: r.region, bucket: r.bucket, accessKeyId: r.accessKeyId });
      await this.audit.record(
        ctx,
        {
          action: 'platform.storage.update',
          targetType: 'platform_storage_setting',
          targetId: 'default',
          before: before ? shown(before) : null,
          after: { ...shown(settings), secretChanged: !!input.secretAccessKey || !before },
        },
        tx,
      );
    });
    await this.storage.reload();
    return this.view(ctx);
  }

  private async resolve(input: StorageSettingsInput): Promise<S3Settings> {
    if (process.env.NODE_ENV === 'production' && !input.endpoint.startsWith('https://')) throw new BadRequestException('The endpoint must use https');
    let secretAccessKey = input.secretAccessKey;
    if (!secretAccessKey) {
      const [row] = await this.db.select({ secret: platformStorageSetting.secret }).from(platformStorageSetting).where(eq(platformStorageSetting.id, 'default'));
      if (!row) throw new BadRequestException('Enter the secret access key');
      const key = this.config.STORAGE_CREDENTIAL_KEY_V1;
      if (!key) throw new ConflictException('STORAGE_CREDENTIAL_KEY_V1 is not set, so the saved secret cannot be read; enter the secret again');
      try {
        secretAccessKey = openStorageSecret(row.secret, key);
      } catch {
        throw new ConflictException('The saved secret cannot be decrypted with STORAGE_CREDENTIAL_KEY_V1; enter the secret again');
      }
    }
    return { endpoint: input.endpoint.replace(/\/+$/, ''), region: input.region, bucket: input.bucket, accessKeyId: input.accessKeyId, secretAccessKey };
  }

  private async probe(settings: S3Settings) {
    try {
      await probeS3(settings);
    } catch (e) {
      const err = e as { name?: string; message?: string; Code?: string };
      const code = err.Code ?? err.name ?? 'Error';
      throw new UnprocessableEntityException(`Storage test failed (${code}): ${err.message ?? 'no detail'}`.slice(0, 500));
    }
  }

  private assertSuperadmin(ctx: RequestContext) {
    if (ctx.platformAdminLevel !== 'superadmin') throw new ForbiddenException('Platform administrators only');
  }
}
