// Settings → Connections (decision 068, slice 5): GET /connections reports every outside connection of the workspace
// and entity with a status, a summary, the last activity and where to set it up. Checked here: a fresh workspace,
// sections changing as things are added (a GST registration, an edge agent that reports and one that does not, a
// Tally import), the storage write test, permissions (read and manage), and isolation between workspaces.
// Usage: API=http://localhost:4000 node --env-file=.env apps/api/scripts/smoke-connections.mjs
import assert from 'node:assert/strict';
import { createDb } from '../../../packages/db/dist/index.js';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const db = createDb(process.env.DATABASE_URL);
const q = async (text, params = []) => (await db.$client.query(text, params)).rows;
const pause = () => new Promise((r) => setTimeout(r, 30e3));
const c = await new Client().init('Connections owner');
let checks = 0;
const check = async (label, fn) => {
  await fn();
  checks++;
  ok(label);
};
const list = async (who = c) => (await who.req('GET', '/connections')).connections;
const section = (all, key) => all.find((x) => x.key === key);

try {
  await check('a fresh workspace lists every connection, in order, each with a status and a way to set it up', async () => {
    const all = await list();
    assert.deepEqual(all.map((x) => x.key), ['gst', 'email', 'storage', 'devices', 'printers', 'support', 'tally']);
    for (const x of all) {
      assert.ok(['ok', 'attention', 'off', 'setup'].includes(x.status), x.key);
      assert.ok(x.summary.length > 0, x.key);
      assert.ok(x.href || x.setupBy, `${x.key} says where it is set up`);
    }
    assert.deepEqual(['gst', 'devices', 'printers', 'tally'].map((k) => section(all, k).status), ['setup', 'setup', 'setup', 'setup']);
    assert.equal(section(all, 'gst').href, '/app/settings/entities', 'no registration yet: add one first');
    if (!process.env.EMAIL_MODE || process.env.EMAIL_MODE === 'disabled') assert.equal(section(all, 'email').status, 'off');
    if (process.env.SUPPORT_ACCESS_ENABLED !== 'true') assert.equal(section(all, 'support').status, 'off');
  });

  await check('GST: with a registration but no sandbox connection, the GST page is the place to set it up', async () => {
    await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
    const gst = section(await list(), 'gst');
    assert.equal(gst.status, 'setup');
    assert.equal(gst.href, '/app/settings/gst-integrations');
    assert.match(gst.summary, /1 registration/);
  });

  await check('edge agents: one that never reported needs a look; once it reports it is working', async () => {
    const edge = await c.req('POST', '/plant/edges', { code: 'EDGE-1', name: 'Shop floor edge' }, 201);
    let devices = section(await list(), 'devices');
    assert.equal(devices.status, 'attention');
    assert.match(devices.summary, /1 edge agent not reporting/);
    await q('update iot_edge set last_seen_at = now() where id = $1', [edge.id]);
    devices = section(await list(), 'devices');
    assert.equal(devices.status, 'ok');
    assert.ok(devices.lastActivityAt);
    await q("update iot_edge set last_seen_at = now() - interval '1 hour' where id = $1", [edge.id]);
    assert.equal(section(await list(), 'devices').status, 'attention', 'silent for an hour');
  });

  await check('Tally: an import waiting for review needs a look', async () => {
    await q("insert into tally_import (tenant_id, entity_id, files, created_by) select $1, $2, '[]'::jsonb, created_by from iot_edge where entity_id = $2 limit 1", [c.tenantId, c.entityId]);
    const tally = section(await list(), 'tally');
    assert.equal(tally.status, 'attention');
    assert.match(tally.summary, /waiting for review/);
  });

  await check('storage: the test writes, reads back and deletes a file, and is audited', async () => {
    const storage = section(await list(), 'storage');
    const r = await c.req('POST', '/connections/storage/test', {}, 201);
    if (storage.status === 'ok') assert.deepEqual(r, { ok: true, message: 'A test file was written, read back and deleted.' });
    else assert.equal(r.ok, false);
    const [audit] = await q("select after from audit_event where tenant_id = $1 and action = 'settings.connections.storage_test' order by seq desc limit 1", [c.tenantId]);
    assert.equal(audit.after.ok, r.ok);
  });

  await check('signed out is refused', async () => assert.equal((await new Client().raw('GET', '/connections')).status, 401));

  // ── Permissions ──
  const role = await c.req('POST', '/roles', { name: 'Integrations viewer', permissions: ['settings.integration.read'] }, 201);
  const none = await c.req('POST', '/roles', { name: 'Stores only', permissions: ['masters.item.read'] }, 201);
  const person = async (name, roleId) => {
    await pause();
    const who = new Client();
    const email = `${name.toLowerCase().replace(/ /g, '-')}-${Date.now()}@example.com`;
    const inv = await c.req('POST', '/invitations', { email, roles: [{ roleId, entityIds: [c.entityId] }] }, 201);
    await who.req('POST', '/auth/sign-up/email', { name, email, password: 'Sup3r-secret-pw' });
    await who.req('POST', '/invitations/accept', { token: inv.inviteUrl.split('/').at(-1) }, 201);
    who.tenantId = c.tenantId;
    who.entityId = c.entityId;
    return who;
  };
  const viewer = await person('Vani Viewer', role.id);
  await check('read permission sees the page but cannot run the storage test', async () => {
    assert.equal((await list(viewer)).length, 7);
    assert.equal((await viewer.raw('POST', '/connections/storage/test', {})).status, 403);
  });
  const clerk = await person('Kiran Clerk', none.id);
  await check('without settings.integration.read the page is refused', async () => {
    assert.equal((await clerk.raw('GET', '/connections')).status, 403);
  });

  // ── Isolation ──
  await pause();
  const other = await new Client().init('Connections other');
  await check("another workspace sees only its own connections", async () => {
    const all = await list(other);
    assert.deepEqual(['gst', 'devices', 'tally'].map((k) => section(all, k).status), ['setup', 'setup', 'setup']);
    assert.equal(section(all, 'gst').href, '/app/settings/entities');
  });

  console.log(`\nConnections smoke: ${checks} checks passed`);
} finally {
  await db.$client.end();
}
