import { chromium } from 'playwright';
// Operations without routing time (decision 054) against running web + API (fresh tenant each run): a routing with a
// 0-minute inspection step; after Reschedule the Schedule page lists it under "No routing time" and marks the order's
// bars, the work order's Schedule panel names it, and the BOM editor warns on the row. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:schedule-no-time   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/schedule-no-time', import.meta.url).pathname;
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
  await L('Full name').fill('Production Planner');
  await L('Work email').fill(`nt${run}@azeonics.com`);
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

  step('a routing with a 0-minute inspection and a released order (API)');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const call = async (method, path, data) => {
    const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  await call('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) });
  const uoms = await call('GET', '/uoms');
  const u = (c) => uoms.find((x) => x.code === c).id;
  const bar = await call('POST', '/items', { code: 'AL6061', name: 'Aluminium bar', type: 'raw_material', tracking: 'none', stockUomId: u('KG'), hsnCode: '76042910' });
  const part = await call('POST', '/items', { code: 'BRKT', name: 'Bracket', type: 'finished_good', tracking: 'none', stockUomId: u('NOS'), hsnCode: '88073000' });
  const sto = await call('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' });
  const fg = await call('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' });
  const cnc = await call('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' });
  const qc = await call('POST', '/manufacturing/work-centres', { code: 'QC', name: 'Inspection', hourlyRate: '600' });
  await call('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M1', name: 'VMC 1' });
  await call('POST', `/manufacturing/work-centres/${qc.id}/machines`, { code: 'Q1', name: 'Inspection bench' });
  const bom = await call('POST', '/manufacturing/boms', {
    itemId: part.id,
    revision: 'A',
    materials: [{ itemId: bar.id, qty: '0.5' }],
    operations: [
      { seq: 10, name: 'Mill', workCentreId: cnc.id, runMinutesPerUnit: '60' },
      { seq: 20, name: 'Inspect', workCentreId: qc.id },
    ],
  });
  await call('POST', `/manufacturing/boms/${bom.id}/activate`, {});
  const draft = await call('POST', '/manufacturing/work-orders', { itemId: part.id, plannedQty: '2', sourceWarehouseId: sto.id, targetWarehouseId: fg.id });
  const wo = await call('POST', `/manufacturing/work-orders/${draft.id}/release`, {});

  step('Reschedule: the inspection is listed under No routing time and the milling bar is marked');
  await page.goto(`${B}/app/manufacturing/schedule`);
  await pickEntity();
  await page.click('button:has-text("Reschedule")');
  const mill = page.locator(`button[aria-label="${wo.number} operation 10 Mill"]`);
  await mill.locator('[aria-label="No routing time"]').waitFor();
  const card = page.locator('li', { hasText: 'no set-up or run time, so it is not on the schedule' });
  await card.getByRole('link', { name: wo.number }).waitFor();
  expect(/· 20 Inspect/.test(await card.innerText()) && /BRKT on QC/.test(await card.innerText()), 'the row names the operation, item and work centre');
  expect((await page.locator(`button[aria-label="${wo.number} operation 20 Inspect"]`).count()) === 0, 'the 0-minute operation has no bar');
  await mill.click();
  await page.locator('[aria-label="Selected operation"]').getByText('An operation has no routing time').waitFor();
  await shot('01-schedule');

  step('work order: the Schedule panel names the operation');
  await card.getByRole('link', { name: wo.number }).click();
  await page.waitForURL(`**/app/manufacturing/work-orders/${wo.id}`);
  await page.getByText('Operation 20 has no set-up or run time, so it is not on the schedule').waitFor();
  await shot('02-work-order');

  step('BOM editor warns on the row');
  await page.goto(`${B}/app/manufacturing/boms/${bom.id}`);
  await pickEntity();
  await page.getByText('Not scheduled: no set-up or run time').waitFor();
  expect((await page.getByText('Not scheduled: no set-up or run time').count()) === 1, 'only the inspection row warns');
  await shot('03-bom');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${B}/app/manufacturing/schedule`);
  await pickEntity();
  await page.locator('li', { hasText: `${wo.number} · 10 Mill` }).getByText('No routing time').waitFor();
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
console.log('Schedule no-time walkthrough passed. Screenshots in', shots);
