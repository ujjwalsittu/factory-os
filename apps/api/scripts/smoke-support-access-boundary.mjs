// Support access (decision 050) Task 6: the selector header cannot escape the read boundary, origins are exact,
// every read writes required two-identity evidence before data leaves, and ordinary audit hashing is unchanged.
// Usage: pnpm --filter @factoryos/api... build && node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-boundary.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { toNodeHandler } from 'better-auth/node';
import { AuditService } from '../dist/common/audit.service.js';
import { SupportReadService } from '../dist/modules/support-access/support-access.read.js';
import { SupportReadPoolService } from '../dist/modules/support-access/support-access.read-pool.js';
import { supportTransport } from '../dist/modules/support-access/support-access.transport.js';
import { SupportWorkspaceController } from '../dist/modules/support-access/support-access.workspace.controller.js';
import { addMember, PASSWORD, seedTenant, startSupportFixture } from './support-access-test-helpers.mjs';

let count = 0;
const test = async (name, fn) => {
  await fn();
  count++;
  console.log(`PASS ${name}`);
};
let nativeDispatches = 0;
const f = await startSupportFixture(
  {},
  {
    controllers: [SupportWorkspaceController],
    providers: [SupportReadService, SupportReadPoolService],
    configure(app, { config, auth }) {
      // The same order as main.ts: transport first, then native auth, then everything else.
      const server = app.getHttpAdapter().getInstance();
      server.use(supportTransport(config.supportAccess));
      server.all('/api/auth/{*path}', (_req, _res, next) => {
        nativeDispatches++;
        next();
      }, toNodeHandler(auth));
    },
  },
);
const q = (text, values) => f.db.$client.query(text, values).then((r) => r.rows);
const api = new URL(process.env.API ?? 'http://localhost:4000');
const base = `http://${api.hostname === 'localhost' ? '127.0.0.1' : api.hostname}:${api.port || 4000}`;
const WEB = f.config.WEB_ORIGIN;
const cookieOf = (who) => [...who.cookies].map(([k, v]) => k + '=' + v).join('; ');

try {
  const owner = await f.completedUser('owner@example.test', 'totp', 'Owner');
  const operator = await f.completedUser('ops@example.test', 'totp', 'Operator');
  const rival = await f.completedUser('ops2@example.test', 'totp', 'Rival');
  const clerk = await f.localUser('clerk@example.test', 'Clerk');
  await q(`insert into platform_admin(user_id, level) values ($1, 'support'), ($2, 'support')`, [operator.id, rival.id]);
  const t = await seedTenant(f.db, owner.id);
  const member = await addMember(f.db, t.tenantId, clerk.id, ['inventory.report.read', 'accounts.report.read', 'buying.purchase_invoice.read'], [t.entityId]);
  const control = (who, method, path, body) => f.request('/api/support-access' + path, { method, body, cookies: who.cookies, headers: { 'x-tenant-id': t.tenantId } });
  assert.equal((await control(owner, 'PATCH', '/policy', { enabled: true, maxDurationSeconds: 1800, allowedAreas: ['inventory', 'accounting', 'purchase-invoices'], password: PASSWORD })).status, 200);
  const grantFor = async (areas = ['inventory', 'accounting']) => {
    const g = await control(owner, 'POST', '/grants', { operatorEmail: 'ops@example.test', targetMembershipId: member.membershipId, entityId: t.entityId, areas, durationSeconds: 1800, reason: 'Ticket 9', password: PASSWORD });
    assert.equal(g.status, 201, JSON.stringify(g.data));
    const s = await f.request(`/api/support-access/operator/grants/${g.data.id}/start`, { body: { password: PASSWORD }, cookies: operator.cookies });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    return g.data.id;
  };
  const grant = await grantFor();
  const ws = (path, headers = {}, method = 'GET', who = operator) =>
    fetch(base + path, { method, headers: { cookie: cookieOf(who), origin: WEB, 'x-factoryos-support-access': grant, ...headers } }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

  await test('the workspace context names the real operator and the subject, with server time and deadline', async () => {
    const r = await ws('/api/support-access/workspace/context');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.actor.id, operator.id);
    assert.equal(r.data.grant.subject.id, clerk.id);
    assert.deepEqual(r.data.effectiveAreas, ['inventory', 'accounting']);
    assert.ok(Date.parse(r.data.serverNow) < Date.parse(r.data.expiresAt));
  });
  await test('a panel read returns data only after the subject+operator audit row and the read event commit', async () => {
    const before = (await q(`select count(*)::int n from support_access_event where grant_id = $1 and kind = 'read'`, [grant]))[0].n;
    const r = await ws('/api/support-access/workspace/accounting?panel=status');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.kind, 'detail');
    assert.equal((await q(`select count(*)::int n from support_access_event where grant_id = $1 and kind = 'read'`, [grant]))[0].n, before + 1);
    const [row] = await q(`select actor_user_id, impersonator_user_id, after from audit_event where action = 'support_access.read' and target_id = $1 order by seq desc limit 1`, [grant]);
    assert.equal(row.actor_user_id, clerk.id);
    assert.equal(row.impersonator_user_id, operator.id);
    assert.deepEqual(row.after, { area: 'accounting', panel: 'status' });
    assert.equal((await ws('/api/support-access/workspace/inventory?panel=balance')).data.kind, 'table');
  });

  await test('the selector header never reaches native auth', async () => {
    const before = nativeDispatches;
    for (const [method, path] of [['GET', '/api/auth/get-session'], ['POST', '/api/auth/sign-out'], ['GET', '/api/auth/list-sessions'], ['POST', '/api/auth/sign-in/email']]) {
      const r = await ws(path, {}, method);
      assert.equal(r.status, 403, `${method} ${path}`);
    }
    assert.equal(nativeDispatches, before, 'no native auth handler ran');
    assert.equal((await f.request('/get-session', { cookies: operator.cookies })).data.user.id, operator.id, 'still signed in');
  });
  await test('the selector header is refused on controls, other paths and other methods before any handler', async () => {
    for (const [method, path] of [
      ['GET', '/api/support-access/policy'],
      ['GET', '/api/support-access/operator/grants'],
      ['POST', `/api/support-access/operator/grants/${grant}/stop`],
      ['POST', '/api/support-access/workspace/context'],
      ['GET', '/api/support-access/workspace/settings'],
      ['GET', '/api/support-access/workspace/context/extra'],
      ['GET', '/api/support-access/workspace/../policy'],
      ['GET', '/api/accounts/invoice-balances'],
      ['GET', '/api/attachments'],
    ])
      assert.equal((await ws(path, {}, method)).status, 403, `${method} ${path}`);
    assert.equal((await q(`select end_kind from support_access_grant where id = $1`, [grant]))[0].end_kind, null, 'the stop never ran');
  });
  await test('malformed, duplicated or conflicting selectors fail; no cookie means no access', async () => {
    assert.equal((await ws('/api/support-access/workspace/context', { 'x-factoryos-support-access': 'not-a-uuid' })).status, 400);
    assert.equal((await ws('/api/support-access/workspace/context', { 'x-factoryos-support-access': `${grant}, ${grant}` })).status, 400);
    assert.equal((await ws('/api/support-access/workspace/context', { 'x-tenant-id': t.tenantId })).status, 400);
    assert.equal((await ws('/api/support-access/workspace/context', { 'x-entity-id': t.entityId })).status, 400);
    const anonymous = await fetch(base + '/api/support-access/workspace/context', { headers: { origin: WEB, 'x-factoryos-support-access': grant } });
    assert.equal(anonymous.status, 403);
    assert.equal((await fetch(base + '/api/support-access/workspace/context', { headers: { cookie: cookieOf(operator), origin: WEB } })).status, 400, 'workspace needs the selector');
    assert.equal((await ws('/api/support-access/workspace/accounting?panel=status&panel=status')).status, 400, 'duplicate parameters');
    assert.equal((await ws('/api/support-access/workspace/accounting?panel=status&sql=1')).status, 400, 'unknown parameters');
  });
  await test('origins are exact: evil hosts, ports and subdomains refuse; same-origin fetch metadata with an exact referer passes', async () => {
    for (const origin of ['http://evil.example', 'http://localhost:3001', 'http://sub.localhost:3000', 'null'])
      assert.equal((await ws('/api/support-access/workspace/context', { origin })).status, 403, origin);
    const noOrigin = (headers) => fetch(base + '/api/support-access/workspace/context', { headers: { cookie: cookieOf(operator), 'x-factoryos-support-access': grant, ...headers } }).then((r) => r.status);
    assert.equal(await noOrigin({ 'sec-fetch-site': 'same-origin', referer: WEB + '/support/workspace/' + grant }), 200);
    assert.equal(await noOrigin({ 'sec-fetch-site': 'cross-site', referer: WEB + '/support' }), 403);
    assert.equal(await noOrigin({ 'sec-fetch-site': 'same-origin', referer: 'http://evil.example/support' }), 403);
    assert.equal(await noOrigin({ referer: WEB + '/support' }), 403, 'no fetch metadata');
    const spoof = await new Promise((resolve) => {
      const req = http.request(base + '/api/support-access/workspace/context', { headers: { host: 'evil.example', origin: 'http://evil.example', cookie: cookieOf(operator), 'x-factoryos-support-access': grant } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.end();
    });
    assert.equal(spoof, 403, 'a forged Host never becomes the allowed origin');
  });
  await test('control writes need the exact web origin', async () => {
    const stop = (headers) => fetch(base + `/api/support-access/operator/grants/${grant}/stop`, { method: 'POST', headers: { cookie: cookieOf(operator), 'content-type': 'application/json', ...headers } }).then((r) => r.status);
    assert.equal(await stop({}), 403, 'no Origin');
    assert.equal(await stop({ origin: 'http://evil.example' }), 403);
    // Routing ignores case and decodes nothing the check would miss: other spellings of the path are held to it too.
    for (const path of [`/api/Support-Access/operator/grants/${grant}/stop`, `/API/SUPPORT-ACCESS/operator/grants/${grant}/stop`, `/api/support-access/operator/grants/${grant}/stop/`]) {
      const r = await fetch(base + path, { method: 'POST', headers: { cookie: cookieOf(operator), 'content-type': 'application/json' } });
      assert.equal(r.status, 403, path);
    }
    // Without the selector, other spellings of a workspace path are refused before any handler.
    assert.equal((await fetch(base + '/api/Support-Access/Workspace/context', { headers: { cookie: cookieOf(operator), origin: WEB } })).status, 400);
  });
  await test('unknown and foreign grants are a generic 404; another operator cannot use the selector', async () => {
    assert.deepEqual(await ws('/api/support-access/workspace/context', { 'x-factoryos-support-access': crypto.randomUUID() }), { status: 404, data: { code: 'SUPPORT_UNAVAILABLE' } });
    assert.deepEqual(await ws('/api/support-access/workspace/context', {}, 'GET', rival), { status: 404, data: { code: 'SUPPORT_UNAVAILABLE' } });
  });
  await test('an area outside the approved scope is denied, with the denial kept as evidence', async () => {
    const r = await ws('/api/support-access/workspace/purchase-invoices?panel=list');
    assert.deepEqual([r.status, r.data], [403, { code: 'SUPPORT_UNAVAILABLE' }]);
    assert.equal((await q(`select count(*)::int n from support_access_event where grant_id = $1 and kind = 'denied' and area = 'purchase-invoices'`, [grant]))[0].n, 1);
  });
  await test('if the required audit insert fails, no data and no read evidence are released', async () => {
    const before = (await q(`select count(*)::int n from support_access_event where grant_id = $1 and kind = 'read'`, [grant]))[0].n;
    await q(`create function refuse_support_audit() returns trigger language plpgsql as $$ begin if new.action = 'support_access.read' then raise exception 'audit store unavailable'; end if; return new; end $$`);
    await q(`create trigger refuse_support_audit before insert on audit_event for each row execute function refuse_support_audit()`);
    try {
      const r = await ws('/api/support-access/workspace/accounting?panel=status');
      assert.notEqual(r.status, 200);
      assert.deepEqual(r.data, { code: 'SUPPORT_UNAVAILABLE' });
    } finally {
      await q('drop trigger refuse_support_audit on audit_event; drop function refuse_support_audit()');
    }
    assert.equal((await q(`select count(*)::int n from support_access_event where grant_id = $1 and kind = 'read'`, [grant]))[0].n, before);
  });
  await test('ordinary audit rows keep their byte-identical hash and a null impersonator', async () => {
    const audit = f.app.get(AuditService);
    await audit.record({ user: { id: owner.id, email: owner.email, name: 'Owner' }, sessionId: 'x', platformAdminLevel: null, tenant: null, ip: '127.0.0.1', userAgent: 'fixture' }, { action: 'fixture.check', targetType: 'fixture', targetId: 'one', tenantId: t.tenantId, after: { a: 1 } });
    const [row] = await q(`select * from audit_event where action = 'fixture.check' order by seq desc limit 1`);
    assert.equal(row.impersonator_user_id, null);
    const recomputed = {
      occurredAt: new Date(row.occurred_at), tenantId: row.tenant_id, entityId: row.entity_id, actorUserId: row.actor_user_id, impersonatorUserId: null, action: row.action, targetType: row.target_type,
      targetId: row.target_id, before: row.before, after: row.after, reason: row.reason, ip: row.ip, userAgent: row.user_agent, prevHash: row.prev_hash,
    };
    assert.equal(createHash('sha256').update(JSON.stringify(recomputed)).digest('hex'), row.hash);
  });
  await test('a stopped grant reads as ended; the deployment switch closes the workspace', async () => {
    const second = await grantFor(['inventory']);
    assert.equal((await f.request(`/api/support-access/operator/grants/${grant}/stop`, { method: 'POST', cookies: operator.cookies })).data.state, 'stopped');
    assert.deepEqual((await ws('/api/support-access/workspace/context')).data, { code: 'SUPPORT_ENDED' });
    f.config.supportAccess.enabled = false;
    try {
      assert.equal((await ws('/api/support-access/workspace/context', { 'x-factoryos-support-access': second })).status, 403);
    } finally {
      f.config.supportAccess.enabled = true;
    }
  });
} finally {
  await f.app.get(SupportReadPoolService).close().catch(() => undefined);
  await f.close();
}
console.log(`\nSupport access boundary: ${count} checks passed.`);
