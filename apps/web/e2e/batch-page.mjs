import { chromium } from 'playwright';
// Batch and serial page (decision 053) against running web + API (fresh tenant each run, API with a storage driver):
// Inventory → Batches & serials, find a lot by its heat number, open it, see stock by warehouse, movements and its NCR,
// attach a mill certificate, reach it from the stock balance; read-only details; 390 px without page scroll.
// Usage: pnpm --filter @factoryos/web e2e:batch-page   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/batch-page', import.meta.url).pathname;
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

try {
  step('sign up + onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Stores Lead');
  await L('Work email').fill(`bp${run}@azeonics.com`);
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

  step('a lot received into stores, part moved to the shop floor, an NCR on it (API)');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const call = async (method, path, data) => {
    const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const uoms = await call('GET', '/uoms');
  const u = (c) => uoms.find((x) => x.code === c).id;
  const bar = await call('POST', '/items', { code: 'AL6061', name: 'Al 6061 bar', type: 'raw_material', tracking: 'batch', stockUomId: u('KG'), hsnCode: '76042910' });
  const sto = await call('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' });
  const wip = await call('POST', '/warehouses', { code: 'WIP', name: 'Shop floor', type: 'wip' });
  const heat = `HT-${run}`;
  const rec = await call('POST', '/stock-entries', { purpose: 'receipt', postingDate: today, lines: [{ itemId: bar.id, qty: '12', toWarehouseId: sto.id, newBatchNo: `LOT-${run}`, heatNo: heat, rate: '400' }] });
  await call('POST', `/stock-entries/${rec.id}/submit`, {});
  const lot = (await call('GET', `/batches?itemId=${bar.id}`))[0];
  const tr = await call('POST', '/stock-entries', { purpose: 'transfer', postingDate: today, lines: [{ itemId: bar.id, qty: '5', fromWarehouseId: sto.id, toWarehouseId: wip.id, batchId: lot.id }] });
  await call('POST', `/stock-entries/${tr.id}/submit`, {});
  const ncr = await call('POST', '/quality/ncrs', { itemId: bar.id, batchId: lot.id, qty: '2', fromWarehouseId: sto.id, description: 'Surface pitting found at goods-in' });
  await page.reload();

  step('Inventory → Batches & serials: find the lot by heat');
  await page.goto(`${B}/app`);
  await page.click('nav >> text=Batches & serials');
  await page.waitForURL('**/app/inventory/batches');
  await pickEntity();
  await L('Find').fill(heat.slice(0, 6));
  await page.getByRole('link', { name: `LOT-${run}` }).waitFor();
  await shot('01-search');
  await page.getByRole('link', { name: `LOT-${run}` }).click();
  await page.waitForURL(`**/app/inventory/batches/${lot.id}`);

  step('the batch page: details, stock by warehouse, movements, the NCR');
  await page.getByText(heat, { exact: true }).waitFor();
  for (const code of ['STO', 'WIP', 'MRB']) await page.locator('tr', { hasText: code }).first().waitFor();
  await page.getByRole('link', { name: ncr.number }).waitFor();
  expect((await page.locator('main input:not([type=file]):not([type=search])').count()) === 0, 'details are read-only');
  await page.getByRole('main').getByRole('link', { name: 'Genealogy' }).waitFor();

  step('attach the mill certificate');
  await L('File kind').selectOption({ label: 'Mill test certificate (MTC)' }).catch(async () => L('File kind').selectOption('mtc'));
  await L('Attach file').setInputFiles({ name: `MTC ${heat}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nmill certificate\n%%EOF\n') });
  await page.getByRole('button', { name: `Download MTC ${heat}.pdf` }).waitFor();
  await shot('02-batch');

  step('the stock balance links the batch');
  await page.goto(`${B}/app/inventory/balance`);
  await pickEntity();
  await page.getByRole('link', { name: new RegExp(`LOT-${run}`) }).first().click();
  await page.waitForURL(`**/app/inventory/batches/${lot.id}`);

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByText(heat, { exact: true }).waitFor();
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
console.log('Batch page walkthrough passed. Screenshots in', shots);
