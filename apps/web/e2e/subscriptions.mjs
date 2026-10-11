import { chromium } from 'playwright';
// EarthNow subscriptions (decision 059) against running web + API (fresh tenant each run): a standard plan as a
// bundle of reports and alerts, a vineyard subscription back-dated a month, reports recorded beyond the bundle, the
// first period invoiced with its overage, the current period invoiced, an upgrade and cancellation. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:subscriptions   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/subscriptions', import.meta.url).pathname;
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
  await L('Full name').fill('EarthNow Ops');
  await L('Work email').fill(`sub${run}@azeonics.com`);
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

  step('GSTIN, SAC, an analytics service item, a customer and a pro plan (API)');
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
  await call('POST', '/hsn-codes', { code: '998399', kind: 'sac', description: 'Other professional, technical and business services', gstRate: '18', effectiveFrom: '2017-07-01' });
  const uoms = await call('GET', '/uoms');
  const svc = await call('POST', '/items', { code: 'SVC-EO', name: 'Earth observation analytics', type: 'service', stockUomId: uoms.find((x) => x.code === 'NOS').id, hsnCode: '998399' });
  await call('POST', '/parties', { code: 'AGRI', name: 'Deccan Agri Co-op', isCustomer: true, isSupplier: false, gstin: chk('27AAAAD1234B1Z') });
  await call('POST', '/services/subscription-plans', { code: 'CROP-PRO', name: 'Crop health pro', solution: 'Crop health', period: 'month', fee: '45000', includedReports: 8, includedAlerts: 30, reportRate: '4000', alertRate: '400', serviceItemId: svc.id });
  await page.reload();

  step('Services → Subscriptions: a standard plan');
  await page.click('nav >> text=Subscriptions');
  await page.waitForURL('**/app/services/subscriptions');
  await pickEntity();
  await page.click('button:has-text("New plan")');
  await L('Code').fill('CROP-STD');
  await L('Name').fill('Crop health standard');
  await L('Solution').fill('Crop health');
  await L('Fee per period (₹)').fill('30000');
  await L('Reports included').fill('4');
  await L('Alerts included').fill('10');
  await L('Extra report (₹)').fill('5000');
  await L('Extra alert (₹)').fill('500');
  await L('Service item').selectOption({ label: 'SVC-EO · Earth observation analytics' });
  await dialog('Save');
  await page.locator('tr', { hasText: 'CROP-STD' }).waitFor();

  step('subscribe the vineyard block, back-dated a month');
  const [ty, tm, td] = today.split('-').map(Number);
  const start = new Date(Date.UTC(ty, tm - 2, Math.min(td, 28))).toISOString().slice(0, 10);
  await page.click('button:has-text("New subscription")');
  await L('Customer').selectOption({ label: 'Deccan Agri Co-op' });
  await L('Plan').selectOption({ index: 2 });
  await L('Area of interest').fill('Nashik vineyards block A');
  await L('Area (ha)').fill('1250');
  await L('Start').fill(start);
  await L('Customer reference').fill('DAC/PO/2026/44');
  await page.click('dialog button:has-text("Subscribe")');
  await page.waitForURL(/\/app\/services\/subscriptions\/[0-9a-f-]{36}$/);
  const subUrl = page.url();
  await page.locator('h1', { hasText: '/SUB/' }).waitFor();
  const number = (await page.locator('h1').innerText()).trim();
  expect((await page.locator('main').innerText()).includes('CROP-STD'), 'subscribed on the standard plan');

  step('five weekly reports in the first period: one beyond the bundle');
  for (let i = 1; i <= 5; i++) {
    await page.click('button:has-text("Record delivery")');
    await L('Delivered on').fill(start);
    await L('Title').fill(`Weekly crop health report ${i}`);
    await dialog('Record');
  }
  await page.locator('tbody tr').first().getByText('5 / 4').waitFor();

  step('invoice the first period: its fee and the extra report');
  await page.click('button:has-text("Invoice next period")');
  await page.waitForURL(/\/app\/selling\/invoices\/[0-9a-f-]{36}$/);
  await L('Customer PO number').waitFor();
  expect((await L('Customer PO number').inputValue()) === 'DAC/PO/2026/44', 'the invoice carries the customer reference');
  expect((await L('Remarks').inputValue()).includes(`Subscription ${number}`), 'the invoice names the subscription');
  await page.goto(subUrl);
  await page.locator('tbody tr').first().getByText('draft invoice').first().waitFor();

  step('invoice the current period, upgrade to pro, cancel at period end');
  await page.click('button:has-text("Invoice next period")');
  await page.waitForURL(/\/app\/selling\/invoices\/[0-9a-f-]{36}$/);
  await page.goto(subUrl);
  await page.locator('h1', { hasText: number }).waitFor();
  await page.click('button:has-text("Change plan")');
  await L('New plan').selectOption({ label: 'CROP-PRO · Crop health pro · ₹45,000.00' });
  await page.getByText('Upgrade: applies today, prorated.').waitFor();
  await dialog('Change plan');
  await page.getByText('Crop health standard → Crop health pro').waitFor();
  await page.click('button:has-text("Cancel at period end")');
  await L('Reason').fill('Harvest season over');
  await dialog('Cancel at period end');
  await page.getByText('Harvest season over').waitFor();
  await shot('01-subscription');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('h1', { hasText: number }).waitFor();
  await shot('02-mobile');
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
console.log('Subscriptions walkthrough passed. Screenshots in', shots);
