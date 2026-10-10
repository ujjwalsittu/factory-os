// Platform object storage settings (decision 051): one S3-compatible bucket (Cloudflare R2) per deployment,
// set by the platform owner. The secret access key is AES-256-GCM encrypted with a key held only in the
// deployment environment; this table never holds it in clear. Environment variables, when set, override it.
import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.js';

/** AES-256-GCM output, base64 fields; `keyVersion` names the environment key that sealed it. */
export interface StorageSecretEnvelope {
  keyVersion: 'v1';
  iv: string;
  tag: string;
  ciphertext: string;
}

export const platformStorageSetting = pgTable(
  'platform_storage_setting',
  {
    /** Single row per deployment. */
    id: text('id').primaryKey().default('default'),
    endpoint: text('endpoint').notNull(),
    region: text('region').notNull().default('auto'),
    bucket: text('bucket').notNull(),
    accessKeyId: text('access_key_id').notNull(),
    secret: jsonb('secret').$type<StorageSecretEnvelope>().notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('platform_storage_setting_singleton_ck', sql`${t.id} = 'default'`)],
);
