import { chromium } from 'playwright';
// User erasure (decision 067) against running web + API: an owner erases a clerk from Settings → Users with a fixed
// reason and the typed email; the clerk leaves the list. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:user-erasure   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/user-erasure', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000,
  errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const L = (t) => page.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

try {
  step('sign up + onboard the owner');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Owner One');
  await L('Work email').fill(`owner${run}@azeonics.com`);
  await L('Password').fill('Sup3r-secret-pw');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding');
  await L('Workspace (company group) name').fill('Azeonics Group');
  await L('Legal name').fill('Azeonics Private Limited');
  await L('Short name').fill('Azeonics');
  await L('Code').fill('AZ');
  await L('PAN').fill('AAACA1234B');
  await page.click('button:has-text("Create workspace")');
  await page.waitForURL('**/app');

  step('a clerk joins by invitation (API, separate browser context)');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, Origin: B };
  const roles = await (await ctx.request.get(`${B}/api/roles`, { headers: H })).json();
  const viewer = roles.find((r) => r.systemKey && r.systemKey !== 'owner') ?? roles[0];
  const email = `clerk${run}@azeonics.com`;
  const inv = await (await ctx.request.post(`${B}/api/invitations`, { headers: H, data: { email, roles: [{ roleId: viewer.id, entityIds: [E] }] } })).json();
  const other = await browser.newContext();
  const sign = await other.request.post(`${B}/api/auth/sign-up/email`, { headers: { Origin: B }, data: { name: 'Kiran Clerk', email, password: 'Sup3r-secret-pw' } });
  expect(sign.ok(), `clerk sign-up ${sign.status()}`);
  const acc = await other.request.post(`${B}/api/invitations/accept`, { headers: { Origin: B }, data: { token: inv.inviteUrl.split('/').at(-1) } });
  expect(acc.ok(), `accept ${acc.status()}`);
  await other.close();

  step('Settings → Users: erase the clerk');
  await page.goto(`${B}/app/settings/users`);
  const row = page.locator('tr', { hasText: email }).filter({ has: page.getByRole('button', { name: 'Erase…' }) });
  await row.getByRole('button', { name: 'Erase…' }).click();
  await page.getByRole('dialog').getByText('This cannot be undone').waitFor();
  await L('Reason').selectOption({ label: 'The person asked to be erased' });
  await L(`Type ${email} to confirm`).fill('wrong@azeonics.com');
  await page.getByRole('dialog').getByRole('button', { name: 'Erase permanently' }).click();
  await page.getByRole('dialog').getByText('Does not match').waitFor();
  await shot('01-confirm');
  await L(`Type ${email} to confirm`).fill(email);
  await page.getByRole('dialog').getByRole('button', { name: 'Erase permanently' }).click();
  await page.locator('tr', { hasText: 'Kiran Clerk' }).waitFor({ state: 'detached' });
  expect((await page.locator('tr', { hasText: 'Owner One' }).getByRole('button', { name: 'Erase…' }).count()) === 0, 'no Erase on an owner');
  await shot('02-erased');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${B}/app/settings/users`);
  await page.locator('h1').waitFor();
  await page.waitForLoadState('networkidle');
  expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal page scroll at 390 px');
  await shot('03-mobile');
} catch (error) {
  await shot('failed').catch(() => {});
  throw error;
} finally {
  await browser.close();
}
// The wrong confirmation email is refused on purpose (400).
const unexpected = errors.filter((e) => !/400 \(Bad Request\)/.test(e));
if (unexpected.length) {
  console.error('Browser errors:\n' + unexpected.join('\n'));
  process.exit(1);
}
console.log('User erasure walkthrough passed. Screenshots in', shots);
