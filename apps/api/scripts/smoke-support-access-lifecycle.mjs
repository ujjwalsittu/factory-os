// Support access (decision 050) Task 4: operator inbox, single-use start bound to the operator's native session, the
// deadline rule, and stop/revoke by each participant. Real native sessions and the real guard throughout.
// Usage: pnpm --filter @factoryos/api... build && node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-lifecycle.mjs
import assert from 'node:assert/strict';
import { Controller, Get } from '@nestjs/common';
import { PlatformAdmin } from '../dist/common/access.js';
import { AuditService } from '../dist/common/audit.service.js';
import { SupportProofService } from '../dist/modules/support-access/support-access.proof.js';
import { addMember, PASSWORD, seedTenant, startSupportFixture } from './support-access-test-helpers.mjs';

// The existing platform console guard, unchanged: SuperAdmin only.
class ConsoleProbe {
  console() {
    return { ok: true };
  }
}
Controller('support-fixture')(ConsoleProbe);
Get('console')(ConsoleProbe.prototype, 'console', Object.getOwnPropertyDescriptor(ConsoleProbe.prototype, 'console'));
PlatformAdmin()(ConsoleProbe.prototype, 'console', Object.getOwnPropertyDescriptor(ConsoleProbe.prototype, 'console'));

let count = 0;
const test = async (name, fn) => {
  await fn();
  count++;
  console.log(`PASS ${name}`);
};
const f = await startSupportFixture({}, { controllers: [ConsoleProbe] });
const q = (text, values) => f.db.$client.query(text, values).then((r) => r.rows);

try {
  const owner = await f.completedUser('owner@example.test', 'totp', 'Owner');
  const operator = await f.completedUser('ops@example.test', 'totp', 'Operator');
  const rival = await f.completedUser('ops2@example.test', 'totp', 'Other operator');
  const clerk = await f.localUser('clerk@example.test', 'Clerk');
  await q(`insert into platform_admin(user_id, level) values ($1, 'support'), ($2, 'support')`, [operator.id, rival.id]);
  const t = await seedTenant(f.db, owner.id);
  const clerkMember = await addMember(f.db, t.tenantId, clerk.id, ['inventory.report.read', 'accounts.report.read'], [t.entityId]);
  const auditor = await f.completedUser('auditor@example.test', 'totp', 'Auditor');
  await addMember(f.db, t.tenantId, auditor.id, ['settings.support_access.read']);
  const tenant = (who, method, path, body) => f.request('/api/support-access' + path, { method, body, cookies: who.cookies, headers: { 'x-tenant-id': t.tenantId } });
  const op = (who, method, path, body) => f.request('/api/support-access/operator' + path, { method, body, cookies: who.cookies });
  assert.equal((await tenant(owner, 'PATCH', '/policy', { enabled: true, maxDurationSeconds: 1800, allowedAreas: ['inventory', 'accounting'], password: PASSWORD })).status, 200);
  const approve = async (patch = {}) => {
    const r = await tenant(owner, 'POST', '/grants', { operatorEmail: 'ops@example.test', targetMembershipId: clerkMember.membershipId, entityId: t.entityId, areas: ['inventory', 'accounting'], durationSeconds: 1800, reason: 'Ticket 7: ledger check', password: PASSWORD, ...patch });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  };
  const sessionsOf = async (id) => (await q('select id from session where user_id = $1 order by id', [id])).map((r) => r.id);

  const g = await approve();
  await test('the operator inbox lists only consent addressed to that operator', async () => {
    const mine = await op(operator, 'GET', '/grants');
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.data.grants.map((x) => x.id), [g.id]);
    assert.deepEqual((await op(rival, 'GET', '/grants')).data.grants, []);
  });
  await test('people without a platform operator role have no inbox', async () => {
    const r = await op(clerk, 'GET', '/grants');
    assert.deepEqual([r.status, r.data], [403, { code: 'SUPPORT_UNAVAILABLE' }]);
  });
  await test('another operator cannot see, start or stop the grant: it is not found', async () => {
    assert.equal((await op(rival, 'POST', `/grants/${g.id}/start`, { password: PASSWORD })).status, 404);
    assert.equal((await op(rival, 'POST', `/grants/${g.id}/stop`)).status, 404);
  });
  await test('start needs the actual password', async () => {
    assert.equal((await op(operator, 'POST', `/grants/${g.id}/start`, {})).status, 400);
    assert.equal((await op(operator, 'POST', `/grants/${g.id}/start`, { password: 'Wrong-password-1' })).data.code, 'SUPPORT_REAUTHENTICATE');
  });

  let started;
  await test('start consumes consent once, binds the native session and creates no other session', async () => {
    const before = await sessionsOf(clerk.id);
    const operatorBefore = await sessionsOf(operator.id);
    const r = await op(operator, 'POST', `/grants/${g.id}/start`, { password: PASSWORD });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    started = r.data;
    assert.equal(started.actorSessionId, operator.ctx.sessionId);
    assert.equal(started.grant.state, 'active');
    assert.deepEqual(started.effectiveAreas, ['inventory', 'accounting']);
    const [native] = await q('select expires_at from session where id = $1', [operator.ctx.sessionId]);
    assert.ok(Date.parse(started.expiresAt) <= new Date(native.expires_at).getTime());
    assert.ok(Date.parse(started.expiresAt) - Date.parse(started.grant.startedAt) <= 1800000);
    assert.deepEqual(await sessionsOf(clerk.id), before, 'no target session');
    assert.deepEqual(await sessionsOf(operator.id), operatorBefore, 'no new operator session');
  });
  await test('a second start is a conflict, and history records exactly one start', async () => {
    const again = await op(operator, 'POST', `/grants/${g.id}/start`, { password: PASSWORD });
    assert.equal(again.status, 409);
    assert.equal((await q(`select count(*)::int n from support_access_event where grant_id = $1 and kind = 'started'`, [g.id]))[0].n, 1);
  });
  await test('renewing the native session never extends the support deadline', async () => {
    await q(`update session set expires_at = expires_at + interval '7 days' where id = $1`, [operator.ctx.sessionId]);
    const row = (await op(operator, 'GET', '/grants')).data.grants.find((x) => x.id === g.id);
    assert.equal(row.expiresAt, started.expiresAt);
  });
  await test('the approver signing out does not end consent', async () => {
    await q('delete from session where user_id = $1', [owner.id]);
    assert.equal((await op(operator, 'GET', '/grants')).data.grants.find((x) => x.id === g.id).state, 'active');
  });

  const owner2 = await f.completedUser('owner2@example.test', 'totp', 'Second owner');
  await addMember(f.db, t.tenantId, owner2.id, ['settings.support_access.approve', 'settings.support_access.cancel', 'settings.support_access.read']);
  const tenant2 = (method, path, body) => f.request('/api/support-access' + path, { method, body, cookies: owner2.cookies, headers: { 'x-tenant-id': t.tenantId } });
  const approve2 = async (patch = {}) => {
    const r = await tenant2('POST', '/grants', { operatorEmail: 'ops@example.test', targetMembershipId: clerkMember.membershipId, entityId: t.entityId, areas: ['inventory'], durationSeconds: 900, reason: 'Ticket 8', password: PASSWORD, ...patch });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  };

  await test('the deadline is the earlier of the approved duration and the native session expiry', async () => {
    // Over HTTP the ordinary guard renews any session with under six days left before the handler runs, so the
    // native expiry is checked through the proof service (which never renews) and the store directly.
    // The native password check itself renews the session (native behaviour, preserved), so the expiry is
    // shortened after it and before start.
    const g2 = await approve2();
    const headers = new Headers({ origin: f.config.WEB_ORIGIN, cookie: [...operator.cookies].map(([k, v]) => k + '=' + v).join('; ') });
    const proofs = f.app.get(SupportProofService);
    const actor = { ...(await proofs.actor(headers)), platformAdminLevel: 'support' };
    const proof = await proofs.confirm(headers, PASSWORD, operator.id);
    const [set] = await q(`update session set expires_at = clock_timestamp() + interval '400 seconds' where id = $1 returning expires_at`, [operator.ctx.sessionId]);
    const ctx = await f.store.start(actor, g2.id, proof, f.app.get(AuditService));
    assert.equal(Date.parse(ctx.expiresAt), new Date(set.expires_at).getTime());
    assert.ok(Date.parse(ctx.expiresAt) < Date.parse(ctx.grant.startedAt) + 900000);
    await q(`update session set expires_at = clock_timestamp() + interval '7 days' where id = $1`, [operator.ctx.sessionId]);
    assert.equal((await op(operator, 'POST', `/grants/${g2.id}/stop`)).data.state, 'stopped');
  });
  await test('consent not started within 600 seconds has expired and cannot start', async () => {
    const [old] = await q(
      `insert into support_access_grant (tenant_id, entity_id, operator_user_id, subject_user_id, subject_membership_id, approver_user_id, areas, reason, duration_seconds, approved_at, start_by,
         policy_config_revision, tenant_authority_revision, operator_epoch, subject_epoch, approver_epoch, approver_password_version, approver_session_id)
       select $1, $2, $3, $4, $5, $6, array['inventory'], 'Old consent', 900, clock_timestamp() - interval '601 seconds', clock_timestamp() - interval '1 second',
         p.config_revision, p.authority_revision, 0, 0, 0, 'x', 'x' from support_access_policy p where p.tenant_id = $1 returning id`,
      [t.tenantId, t.entityId, operator.id, clerk.id, clerkMember.membershipId, owner2.id],
    );
    const r = await op(operator, 'POST', `/grants/${old.id}/start`, { password: PASSWORD });
    assert.equal(r.data.code, 'SUPPORT_ENDED');
    assert.equal((await op(operator, 'GET', '/grants')).data.grants.find((x) => x.id === old.id).state, 'expired');
  });
  await test('the subject can stop consent about themselves, idempotently; nobody else uses that route', async () => {
    const g3 = await approve2();
    assert.equal((await op(operator, 'POST', `/grants/${g3.id}/start`, { password: PASSWORD })).status, 200);
    assert.equal((await f.request(`/api/support-access/grants/${g3.id}/stop`, { method: 'POST', cookies: rival.cookies })).status, 404);
    const stop = await f.request(`/api/support-access/grants/${g3.id}/stop`, { method: 'POST', cookies: clerk.cookies });
    assert.deepEqual([stop.status, stop.data], [200, { state: 'stopped' }]);
    assert.deepEqual((await f.request(`/api/support-access/grants/${g3.id}/stop`, { method: 'POST', cookies: clerk.cookies })).data, { state: 'stopped' });
    assert.equal((await q(`select count(*)::int n from support_access_event where grant_id = $1 and kind = 'stopped'`, [g3.id]))[0].n, 1);
  });
  await test('tenant revoke needs tenant-wide cancel authority; revoked consent stays revoked', async () => {
    const g4 = await approve2();
    assert.equal((await tenant(auditor, 'POST', `/grants/${g4.id}/revoke`)).status, 403);
    const r = await tenant2('POST', `/grants/${g4.id}/revoke`);
    assert.deepEqual([r.status, r.data], [200, { state: 'revoked' }]);
    assert.equal((await op(operator, 'POST', `/grants/${g4.id}/start`, { password: PASSWORD })).data.code, 'SUPPORT_ENDED');
  });
  await test('a security change of any participant ends consent irreversibly', async () => {
    const g5 = await approve2();
    await q(`update "user" set email_verified = false where id = $1`, [clerk.id]);
    await q(`update "user" set email_verified = true where id = $1`, [clerk.id]);
    assert.equal((await op(operator, 'POST', `/grants/${g5.id}/start`, { password: PASSWORD })).data.code, 'SUPPORT_ENDED');
    assert.equal((await op(operator, 'GET', '/grants')).data.grants.find((x) => x.id === g5.id).state, 'invalidated');
  });
  await test('the operator stop of an already ended grant reports its state without changing it', async () => {
    const r = await op(operator, 'POST', `/grants/${g.id}/stop`);
    assert.equal(r.status, 200);
    assert.equal(r.data.state, 'invalidated', 'the earlier subject email change ended it');
    assert.deepEqual((await op(operator, 'POST', `/grants/${g.id}/stop`)).data, r.data);
  });
  await test('switching the deployment off refuses start', async () => {
    const g6 = await approve2();
    f.config.supportAccess.enabled = false;
    try {
      assert.equal((await op(operator, 'POST', `/grants/${g6.id}/start`, { password: PASSWORD })).data.code, 'SUPPORT_UNAVAILABLE');
    } finally {
      f.config.supportAccess.enabled = true;
    }
  });
  await test('the existing platform console still excludes support-level operators', async () => {
    assert.equal((await f.request('/api/support-fixture/console', { cookies: operator.cookies })).status, 403);
  });
} finally {
  await f.close();
}
console.log(`\nSupport access lifecycle: ${count} checks passed.`);
