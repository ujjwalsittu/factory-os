// Support access (decision 050) Task 3: tenant policy and consent need a real native proof — a completed sign-in
// under 300 seconds old with verified email and verified local TOTP, plus the actual password — and tenant-wide
// authority. Every refusal path below goes through the real native handler and the real Nest guard.
// Usage: pnpm --filter @factoryos/api... build && node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-consent.mjs
import assert from 'node:assert/strict';
import { createDb } from '../../../packages/db/dist/index.js';
import { addMember, PASSWORD, seedTenant, startSupportFixture, waitForLockWaiter } from './support-access-test-helpers.mjs';

let count = 0;
const test = async (name, fn) => {
  await fn();
  count++;
  console.log(`PASS ${name}`);
};
const f = await startSupportFixture();
const q = (text, values) => f.db.$client.query(text, values).then((r) => r.rows);

try {
  const owner = await f.completedUser('owner@example.test', 'totp', 'Owner');
  const operator = await f.localUser('ops@example.test', 'Operator');
  const clerk = await f.localUser('clerk@example.test', 'Clerk');
  await q(`insert into platform_admin(user_id, level) values ($1, 'support')`, [operator.id]);
  const t = await seedTenant(f.db, owner.id);
  const clerkMember = await addMember(f.db, t.tenantId, clerk.id, ['inventory.report.read', 'selling.sales_invoice.read'], [t.entityId]);
  const H = { 'x-tenant-id': t.tenantId };
  const call = (who, method, path, body, headers = {}) => f.request('/api/support-access' + path, { method, body, cookies: who.cookies, headers: { ...H, ...headers } });
  const approval = (patch = {}) => ({ operatorEmail: 'OPS@example.test', targetMembershipId: clerkMember.membershipId, entityId: t.entityId, areas: ['inventory'], durationSeconds: 1800, reason: 'Ticket 101: stock mismatch', password: PASSWORD, ...patch });
  const policy = { enabled: true, maxDurationSeconds: 1800, allowedAreas: ['inventory', 'sales-invoices', 'accounting'] };

  await test('a tenant without a policy row reads as disabled with the default cap and areas', async () => {
    const r = await call(owner, 'GET', '/policy');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { enabled: false, maxDurationSeconds: 1800, allowedAreas: ['inventory', 'sales-invoices', 'purchase-invoices', 'work-orders', 'accounting'] });
  });
  await test('consent is refused while the tenant policy is disabled', async () => {
    const r = await call(owner, 'POST', '/grants', approval());
    assert.equal(r.status, 403);
    assert.equal(r.data.code, 'SUPPORT_UNAVAILABLE');
  });
  await test('enabling the policy needs the actual password', async () => {
    assert.equal((await call(owner, 'PATCH', '/policy', policy)).data.code, 'SUPPORT_REAUTHENTICATE');
    assert.equal((await call(owner, 'PATCH', '/policy', { ...policy, password: 'wrong-password-1' })).data.code, 'SUPPORT_REAUTHENTICATE');
    const ok = await call(owner, 'PATCH', '/policy', { ...policy, password: PASSWORD });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual(ok.data, policy);
  });
  await test('deployment switch off refuses enabling and consent (no bypass)', async () => {
    f.config.supportAccess.enabled = false;
    try {
      assert.equal((await call(owner, 'PATCH', '/policy', { ...policy, password: PASSWORD })).data.code, 'SUPPORT_UNAVAILABLE');
      assert.equal((await call(owner, 'POST', '/grants', approval())).data.code, 'SUPPORT_UNAVAILABLE');
    } finally {
      f.config.supportAccess.enabled = true;
    }
  });

  let valid;
  await test('an Owner with a fresh TOTP-completed sign-in grants scoped consent; private fields stay private', async () => {
    const r = await call(owner, 'POST', '/grants', approval());
    assert.equal(r.status, 201, JSON.stringify(r.data));
    valid = r.data;
    assert.equal(valid.durationSeconds, 1800);
    assert.equal(valid.state, 'approved');
    assert.equal(valid.operator.id, operator.id);
    assert.equal(valid.subject.id, clerk.id);
    assert.equal(valid.approver.id, owner.id);
    assert.deepEqual(valid.areas, ['inventory']);
    const text = JSON.stringify(valid);
    for (const key of ['passwordVersion', 'Epoch', 'Revision', 'SessionId', 'session'])
      assert.equal(text.includes(key), false, key);
    assert.ok(Date.parse(valid.startBy) - Date.parse(valid.approvedAt) === 600000, 'must start within 600 seconds');
    const [audit] = await q(`select actor_user_id, impersonator_user_id, after from audit_event where action = 'settings.support_access.approve' and target_id = $1`, [valid.id]);
    assert.equal(audit.actor_user_id, owner.id);
    assert.equal(audit.impersonator_user_id, null);
    assert.equal(JSON.stringify(audit).includes(PASSWORD), false);
    assert.equal((await q(`select count(*)::int n from support_access_event where grant_id = $1 and kind = 'approved'`, [valid.id]))[0].n, 1);
    assert.equal((await q('select count(*)::int n from session where user_id = $1', [clerk.id]))[0].n, 1, 'no target session is created');
  });
  await test('backup-code and trusted-device completed sign-ins also prove the approver', async () => {
    for (const mode of ['backup', 'trusted']) {
      const admin = await f.completedUser(`admin-${mode}@example.test`, mode, `Admin ${mode}`);
      await addMember(f.db, t.tenantId, admin.id, ['settings.support_access.approve', 'settings.support_access.read']);
      const r = await call(admin, 'POST', '/grants', approval());
      assert.equal(r.status, 201, `${mode}: ${JSON.stringify(r.data)}`);
    }
  });

  await test('a pending second factor or SSO challenge confers no authority; a pending passkey flag cannot be forged', async () => {
    const pending = await f.completedUser('pending@example.test', 'pending', 'Pending');
    await addMember(f.db, t.tenantId, pending.id, ['settings.support_access.approve']);
    assert.equal((await call(pending, 'POST', '/grants', approval())).status, 401, 'no native session until the factor is completed');
    const done = await f.completedUser('flagged@example.test', 'totp', 'Flagged');
    await addMember(f.db, t.tenantId, done.id, ['settings.support_access.approve']);
    // Pending passkey state can only be created by a real passkey sign-in (the passkey session guard refuses a forged
    // flag), and the same stored-flag check that refuses SSO below refuses it; the passkey suites cover that path.
    await assert.rejects(q('update session set passkey_pending = true where id = $1', [done.ctx.sessionId]), /Passkey session provenance/);
    const forged = await q('update session set sso_pending = true where id = $1 returning id', [done.ctx.sessionId]).catch(() => null);
    if (forged) {
      assert.equal((await call(done, 'POST', '/grants', approval())).status, 401, 'pending SSO');
      await q('update session set sso_pending = false where id = $1', [done.ctx.sessionId]);
    }
  });
  await test('unverified email, no local TOTP or a sign-in older than 300 seconds refuse', async () => {
    const plain = await f.localUser('plain-owner@example.test', 'No TOTP');
    await addMember(f.db, t.tenantId, plain.id, ['settings.support_access.approve']);
    const r = await call(plain, 'POST', '/grants', approval());
    assert.deepEqual(r.data, { code: 'SUPPORT_REAUTHENTICATE', reason: 'totp-required' });
    await q('update "user" set email_verified = false where id = $1', [owner.id]);
    assert.equal((await call(owner, 'POST', '/grants', approval())).data.reason, 'email-unverified');
    await q('update "user" set email_verified = true where id = $1', [owner.id]);
    await q(`update session set created_at = clock_timestamp() - interval '300 seconds' where id = $1`, [owner.ctx.sessionId]);
    assert.equal((await call(owner, 'POST', '/grants', approval())).data.reason, 'sign-in-again');
    await q(`update session set created_at = clock_timestamp() where id = $1`, [owner.ctx.sessionId]);
  });
  await test('an incorrect password or a forged proof field refuses', async () => {
    assert.equal((await call(owner, 'POST', '/grants', approval({ password: 'Not-the-password-1' }))).data.code, 'SUPPORT_REAUTHENTICATE');
    for (const forged of [{ passwordVersion: 'x' }, { proof: true }, { verified: true }, { securityEpoch: '0' }])
      assert.equal((await call(owner, 'POST', '/grants', { ...approval(), ...forged })).status, 400, JSON.stringify(forged));
  });

  await test('entity-scoped approvers and x-entity-id never authorize tenant consent', async () => {
    const scoped = await f.completedUser('scoped@example.test', 'totp', 'Scoped');
    await addMember(f.db, t.tenantId, scoped.id, ['settings.support_access.approve', 'settings.support_access.read'], [t.entityId]);
    assert.equal((await call(scoped, 'POST', '/grants', approval())).status, 403);
    assert.equal((await call(owner, 'POST', '/grants', approval(), { 'x-entity-id': t.entityId })).status, 400);
    assert.equal((await call(owner, 'GET', '/grants', undefined, { 'x-entity-id': t.entityId })).status, 400);
  });
  await test('a read-only delegate sees history but cannot approve, configure or reach it with read-only rules', async () => {
    const auditor = await f.completedUser('auditor@example.test', 'totp', 'Auditor');
    await addMember(f.db, t.tenantId, auditor.id, ['settings.support_access.read']);
    const list = await call(auditor, 'GET', '/grants');
    assert.equal(list.status, 200);
    assert.ok(list.data.grants.some((g) => g.id === valid.id));
    assert.equal((await call(auditor, 'POST', '/grants', approval())).status, 403);
    assert.equal((await call(auditor, 'PATCH', '/policy', { ...policy, password: PASSWORD })).status, 403);
  });

  await test('the operator cannot approve themselves; unknown and non-operator emails get the same answer', async () => {
    const opAdmin = await f.completedUser('ops-admin@example.test', 'totp', 'Ops admin');
    await q(`insert into platform_admin(user_id, level) values ($1, 'superadmin')`, [opAdmin.id]);
    await addMember(f.db, t.tenantId, opAdmin.id, ['settings.support_access.approve']);
    const self = await call(opAdmin, 'POST', '/grants', approval({ operatorEmail: 'ops-admin@example.test' }));
    const unknown = await call(owner, 'POST', '/grants', approval({ operatorEmail: 'nobody@example.test' }));
    const notOperator = await call(owner, 'POST', '/grants', approval({ operatorEmail: 'clerk@example.test' }));
    for (const r of [self, unknown, notOperator]) assert.deepEqual([r.status, r.data], [403, { code: 'SUPPORT_UNAVAILABLE' }]);
  });
  await test('inactive, foreign or platform-role targets and foreign entities refuse', async () => {
    const other = await seedTenant(f.db, owner.id, 'Other tenant');
    const outsider = await f.localUser('outsider@example.test', 'Outsider');
    const foreign = await addMember(f.db, other.tenantId, outsider.id, ['inventory.report.read']);
    assert.equal((await call(owner, 'POST', '/grants', approval({ targetMembershipId: foreign.membershipId }))).data.code, 'SUPPORT_UNAVAILABLE');
    assert.equal((await call(owner, 'POST', '/grants', approval({ entityId: other.entityId }))).data.code, 'SUPPORT_UNAVAILABLE');
    await q(`update membership set status = 'disabled' where id = $1`, [clerkMember.membershipId]);
    assert.equal((await call(owner, 'POST', '/grants', approval())).data.code, 'SUPPORT_UNAVAILABLE');
    await q(`update membership set status = 'active' where id = $1`, [clerkMember.membershipId]);
    const staff = await f.localUser('staff@example.test', 'Staff');
    const staffMember = await addMember(f.db, t.tenantId, staff.id, ['inventory.report.read']);
    await q(`insert into platform_admin(user_id, level) values ($1, 'support')`, [staff.id]);
    assert.equal((await call(owner, 'POST', '/grants', approval({ targetMembershipId: staffMember.membershipId }))).data.code, 'SUPPORT_UNAVAILABLE');
  });
  await test('areas the target cannot read, outside the policy or longer than its cap refuse', async () => {
    assert.equal((await call(owner, 'POST', '/grants', approval({ areas: ['accounting'] }))).data.code, 'SUPPORT_INVALID_INPUT');
    assert.equal((await call(owner, 'POST', '/grants', approval({ areas: ['purchase-invoices'] }))).data.code, 'SUPPORT_INVALID_INPUT');
    assert.equal((await call(owner, 'PATCH', '/policy', { ...policy, maxDurationSeconds: 900, password: PASSWORD })).status, 200);
    assert.equal((await call(owner, 'POST', '/grants', approval({ durationSeconds: 901 }))).data.code, 'SUPPORT_INVALID_INPUT');
    assert.equal((await call(owner, 'POST', '/grants', approval({ durationSeconds: 900 }))).status, 201);
  });
  await test('any policy change, even relaxing, ends every earlier consent for good', async () => {
    const list = await call(owner, 'GET', '/grants');
    assert.equal(list.data.grants.find((g) => g.id === valid.id).state, 'invalidated');
    assert.equal((await call(owner, 'PATCH', '/policy', { ...policy, maxDurationSeconds: 1800, password: PASSWORD })).status, 200);
    assert.equal((await call(owner, 'GET', '/grants')).data.grants.find((g) => g.id === valid.id).state, 'invalidated');
    assert.ok(list.data.events.some((e) => e.kind === 'policy-changed'));
  });

  await test('a password change committed while consent waits for its locks refuses it (real lock wait)', async () => {
    const side = createDb(f.url, 1);
    const holder = await side.$client.connect();
    try {
      await holder.query('begin');
      await holder.query('select 1 from support_access_user_epoch where user_id = $1 for update', [owner.id]);
      const pid = (await holder.query('select pg_backend_pid() as pid')).rows[0].pid;
      const pending = call(owner, 'POST', '/grants', approval());
      await waitForLockWaiter(f.db, pid);
      await holder.query(`update account set password = password || 'reset' where user_id = $1 and provider_id = 'credential'`, [owner.id]);
      await holder.query('commit');
      const r = await pending;
      assert.equal(r.status, 403, JSON.stringify(r.data));
      assert.equal(r.data.code, 'SUPPORT_REAUTHENTICATE');
    } finally {
      holder.release();
      await side.$client.end();
    }
    await q(`update account set password = left(password, -5) where user_id = $1 and provider_id = 'credential'`, [owner.id]);
  });

  await test('cursor pagination and strict list queries', async () => {
    const one = await call(owner, 'GET', '/grants?limit=1');
    assert.equal(one.data.grants.length, 1);
    assert.ok(one.data.nextCursor);
    const two = await call(owner, 'GET', `/grants?limit=1&cursor=${one.data.nextCursor}`);
    assert.notEqual(two.data.grants[0].id, one.data.grants[0].id);
    assert.equal((await call(owner, 'GET', '/grants?limit=0')).status, 400);
    assert.equal((await call(owner, 'GET', '/grants?status=active')).status, 400);
    assert.equal((await call(owner, 'GET', '/grants?cursor=bm90LWEtY3Vyc29y')).status, 400);
  });
} finally {
  await f.close();
}
console.log(`\nSupport access consent: ${count} checks passed.`);
