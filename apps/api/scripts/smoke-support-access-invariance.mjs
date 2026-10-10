// Support access (decision 050) Task 9: support reads change nothing but support evidence. Runs the real API stack on an
// owned copy of the local database (real books from the regular suites), migrated to the current journal. Every table
// is hashed before and after every catalogued panel and a denial: books, stock, FIFO, bills, activations, native
// credentials, sessions and the original audit rows are byte-identical; only support events and appended two-identity
// audit rows are new, and the tenant audit chain still links and hashes.
// Needs no other connections to the local database (stop the local API/web first).
// Usage: pnpm --filter @factoryos/api... build && node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-invariance.mjs
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { toNodeHandler } from 'better-auth/node';
import { createDb } from '../../../packages/db/dist/index.js';
import { runMigrations } from '../../../packages/db/dist/migrate.js';
import { SupportReadService } from '../dist/modules/support-access/support-access.read.js';
import { SupportReadPoolService } from '../dist/modules/support-access/support-access.read-pool.js';
import { supportTransport } from '../dist/modules/support-access/support-access.transport.js';
import { SupportWorkspaceController } from '../dist/modules/support-access/support-access.workspace.controller.js';
import { PASSWORD, startSupportFixture } from './support-access-test-helpers.mjs';

let count = 0;
const pass = (name) => {
  count++;
  console.log(`PASS ${name}`);
};
const READS = ['inventory.report.read', 'selling.sales_invoice.read', 'buying.purchase_invoice.read', 'manufacturing.work_order.read', 'accounts.report.read'];
const AREAS = ['inventory', 'sales-invoices', 'purchase-invoices', 'work-orders', 'accounting'];
const sha = (v) => createHash('sha256').update(v).digest('hex');

// ── owned copy of the local database; the source itself is only read ──
const admin = createDb(process.env.DATABASE_URL);
const sourceName = new URL(process.env.DATABASE_URL).pathname.slice(1);
const busy = (await admin.$client.query('select count(*)::int n from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [sourceName])).rows[0].n;
assert.equal(busy, 0, `stop other connections to ${sourceName} (local API/web) so it can be copied`);
const copy = 'sa_invariance_' + randomUUID().replaceAll('-', '');
await admin.$client.query(`create database ${copy} template ${sourceName}`);
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/' + copy;
const sqlHashes = async () => {
  const dir = new URL('../../../packages/db/drizzle/', import.meta.url);
  const out = {};
  for (const name of (await readdir(dir)).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()) out[name] = sha(await readFile(new URL(name, dir)));
  return out;
};
const publishedBefore = await sqlHashes();
const probe = createDb(url.toString(), 1);
const journalBefore = (await probe.$client.query('select hash from drizzle.__drizzle_migrations order by id')).rows.map((x) => x.hash);
await probe.$client.end();
await runMigrations(url.toString());
const database = {
  db: createDb(url.toString()),
  url: url.toString(),
  async close() {
    await this.db.$client.end();
    for (let n = 0; n < 250; n++) {
      if ((await admin.$client.query('select count(*)::int n from pg_stat_activity where datname = $1', [copy])).rows[0].n === 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await admin.$client.query(`drop database ${copy}`);
    await admin.$client.end();
  },
};

const f = await startSupportFixture(
  {},
  {
    database,
    controllers: [SupportWorkspaceController],
    providers: [SupportReadService, SupportReadPoolService],
    configure(app, { config, auth }) {
      const server = app.getHttpAdapter().getInstance();
      server.use(supportTransport(config.supportAccess));
      server.all('/api/auth/{*path}', toNodeHandler(auth));
    },
  },
);
const q = (text, values) => f.db.$client.query(text, values).then((r) => r.rows);
const api = new URL(process.env.API ?? 'http://localhost:4000');
const base = `http://${api.hostname === 'localhost' ? '127.0.0.1' : api.hostname}:${api.port || 4000}`;

try {
  const journalAfter = (await q('select hash from drizzle.__drizzle_migrations order by id')).map((x) => x.hash);
  assert.deepEqual(journalAfter.slice(0, journalBefore.length), journalBefore);
  assert.deepEqual(await sqlHashes(), publishedBefore);
  pass(`owned copy migrated: published SQL and journal prefix unchanged (${journalBefore.length} → ${journalAfter.length})`);

  const [data] = await q(`select e.id, e.tenant_id from legal_entity e
     where exists (select 1 from sales_invoice s where s.entity_id = e.id and s.status = 'submitted')
       and exists (select 1 from stock_ledger_entry s where s.entity_id = e.id)
       and exists (select 1 from gl_entry g where g.entity_id = e.id)
     order by (select count(*) from work_order w where w.entity_id = e.id) desc, e.id limit 1`);
  assert.ok(data, 'local books needed: run the regular suites first');

  // Participants: an approver, a member to view as and an operator, added to the copied tenant.
  const owner = await f.completedUser('inv-owner@example.test', 'totp', 'Approver');
  const operator = await f.completedUser('inv-ops@example.test', 'totp', 'Operator');
  const clerk = await f.localUser('inv-clerk@example.test', 'Clerk');
  await q(`insert into platform_admin(user_id, level) values ($1, 'support')`, [operator.id]);
  const role = async (perms) => (await q(`insert into role(tenant_id, name, permissions) values ($1, $2, $3::jsonb) returning id`, [data.tenant_id, 'Role ' + randomUUID(), JSON.stringify(perms)]))[0].id;
  const join = async (userId, roleId) => {
    const [m] = await q(`insert into membership(tenant_id, user_id) values ($1, $2) returning id`, [data.tenant_id, userId]);
    await q(`insert into role_assignment(tenant_id, membership_id, role_id) values ($1, $2, $3)`, [data.tenant_id, m.id, roleId]);
    return m.id;
  };
  await join(owner.id, await role(['settings.support_access.read', 'settings.support_access.configure', 'settings.support_access.approve', 'settings.support_access.cancel']));
  const subjectMembership = await join(clerk.id, await role(READS));
  const tenant = (method, path, body) => f.request('/api/support-access' + path, { method, body, cookies: owner.cookies, headers: { 'x-tenant-id': data.tenant_id } });
  assert.equal((await tenant('PATCH', '/policy', { enabled: true, maxDurationSeconds: 1800, allowedAreas: AREAS, password: PASSWORD })).status, 200);
  const startGrant = async (areas) => {
    const g = await tenant('POST', '/grants', { operatorEmail: 'inv-ops@example.test', targetMembershipId: subjectMembership, entityId: data.id, areas, durationSeconds: 1800, reason: 'Invariance', password: PASSWORD });
    assert.equal(g.status, 201, JSON.stringify(g.data));
    const s = await f.request(`/api/support-access/operator/grants/${g.data.id}/start`, { body: { password: PASSWORD }, cookies: operator.cookies });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    return g.data.id;
  };
  const all = await startGrant(AREAS);
  const narrow = await startGrant(['inventory']);
  const cookie = [...operator.cookies].map(([k, v]) => k + '=' + v).join('; ');
  const read = async (grant, path) => {
    const r = await fetch(`${base}/api/support-access/workspace/${path}`, { headers: { cookie, origin: f.config.WEB_ORIGIN, 'x-factoryos-support-access': grant } });
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  const tables = (await q(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).map((r) => r.table_name);
  const EVIDENCE = new Set(['support_access_event', 'audit_event']);
  const snapshot = async () => {
    const out = {};
    for (const table of tables.filter((t) => !EVIDENCE.has(t))) out[table] = sha((await q(`select row_to_json(t)::text v from "${table}" t order by 1`)).map((r) => r.v).join('\n'));
    out['drizzle.__drizzle_migrations'] = sha(JSON.stringify(await q('select * from drizzle.__drizzle_migrations order by id')));
    return out;
  };
  const auditRows = () => q(`select * from audit_event where tenant_id = $1 order by seq`, [data.tenant_id]);
  const before = await snapshot();
  const auditBefore = await auditRows();
  const [{ n: eventsBefore }] = await q('select count(*)::int n from support_access_event');

  // Every catalogued panel, following real references, plus the context and a denial.
  const panels = [];
  const get = async (grant, path) => {
    const r = await read(grant, path);
    panels.push([path, r.status]);
    return r;
  };
  assert.equal((await get(all, 'context')).status, 200);
  const balance = await get(all, 'inventory?panel=balance');
  const itemId = balance.data.table.rows.find((r) => r.itemId)?.itemId;
  assert.ok(itemId);
  assert.equal((await get(all, `inventory?panel=ledger&itemId=${itemId}`)).status, 200);
  for (const area of ['sales-invoices', 'purchase-invoices', 'work-orders']) {
    const list = await get(all, `${area}?panel=list`);
    assert.equal(list.status, 200, JSON.stringify(list.data));
    const id = list.data.table.rows[0]?.id;
    if (id) assert.equal((await get(all, `${area}?panel=detail&id=${id}`)).status, 200);
  }
  for (const panel of ['status', 'day-book']) assert.equal((await get(all, `accounting?panel=${panel}`)).status, 200);
  const tb = await get(all, 'accounting?panel=trial-balance');
  const accountId = tb.data.detail.tables[0].table.rows.find((r) => r.id)?.id;
  assert.equal((await get(all, `accounting?panel=ledger&accountId=${accountId}`)).status, 200);
  const denied = await get(narrow, 'accounting?panel=status');
  assert.equal(denied.data.code, 'SUPPORT_UNAVAILABLE');
  pass(`read ${panels.length} panels (context, all five areas with drill-downs) and one denial`);

  assert.deepEqual(await snapshot(), before);
  pass(`books, stock, FIFO, bills, activations, native credentials, sessions, tenancy and support consent unchanged (${tables.length - EVIDENCE.size} tables)`);

  const auditAfter = await auditRows();
  assert.deepEqual(auditAfter.slice(0, auditBefore.length), auditBefore, 'original audit rows unchanged');
  const appended = auditAfter.slice(auditBefore.length);
  const reads = panels.filter(([, s]) => s === 200).length;
  assert.equal(appended.length, reads, 'one audit row per released read');
  for (const row of appended) {
    assert.equal(row.action, 'support_access.read');
    assert.equal(row.actor_user_id, clerk.id);
    assert.equal(row.impersonator_user_id, operator.id);
  }
  const events = (await q('select kind from support_access_event order by occurred_at')).slice(eventsBefore);
  assert.deepEqual([...new Set(events.map((e) => e.kind))].sort(), ['denied', 'read']);
  pass(`only evidence appended: ${appended.length} two-identity audit rows and ${events.length} support events`);

  for (let i = 1; i < auditAfter.length; i++) assert.equal(auditAfter[i].prev_hash, auditAfter[i - 1].hash, `chain link at seq ${auditAfter[i].seq}`);
  for (const r of appended) {
    const row = {
      occurredAt: new Date(r.occurred_at),
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      actorUserId: r.actor_user_id,
      impersonatorUserId: r.impersonator_user_id,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      before: r.before,
      after: r.after,
      reason: r.reason,
      ip: r.ip,
      userAgent: r.user_agent,
      prevHash: r.prev_hash,
    };
    assert.equal(sha(JSON.stringify(row)), r.hash, `hash of seq ${r.seq}`);
  }
  pass(`tenant audit chain links over ${auditAfter.length} rows and every two-identity row re-hashes`);
} finally {
  await f.close();
}
console.log(`\nSupport access invariance: ${count} checks passed.`);
