import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
// Support workspace (decision 050, Task 8) against a running production web + API with SUPPORT_ACCESS_ENABLED=true and
// real books in the local database (run the regular walkthroughs first). A tenant owner approves (native proof over
// HTTP); a support-level operator starts each approval in the browser. Covers: banner and panels with real records,
// no business writes or ordinary storage changes, held response + native account switch (aborted, never rendered),
// tenant revoke, expiry by server-anchored countdown, Stop back to the inbox, phone width.
// Usage: pnpm --filter @factoryos/web e2e:support-access-workspace   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH, DATABASE_URL)
const { createDb } = await import('../../../packages/db/dist/index.js');
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/support-access-workspace', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const db = createDb(process.env.DATABASE_URL);
const q = (text, values) => db.$client.query(text, values).then((r) => r.rows);
const run = Date.now() % 1000000;
const PASSWORD = 'Support-ws-pw-' + run;
const READS = ['inventory.report.read', 'selling.sales_invoice.read', 'buying.purchase_invoice.read', 'manufacturing.work_order.read', 'accounts.report.read'];
const AREAS = ['inventory', 'sales-invoices', 'purchase-invoices', 'work-orders', 'accounting'];
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

/** Same-origin HTTP with a cookie jar; waits out the native rate limit instead of failing. */
async function http(path, { body, cookies, method = 'POST', headers = {} }) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${B}${path}`, {
      method,
      headers: { origin: B, 'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
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
    assert.ok(res.status < 300, `${path}: ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
}

async function user(name, email, withTotp) {
  const cookies = new Map();
  const { user: u } = await http('/api/auth/sign-up/email', { body: { name, email, password: PASSWORD }, cookies });
  await q('update "user" set email_verified = true where id = $1', [u.id]);
  if (!withTotp) return { id: u.id, email, name };
  const enabled = await http('/api/auth/two-factor/enable', { body: { password: PASSWORD }, cookies });
  const secret = new URL(enabled.totpURI).searchParams.get('secret');
  await http('/api/auth/two-factor/verify-totp', { body: { code: totp(secret) }, cookies });
  return { id: u.id, email, name, secret };
}

/** A completed native sign-in (password + TOTP) over HTTP: the owner's fresh proof for each approval. */
async function freshCookies(u) {
  const cookies = new Map();
  await http('/api/auth/sign-in/email', { body: { email: u.email, password: PASSWORD }, cookies });
  for (let tries = 0; ; tries++) {
    try {
      await http('/api/auth/two-factor/verify-totp', { body: { code: totp(u.secret) }, cookies });
      return cookies;
    } catch (error) {
      if (tries >= 2) throw error;
      await sleep(30000 - (Date.now() % 30000) + 500);
    }
  }
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const open = [];
// Refusals provoked on purpose: the ended grant's 403/404 answers and the aborted held request.
let expected = 0;
// Native sign-in rate limits (429) are waited out by signIn, so they are expected too.
const tolerated = (text) => /status of 429/.test(text) || (expected > 0 && /status of (403|404)/.test(text));

async function session(u, label, viewport = { width: 1280, height: 900 }, setup) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  open.push([label, page]);
  await setup?.(page);
  const requests = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !tolerated(m.text()) && errors.push(`${label} console: ${m.text()}`));
  await signIn(page, u, '/support');
  return { ctx, page, requests };
}

async function signIn(page, u, next) {
  for (let attempt = 0; ; attempt++) {
    await page.goto(`${B}/sign-in?next=${encodeURIComponent(next)}`);
    await page.getByLabel('Email', { exact: true }).fill(u.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.click('button[type=submit]');
    const outcome = await Promise.race([page.waitForURL('**/sign-in/two-factor**').then(() => 'mfa'), page.waitForSelector('text=Too many attempts').then(() => 'limited')]);
    if (outcome === 'limited' && attempt < 4) {
      await sleep(11000);
      continue;
    }
    // A code already used in this 30-second window (enrolment, an earlier sign-in) is refused: use the next one.
    for (let tries = 0; ; tries++) {
      await page.locator('input').first().fill(totp(u.secret));
      await page.click('button[type=submit]');
      const done = await Promise.race([page.waitForURL((url) => !url.pathname.startsWith('/sign-in')).then(() => true), page.waitForSelector('text=That code did not match').then(() => false)]);
      if (done) return;
      assert.ok(tries < 3, 'TOTP sign-in keeps failing');
      await sleep(30000 - (Date.now() % 30000) + 500);
    }
  }
}

async function start(page, grantId) {
  await page.goto(`${B}/support`);
  const card = page.locator('div', { has: page.getByRole('button', { name: 'Start read-only support' }) }).filter({ hasText: reasonOf[grantId] }).last();
  await card.getByLabel('Your password').fill(PASSWORD);
  await card.getByRole('button', { name: 'Start read-only support' }).click();
  await page.waitForURL(`**/support/workspace/${grantId}`);
  await page.getByText('Read-only support', { exact: true }).waitFor();
}

const reasonOf = {};
const tab = (page, name) => page.getByRole('tab', { name, exact: true });
const storage = (page) => page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()) + JSON.stringify(Object.entries(sessionStorage).sort()));
const nativeUserId = (page) => page.evaluate(() => fetch('/api/me', { credentials: 'include' }).then((r) => r.json()).then((m) => m.user.id));

try {
  step('seed: an entity with real books, its owner, a member to view as, two support operators');
  const [data] = await q(`select e.id, e.tenant_id, e.short_name, t.name as tenant_name from legal_entity e join tenant t on t.id = e.tenant_id
     where exists (select 1 from sales_invoice s where s.entity_id = e.id and s.status = 'submitted')
       and exists (select 1 from stock_ledger_entry s where s.entity_id = e.id)
       and exists (select 1 from gl_entry g where g.entity_id = e.id)
     order by (select count(*) from work_order w where w.entity_id = e.id) desc, e.id limit 1`);
  assert.ok(data, 'local books needed: run the regular walkthroughs first');
  const [{ number: invoiceNumber }] = await q(`select number from sales_invoice where entity_id = $1 and status = 'submitted' order by number limit 1`, [data.id]);
  const owner = await user('Books Owner', `wsowner${run}@supportco.test`, true);
  const subject = await user('Books Clerk', `wsclerk${run}@supportco.test`, false);
  const op1 = await user('First Operator', `wsop1${run}@azeonics.com`, true);
  const op2 = await user('Second Operator', `wsop2${run}@azeonics.com`, true);
  await q(`insert into platform_admin(user_id, level) values ($1, 'support'), ($2, 'support')`, [op1.id, op2.id]);
  const role = async (name, perms) => (await q(`insert into role(tenant_id, name, permissions) values ($1, $2, $3::jsonb) returning id`, [data.tenant_id, `${name} ${run}`, JSON.stringify(perms)]))[0].id;
  const member = async (userId, roleId) => {
    const [m] = await q(`insert into membership(tenant_id, user_id) values ($1, $2) returning id`, [data.tenant_id, userId]);
    await q(`insert into role_assignment(tenant_id, membership_id, role_id) values ($1, $2, $3)`, [data.tenant_id, m.id, roleId]);
    return m.id;
  };
  await member(owner.id, await role('Support approver', ['settings.support_access.read', 'settings.support_access.configure', 'settings.support_access.approve', 'settings.support_access.cancel', 'settings.user.read']));
  const subjectMembership = await member(subject.id, await role('Books reader', READS));
  const ownerCookies = await freshCookies(owner);
  const tenantHeaders = { 'x-tenant-id': data.tenant_id };
  await http('/api/support-access/policy', { method: 'PATCH', cookies: ownerCookies, headers: tenantHeaders, body: { enabled: true, maxDurationSeconds: 1800, allowedAreas: AREAS, password: PASSWORD } });
  const approve = async (operator, reason, minutes = 30) => {
    const g = await http('/api/support-access/grants', { cookies: await freshCookies(owner), headers: tenantHeaders, body: { operatorEmail: operator.email, targetMembershipId: subjectMembership, entityId: data.id, areas: AREAS, durationSeconds: minutes * 60, reason, password: PASSWORD } });
    reasonOf[g.id] = reason;
    return g.id;
  };
  const grant1 = await approve(op1, `Check invoice totals ${run}`);

  step('operator: start, banner always shows who, as whom, where, why, until when and Stop');
  const a = await session(op1, 'op1');
  const before = await storage(a.page);
  await start(a.page, grant1);
  for (const text of [op1.name, subject.name, data.tenant_name, reasonOf[grant1]]) await a.page.getByText(text, { exact: false }).first().waitFor();
  assert.match(await a.page.getByLabel('Time left').innerText(), /^(29|30):\d\d$/);
  await a.page.getByRole('button', { name: 'Stop' }).waitFor();

  step('panels: actual records in every approved area, invoice detail with frozen lines');
  await tab(a.page, 'Sales invoices').click();
  await a.page.getByRole('button', { name: invoiceNumber, exact: true }).click();
  await a.page.getByText('Lines', { exact: true }).waitFor();
  await tab(a.page, 'Inventory').click();
  await a.page.locator('tbody tr').first().waitFor();
  await a.page.locator('tbody tr button').first().click();
  await a.page.getByText('Balance quantity').waitFor();
  await tab(a.page, 'Purchase invoices').click();
  await a.page.locator('table, :text("No records")').first().waitFor();
  await tab(a.page, 'Accounting reports').click();
  await a.page.getByText('Books active').waitFor();
  await a.page.getByRole('button', { name: 'Trial balance' }).click();
  await a.page.getByText('Total debit').waitFor();
  await a.page.getByRole('button', { name: 'Day book' }).click();
  await a.page.locator('tbody tr').first().waitFor();
  await a.page.screenshot({ path: `${shots}/01-workspace.png`, fullPage: true });

  step('no business writes, exports or downloads; ordinary tenant/entity storage untouched');
  const writes = a.requests.filter((r) => r.url.includes('/api/') && r.method !== 'GET' && !r.url.includes('/api/auth/') && !/\/api\/support-access\/operator\/grants\/[^/]+\/start$/.test(r.url));
  assert.deepEqual(writes, []);
  assert.equal(a.requests.some((r) => /export|download|attachment/i.test(r.url)), false);
  assert.equal(a.requests.some((r) => r.url.includes('/api/me/context')), false, 'never the ordinary workspace context');
  assert.equal(await storage(a.page), before, 'fos.tenant / fos.entity and other storage unchanged');
  assert.equal(await nativeUserId(a.page), op1.id);

  step('held response + native account switch: the old request is aborted and its data never renders');
  let release;
  const held = new Promise((r) => (release = r));
  let abortedOldWorkspaceRequest = false;
  a.page.on('requestfailed', (r) => r.url().includes('/workspace/work-orders') && (abortedOldWorkspaceRequest = true));
  await a.page.route('**/api/support-access/workspace/work-orders**', async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await tab(a.page, 'Work orders').click();
  await a.page.getByText('Loading…').waitFor();
  const other = await a.ctx.newPage();
  expected = 1000;
  await other.goto(`${B}/support`);
  await other.evaluate(() => fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' }));
  await signIn(other, op2, '/support');
  await a.page.bringToFront();
  await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await a.page.getByText('Support access ended').waitFor();
  release();
  await sleep(500);
  assert.equal(abortedOldWorkspaceRequest, true, 'held request aborted');
  assert.equal(await a.page.getByText(invoiceNumber, { exact: true }).count(), 0);
  assert.equal(await a.page.locator('tbody tr').count(), 0, 'no support rows after the switch');
  assert.equal(await nativeUserId(a.page), op2.id, 'native identity is the new account, untouched by support');
  assert.equal(await storage(a.page), before);
  const [g1] = await q(`select kind from support_access_event where grant_id = $1 and kind in ('invalidated','stopped','revoked') limit 1`, [grant1]);
  assert.ok(g1, 'signing out of the bound session ended the grant on the server too');
  await a.page.screenshot({ path: `${shots}/02-account-switch.png`, fullPage: true });
  await a.ctx.close();
  expected = 0;

  step('tenant revoke: the next read ends the workspace, data cleared, no automatic resume');
  const grant2 = await approve(op1, `Revoke check ${run}`);
  await sleep(11000);
  const b = await session(op1, 'op1-revoke');
  await start(b.page, grant2);
  await tab(b.page, 'Sales invoices').click();
  await b.page.getByRole('button', { name: invoiceNumber, exact: true }).waitFor();
  await http(`/api/support-access/grants/${grant2}/revoke`, { cookies: ownerCookies, headers: tenantHeaders });
  expected = 1000;
  await tab(b.page, 'Inventory').click();
  await b.page.getByText('Support access ended').waitFor();
  assert.equal(await b.page.getByText(invoiceNumber, { exact: true }).count(), 0);
  await b.page.reload();
  await b.page.getByText('Support access ended').waitFor();
  await b.ctx.close();
  expected = 0;

  step('expiry: the server-anchored countdown clears everything at the deadline');
  const grant3 = await approve(op1, `Expiry check ${run}`, 5);
  await sleep(11000);
  const c = await session(op1, 'op1-expiry', undefined, (page) => page.clock.install());
  await start(c.page, grant3);
  await tab(c.page, 'Sales invoices').click();
  await c.page.getByRole('button', { name: invoiceNumber, exact: true }).waitFor();
  await c.page.clock.fastForward('05:05');
  await c.page.getByText('The approved time is over').waitFor();
  assert.equal(await c.page.getByText(invoiceNumber, { exact: true }).count(), 0);
  await c.ctx.close();

  step('phone: Stop returns to the inbox, the operator stays signed in as themselves');
  const grant4 = await approve(op1, `Stop check ${run}`);
  await sleep(11000);
  const d = await session(op1, 'op1-mobile', { width: 390, height: 844 });
  const beforeMobile = await storage(d.page);
  await start(d.page, grant4);
  await tab(d.page, 'Sales invoices').click();
  await d.page.getByRole('button', { name: invoiceNumber, exact: true }).waitFor();
  assert.equal(await d.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal page scroll');
  await d.page.screenshot({ path: `${shots}/03-mobile.png`, fullPage: true });
  await d.page.getByRole('button', { name: 'Stop' }).click();
  await d.page.waitForURL('**/support');
  await d.page.locator('div', { hasText: reasonOf[grant4] }).getByText('Stopped', { exact: true }).first().waitFor();
  assert.equal(await nativeUserId(d.page), op1.id);
  assert.equal(await storage(d.page), beforeMobile);
  await d.ctx.close();
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
console.log('Support access workspace walkthrough passed. Screenshots in', shots);
