import { chromium } from 'playwright';
// Test campaigns (decision 057) against running web + API (fresh tenant each run; API with a storage driver): create a
// TVAC campaign, add steps, accept, receive the payload, book the chamber, record results, attach a test log, approve
// the report, print it, add an extra, invoice, return the payload and close. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:test-campaigns   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/test-campaigns', import.meta.url).pathname;
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

try {
  step('sign up + onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Test Lead');
  await L('Work email').fill(`tc${run}@azeonics.com`);
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

  step('GSTIN, SAC rate, the test service, a TVAC chamber and a customer (API)');
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
  await call('POST', '/hsn-codes', { code: '998346', kind: 'sac', description: 'Technical testing and analysis services', gstRate: '18', effectiveFrom: '2017-07-01' });
  const uoms = await call('GET', '/uoms');
  await call('POST', '/items', { code: 'TEST-TVAC', name: 'Thermal vacuum testing', type: 'service', stockUomId: uoms.find((x) => x.code === 'NOS').id, hsnCode: '998346' });
  await call('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) });
  const env = await call('POST', '/manufacturing/work-centres', { code: 'ENV', name: 'Environmental test', hourlyRate: '3000' });
  await call('POST', `/manufacturing/work-centres/${env.id}/machines`, { code: 'TVAC-1', name: 'Thermal vacuum chamber' });
  await call('POST', '/parties', { code: 'ORBIT', name: 'Orbit Sat Pvt Ltd', isCustomer: true, isSupplier: false, gstin: chk('27AABCO1234B1Z') });
  await page.reload();

  step('Services → Test campaigns: a TVAC campaign quoted at ₹4,50,000');
  await page.click('nav >> text=Test campaigns');
  await page.waitForURL('**/app/services/campaigns');
  await pickEntity();
  await page.click('button:has-text("New campaign")');
  await L('Customer').selectOption({ label: 'Orbit Sat Pvt Ltd' });
  await L('Customer reference').fill('PO-ORB-117');
  await L('Title').fill('TVAC qualification of 6U bus');
  await L('Scope').fill('8 thermal cycles, -40 °C to +80 °C at 1e-5 mbar');
  await L('Service item').selectOption({ label: 'TEST-TVAC · Thermal vacuum testing' });
  await L('Quoted amount (₹)').fill('450000');
  await page.click('dialog button:has-text("Create campaign")');
  await page.waitForURL(/\/app\/services\/campaigns\/[0-9a-f-]{36}$/);
  const campaignUrl = page.url();
  await page.locator('h1', { hasText: '/TC/' }).waitFor();
  const number = (await page.locator('h1').innerText()).trim();

  step('test steps, then accept');
  for (const [name, req] of [
    ['Pump-down', '≤ 1e-5 mbar within 4 h'],
    ['Thermal cycling', '8 cycles, dwell 2 h at each extreme'],
  ]) {
    await page.click('button:has-text("Add step")');
    await L('Step').fill(name);
    await L('Requirement').fill(req);
    await dialog('Add step');
  }
  await page.click('button:has-text("Accept campaign")');
  await page.locator('main').getByText('In test', { exact: true }).waitFor();

  step('receive the payload and book the chamber');
  await page.click('button:has-text("Receive payload")');
  await L('Item').fill('6U satellite bus (flight model)');
  await L('Serial no.').fill('ORB-FM-01');
  await L('Customer’s challan no.').fill('ORB/DC/0042');
  await L('Condition on receipt').fill('Crate sealed, shock indicator intact');
  await dialog('Receive');
  await page.locator('tr', { hasText: 'ORB-FM-01' }).getByText('In custody').waitFor();
  await page.click('button:has-text("Book chamber")');
  expect(await L('Customer').isDisabled(), 'the campaign’s customer is fixed');
  await L('Machine').selectOption({ label: 'TVAC-1 · Thermal vacuum chamber' });
  await dialog('Save');
  await page.locator('li', { hasText: 'TVAC-1' }).getByText('Tentative').waitFor();
  // The chamber run itself happens on the booking (confirm, start, stop); done through the API here.
  const camp = await call('GET', `/services/campaigns/${campaignUrl.split('/').pop()}`);
  for (const a of ['confirm', 'start', 'stop']) await call('POST', `/services/bookings/${camp.bookings[0].id}/${a}`, {});

  step('record results, attach the test log, approve the report');
  const results = [
    ['10 Pump-down', '7.8e-6 mbar at 3 h 10 min'],
    ['20 Thermal cycling', '8 cycles, -40.6 / +80.3 °C'],
  ];
  for (const [row, measured] of results) {
    await page.locator('tr', { hasText: row }).getByRole('button', { name: 'Record result' }).click();
    await L('Result').selectOption('pass');
    await L('Measured').fill(measured);
    await dialog('Record');
  }
  await L('File kind').selectOption({ label: 'Other' }).catch(() => L('File kind').selectOption('other'));
  await L('Attach file').setInputFiles({ name: `TVAC log ${number.replace(/\//g, '-')}.csv`, mimeType: 'text/csv', buffer: Buffer.from('t,pressure,temp\n0,1013,25\n') });
  await page.getByRole('button', { name: /^Download TVAC log/ }).waitFor();
  await page.click('button:has-text("Approve report")');
  await L('Summary').fill('Pump-down and thermal cycling met the requirement.');
  await dialog('Approve report');
  await page.locator('main').getByText('Report approved', { exact: true }).first().waitFor();
  await shot('01-campaign');

  step('the printable test report');
  await page.getByRole('link', { name: 'Test report' }).click();
  await page.waitForURL('**/report');
  await page.getByRole('heading', { name: 'Test report' }).waitFor();
  await page.getByText('ORB-FM-01', { exact: false }).waitFor();
  await page.getByText(/Approved by Test Lead/).waitFor();
  await shot('02-report');
  await page.goto(campaignUrl);

  step('an extra, the invoice, the payload back, closed');
  await page.click('button:has-text("Add extra")');
  await L('Description').fill('Additional chamber time');
  await L('Quantity').fill('8');
  await L('Rate (₹)').fill('5000');
  await dialog('Add');
  await page.getByText('₹4,90,000.00 with extras', { exact: false }).waitFor();
  await page.click('button:has-text("Create invoice")');
  await page.waitForURL(/\/app\/selling\/invoices\/[0-9a-f-]{36}$/);
  await L('Customer PO number').waitFor();
  expect((await L('Remarks').inputValue()) === `Test campaign ${number}`, 'the draft invoice names the campaign');
  expect((await L('Customer PO number').inputValue()) === 'PO-ORB-117', 'the invoice carries the customer reference');
  await page.goto(campaignUrl);
  await page.locator('tr', { hasText: 'ORB-FM-01' }).getByRole('button', { name: 'Return' }).click();
  await L('Condition on return').fill('Repacked in original crate');
  await dialog('Return');
  await page.locator('tr', { hasText: 'ORB-FM-01' }).getByText(/\/RDC\//).waitFor();
  await page.click('button:has-text("Close campaign")');
  await page.locator('main').getByText('Closed', { exact: true }).waitFor();
  await shot('03-closed');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('h1', { hasText: number }).waitFor();
  await shot('04-mobile');
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
console.log('Test campaigns walkthrough passed. Screenshots in', shots);
