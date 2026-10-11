import { chromium } from 'playwright';
// Machine-hour MaaS (decision 055) against running web + API (fresh tenant each run): mark a customer as studio member,
// add a rate card, book a machine, confirm it (reserved on the production schedule), start and stop the timer, record
// usage by hand, see the billing at the member rate with rounding, and create the draft tax invoice. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:maas   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/maas', import.meta.url).pathname;
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
const chk = (base) => {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let s = 0;
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(base[i]) * (i % 2 ? 2 : 1);
    s += Math.floor(v / 36) + (v % 36);
  }
  return base + chars[(36 - (s % 36)) % 36];
};

try {
  step('sign up + onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Studio Coordinator');
  await L('Work email').fill(`maas${run}@azeonics.com`);
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

  step('GSTIN, SAC rate, machine-time service, a 5-axis machine and a customer (API)');
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
  await call('POST', '/items', { code: 'MAAS-5AX', name: '5-axis machine time', type: 'service', stockUomId: uoms.find((x) => x.code === 'HR').id, hsnCode: '998898' });
  await call('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) });
  const cnc = await call('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' });
  await call('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M03', name: 'Variaxis 5-axis' });
  await call('POST', '/parties', { code: 'ORBIT', name: 'Orbit Startup Pvt Ltd', isCustomer: true, isSupplier: false, gstin: chk('27AABCO1234B1Z') });
  await page.reload();

  step('the customer becomes a studio member');
  await page.goto(`${B}/app/masters/parties`);
  await page.getByText('Orbit Startup Pvt Ltd').click();
  await page.getByLabel('Studio member (member rates on machine-hour bookings)').check();
  await page.click('dialog button:has-text("Save")');
  await page.locator('dialog').waitFor({ state: 'detached' });

  step('Services → Rate cards: 2,500/h, members 2,000/h, 2 h minimum, 15-minute steps');
  await page.goto(`${B}/app`);
  await page.click('nav >> text=Rate cards');
  await page.waitForURL('**/app/services/rate-cards');
  await pickEntity();
  await page.click('button:has-text("New rate card")');
  await L('Machine').selectOption({ label: 'M03 · Variaxis 5-axis' });
  await L('Service item').selectOption({ label: 'MAAS-5AX · 5-axis machine time' });
  await L('Standard rate (₹/h)').fill('2500');
  await L('Member rate (₹/h)').fill('2000');
  await L('Minimum per booking (minutes)').fill('120');
  await L('Round usage up to').selectOption('15');
  await page.click('dialog button:has-text("Save")');
  await page.locator('tr', { hasText: 'M03' }).getByText('Current').waitFor();
  await shot('01-rate-cards');

  step('Services → Machine bookings: book M03 tomorrow');
  await page.click('nav >> text=Machine bookings');
  await page.waitForURL('**/app/services/bookings');
  await page.click('button:has-text("New booking")');
  await L('Customer').selectOption({ label: 'Orbit Startup Pvt Ltd · member' });
  await L('Machine').selectOption({ label: 'M03 · Variaxis 5-axis' });
  const ist = (h) => new Date(Math.ceil(Date.now() / 3600e3) * 3600e3 + h * 3600e3 + 5.5 * 3600e3).toISOString().slice(0, 16);
  await L('From').fill(ist(24));
  await L('To').fill(ist(30));
  await L('Purpose').fill('Bracket prototypes, own CAM program');
  await page.click('dialog button:has-text("Save")');
  await page.waitForURL(/\/app\/services\/bookings\/[0-9a-f-]{36}$/);
  const bookingUrl = page.url();
  await page.getByText('Tentative', { exact: true }).first().waitFor();

  step('confirm: the machine is reserved on the production schedule');
  await page.click('button:has-text("Confirm")');
  await page.locator('main').getByText('Confirmed', { exact: true }).waitFor();
  const number = (await page.locator('h1').innerText()).trim();
  await page.goto(`${B}/app/manufacturing/schedule`);
  await pickEntity();
  await page.click('button:has-text("Week")');
  await page.locator(`[aria-label^="Reserved: Booking ${number}"]`).waitFor({ state: 'attached' });
  await shot('02-schedule');

  step('start and stop the machine, then record the log-sheet time');
  await page.goto(bookingUrl);
  await page.click('button:has-text("Start machine")');
  await page.locator('main').getByText('In use', { exact: true }).waitFor();
  await page.click('button:has-text("Stop machine")');
  await page.locator('main').getByText('Completed', { exact: true }).waitFor();
  await page.click('button:has-text("Record usage")');
  await L('Minutes').fill('324');
  await L('Note').fill('Operator log sheet');
  await page.click('dialog button:has-text("Record")');
  await page.locator('dialog').waitFor({ state: 'detached' });
  await page.getByText('5 h 30 min = 5.50 h').waitFor();
  await page.getByText('Member rate', { exact: true }).waitFor();
  await page.getByText('₹11,000.00').waitFor();
  await shot('03-billing');

  step('create the draft tax invoice');
  await page.click('button:has-text("Create invoice")');
  await page.waitForURL(/\/app\/selling\/invoices\/[0-9a-f-]{36}$/);
  await page.waitForFunction(() => [...document.querySelectorAll('input,textarea')].some((e) => e.value.includes('324 min used, 330 min billed at member rate')));
  await shot('04-invoice');
  await page.goto(bookingUrl);
  await page.getByText('Invoice', { exact: true }).waitFor().catch(() => null);
  expect((await page.getByRole('button', { name: 'Create invoice' }).count()) === 0, 'an invoiced booking offers no second invoice');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('h1', { hasText: number }).waitFor();
  await shot('05-mobile');
  expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal page scroll at 390 px');
  await page.goto(`${B}/app/services/bookings`);
  await page.getByRole('link', { name: number }).waitFor();
  expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal page scroll at 390 px (list)');
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
console.log('MaaS walkthrough passed. Screenshots in', shots);
