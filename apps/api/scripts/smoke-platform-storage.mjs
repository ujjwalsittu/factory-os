// Platform → Storage (decision 051): SuperAdmin only, every save tested against the bucket first, the secret
// sealed and never returned, audited, and attachments then go to the saved bucket. A small in-process
// S3-compatible server (fake-s3.mjs) stands in for Cloudflare R2.
// Run against an API started WITHOUT STORAGE_DRIVER and WITH STORAGE_CREDENTIAL_KEY_V1, e.g.:
//   STORAGE_DRIVER= STORAGE_CREDENTIAL_KEY_V1=$(openssl rand -base64 32) PORT=4012 node --env-file=../../.env dist/main.js
// Usage: API=http://localhost:4012 node apps/api/scripts/smoke-platform-storage.mjs
import assert from 'node:assert/strict';
import { createDb } from '../../../packages/db/dist/index.js';
import { Client } from './accounting-test-helpers.mjs';
import { startFakeS3 } from './fake-s3.mjs';

let checks = 0;
const ok = (label) => {
  checks++;
  console.log(`✓ ${label}`);
};
const db = createDb(process.env.DATABASE_URL);

const s3 = await startFakeS3();
const SECRET = `s3cr3t-${Date.now()}-do-not-log`;
const { endpoint, objects, bucket: BUCKET, accessKeyId: ACCESS } = s3;
const good = { endpoint, region: 'auto', bucket: BUCKET, accessKeyId: ACCESS, secretAccessKey: SECRET };

try {
  const fail = async (c, method, path, body, status, label, pattern) => {
    const r = await c.raw(method, path, body);
    assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
    if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
    ok(label);
    return r.data;
  };

  // A tenant owner is not a platform administrator.
  const member = await new Client().init('Storage member');
  await fail(member, 'GET', '/platform/storage', undefined, 403, 'tenant users cannot read platform storage settings');
  await fail(member, 'PUT', '/platform/storage', good, 403, 'tenant users cannot save platform storage settings');

  const admin = await new Client().init('Storage admin');
  const me = await admin.req('GET', '/me');
  await db.$client.query("insert into platform_admin(user_id, level) values ($1, 'support')", [me.user.id]);
  await fail(admin, 'GET', '/platform/storage', undefined, 403, 'support-level operators cannot read storage settings');
  await db.$client.query("update platform_admin set level = 'superadmin' where user_id = $1", [me.user.id]);

  const before = (await db.$client.query("select count(*)::int n from platform_storage_setting")).rows[0].n;
  let view = await admin.req('GET', '/platform/storage');
  assert.equal(view.source, 'saved', 'the API under test must run without STORAGE_DRIVER');
  assert.equal(view.keyConfigured, true, 'the API under test must have STORAGE_CREDENTIAL_KEY_V1');
  if (before === 0) {
    assert.equal(view.saved, null);
    assert.equal(view.active.kind, 'disabled');
    assert.match(view.active.reason, /Platform → Storage/);
    ok('with nothing saved, storage is off and says where to set it up');
    await fail(admin, 'PUT', '/platform/storage', { ...good, secretAccessKey: undefined }, 400, 'the first save needs the secret', /secret access key/);
  }

  await fail(admin, 'PUT', '/platform/storage', { ...good, bucket: 'Bad_Bucket' }, 400, 'bucket names are validated', /Bucket names/);
  await fail(admin, 'PUT', '/platform/storage', { ...good, endpoint: 'ftp://example.com' }, 400, 'the endpoint must be http(s)');
  await fail(admin, 'POST', '/platform/storage/test', { ...good, bucket: 'missing-bucket' }, 422, 'a test names a missing bucket', /NoSuchBucket/);
  await fail(admin, 'POST', '/platform/storage/test', { ...good, accessKeyId: 'AKIDWRONG' }, 422, 'a test names a wrong access key', /InvalidAccessKeyId/);
  const failedSave = await admin.raw('PUT', '/platform/storage', { ...good, accessKeyId: 'AKIDWRONG' });
  assert.equal(failedSave.status, 422);
  const stillBefore = (await db.$client.query("select access_key_id from platform_storage_setting")).rows;
  assert.ok(stillBefore.every((r) => r.access_key_id !== 'AKIDWRONG'));
  ok('a save that fails its test stores nothing');

  const tested = await admin.req('POST', '/platform/storage/test', good);
  assert.equal(tested.ok, true);
  assert.equal(objects.size, 0, 'the test object is deleted again');
  ok('a test writes, reads back and deletes a probe object');

  view = await admin.req('PUT', '/platform/storage', good);
  assert.equal(view.saved.bucket, BUCKET);
  assert.equal(view.saved.accessKeyId, ACCESS);
  assert.equal(view.saved.secretSet, true);
  assert.equal(view.active.kind, 's3');
  assert.equal(view.active.bucket, BUCKET);
  assert.ok(!JSON.stringify(view).includes(SECRET), 'the secret is never returned');
  ok('saved: storage is on, the secret is write-only');

  const row = (await db.$client.query("select secret from platform_storage_setting where id = 'default'")).rows[0];
  assert.equal(row.secret.keyVersion, 'v1');
  assert.ok(!JSON.stringify(row).includes(SECRET));
  ok('the secret is stored encrypted');

  const audit = (await db.$client.query("select after from audit_event where action = 'platform.storage.update' and actor_user_id = $1 order by seq desc limit 1", [me.user.id])).rows[0];
  assert.ok(audit, 'audited');
  assert.equal(audit.after.bucket, BUCKET);
  assert.equal(audit.after.secretChanged, true);
  assert.ok(!JSON.stringify(audit).includes(SECRET));
  ok('the change is audited without the secret');

  // Keeping the secret: omit it, and the saved one is used for the test and kept.
  view = await admin.req('PUT', '/platform/storage', { ...good, secretAccessKey: undefined, region: 'auto' });
  assert.equal(view.active.kind, 's3');
  const audit2 = (await db.$client.query("select after from audit_event where action = 'platform.storage.update' and actor_user_id = $1 order by seq desc limit 1", [me.user.id])).rows[0];
  assert.equal(audit2.after.secretChanged, false);
  ok('saving without a secret keeps (and re-tests) the saved one');

  // Attachments now go to the saved bucket.
  const uoms = await admin.req('GET', '/uoms');
  const bar = await admin.req('POST', '/items', { code: 'TI', name: 'Ti bar', type: 'raw_material', tracking: 'batch', stockUomId: uoms.find((u) => u.code === 'KG').id, hsnCode: '81089090' }, 201);
  const sto = await admin.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const r = await admin.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: today, lines: [{ itemId: bar.id, qty: '1', toWarehouseId: sto.id, newBatchNo: 'HN-S3', rate: '100' }] }, 201);
  await admin.req('POST', `/stock-entries/${r.id}/submit`, {}, 201);
  const heat = (await admin.req('GET', `/batches?itemId=${bar.id}`))[0];
  const pdf = Buffer.from('%PDF-1.4\n% stored in the platform bucket\n%%EOF\n');
  const up = await fetch(`${admin.base}/attachments?${new URLSearchParams({ ownerType: 'batch', ownerId: heat.id, kind: 'mtc', fileName: 'MTC.pdf' })}`, {
    method: 'POST',
    headers: { Cookie: admin.cookie, 'x-tenant-id': admin.tenantId, 'x-entity-id': admin.entityId, Origin: admin.origin, 'Content-Type': 'application/pdf' },
    body: pdf,
  });
  assert.equal(up.status, 201, await up.clone().text());
  const stored = [...objects.entries()].find(([k]) => k.startsWith(`${admin.tenantId}/${admin.entityId}/batch/`));
  assert.ok(stored, 'object written under the tenant/entity prefix');
  assert.deepEqual(stored[1].body, pdf);
  const list = await admin.req('GET', `/attachments?ownerType=batch&ownerId=${heat.id}`);
  assert.equal(list.storage, true);
  ok('attachments upload to the saved bucket under the tenant/entity prefix');

  console.log(`\nPlatform storage smoke passed: ${checks} checks.`);
} finally {
  s3.close();
  await db.$client.end();
}
