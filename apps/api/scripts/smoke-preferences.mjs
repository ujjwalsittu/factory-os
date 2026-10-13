// Menu preferences (decision 068, slice 2): favourites, recent pages and closed areas are stored per person and
// workspace, accept only in-app menu links and fixed area names within fixed limits, are visible only to their owner,
// need no permission beyond membership, and are removed when the person is erased.
// Usage: API=http://localhost:4000 node --env-file=.env apps/api/scripts/smoke-preferences.mjs
import assert from 'node:assert/strict';
import { createDb } from '../../../packages/db/dist/index.js';
import { Client } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const db = createDb(process.env.DATABASE_URL);
const q = async (text, params = []) => (await db.$client.query(text, params)).rows;
const pause = () => new Promise((r) => setTimeout(r, 20e3));
const c = await new Client().init('Preferences owner');
const check = async (label, fn) => {
  await fn();
  c.checks++;
  ok(label);
};
const refused = async (who, body, label) => {
  const r = await who.raw('PUT', '/me/preferences', body);
  assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.data)}`);
  c.checks++;
  ok(label);
};

try {
  const empty = { favourites: [], recent: [], collapsed: [] };
  await check('a new person has no preferences', async () => assert.deepEqual(await c.req('GET', '/me/preferences'), empty));

  const mine = { favourites: ['/app/selling/invoices', '/app/masters/parties?role=customer', '/app/accounts/ledger'], recent: ['/app/inventory/entries', '/app'], collapsed: ['quality', 'services'] };
  await check('preferences are saved and read back', async () => {
    assert.deepEqual(await c.req('PUT', '/me/preferences', mine), mine);
    assert.deepEqual(await c.req('GET', '/me/preferences'), mine);
  });
  await check('duplicates are removed and the order is kept', async () => {
    const out = await c.req('PUT', '/me/preferences', { favourites: ['/app/a-b', '/app/c', '/app/a-b'], recent: ['/app/x', '/app/x'], collapsed: ['make', 'make'] });
    assert.deepEqual(out, { favourites: ['/app/a-b', '/app/c'], recent: ['/app/x'], collapsed: ['make'] });
  });
  await check('saving again replaces the row, never adds one', async () => {
    const [{ n }] = await q('select count(*)::int n from user_preference where tenant_id=$1', [c.tenantId]);
    assert.equal(n, 1);
  });

  // ── Only menu links and fixed names, within the limits ──
  await refused(c, { favourites: ['https://evil.example/app'], recent: [], collapsed: [] }, 'an external address is refused');
  await refused(c, { favourites: ['//evil.example'], recent: [], collapsed: [] }, 'a protocol-relative address is refused');
  await refused(c, { favourites: ['javascript:alert(1)'], recent: [], collapsed: [] }, 'a script address is refused');
  await refused(c, { favourites: ['/app/../settings'], recent: [], collapsed: [] }, 'a path with dots is refused');
  await refused(c, { favourites: ['/app/Selling'], recent: [], collapsed: [] }, 'a path outside the menu shape is refused');
  await refused(c, { favourites: ['/app/a/b/c/d'], recent: [], collapsed: [] }, 'a path deeper than a menu link is refused');
  await refused(c, { favourites: ['/app?role=admin'], recent: [], collapsed: [] }, 'only the parties role filter is accepted as a query');
  await refused(c, { favourites: ['/app/masters/parties?role=customer&x=1'], recent: [], collapsed: [] }, 'extra query text is refused');
  await refused(c, { favourites: Array.from({ length: 13 }, (_, i) => `/app/p${i}`), recent: [], collapsed: [] }, 'more than 12 favourites are refused');
  await refused(c, { favourites: [], recent: Array.from({ length: 6 }, (_, i) => `/app/p${i}`), collapsed: [] }, 'more than 5 recent pages are refused');
  await refused(c, { favourites: [], recent: [], collapsed: ['everything'] }, 'an unknown area is refused');
  await refused(c, { favourites: 'x', recent: [], collapsed: [] }, 'a wrong shape is refused');
  await refused(c, { favourites: [] }, 'a missing field is refused');
  await check('nothing refused was stored', async () => assert.deepEqual(await c.req('GET', '/me/preferences'), { favourites: ['/app/a-b', '/app/c'], recent: ['/app/x'], collapsed: ['make'] }));

  // ── Per person and per workspace ──
  await check('a second workspace of the same person has its own preferences', async () => {
    await pause();
    const second = await c.req('POST', '/tenants', { name: 'Second preferences workspace', entity: { legalName: 'Second Pvt Ltd', shortName: 'Second', code: 'S2', pan: 'AAACB1234C' } }, 201);
    const other = new Client();
    other.cookie = c.cookie;
    other.tenantId = second.tenant.id;
    assert.deepEqual(await other.req('GET', '/me/preferences'), empty);
    await other.req('PUT', '/me/preferences', { favourites: ['/app/settings/users'], recent: [], collapsed: [] });
    assert.deepEqual(await c.req('GET', '/me/preferences'), { favourites: ['/app/a-b', '/app/c'], recent: ['/app/x'], collapsed: ['make'] });
  });

  const role = await c.req('POST', '/roles', { name: 'Clerk', permissions: ['masters.item.read'] }, 201);
  const join = async (name) => {
    await pause();
    const who = new Client();
    const email = `${name.split(' ')[0].toLowerCase()}-${Date.now()}@example.com`;
    const inv = await c.req('POST', '/invitations', { email, roles: [{ roleId: role.id, entityIds: [c.entityId] }] }, 201);
    await who.req('POST', '/auth/sign-up/email', { name, email, password: 'Sup3r-secret-pw' });
    await who.req('POST', '/invitations/accept', { token: inv.inviteUrl.split('/').at(-1) }, 201);
    who.tenantId = c.tenantId;
    who.entityId = c.entityId;
    who.email = email;
    return who;
  };
  const clerk = await join('Kiran Clerk');
  await check('a member with almost no permissions has their own preferences and cannot see the owner\'s', async () => {
    assert.deepEqual(await clerk.req('GET', '/me/preferences'), empty);
    await clerk.req('PUT', '/me/preferences', { favourites: ['/app/masters/items'], recent: ['/app/masters/items'], collapsed: [] });
    assert.deepEqual(await c.req('GET', '/me/preferences'), { favourites: ['/app/a-b', '/app/c'], recent: ['/app/x'], collapsed: ['make'] });
    assert.deepEqual(await clerk.req('GET', '/me/preferences'), { favourites: ['/app/masters/items'], recent: ['/app/masters/items'], collapsed: [] });
  });

  // ── Access ──
  await check('signed out is refused', async () => {
    const r = await new Client().raw('GET', '/me/preferences');
    assert.equal(r.status, 401);
  });
  await check('a person outside the workspace is refused', async () => {
    await pause();
    const outsider = await new Client().init('Preferences outsider');
    outsider.tenantId = c.tenantId;
    const r = await outsider.raw('GET', '/me/preferences');
    assert.ok([403, 404].includes(r.status), `outsider read: ${r.status}`);
    const w = await outsider.raw('PUT', '/me/preferences', empty);
    assert.ok([403, 404].includes(w.status), `outsider write: ${w.status}`);
  });
  await check('the outsider wrote nothing into the workspace', async () => {
    const rows = await q('select user_id from user_preference where tenant_id=$1 order by 1', [c.tenantId]);
    assert.equal(rows.length, 2);
  });

  // ── Erasure ──
  await check('erasing a person removes their preferences and no one else\'s', async () => {
    const members = await c.req('GET', '/members');
    const m = members.find((x) => x.email === clerk.email);
    assert.ok(m, 'clerk is listed');
    const [{ id: clerkUserId }] = await q('select id from "user" where email=$1', [clerk.email]);
    assert.equal((await q('select 1 from user_preference where user_id=$1', [clerkUserId])).length, 1);
    await c.req('POST', `/members/${m.id}/erase`, { reason: 'data_principal_request', confirmEmail: clerk.email }, 201);
    assert.equal((await q('select 1 from user_preference where user_id=$1', [clerkUserId])).length, 0);
    assert.equal((await q('select 1 from user_preference where tenant_id=$1', [c.tenantId])).length, 1);
    assert.deepEqual(await c.req('GET', '/me/preferences'), { favourites: ['/app/a-b', '/app/c'], recent: ['/app/x'], collapsed: ['make'] });
  });

  console.log(`\nPreferences smoke: ${c.checks} request checks, all passing`);
} finally {
  await db.$client.end();
}
