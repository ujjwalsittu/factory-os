// Support access (decision 050) Task 9: real concurrency and deadline barriers. Competing work runs on separate
// PostgreSQL backends whose blocking is observed through pg_blocking_pids; nothing is proven by sleeping alone.
// Covers single-use start, read/revoke serialisation, irreversible invalidation after source removal and restoration,
// the bound native session, concurrent source transactions in different orders, and the support/control deadlines.
// Usage: pnpm --filter @factoryos/api... build && node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-barriers.mjs
import assert from 'node:assert/strict';
import { toNodeHandler } from 'better-auth/node';
import { AuditService } from '../dist/common/audit.service.js';
import { SupportProofService } from '../dist/modules/support-access/support-access.proof.js';
import { SupportReadService } from '../dist/modules/support-access/support-access.read.js';
import { SupportReadPoolService } from '../dist/modules/support-access/support-access.read-pool.js';
import { supportTransport } from '../dist/modules/support-access/support-access.transport.js';
import { SupportWorkspaceController } from '../dist/modules/support-access/support-access.workspace.controller.js';
import { addMember, PASSWORD, seedTenant, startSupportFixture, totp, withObservedBlocker } from './support-access-test-helpers.mjs';

let count = 0;
const test = async (name, fn) => {
  await fn();
  count++;
  console.log(`PASS ${name}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const f = await startSupportFixture(
  {},
  {
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
const cookieOf = (who) => [...who.cookies].map(([k, v]) => k + '=' + v).join('; ');

/** A new completed native sign-in (password + TOTP) for a proof younger than 300 seconds. */
async function freshen(u) {
  const cookies = new Map();
  const r = await f.request('/sign-in/email', { body: { email: u.email, password: u.password ?? PASSWORD }, cookies });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await f.request('/two-factor/verify-totp', { body: { code: totp(u.secret) }, cookies })).status, 200);
  const [s] = await q('select id from session where user_id = $1 order by created_at desc limit 1', [u.id]);
  u.cookies = cookies;
  u.ctx = { ...u.ctx, sessionId: s.id };
  return u;
}

try {
  const owner = await f.completedUser('owner@example.test', 'totp', 'Owner');
  const operator = await f.completedUser('ops@example.test', 'totp', 'Operator');
  const clerk = await f.localUser('clerk@example.test', 'Clerk');
  await q(`insert into platform_admin(user_id, level) values ($1, 'support')`, [operator.id]);
  const t = await seedTenant(f.db, owner.id);
  const member = await addMember(f.db, t.tenantId, clerk.id, ['inventory.report.read', 'accounts.report.read'], [t.entityId]);
  const tenant = (method, path, body) => f.request('/api/support-access' + path, { method, body, cookies: owner.cookies, headers: { 'x-tenant-id': t.tenantId } });
  await freshen(owner);
  assert.equal((await tenant('PATCH', '/policy', { enabled: true, maxDurationSeconds: 1800, allowedAreas: ['inventory', 'accounting'], password: PASSWORD })).status, 200);

  const approve = async () => {
    await freshen(owner);
    const g = await tenant('POST', '/grants', { operatorEmail: 'ops@example.test', targetMembershipId: member.membershipId, entityId: t.entityId, areas: ['inventory', 'accounting'], durationSeconds: 1800, reason: 'Barrier ticket', password: PASSWORD });
    assert.equal(g.status, 201, JSON.stringify(g.data));
    return g.data.id;
  };
  const startHttp = (id) => f.request(`/api/support-access/operator/grants/${id}/start`, { body: { password: PASSWORD }, cookies: operator.cookies });
  const started = async () => {
    const id = await approve();
    await freshen(operator);
    const s = await startHttp(id);
    assert.equal(s.status, 200, JSON.stringify(s.data));
    return id;
  };
  const read = (grant, panel = 'accounting?panel=status', who = operator) =>
    fetch(`${base}/api/support-access/workspace/${panel}`, { headers: { cookie: cookieOf(who), origin: f.config.WEB_ORIGIN, 'x-factoryos-support-access': grant } }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  const events = async (grant, kind) => (await q(`select count(*)::int n from support_access_event where grant_id = $1 and kind = $2`, [grant, kind]))[0].n;
  const holdPolicy = (c) => c.query('begin').then(() => c.query('select 1 from support_access_policy where tenant_id = $1 for update', [t.tenantId]));

  await test('two concurrent starts on separate backends: exactly one succeeds, the other is a conflict, one start event', async () => {
    const id = await approve();
    await freshen(operator);
    await withObservedBlocker(f.url, async ({ first, pids, waiters }) => {
      await holdPolicy(first);
      const both = [startHttp(id), startHttp(id)];
      const seen = await waiters(1);
      assert.ok(seen.blockers.includes(pids.first), 'a start is blocked by the held policy lock');
      assert.ok(!seen.pids.includes(pids.first));
      await first.query('commit');
      const startStatuses = (await Promise.all(both)).map((r) => r.status);
      assert.deepEqual(startStatuses.sort(), [200, 409]);
    });
    assert.equal(await events(id, 'started'), 1);
  });

  await test('read and revoke serialise: the read queued before the revoke sees data, the one after sees an ended grant', async () => {
    const id = await started();
    await withObservedBlocker(f.url, async ({ first, pids, waiters }) => {
      await holdPolicy(first);
      const before = read(id);
      assert.ok((await waiters(1)).blockers.includes(pids.first));
      const revoke = tenant('POST', `/grants/${id}/revoke`);
      await waiters(2);
      const after = read(id);
      await waiters(3);
      await first.query('commit');
      const [r1, rv, r2] = await Promise.all([before, revoke, after]);
      assert.equal(r1.status, 200, JSON.stringify(r1.data));
      assert.equal(r1.data.kind, 'detail');
      assert.equal(rv.data.state, 'revoked');
      assert.equal(r2.data.code, 'SUPPORT_ENDED');
      assert.equal(JSON.stringify(r2.data).includes('Books active'), false);
    });
    const order = await q(`select kind from support_access_event where grant_id = $1 and kind in ('read', 'revoked') order by occurred_at`, [id]);
    assert.deepEqual(order.map((r) => r.kind), ['read', 'revoked']);
  });

  // Each source change is removed and then restored in separate committed transactions, without any support request in
  // between. The old grant must stay ended: restoration never revives consent.
  const restorations = [
    ['subject role assignment', async () => {
      const [ra] = await q(`delete from role_assignment where membership_id = $1 returning tenant_id, membership_id, role_id, entity_ids`, [member.membershipId]);
      await q(`insert into role_assignment(tenant_id, membership_id, role_id, entity_ids) values ($1, $2, $3, $4::jsonb)`, [ra.tenant_id, ra.membership_id, ra.role_id, JSON.stringify(ra.entity_ids)]);
    }],
    ['subject membership status', async () => {
      await q(`update membership set status = 'disabled' where id = $1`, [member.membershipId]);
      await q(`update membership set status = 'active' where id = $1`, [member.membershipId]);
    }],
    ['subject role permissions', async () => {
      await q(`update role set permissions = '["inventory.report.read"]'::jsonb where id = $1`, [member.roleId]);
      await q(`update role set permissions = '["inventory.report.read","accounts.report.read"]'::jsonb where id = $1`, [member.roleId]);
    }],
    ['tenant status', async () => {
      await q(`update tenant set status = 'suspended' where id = $1`, [t.tenantId]);
      await q(`update tenant set status = 'active' where id = $1`, [t.tenantId]);
    }],
    ['entity active flag', async () => {
      await q(`update legal_entity set is_active = false where id = $1`, [t.entityId]);
      await q(`update legal_entity set is_active = true where id = $1`, [t.entityId]);
    }],
    ['operator platform role', async () => {
      await q(`delete from platform_admin where user_id = $1`, [operator.id]);
      await q(`insert into platform_admin(user_id, level) values ($1, 'support')`, [operator.id]);
    }],
    ['subject email', async () => {
      await q(`update "user" set email = 'clerk-renamed@example.test' where id = $1`, [clerk.id]);
      await q(`update "user" set email = 'clerk@example.test' where id = $1`, [clerk.id]);
    }],
    ['operator password (native change and change back, other sessions kept)', async () => {
      const other = { ...operator };
      await freshen(other);
      for (const [from, to] of [[PASSWORD, PASSWORD + '-new'], [PASSWORD + '-new', PASSWORD]]) {
        const r = await f.request('/change-password', { body: { currentPassword: from, newPassword: to, revokeOtherSessions: false }, cookies: other.cookies });
        assert.equal(r.status, 200, JSON.stringify(r.data));
      }
    }],
    ['approver TOTP (native disable and enrol again)', async () => {
      await freshen(owner);
      assert.equal((await f.request('/two-factor/disable', { body: { password: PASSWORD }, cookies: owner.cookies })).status, 200);
      const enabled = await f.request('/two-factor/enable', { body: { password: PASSWORD }, cookies: owner.cookies });
      assert.equal(enabled.status, 200, JSON.stringify(enabled.data));
      owner.secret = new URL(enabled.data.totpURI).searchParams.get('secret');
      assert.equal((await f.request('/two-factor/verify-totp', { body: { code: totp(owner.secret) }, cookies: owner.cookies })).status, 200);
    }],
  ];
  await test(`removal then restoration of each source never revives consent (${restorations.length} sources)`, async () => {
    for (const [label, change] of restorations) {
      const id = await started();
      assert.equal((await read(id)).status, 200, `${label}: readable before`);
      await change();
      const restoredOldGrantRead = await read(id);
      assert.equal(restoredOldGrantRead.data.code, 'SUPPORT_ENDED', `${label}: ${JSON.stringify(restoredOldGrantRead.data)}`);
      assert.ok((await q(`select 1 from support_access_event where grant_id = $1 and kind = 'invalidated'`, [id])).length, `${label}: invalidation recorded`);
      // A fresh approval after restoration works normally.
    }
    const again = await started();
    assert.equal((await read(again)).status, 200, 'new consent after restoration works');
    await f.request(`/api/support-access/operator/grants/${again}/stop`, { method: 'POST', cookies: operator.cookies });
  });

  await test('unrelated session cleanup, bound-session renewal and name changes do not end consent; bound logout does', async () => {
    const id = await started();
    const bound = operator.ctx.sessionId;
    const spare = { ...operator };
    await freshen(spare);
    await q(`delete from session where id = $1`, [spare.ctx.sessionId]);
    await q(`update session set expires_at = expires_at + interval '1 day', updated_at = now() where id = $1`, [bound]);
    await q(`update "user" set name = 'Clerk Renamed' where id = $1`, [clerk.id]);
    assert.equal((await read(id)).status, 200);
    assert.equal(await events(id, 'invalidated'), 0);
    const out = await f.request('/sign-out', { body: {}, cookies: new Map(operator.cookies) });
    assert.equal(out.status, 200);
    const r = await read(id);
    assert.ok(r.status >= 400 && !('kind' in (r.data ?? {})), JSON.stringify(r.data));
    const [ended] = await q(`select reason_code from support_access_event where grant_id = $1 and kind = 'invalidated'`, [id]);
    assert.equal(ended.reason_code, 'actor-session-ended');
  });

  await test('concurrent native and tenant source transactions in different orders all commit with no lost bump', async () => {
    const extra = [];
    for (const n of [1, 2]) {
      const u = await f.localUser(`extra${n}@example.test`, `Extra ${n}`);
      extra.push({ user: u, ...(await addMember(f.db, t.tenantId, u.id, ['inventory.report.read'])) });
    }
    // Epoch rows exist for users who take part in consent (seeded at approval); seed them as approval would.
    await f.store.seedEpochs(f.db, extra.map((x) => x.user.id));
    const [{ rev: rev0 }] = await q(`select authority_revision::int rev from support_access_policy where tenant_id = $1`, [t.tenantId]);
    const epochs = async () => (await q(`select user_id, security_epoch::int e from support_access_user_epoch where user_id = any($1) order by user_id`, [extra.map((x) => x.user.id)])).map((r) => r.e);
    const e0 = await epochs();
    await withObservedBlocker(f.url, async ({ first, second, waiters }) => {
      await first.query('begin');
      await second.query('begin');
      // first: native identity, then tenancy (a multi-row role update); second: tenancy, then native identity.
      await first.query(`update "user" set email = 'extra1b@example.test' where id = $1`, [extra[0].user.id]);
      await second.query(`update membership set status = 'disabled' where id = $1`, [extra[1].membershipId]);
      const a = first.query(`update role set permissions = '["inventory.report.read","accounts.report.read"]'::jsonb where id = any($1)`, [[extra[0].roleId, extra[1].roleId]]);
      await waiters(1);
      const b = second.query(`update "user" set email = 'extra2b@example.test' where id = $1`, [extra[1].user.id]);
      await second.query('commit').catch(() => {});
      await Promise.all([a, b]);
      await first.query('commit');
    });
    const [{ rev }] = await q(`select authority_revision::int rev from support_access_policy where tenant_id = $1`, [t.tenantId]);
    assert.equal(rev, rev0 + 2, 'one bump per committed tenancy statement');
    const e1 = await epochs();
    assert.deepEqual(e1.map((e, i) => e - e0[i]), [1, 1], 'one bump per user email change');
  });

  await test('an audit wait that crosses the support deadline releases nothing (database clock after the wait)', async () => {
    const id = await approve();
    await freshen(operator);
    const headers = new Headers({ origin: f.config.WEB_ORIGIN, cookie: cookieOf(operator) });
    const proofs = f.app.get(SupportProofService);
    const actor = { ...(await proofs.actor(headers)), platformAdminLevel: 'support' };
    const proof = await proofs.confirm(headers, PASSWORD, operator.id);
    // The deadline is the earlier of the duration and the native session expiry: make it three seconds away.
    await q(`update session set expires_at = clock_timestamp() + interval '3 seconds' where id = $1`, [operator.ctx.sessionId]);
    const ctx = await f.store.start(actor, id, proof, f.app.get(AuditService));
    const deadline = Date.parse(ctx.expiresAt);
    await withObservedBlocker(f.url, async ({ first, pids, waiters }) => {
      await first.query('begin');
      await first.query(`select pg_advisory_xact_lock(hashtext($1))`, ['audit:' + t.tenantId]);
      const pending = read(id);
      assert.ok((await waiters(1)).blockers.includes(pids.first), 'the read waits on the held audit lock');
      await sleep(Math.max(0, deadline - Date.now()) + 300);
      await first.query('commit');
      const expiredAfterAuditWait = await pending;
      assert.equal(expiredAfterAuditWait.data.code, 'SUPPORT_ENDED', JSON.stringify(expiredAfterAuditWait.data));
    });
    assert.equal(await events(id, 'read'), 0, 'no read evidence and no data');
  });

  await test('the 5-second control deadline ends a read held behind the audit lock, with no data', async () => {
    const id = await started();
    await withObservedBlocker(f.url, async ({ first, waiters }) => {
      await first.query('begin');
      await first.query(`select pg_advisory_xact_lock(hashtext($1))`, ['audit:' + t.tenantId]);
      const t0 = Date.now();
      const pending = read(id);
      await waiters(1);
      const r = await pending;
      const took = Date.now() - t0;
      await first.query('commit');
      assert.equal(r.data.code, 'SUPPORT_UNAVAILABLE');
      assert.ok(took >= 4500 && took < 7000, `took ${took} ms`);
    });
    assert.equal(await events(id, 'read'), 0);
    assert.equal((await read(id)).status, 200, 'the grant itself is unaffected');
  });

  await test('with both read-pool connections busy, a read gives up after the 2-second wait and releases nothing', async () => {
    const id = await started();
    const pool = f.app.get(SupportReadPoolService);
    const hold = [pool.run((db) => db.execute('select pg_sleep(3.5)')), pool.run((db) => db.execute('select pg_sleep(3.5)'))];
    await sleep(100);
    const t0 = Date.now();
    const r = await read(id, 'inventory?panel=balance');
    const waited = Date.now() - t0;
    await Promise.allSettled(hold);
    assert.equal(r.data.code, 'SUPPORT_UNAVAILABLE', JSON.stringify(r.data));
    assert.ok(waited >= 1900 && waited < 3500, `waited ${waited} ms`);
    assert.equal(await events(id, 'read'), 0);
  });

  await test('the bound session deleted while a read waits for its locks: the read returns nothing', async () => {
    const id = await started();
    await withObservedBlocker(f.url, async ({ first, second, pids, waiters }) => {
      await holdPolicy(first);
      const pending = read(id);
      assert.ok((await waiters(1)).blockers.includes(pids.first));
      await second.query('delete from session where id = $1', [operator.ctx.sessionId]);
      await first.query('commit');
      const r = await pending;
      assert.ok(!('kind' in (r.data ?? {})), JSON.stringify(r.data));
      assert.equal(r.data.code, 'SUPPORT_ENDED');
    });
    assert.equal(await events(id, 'read'), 0);
  });
} finally {
  await f.close();
}
console.log(`\nSupport access barriers: ${count} checks passed.`);
