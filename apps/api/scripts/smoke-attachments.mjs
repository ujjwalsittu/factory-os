// Certificates and attachments (decision 048): upload as the raw body, type and size rules, owner scope,
// download, withdrawal. Run with STORAGE_DRIVER=local on the API (the R2 driver needs real credentials).
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-attachments.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Client } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Attachments');
const upload = (params, body, type) =>
  fetch(`${c.base}/attachments?${new URLSearchParams(params)}`, { method: 'POST', headers: { Cookie: c.cookie, 'x-tenant-id': c.tenantId, 'x-entity-id': c.entityId, Origin: c.origin, 'Content-Type': type }, body });
const expect = async (res, status, label, pattern) => {
  const text = await res.text();
  assert.equal(res.status, status, `${label}: ${text}`);
  if (pattern) assert.match(text, pattern, label);
  ok(label);
  return text ? JSON.parse(text) : null;
};

const uoms = await c.req('GET', '/uoms');
const bar = await c.req('POST', '/items', { code: 'TI', name: 'Ti bar', type: 'raw_material', tracking: 'batch', stockUomId: uoms.find((u) => u.code === 'KG').id, hsnCode: '81089090' }, 201);
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const r = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: today, lines: [{ itemId: bar.id, qty: '5', toWarehouseId: sto.id, newBatchNo: 'HN-1', rate: '100' }] }, 201);
await c.req('POST', `/stock-entries/${r.id}/submit`, {}, 201);
const heat = (await c.req('GET', `/batches?itemId=${bar.id}`))[0];

const pdf = Buffer.from('%PDF-1.4\n% mill test certificate HN-1\n%%EOF\n');
const owner = { ownerType: 'batch', ownerId: heat.id };
await expect(await upload({ ...owner, kind: 'mtc', fileName: 'run.exe' }, Buffer.from('MZ'), 'application/x-msdownload'), 400, 'executables are refused', /not accepted/);
await expect(await upload({ ...owner, kind: 'mtc', fileName: 'fake.pdf' }, Buffer.from('hello'), 'application/pdf'), 400, 'a file that claims to be PDF but is not is refused', /not a PDF/);
await expect(await upload({ ...owner, kind: 'mtc', fileName: '../../etc/passwd' }, pdf, 'application/pdf'), 400, 'file names cannot contain slashes', /slashes/);
await expect(await upload({ ownerType: 'batch', ownerId: '00000000-0000-4000-8000-000000000000', kind: 'mtc', fileName: 'x.pdf' }, pdf, 'application/pdf'), 404, 'the owner must exist in this tenant', /not found/);
await expect(await upload({ ...owner, kind: 'mtc', fileName: 'big.pdf' }, Buffer.concat([pdf, Buffer.alloc(26 * 1024 * 1024)]), 'application/pdf'), 413, 'files over 25 MB are refused');
const a = await expect(await upload({ ...owner, kind: 'mtc', fileName: 'MTC HN-1.pdf' }, pdf, 'application/pdf'), 201, 'MTC uploaded against the heat');
assert.equal(a.sha256, createHash('sha256').update(pdf).digest('hex'));
assert.equal(a.size, pdf.length);
assert.equal(a.objectKey, undefined);
ok('hash and size recorded; the object key is never exposed');
const list = await c.req('GET', `/attachments?ownerType=batch&ownerId=${heat.id}`);
assert.equal(list.storage, true);
assert.deepEqual(list.rows.map((x) => [x.fileName, x.kind]), [['MTC HN-1.pdf', 'mtc']]);
ok('listed on the heat');
const dl = await fetch(`${c.base}/attachments/${a.id}/download`, { headers: { Cookie: c.cookie, 'x-tenant-id': c.tenantId, 'x-entity-id': c.entityId, Origin: c.origin } });
assert.equal(dl.status, 200);
assert.ok(Buffer.from(await dl.arrayBuffer()).equals(pdf));
assert.match(dl.headers.get('content-disposition') ?? '', /MTC%20HN-1\.pdf/);
ok('download returns the same bytes as an attachment');
await c.req('POST', `/attachments/${a.id}/withdraw`, { reason: 'no' }, 400);
ok('withdrawal needs a reason');
await c.req('POST', `/attachments/${a.id}/withdraw`, { reason: 'Wrong heat certificate' }, 201);
await c.req('POST', `/attachments/${a.id}/withdraw`, { reason: 'Wrong heat certificate' }, 409);
ok('withdrawn once; stays listed with the reason');
const after = await c.req('GET', `/attachments?ownerType=batch&ownerId=${heat.id}`);
assert.equal(after.rows[0].withdrawReason, 'Wrong heat certificate');
const gone = await fetch(`${c.base}/attachments/${a.id}/download`, { headers: { Cookie: c.cookie, 'x-tenant-id': c.tenantId, 'x-entity-id': c.entityId, Origin: c.origin } });
assert.equal(gone.status, 409);
ok('a withdrawn file can no longer be downloaded');

// Another tenant can't see or attach to this heat.
const other = await new Client().init('AttachmentsOther');
const res = await fetch(`${other.base}/attachments?ownerType=batch&ownerId=${heat.id}`, { headers: { Cookie: other.cookie, 'x-tenant-id': other.tenantId, 'x-entity-id': other.entityId, Origin: other.origin } });
assert.equal(res.status, 404);
ok('another tenant gets not found');
console.log('\nAttachments smoke passed.');
