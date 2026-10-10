import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
// Support access consent and operator inbox (decision 050, Task 7) against a running production web + API with
// SUPPORT_ACCESS_ENABLED=true. Tenant owner configures the policy and approves with a real native proof (password +
// TOTP sign-in); a read-only member sees history only; the support-level operator sees only their own approval,
// starts it with their password and stops it. Passwords never reach the URL, storage or responses. Desktop and phone.
// Usage: pnpm --filter @factoryos/web e2e:support-access-controls   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH, DATABASE_URL)
const { createDb } = await import('../../../packages/db/dist/index.js');
const { ALL_PERMISSIONS } = await import('../../../packages/auth/dist/index.js');
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/support-access-controls', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const db = createDb(process.env.DATABASE_URL);
const q = (text, values) => db.$client.query(text, values).then((r) => r.rows);
const run = Date.now() % 1000000;
const PASSWORD = 'Support-e2e-pw-' + run;
const step = (s) => console.log('→', s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function totp(secret, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const count = Buffer.alloc(8);
  count.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', key).update(count).digest();
  const o = h.at(-1) & 15;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

/** Native auth over the same-origin proxy; waits out the native rate limit instead of failing. */
async function native(path, body, cookies) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${B}/api/auth${path}`, {
      method: 'POST',
      headers: { origin: B, 'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 6) {
      await sleep(11000);
      continue;
    }
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (/max-age=0/i.test(c)) cookies.delete(pair.slice(0, i));
      else cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const data = await res.json().catch(() => null);
    assert.equal(res.status, 200, `${path}: ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
}

/** A verified local user, optionally with an enabled, verified TOTP factor. */
async function user(name, email, withTotp) {
  const cookies = new Map();
  const { user: u } = await native('/sign-up/email', { name, email, password: PASSWORD }, cookies);
  await q('update "user" set email_verified = true where id = $1', [u.id]);
  if (!withTotp) return { id: u.id, email, name };
  const enabled = await native('/two-factor/enable', { password: PASSWORD }, cookies);
  const secret = new URL(enabled.totpURI).searchParams.get('secret');
  await native('/two-factor/verify-totp', { code: totp(secret) }, cookies);
  return { id: u.id, email, name, secret };
}

async function seed(owner, subject, viewer) {
  const [t] = await q(`insert into tenant(name, slug) values ($1, $2) returning id`, [`Support Co ${run}`, `support-co-${run}`]);
  const [e] = await q(`insert into legal_entity(tenant_id, legal_name, short_name, code) values ($1, $2, $3, 'SC') returning id`, [t.id, `Support Co ${run} Pvt Ltd`, `Support Co ${run}`]);
  const role = async (name, perms, key = null) => (await q(`insert into role(tenant_id, system_key, name, permissions) values ($1, $2, $3, $4::jsonb) returning id`, [t.id, key, name, JSON.stringify(perms)]))[0].id;
  const member = async (userId, roleId, isOwner = false) => {
    const [m] = await q(`insert into membership(tenant_id, user_id, is_owner) values ($1, $2, $3) returning id`, [t.id, userId, isOwner]);
    await q(`insert into role_assignment(tenant_id, membership_id, role_id) values ($1, $2, $3)`, [t.id, m.id, roleId]);
    return m.id;
  };
  await member(owner.id, await role('Owner', ALL_PERMISSIONS, 'owner'), true);
  const subjectMembership = await member(subject.id, await role('Stores', ['inventory.report.read', 'selling.sales_invoice.read']));
  await member(viewer.id, await role('Support history', ['settings.support_access.read']));
  return { tenantId: t.id, entityId: e.id, entityName: `Support Co ${run}`, subjectMembership };
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const open = [];
let expected = 0; // refusals provoked on purpose (wrong password, stale sign-in, support-level platform console)

async function signedIn(u, label, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  open.push([label, page]);
  const requests = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? '' }));
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !(expected && /status of (403|401)/.test(m.text()) && expected--) && errors.push(`${label} console: ${m.text()}`));
  await signIn(page, u);
  return { ctx, page, requests };
}

async function signIn(page, u, next = '/app') {
  await page.goto(`${B}/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email', { exact: true }).fill(u.email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.click('button[type=submit]');
  if (u.secret) {
    await page.waitForURL('**/sign-in/two-factor**');
    await page.locator('input').first().fill(totp(u.secret));
    await page.click('button[type=submit]');
  }
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'));
}

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth).then((o) => assert.equal(o, false, 'no horizontal page scroll'));
async function leaksNothing(page, requests, secret) {
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href + document.body.innerText);
  assert.equal(storage.includes(secret), false, 'password never in URL, storage or page');
  for (const r of requests) assert.equal(r.url.includes(secret), false, 'password never in a URL');
  assert.equal(requests.some((r) => r.url.includes('/operator/directory')), false, 'no operator directory');
}

try {
  step('seed: owner and operator with TOTP, subject and read-only viewer, tenant and entity');
  const owner = await user('Tenant Owner', `owner${run}@supportco.test`, true);
  const operator = await user('Support Operator', `operator${run}@azeonics.com`, true);
  const subject = await user('Stores Clerk', `clerk${run}@supportco.test`, false);
  const viewer = await user('History Viewer', `viewer${run}@supportco.test`, false);
  await q(`insert into platform_admin(user_id, level) values ($1, 'support')`, [operator.id]);
  const t = await seed(owner, subject, viewer);

  step('owner: settings link, read-only notice, policy starts off with no approval form');
  const o = await signedIn(owner, 'owner');
  await o.page.evaluate((id) => localStorage.setItem('fos.tenant', id), t.tenantId);
  await o.page.goto(`${B}/app`);
  await o.page.getByRole('link', { name: 'Support access' }).click();
  await o.page.waitForURL('**/app/settings/support-access');
  await o.page.getByText('Read-only support', { exact: true }).waitFor();
  await o.page.waitForSelector('text=Allow support access for this tenant');
  assert.equal(await o.page.getByText('Approve support access').count(), 0, 'no approval while the policy is off');
  await o.page.screenshot({ path: `${shots}/01-policy-off.png`, fullPage: true });

  step('owner: enabling with a wrong password is refused and the field is cleared');
  await o.page.getByLabel('Allow support access for this tenant').check();
  await o.page.getByLabel('Your password').fill('wrong-' + run);
  expected = 1;
  await o.page.getByRole('button', { name: 'Save policy' }).click();
  await o.page.waitForSelector('text=That password is not correct.');
  assert.equal(await o.page.getByLabel('Your password').inputValue(), '');

  step('owner: enable with the real password');
  await o.page.getByLabel('Your password').fill(PASSWORD);
  await o.page.getByRole('button', { name: 'Save policy' }).click();
  await o.page.waitForSelector('text=Policy saved.');
  await o.page.waitForSelector('text=Approve support access');

  step('owner: approve the operator as the clerk for inventory and sales invoices');
  const form = o.page.locator('form', { has: o.page.getByRole('button', { name: 'Approve' }) });
  await form.getByLabel('Operator email').fill(operator.email);
  await form.getByLabel('Show data as').selectOption(t.subjectMembership);
  await form.getByLabel('Entity').selectOption(t.entityId);
  await form.getByLabel('Duration (minutes)').fill('15');
  await form.getByLabel('Inventory').check();
  await form.getByLabel('Sales invoices').check();
  await form.getByLabel('Reason').fill('Stock balance looks wrong after the GRN');
  await form.getByLabel('Your password').fill(PASSWORD);
  const approval = o.page.waitForResponse((r) => r.url().endsWith('/api/support-access/grants') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Approve' }).click();
  const approved = await (await approval).json();
  assert.equal(JSON.stringify(approved).includes(PASSWORD), false);
  await o.page.waitForSelector(`text=Approved for ${operator.email}`);
  assert.equal(await form.getByLabel('Your password').inputValue(), '', 'password cleared after success');
  const history = await (await o.page.waitForResponse((r) => r.url().includes('/api/support-access/grants?') && r.status() === 200)).json();
  for (const secret of ['passwordVersion', 'securityEpoch', PASSWORD, 'token']) assert.equal(JSON.stringify(history).includes(secret), false, secret);
  const row = o.page.locator('tr', { hasText: operator.email });
  await row.getByText('Approved', { exact: true }).waitFor();
  await row.getByText('Stores Clerk').waitFor();
  assert.ok(o.requests.filter((r) => r.url.includes('/api/support-access/')).every((r) => !/x-entity-id/.test(r.url)));
  await leaksNothing(o.page, o.requests, PASSWORD);
  await o.page.screenshot({ path: `${shots}/02-approved.png`, fullPage: true });

  step('owner: a stale sign-in asks to sign in again and returns to this page');
  await q(`update session set created_at = now() - interval '10 minutes' where user_id = $1`, [owner.id]);
  await form.getByLabel('Operator email').fill(operator.email);
  await form.getByLabel('Show data as').selectOption(t.subjectMembership);
  await form.getByLabel('Entity').selectOption(t.entityId);
  await form.getByLabel('Inventory').check();
  await form.getByLabel('Reason').fill('Second look');
  await form.getByLabel('Your password').fill(PASSWORD);
  expected = 1;
  await form.getByRole('button', { name: 'Approve' }).click();
  await o.page.waitForSelector('text=Sign in again: confirming support access needs a sign-in from the last five minutes.');
  assert.equal(await form.getByLabel('Your password').inputValue(), '', 'password cleared after an error');
  await o.page.getByRole('button', { name: 'Sign in again' }).click();
  await o.page.waitForURL(`**/sign-in?next=${encodeURIComponent('/app/settings/support-access')}`);

  step('read-only member: history, no approval, configuration or revoke controls');
  const v = await signedIn(viewer, 'viewer');
  await v.page.evaluate((id) => localStorage.setItem('fos.tenant', id), t.tenantId);
  await v.page.goto(`${B}/app/settings/support-access`);
  await v.page.locator('tr', { hasText: operator.email }).waitFor();
  assert.equal(await v.page.getByText('Approve support access').count(), 0);
  assert.equal(await v.page.getByRole('button', { name: 'Save policy' }).count(), 0);
  assert.equal(await v.page.getByRole('button', { name: 'Revoke' }).count(), 0);
  assert.equal(await v.page.getByLabel('Allow support access for this tenant').isDisabled(), true);
  await v.ctx.close();

  step('operator (support level): inbox shows only the approval addressed to them; platform console stays closed');
  const op = await signedIn(operator, 'operator', { width: 390, height: 844 });
  await op.page.goto(`${B}/support`);
  await op.page.getByText('Read-only support', { exact: true }).waitFor();
  await op.page.getByText(`Support Co ${run}`, { exact: true }).waitFor();
  assert.equal(await op.page.locator('text=Start read-only support').count(), 1);
  await noOverflow(op.page);
  await op.page.screenshot({ path: `${shots}/03-inbox-mobile.png`, fullPage: true });
  await op.page.goto(`${B}/platform`);
  await op.page.waitForSelector('text=Platform administrators only');

  step('operator: wrong password refused, real password starts it and opens the workspace');
  await op.page.goto(`${B}/support`);
  await op.page.getByLabel('Your password').fill('wrong-' + run);
  expected = 1;
  await op.page.getByRole('button', { name: 'Start read-only support' }).click();
  await op.page.waitForSelector('text=That password is not correct.');
  assert.equal(await op.page.getByLabel('Your password').inputValue(), '');
  assert.equal(op.requests.some((r) => r.url.includes('/api/support-access/workspace')), false, 'no workspace call from the inbox');
  await op.page.getByLabel('Your password').fill(PASSWORD);
  await op.page.getByRole('button', { name: 'Start read-only support' }).click();
  await op.page.waitForURL(`**/support/workspace/${approved.id}`);
  await op.page.getByText('Viewing as').waitFor();
  await leaksNothing(op.page, op.requests, PASSWORD);

  step('operator: the inbox shows it active and stops it');
  await op.page.goto(`${B}/support`);
  await op.page.getByRole('button', { name: 'Stop' }).click();
  await op.page.getByText('Stopped', { exact: true }).waitFor();
  await op.ctx.close();

  step('owner (phone, fresh sign-in): history shows the stopped grant and its activity');
  await o.ctx.close();
  await sleep(11000);
  const o2 = await signedIn(owner, 'owner-mobile', { width: 390, height: 844 });
  await o2.page.evaluate((id) => localStorage.setItem('fos.tenant', id), t.tenantId);
  await o2.page.goto(`${B}/app/settings/support-access`);
  const r2 = o2.page.locator('tr', { hasText: operator.email });
  await r2.getByText('Stopped', { exact: true }).waitFor();
  for (const label of ['Approved', 'Started', 'Stopped']) await o2.page.locator('li', { hasText: label }).first().waitFor();
  assert.equal(await r2.getByRole('button', { name: 'Revoke' }).count(), 0, 'ended access cannot be revoked again');
  await noOverflow(o2.page);
  await o2.page.screenshot({ path: `${shots}/04-history-mobile.png`, fullPage: true });
  await o2.ctx.close();
} catch (error) {
  for (const [label, page] of open) await page.screenshot({ path: `${shots}/failed-${label}.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await db.$client.end();
}
if (errors.length) {
  console.error('Browser errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('Support access controls walkthrough passed. Screenshots in', shots);
