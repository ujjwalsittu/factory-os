import { chromium } from 'playwright';
// Billing runs (decision 060) against running web + API (fresh tenant each run): a completed booking, a subscription
// and a reported campaign under one PO are previewed, raised as one draft invoice per customer and PO, and submitted
// together. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:billing-runs   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/billing-runs', import.meta.url).pathname;
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
const pickEntity = async () => {
  if (await page.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await page.click('main button:has-text("Azeonics")', { timeout: 3000 }).catch(() => null);
};
const dialog = (button) => page.click(`dialog button:has-text("${button}")`).then(() => page.locator('dialog').waitFor({ state: 'detached' }));
const chk = (base) => {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let s = 0;
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(base[i]) * (i % 2 ? 2 : 1);
    s += Math.floor(v / 36) + (v % 36);
  }
  return base + chars[(36 - (s % 36)) % 36];
};
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

try {
  step('sign up + onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Billing Lead');
  await L('Work email').fill(`br${run}@azeonics.com`);
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

  step('due work across services (API): a completed booking, a subscription and a reported campaign under one PO');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const call = async (method, path, data) => {
    const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  await call('POST', `/entities/${E}/gst-registrations`, { gstin: chk('27AAACA1234B1Z') });
  await call('POST', '/hsn-codes', { code: '998898', kind: 'sac', description: 'Other manufacturing services', gstRate: '18', effectiveFrom: '2017-07-01' });
  const uoms = await call('GET', '/uoms');
  const u = (code) => uoms.find((x) => x.code === code).id;
  const svc = await call('POST', '/items', { code: 'SVC', name: 'Engineering services', type: 'service', stockUomId: u('NOS'), hsnCode: '998898' });
  const hrs = await call('POST', '/items', { code: 'MAAS', name: 'Machine time', type: 'service', stockUomId: u('HR'), hsnCode: '998898' });
  await call('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) });
  const cnc = await call('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' });
  const m1 = await call('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M03', name: 'Variaxis 5-axis' });
  await call('POST', '/services/rate-cards', { machineId: m1.id, serviceItemId: hrs.id, standardRate: '2500', minimumMinutes: 60, roundingMinutes: 15, validFrom: '2024-01-01' });
  const orbit = await call('POST', '/parties', { code: 'ORBIT', name: 'Orbit Space Pvt Ltd', isCustomer: true, isSupplier: false, gstin: chk('27AABCO1234B1Z') });
  const h = Math.ceil(Date.now() / 900e3) * 900e3;
  const bk = await call('POST', '/services/bookings', { customerId: orbit.id, machineId: m1.id, startsAt: new Date(h + 3600e3).toISOString(), endsAt: new Date(h + 3 * 3600e3).toISOString() });
  for (const a of ['confirm', 'start', 'stop']) await call('POST', `/services/bookings/${bk.id}/${a}`, {});
  await call('POST', `/services/bookings/${bk.id}/usage`, { minutes: 120, note: 'Log sheet' });
  const plan = await call('POST', '/services/subscription-plans', { code: 'CROP', name: 'Crop health', solution: 'Crop health', period: 'month', fee: '30000', includedReports: 4, includedAlerts: 10, reportRate: '5000', alertRate: '500', serviceItemId: svc.id });
  await call('POST', '/services/subscriptions', { customerId: orbit.id, planId: plan.id, customerRef: 'PO-ORB-1', aoiName: 'Block A', startDate: today });
  const tc = await call('POST', '/services/campaigns', { customerId: orbit.id, title: 'TVAC test', customerRef: 'PO-ORB-1', serviceItemId: svc.id, quotedAmount: '200000' });
  await call('POST', `/services/campaigns/${tc.id}/steps`, { name: 'Pump-down' });
  await call('POST', `/services/campaigns/${tc.id}/accept`, {});
  const [st] = (await call('GET', `/services/campaigns/${tc.id}`)).steps;
  await call('POST', `/services/steps/${st.id}/result`, { result: 'pass' });
  await call('POST', `/services/campaigns/${tc.id}/approve`, { summary: 'Met the requirement' });
  await page.reload();

  step('Services → Billing runs: preview what is due');
  await page.click('nav >> text=Billing runs');
  await page.waitForURL('**/app/services/billing-runs');
  await pickEntity();
  await page.click('button:has-text("New run")');
  await page.locator('tr', { hasText: 'PO PO-ORB-1' }).getByText('₹2,30,000.00').waitFor();
  await page.locator('tr', { hasText: 'Total' }).getByText('2 customer groups').waitFor();
  await shot('01-preview');

  step('create the drafts: one invoice per customer and PO');
  await page.click('button:has-text("Create drafts")');
  await page.waitForURL(/\/app\/services\/billing-runs\/[0-9a-f-]{36}$/);
  await page.locator('h1', { hasText: '/BR/' }).waitFor();
  expect((await page.locator('main tbody tr').count()) === 2, 'two invoices in the run');
  await page.locator('tr', { hasText: 'PO PO-ORB-1' }).getByText('Draft', { exact: true }).waitFor();

  step('submit all');
  await page.click('button:has-text("Submit all")');
  await page.getByText('2 submitted.').waitFor();
  await page.locator('main').getByText('Submitted', { exact: true }).nth(1).waitFor();
  await shot('02-run');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('h1', { hasText: '/BR/' }).waitFor();
  await shot('03-mobile');
  expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal page scroll at 390 px');
} catch (error) {
  await shot('failed').catch(() => {});
  throw error;
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('Browser errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('Billing runs walkthrough passed. Screenshots in', shots);
