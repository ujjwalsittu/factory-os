import { chromium } from 'playwright';
// Settings → Connections and hand-offs (decision 068, slice 5) against running web + API: every connection card with
// its status, the storage test, the "Create purchase order" hand-off from Home prefilled with the item and the
// shortfall, the same from the item page, and "Record receipt" opening with the customer chosen. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:connections   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/connections', import.meta.url).pathname;
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
const main = page.locator('main');
const step = (s) => console.log('→', s);
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const fits = async () => expect((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, `no sideways scroll on ${page.url()}`);

try {
  step('sign up and create a workspace');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Connections Owner');
  await L('Work email').fill(`conn${run}@azeonics.com`);
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

  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const call = async (method, path, data) => {
    const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const uoms = await call('GET', '/uoms');
  const bar = await call('POST', '/items', { code: 'SS-BAR', name: 'Stainless bar 20 mm', type: 'raw_material', stockUomId: uoms.find((u) => u.code === 'KG').id, reorderLevel: '100' });
  const customer = await call('POST', '/parties', { code: 'ORBIT', name: 'Orbit Aerospace', isCustomer: true, gstTreatment: 'unregistered' });

  step('Settings → Connections');
  await page.goto(`${B}/app/settings/connections`);
  await main.getByRole('button', { name: 'Azeonics', exact: true }).click();
  for (const t of ['GST e-invoice and e-way bill', 'E-mail', 'File storage', 'Edge agents and machine taps', 'Label printers', 'Support access', 'Tally'])
    await main.getByText(t, { exact: true }).waitFor();
  await main.getByText('Not set up', { exact: true }).first().waitFor();
  const test = main.getByRole('button', { name: 'Test storage' });
  if (await test.count()) {
    await test.click();
    await main.getByText('A test file was written, read back and deleted.').waitFor();
  }
  await shot('connections');
  console.log('  ✓ every connection shows its status; the storage test runs');

  step('Home: "Create purchase order" for an item below its reorder level');
  await page.goto(`${B}/app`);
  const handoff = main.getByRole('link', { name: 'Create purchase order' }).first();
  await handoff.waitFor();
  await handoff.click();
  await page.waitForURL(`**/app/buying/orders/new?item=${bar.id}&qty=100`);
  // The item picker and the quantity are inputs: read their values.
  const values = () => page.$$eval('main input', (xs) => xs.map((x) => x.value));
  await page.waitForFunction(() => [...document.querySelectorAll('main input, main button')].some((x) => (x.value ?? '').includes('SS-BAR') || x.textContent.includes('SS-BAR')));
  expect((await values()).includes('100'), 'the shortfall is the quantity');
  await shot('po-prefilled');
  console.log('  ✓ the order opens with the item and the shortfall');

  step('item page: the same hand-off');
  await page.goto(`${B}/app/masters/items/${bar.id}`);
  await main.getByRole('link', { name: 'Create purchase order' }).waitFor();
  console.log('  ✓ the item page offers it while the item is below its level');

  step('"Record receipt" opens with the customer chosen');
  await page.goto(`${B}/app/accounts/settlements/new?direction=receipt&party=${customer.id}`);
  const select = L('Customer');
  // The customer list loads after the page; the choice is checked once its option is there.
  await select.locator(`option[value="${customer.id}"]`).waitFor({ state: 'attached' });
  expect((await select.inputValue()) === customer.id, 'the customer is preselected');
  console.log('  ✓ the receipt opens for that customer');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${B}/app/settings/connections`);
  await main.getByText('File storage', { exact: true }).waitFor();
  await fits();
  await shot('connections-phone');
  await page.goto(`${B}/app`);
  await main.getByRole('link', { name: 'Create purchase order' }).first().waitFor();
  await fits();
  await shot('home-phone');
  console.log('  ✓ no sideways scroll at 390 px');

  expect(errors.length === 0, `console errors:\n${errors.join('\n')}`);
  console.log('connections walkthrough passed');
} catch (e) {
  await shot('failure');
  throw e;
} finally {
  await browser.close();
}
