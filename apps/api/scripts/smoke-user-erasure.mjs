// User erasure by anonymisation (decision 067, DPDP Act 2023): an owner erases a person who belongs only to this
// workspace. Their identity and every way to sign in go (password, sessions, passkey through the guard's erasure path),
// this workspace's invitations are anonymised, other workspaces' are untouched, their records stay under
// "Erased user", the audit entry holds no personal data, and a borrowed erasure id cannot remove anyone else's passkey.
// Usage: API=http://localhost:4000 node --env-file=.env apps/api/scripts/smoke-user-erasure.mjs
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createDb } from '../../../packages/db/dist/index.js';
import { Client } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const db = createDb(process.env.DATABASE_URL);
const q = async (text, params = []) => (await db.$client.query(text, params)).rows;
const pause = () => new Promise((r) => setTimeout(r, 20e3));
const c = await new Client().init('Erasure owner');
const fail = async (who, method, path, body, status, label, pattern) => {
  const r = await who.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const role = await c.req('POST', '/roles', { name: 'Clerk', permissions: ['masters.item.read', 'masters.item.create', 'masters.uom.read', 'settings.user.read'] }, 201);
const join = async (owner, name, roleId, entityId) => {
  await pause();
  const who = new Client();
  const email = `${name.split(' ')[0].toLowerCase()}-${Date.now()}@example.com`;
  const inv = await owner.req('POST', '/invitations', { email, roles: [{ roleId, entityIds: [entityId] }] }, 201);
  await who.req('POST', '/auth/sign-up/email', { name, email, password: 'Sup3r-secret-pw' });
  await who.req('POST', '/invitations/accept', { token: inv.inviteUrl.split('/').at(-1) }, 201);
  who.tenantId = owner.tenantId;
  who.entityId = owner.entityId;
  who.email = email;
  return who;
};
const digest = () => createHash('sha256').update(randomUUID()).digest('hex');
/** A passkey enrolled with the native proof path (action, ceremony, credential row in one transaction). */
const enrol = async (userId) => {
  const [s] = await q('select id from session where user_id=$1 order by created_at desc limit 1', [userId]);
  const actionId = randomUUID(), ceremonyId = randomUUID(), id = randomUUID(), handle = randomBytes(32).toString('base64url');
  await q("insert into auth_passkey_action(id,user_id,session_id,kind,target_id,rp_id,config_hash,password_version,nonce_hash,expires_at) values($1,$2,$3,'register',null,'localhost',$4,$5,$6,clock_timestamp()+interval '299 seconds')", [actionId, userId, s.id, digest(), digest(), digest()]);
  await q("insert into auth_passkey_ceremony(id,kind,user_id,session_id,action_id,challenge_hash,rp_id,user_handle,return_cipher,expires_at) values($1,'register',$2,$3,$4,$5,'localhost',$6,'synthetic-private-return',clock_timestamp()+interval '299 seconds')", [ceremonyId, userId, s.id, actionId, digest(), handle]);
  const client = await db.$client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('factoryos.passkey.action_id',$1,true),set_config('factoryos.passkey.ceremony_id',$2,true)", [actionId, ceremonyId]);
    await client.query("insert into passkey(id,name,user_id,credential_id,public_key,counter,device_type,backed_up,rp_id,user_handle,registration_action_id,registration_ceremony_id) values($1,'Laptop',$2,$3,'synthetic-public-key',0,'multiDevice',true,'localhost',$4,$5,$6)", [id, userId, randomBytes(32).toString('base64url'), handle, actionId, ceremonyId]);
    await client.query('commit');
  } finally {
    client.release();
  }
  return id;
};

try {
  // ── A clerk who made records, has a passkey, and an invitation from another workspace ──
  const clerk = await join(c, 'Kiran Clerk', role.id, c.entityId);
  const clerkId = (await q('select id from "user" where email=$1', [clerk.email]))[0].id;
  const uoms = await clerk.req('GET', '/uoms');
  await c.req('POST', '/hsn-codes', { code: '73181500', kind: 'hsn', description: 'Bolts', gstRate: '18', effectiveFrom: '2025-04-01' }, 201);
  const bolt = await clerk.req('POST', '/items', { code: 'BOLT-M8', name: 'Bolt M8', type: 'raw_material', stockUomId: uoms.find((u) => u.code === 'NOS').id, hsnCode: '73181500' }, 201);
  const keyId = await enrol(clerkId);
  await pause();
  const other = await new Client().init('Other workspace');
  const otherRole = await other.req('POST', '/roles', { name: 'Viewer', permissions: ['masters.item.read'] }, 201);
  await other.req('POST', '/invitations', { email: clerk.email, roles: [{ roleId: otherRole.id, entityIds: [other.entityId] }] }, 201);
  const members = await c.req('GET', '/members');
  const mClerk = members.find((m) => m.email === clerk.email);
  const mOwner = members.find((m) => m.isOwner);
  ok('a clerk with an item they created, a passkey, and a pending invitation from another workspace');

  // ── Refusals ──
  await fail(clerk, 'POST', `/members/${mOwner.id}/erase`, { reason: 'left_organisation', confirmEmail: 'x@example.com' }, 403, 'only an owner erases (permission)');
  await fail(c, 'POST', `/members/${mClerk.id}/erase`, { reason: 'because', confirmEmail: clerk.email }, 400, 'the reason is a fixed code, never free text');
  await fail(c, 'POST', `/members/${mClerk.id}/erase`, { reason: 'left_organisation', confirmEmail: 'someone@example.com' }, 400, 'the email is typed exactly to confirm', /Type the person/);
  await fail(c, 'POST', `/members/${mOwner.id}/erase`, { reason: 'left_organisation', confirmEmail: 'owner@example.com' }, 403, 'nobody erases themselves', /yourself/);
  await pause();
  const both = await join(c, 'Bina Both', role.id, c.entityId);
  const inv2 = await other.req('POST', '/invitations', { email: both.email, roles: [{ roleId: otherRole.id, entityIds: [other.entityId] }] }, 201);
  await both.req('POST', '/invitations/accept', { token: inv2.inviteUrl.split('/').at(-1) }, 201);
  const mBoth = (await c.req('GET', '/members')).find((m) => m.email === both.email);
  await fail(c, 'POST', `/members/${mBoth.id}/erase`, { reason: 'left_organisation', confirmEmail: both.email }, 409, 'a person in another workspace is only removed here, not erased', /member of another workspace/);
  await fail(c, 'GET', '/members', undefined, 200, 'refusals change nothing');

  // ── Erase ──
  const done = await c.req('POST', `/members/${mClerk.id}/erase`, { reason: 'data_principal_request', confirmEmail: clerk.email.toUpperCase() }, 201);
  assert.ok(done.erasureId);
  const [u] = await q('select name,email,email_verified,image,erased_at from "user" where id=$1', [clerkId]);
  assert.deepEqual([u.name, u.email, u.email_verified, u.image], ['Erased user', `erased-${clerkId}@erased.invalid`, false, null]);
  assert.ok(u.erased_at);
  const counts = async (table) => Number((await q(`select count(*)::int n from ${table} where user_id=$1`, [clerkId]))[0].n);
  assert.deepEqual(await Promise.all(['session', 'account', 'passkey', 'two_factor', 'membership', 'auth_passkey_action', 'auth_passkey_ceremony'].map(counts)), [0, 0, 0, 0, 0, 0, 0]);
  ok('erased: anonymised, and sessions, password, passkey, proofs and membership are gone');
  assert.equal((await q("select count(*)::int n from auth_passkey_event where credential_id=$1 and kind='removed'", [keyId]))[0].n, 1);
  ok('the passkey left through the guard, with its removal recorded');
  const here = await q('select email,status from invitation where tenant_id=$1 and email like $2', [c.tenantId, 'erased-%']);
  assert.deepEqual(here.map((i) => i.status), ['accepted']);
  const there = await q('select email,status from invitation where tenant_id=$1 and lower(email)=lower($2)', [other.tenantId, clerk.email]);
  assert.deepEqual(there.map((i) => i.status), ['pending']);
  ok('this workspace’s invitation is anonymised; the other workspace’s is left to it');
  assert.equal((await q("select actor_user_id from audit_event where target_id=$1 order by seq limit 1", [bolt.id]))[0].actor_user_id, clerkId);
  const [e] = await q('select reason,erased_by,tenant_id from user_erasure where user_id=$1', [clerkId]);
  assert.deepEqual([e.reason, e.tenant_id], ['data_principal_request', c.tenantId]);
  const [audit] = await q("select after from audit_event where action='user.erase' and target_id=$1", [clerkId]);
  assert.deepEqual(Object.keys(audit.after).sort(), ['erasureId', 'reason']);
  assert.ok(!JSON.stringify(audit.after).includes('@'));
  ok('records stay under the person’s id; the erasure and audit entries hold no name or email');
  assert.ok(!(await c.req('GET', '/members')).some((m) => m.userId === clerkId || m.email === clerk.email));
  c.checks++;
  await fail(clerk, 'GET', '/items', undefined, 401, 'the old session no longer works');
  const relogin = await new Client().raw('POST', '/auth/sign-in/email', { email: clerk.email, password: 'Sup3r-secret-pw' });
  assert.ok(relogin.status >= 400, `sign-in after erasure: ${relogin.status}`);
  c.checks++;
  ok('signing in with the old email and password is refused');
  await fail(c, 'POST', `/members/${mClerk.id}/erase`, { reason: 'data_principal_request', confirmEmail: clerk.email }, 404, 'erasing twice finds nobody');

  // ── The guard path is bound to its own erasure ──
  const bothId = (await q('select id from "user" where email=$1', [both.email]))[0].id;
  const bothKey = await enrol(bothId);
  const client = await db.$client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('factoryos.erasure.id',$1,true)", [done.erasureId]);
    await assert.rejects(client.query('delete from passkey where id=$1', [bothKey]), /proof refused/);
  } finally {
    await client.query('rollback');
    client.release();
  }
  assert.equal((await q('select count(*)::int n from passkey where id=$1', [bothKey]))[0].n, 1);
  c.checks++;
  ok('a borrowed erasure id cannot remove another person’s passkey');

  console.log(`\nUser erasure smoke passed (${c.checks + clerk.checks + other.checks} request checks).`);
} finally {
  await db.$client.end();
}
