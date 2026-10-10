// Support access (decision 050) Task 2: additive schema, immutable consent, append-only evidence and authority
// revisions bumped inside the source transaction. Also an upgrade check on a copy of the local database.
// Usage: pnpm --filter @factoryos/api... build && node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-schema.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createDb } from '../../../packages/db/dist/index.js';
import { runMigrations } from '../../../packages/db/dist/migrate.js';
import { addMember, seedTenant, startSupportFixture } from './support-access-test-helpers.mjs';

let count = 0;
const pass = (name) => {
  count++;
  console.log(`PASS ${name}`);
};
const f = await startSupportFixture();
const q = (text, values) => f.db.$client.query(text, values).then((r) => r.rows);
const fails = async (text, values, pattern, name) => {
  await assert.rejects(q(text, values), pattern, name);
  pass(name);
};

try {
  // ── additive tables, nothing granted ──
  for (const t of ['support_access_policy', 'support_access_grant', 'support_access_user_epoch', 'support_access_event'])
    assert.equal((await q(`select count(*)::int n from ${t}`))[0].n, 0, t);
  pass('four additive tables exist and start empty: no privileged grant is backfilled');

  const owner = await f.localUser('owner@example.test', 'Owner');
  const operator = await f.localUser('ops@example.test', 'Operator');
  const subject = await f.localUser('clerk@example.test', 'Clerk');
  const t = await seedTenant(f.db, owner.id);
  const member = await addMember(f.db, t.tenantId, subject.id, ['inventory.report.read', 'selling.sales_invoice.read'], [t.entityId]);
  await f.store.seedEpochs(f.db, [owner.id, operator.id, subject.id]);
  const epoch = async (id) => BigInt((await q('select security_epoch from support_access_user_epoch where user_id = $1', [id]))[0].security_epoch);
  const revision = async () => BigInt((await q('select authority_revision from support_access_policy where tenant_id = $1', [t.tenantId]))[0].authority_revision);

  // ── policy defaults and constraints ──
  await q('insert into support_access_policy(tenant_id) values ($1)', [t.tenantId]);
  const [policy] = await q('select enabled, max_duration_seconds, allowed_areas from support_access_policy where tenant_id = $1', [t.tenantId]);
  assert.deepEqual(policy, { enabled: false, max_duration_seconds: 1800, allowed_areas: ['inventory', 'sales-invoices', 'purchase-invoices', 'work-orders', 'accounting'] });
  pass('a policy row defaults to disabled, 1800 seconds and the five areas');
  await fails('update support_access_policy set max_duration_seconds = 299 where tenant_id = $1', [t.tenantId], /duration_ck/, 'policy cap below 300 refused');
  await fails('update support_access_policy set max_duration_seconds = 1801 where tenant_id = $1', [t.tenantId], /duration_ck/, 'policy cap above 1800 refused');
  await fails(`update support_access_policy set allowed_areas = array['settings'] where tenant_id = $1`, [t.tenantId], /areas_ck/, 'unknown policy area refused');
  await fails(`update support_access_policy set allowed_areas = array[]::text[] where tenant_id = $1`, [t.tenantId], /areas_ck/, 'empty policy area list refused');
  await fails('update support_access_policy set config_revision = config_revision - 1 where tenant_id = $1', [t.tenantId], /only increase|revisions_ck/, 'policy revisions never decrease');

  // ── grant constraints and immutability ──
  const grant = (patch = {}) => ({
    tenant_id: t.tenantId, entity_id: t.entityId, operator_user_id: operator.id, subject_user_id: subject.id, subject_membership_id: member.membershipId,
    approver_user_id: owner.id, areas: ['inventory'], reason: 'Ticket 1', duration_seconds: 1800, approved_at: 'now()', start_by: `now() + interval '600 seconds'`,
    policy_config_revision: 0, tenant_authority_revision: 0, operator_epoch: 0, subject_epoch: 0, approver_epoch: 0, approver_password_version: 'x', approver_session_id: owner.ctx.sessionId, ...patch,
  });
  const insertGrant = (patch) => {
    const g = grant(patch);
    const cols = Object.keys(g);
    const vals = cols.map((c) => (typeof g[c] === 'string' && /^now\(\)/.test(g[c]) ? g[c] : `'${Array.isArray(g[c]) ? `{${g[c].join(',')}}` : String(g[c]).replaceAll("'", "''")}'`));
    return q(`insert into support_access_grant(${cols.join(',')}) values (${vals.join(',')}) returning id`).then((r) => r[0].id);
  };
  await assert.rejects(insertGrant({ duration_seconds: 299 }), /duration_ck/);
  await assert.rejects(insertGrant({ duration_seconds: 1801 }), /duration_ck/);
  await assert.rejects(insertGrant({ areas: ['settings'] }), /areas_ck/);
  await assert.rejects(insertGrant({ operator_user_id: owner.id }), /people_ck/);
  await assert.rejects(insertGrant({ operator_user_id: subject.id }), /people_ck/);
  await assert.rejects(insertGrant({ start_by: `now() + interval '601 seconds'` }), /window_ck/);
  await assert.rejects(insertGrant({ reason: 'ab' }), /reason_ck/);
  pass('impossible consent is refused: duration, areas, self-approval, self-access, start window, reason');
  const g1 = await insertGrant();
  await fails('update support_access_grant set areas = $2 where id = $1', [g1, ['inventory', 'accounting']], /immutable/, 'approved scope cannot be broadened');
  await fails('update support_access_grant set entity_id = gen_random_uuid() where id = $1', [g1], /immutable/, 'consent identity cannot change');
  await fails('update support_access_grant set started_at = now(), actor_session_id = $2, expires_at = now() + interval \'1801 seconds\' where id = $1', [g1, operator.ctx.sessionId], /start_ck/, 'a start cannot exceed the approved duration');
  await q(`update support_access_grant set started_at = now(), actor_session_id = $2, expires_at = now() + interval '1800 seconds' where id = $1`, [g1, operator.ctx.sessionId]);
  await fails('update support_access_grant set started_at = now(), expires_at = now() + interval \'60 seconds\' where id = $1', [g1], /already started/, 'a started consent cannot restart or extend');
  await q(`update support_access_grant set ended_at = now(), end_kind = 'stopped', ended_by = $2 where id = $1`, [g1, operator.id]);
  await fails(`update support_access_grant set end_kind = 'revoked' where id = $1`, [g1], /has ended/, 'an ended consent never changes again');
  await fails('delete from support_access_grant where id = $1', [g1], /permanent evidence/, 'consent rows cannot be deleted');
  await q(`insert into support_access_event(tenant_id, grant_id, kind) values ($1, $2, 'approved')`, [t.tenantId, g1]);
  await fails(`update support_access_event set kind = 'read'`, [], /append-only/, 'evidence cannot be edited');
  await fails('delete from support_access_event', [], /append-only/, 'evidence cannot be deleted');
  await fails(`insert into support_access_event(tenant_id, kind) values ($1, 'exported')`, [t.tenantId], /kind_ck/, 'unknown event kinds refused');
  await fails(`insert into support_access_event(tenant_id, kind, reason_code) values ($1, 'denied', 'Has Spaces')`, [t.tenantId], /reason_ck/, 'free-text reason codes refused');

  // ── user security epochs: bumped in the source transaction, never by unrelated changes ──
  let before = await epoch(subject.id);
  await q(`update account set password = password || 'x' where user_id = $1 and provider_id = 'credential'`, [subject.id]);
  assert.equal(await epoch(subject.id), before + 1n);
  await q(`update account set password = left(password, -1) where user_id = $1 and provider_id = 'credential'`, [subject.id]);
  assert.equal(await epoch(subject.id), before + 2n);
  pass('password change then restore bumps the epoch twice: restoring never revives');
  before = await epoch(subject.id);
  await f.db.$client.query('begin');
  await f.db.$client.query(`update "user" set email_verified = false where id = $1`, [subject.id]);
  await f.db.$client.query('rollback');
  assert.equal(await epoch(subject.id), before);
  pass('a rolled-back source change leaves the epoch unchanged');
  for (const [sqlText, label] of [
    [`update "user" set name = 'Renamed' where id = $1`, 'name'],
    [`update "user" set updated_at = now() where id = $1`, 'timestamp'],
    [`update session set expires_at = expires_at + interval '1 hour', updated_at = now() where user_id = $1`, 'session renewal'],
  ]) {
    before = await epoch(subject.id);
    await q(sqlText, [subject.id]);
    assert.equal(await epoch(subject.id), before, label);
  }
  pass('names, timestamps and session renewal do not bump the epoch');
  for (const [sqlText, label] of [
    [`update "user" set email = 'clerk2@example.test' where id = $1`, 'email'],
    [`update "user" set email_verified = false where id = $1`, 'verification'],
    [`update "user" set two_factor_enabled = true where id = $1`, '2FA switch'],
    [`insert into two_factor(id, user_id, secret, backup_codes, verified) values (gen_random_uuid()::text, $1, 's', 'b', true)`, 'factor enrolment'],
    [`update two_factor set secret = 's2' where user_id = $1`, 'new factor secret'],
    [`update two_factor set verified = false where user_id = $1`, 'factor verification'],
    [`insert into platform_admin(user_id, level) values ($1, 'support')`, 'platform role granted'],
    [`update platform_admin set level = 'superadmin' where user_id = $1`, 'platform role changed'],
    [`delete from platform_admin where user_id = $1`, 'platform role removed'],
    [`delete from two_factor where user_id = $1`, 'factor removed'],
  ]) {
    before = await epoch(subject.id);
    await q(sqlText, [subject.id]);
    assert.equal(await epoch(subject.id), before + 1n, label);
  }
  pass('email, verification, factor and platform-role changes each bump the epoch once');
  await q(`insert into two_factor(id, user_id, secret, backup_codes, verified) values (gen_random_uuid()::text, $1, 's', 'b', true)`, [subject.id]);
  before = await epoch(subject.id);
  await q(`update two_factor set failed_verification_count = 3, locked_until = now() where user_id = $1`, [subject.id]);
  await q(`update two_factor set backup_codes = 'consumed' where user_id = $1`, [subject.id]);
  assert.equal(await epoch(subject.id), before);
  pass('failed-factor counters, lockouts and consuming a backup code do not bump the epoch');
  before = await epoch(operator.id);
  await q(`update account set password = password where user_id = $1`, [operator.id]);
  assert.equal(await epoch(operator.id), before);
  pass('a no-op credential update does not bump');

  // ── tenant authority revision ──
  let rev = await revision();
  await q(`update role set permissions = permissions || '["masters.item.read"]'::jsonb where id = $1`, [member.roleId]);
  await q(`update role set permissions = permissions - 'masters.item.read' where id = $1`, [member.roleId]);
  assert.equal(await revision(), rev + 2n);
  pass('role permission change then restore bumps the tenant revision twice');
  for (const [sqlText, values, label] of [
    [`update membership set status = 'disabled' where id = $1`, [member.membershipId], 'member disabled'],
    [`update membership set status = 'active' where id = $1`, [member.membershipId], 'member restored'],
    [`update role_assignment set entity_ids = null where membership_id = $1`, [member.membershipId], 'assignment widened'],
    [`insert into role_assignment(tenant_id, membership_id, role_id) values ($1, $2, $3)`, [t.tenantId, member.membershipId, t.ownerRoleId], 'assignment added'],
    [`delete from role_assignment where membership_id = $1 and role_id = $2`, [member.membershipId, t.ownerRoleId], 'assignment removed'],
    [`update legal_entity set is_active = false where id = $1`, [t.entityId], 'entity disabled'],
    [`update legal_entity set is_active = true where id = $1`, [t.entityId], 'entity restored'],
    [`update tenant set status = 'suspended' where id = $1`, [t.tenantId], 'tenant suspended'],
    [`update tenant set status = 'active' where id = $1`, [t.tenantId], 'tenant restored'],
    [`update membership set is_owner = true where id = $1`, [member.membershipId], 'ownership granted'],
  ]) {
    rev = await revision();
    await q(sqlText, values);
    assert.equal(await revision(), rev + 1n, label);
  }
  pass('membership, assignment, entity, tenant and ownership changes each bump the revision once');
  for (const [sqlText, values, label] of [
    [`update role set name = 'Renamed role', description = 'x' where id = $1`, [member.roleId], 'role name'],
    [`update tenant set name = 'Renamed tenant' where id = $1`, [t.tenantId], 'tenant name'],
    [`update legal_entity set short_name = 'Renamed' where id = $1`, [t.entityId], 'entity name'],
    [`insert into role(tenant_id, name, permissions) values ($1, 'Unused', '[]'::jsonb)`, [t.tenantId], 'new unassigned role'],
  ]) {
    rev = await revision();
    await q(sqlText, values);
    assert.equal(await revision(), rev, label);
  }
  pass('names, descriptions and unassigned roles do not bump the revision');
  rev = await revision();
  await q(`update membership set status = 'disabled' where tenant_id = $1`, [t.tenantId]);
  assert.equal(await revision(), rev + 1n);
  await q(`update membership set status = 'active' where tenant_id = $1`, [t.tenantId]);
  pass('a multi-row change bumps once per statement');

  // ── session deletion ends only the bound active grant ──
  await q(`update support_access_policy set enabled = true where tenant_id = $1`, [t.tenantId]);
  const second = await f.localUser('ops2@example.test', 'Second operator');
  const otherSession = (await q('select id from session where user_id = $1', [second.id]))[0].id;
  const g2 = await insertGrant({ operator_user_id: second.id });
  await q(`update support_access_grant set started_at = now(), actor_session_id = $2, expires_at = now() + interval '1800 seconds' where id = $1`, [g2, otherSession]);
  const extra = (await q(`insert into session(id, user_id, token, expires_at) values (gen_random_uuid()::text, $1, gen_random_uuid()::text, now() + interval '1 hour') returning id`, [second.id]))[0].id;
  await q('delete from session where id = $1', [extra]);
  assert.equal((await q('select ended_at from support_access_grant where id = $1', [g2]))[0].ended_at, null);
  pass('deleting an unrelated session of the same operator leaves the grant alone');
  await q('delete from session where id = $1', [otherSession]);
  const [ended] = await q('select end_kind, end_reason from support_access_grant where id = $1', [g2]);
  assert.deepEqual(ended, { end_kind: 'invalidated', end_reason: 'actor-session-ended' });
  assert.equal((await q(`select count(*)::int n from support_access_event where grant_id = $1 and kind = 'invalidated'`, [g2]))[0].n, 1);
  pass('deleting the bound session ends that grant once, with evidence, in the same transaction');

  // ── native cleanup keeps working; references survive ──
  before = await epoch(subject.id);
  await q('delete from "user" where id = $1', [subject.id]);
  assert.equal((await q('select count(*)::int n from session where user_id = $1', [subject.id]))[0].n, 0);
  assert.ok((await epoch(subject.id)) > before, 'each cascaded credential/factor delete also bumps');
  assert.equal((await q('select count(*)::int n from support_access_grant where subject_user_id = $1', [subject.id]))[0].n, 2);
  pass('native user deletion still cascades; the epoch bumps and consent history survives');

  // ── generation is stable ──
  const dir = new URL('../../../packages/db/drizzle/', import.meta.url);
  const journal = JSON.parse(await readFile(new URL('meta/_journal.json', dir), 'utf8'));
  assert.equal(journal.entries.at(-1).tag, '0035_support_access');
  assert.equal(journal.entries.filter((e) => e.tag.endsWith('_support_access')).length, 1);
  pass('one additive support_access migration at the end of the journal');
} finally {
  await f.close();
}

// ── upgrade: a copy of the local database at the previous migration takes 0035 without touching existing rows ──
const sourceUrl = new URL(process.env.DATABASE_URL);
const admin = createDb(process.env.DATABASE_URL);
const copy = 'sa_upgrade_' + crypto.randomUUID().replaceAll('-', '');
const sourceName = sourceUrl.pathname.slice(1);
const busy = (await admin.$client.query('select count(*)::int n from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [sourceName])).rows[0].n;
if (busy) {
  console.log(`SKIP upgrade copy: ${busy} other connection(s) to ${sourceName}; stop the local API to run it`);
} else {
  await admin.$client.query(`create database ${copy} template ${sourceName}`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/' + copy;
  const db = createDb(url.toString());
  try {
    const applied = (await db.$client.query('select count(*)::int n from drizzle.__drizzle_migrations')).rows[0].n;
    const snapshot = async () => {
      const out = {};
      for (const table of ['"user"', 'account', 'session', 'two_factor', 'membership', 'role', 'role_assignment', 'tenant', 'legal_entity', 'gl_entry', 'stock_ledger_entry', 'audit_event']) {
        const rows = (await db.$client.query(`select row_to_json(t)::text v from ${table} t order by 1`)).rows.map((r) => r.v);
        out[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
      }
      return out;
    };
    const hashes = async () => {
      const h = {};
      for (const name of (await readdir(new URL('../../../packages/db/drizzle/', import.meta.url))).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort())
        h[name] = createHash('sha256').update(await readFile(new URL(`../../../packages/db/drizzle/${name}`, import.meta.url))).digest('hex');
      return h;
    };
    const beforeRows = await snapshot();
    const beforeSql = await hashes();
    await runMigrations(url.toString());
    assert.deepEqual(await snapshot(), beforeRows);
    assert.deepEqual(await hashes(), beforeSql);
    const now = (await db.$client.query('select count(*)::int n from drizzle.__drizzle_migrations')).rows[0].n;
    assert.ok(now >= applied);
    assert.equal((await db.$client.query('select count(*)::int n from support_access_grant')).rows[0].n, 0);
    pass(`upgrade of a copy of the local database (${applied} → ${now} migrations) leaves native credentials, tenancy, books and audit unchanged`);
  } finally {
    await db.$client.end();
    await admin.$client.query(`drop database ${copy}`);
  }
}
await admin.$client.end();
console.log(`\nSupport access schema: ${count} checks passed.`);
