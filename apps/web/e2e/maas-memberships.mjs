import { chromium } from 'playwright';
// Studio memberships (decision 056) against running web + API (fresh tenant each run): add a plan, sign a customer up
// (fee as a draft invoice), bill a completed booking to the membership with nothing to invoice, see the hours drawn,
// reverse the billing and see them returned. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:maas-memberships   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/maas-memberships', import.meta.url).pathname;
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
  await L('Work email').fill(`mem${run}@azeonics.com`);
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

  step('GSTIN, SAC rate, services, a machine with a rate card and a customer (API)');
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
  const u = (c) => uoms.find((x) => x.code === c).id;
  const svc = await call('POST', '/items', { code: 'MAAS-5AX', name: '5-axis machine time', type: 'service', stockUomId: u('HR'), hsnCode: '998898' });
  await call('POST', '/items', { code: 'STUDIO', name: 'Studio membership', type: 'service', stockUomId: u('NOS'), hsnCode: '998898' });
  await call('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) });
  const cnc = await call('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' });
  const m03 = await call('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M03', name: 'Variaxis 5-axis' });
  const orbit = await call('POST', '/parties', { code: 'ORBIT', name: 'Orbit Startup Pvt Ltd', isCustomer: true, isSupplier: false, gstin: chk('27AABCO1234B1Z') });
  const day = new Date(Date.now() + 5.5 * 3600e3 - 86400e3).toISOString().slice(0, 10);
  await call('POST', '/services/rate-cards', { machineId: m03.id, serviceItemId: svc.id, standardRate: '2500', memberRate: '2000', minimumMinutes: 120, roundingMinutes: 15, validFrom: day });
  await page.reload();

  step('Services → Memberships: a 10-hour plan and a membership for Orbit');
  await page.click('nav >> text=Memberships');
  await page.waitForURL('**/app/services/memberships');
  await pickEntity();
  await page.click('button:has-text("New plan")');
  await L('Code').fill('STUDIO-10');
  await L('Name').fill('Studio 10 hours');
  await L('Machine-hours included').fill('10');
  await L('Term (months)').fill('12');
  await L('Fee (₹)').fill('50000');
  await L('Service item').selectOption({ label: 'STUDIO · Studio membership' });
  await page.click('dialog button:has-text("Save")');
  await page.locator('tr', { hasText: 'STUDIO-10' }).waitFor();
  await page.click('button:has-text("New membership")');
  await L('Customer').selectOption({ label: 'Orbit Startup Pvt Ltd' });
  await L('Plan').selectOption({ label: 'STUDIO-10 · 10 h · 12 months' });
  await L('Starts on').fill(day);
  await page.click('dialog button:has-text("Create membership")');
  await page.waitForURL(/\/app\/services\/memberships\/[0-9a-f-]{36}$/);
  const membershipUrl = page.url();
  await page.getByText('10 h left').waitFor();
  await page.getByRole('link', { name: '· draft invoice' }).waitFor();
  await shot('01-membership');

  step('a completed booking (API), billed to the membership from its page');
  const now = Math.ceil(Date.now() / 900e3) * 900e3;
  const b = await call('POST', '/services/bookings', { customerId: orbit.id, machineId: m03.id, startsAt: new Date(now + 3600e3).toISOString(), endsAt: new Date(now + 4 * 3600e3).toISOString() });
  for (const a of ['confirm', 'start', 'stop']) await call('POST', `/services/bookings/${b.id}/${a}`, {});
  await call('POST', `/services/bookings/${b.id}/usage`, { minutes: 324, note: 'Operator log sheet' });
  await page.goto(`${B}/app/services/bookings/${b.id}`);
  await pickEntity();
  await page.getByText('Billing draws 5 h 30 min; nothing to invoice.', { exact: false }).waitFor();
  await page.getByText('Member rate', { exact: true }).waitFor();
  await page.click('button:has-text("Bill to membership")');
  await page.getByText('5 h 30 min drawn for this booking.', { exact: false }).waitFor();
  expect((await page.getByRole('button', { name: 'Record usage' }).count()) === 0, 'usage is frozen once billed');
  await shot('02-billed');

  step('the membership shows the hours drawn');
  await page.getByRole('link', { name: /\/MM\// }).click();
  await page.waitForURL(membershipUrl);
  await page.getByText('4 h 30 min left').waitFor();
  await page.locator('tr', { hasText: b.number }).getByText('330').waitFor();

  step('reverse the billing: the hours come back');
  await page.goto(`${B}/app/services/bookings/${b.id}`);
  await page.click('button:has-text("Reverse billing")');
  await L('Reason').fill('Wrong machine on the log sheet');
  await page.click('dialog button:has-text("Reverse")');
  await page.locator('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Bill to membership' }).waitFor();
  await page.goto(membershipUrl);
  await page.getByText('10 h left').waitFor();
  await page.getByText('Reversed: Wrong machine on the log sheet').waitFor();
  await shot('03-reversed');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${B}/app/services/memberships`);
  await page.locator('tr', { hasText: 'STUDIO-10' }).first().waitFor();
  await shot('04-mobile');
  expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal page scroll at 390 px');
  await page.goto(membershipUrl);
  await page.getByText('10 h left').waitFor();
  expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal page scroll at 390 px (membership)');
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
console.log('MaaS memberships walkthrough passed. Screenshots in', shots);
