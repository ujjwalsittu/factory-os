import { chromium } from 'playwright';
// Machine maintenance (decision 066) against running web + API (fresh tenant each run):
//   - setup through the API: a critical VMC and a lathe, a spindle belt in stores, a 24×7 calendar;
//   - in the browser: a quarterly plan with a measured item and a spare; the due list opens its order;
//   - the order: an out-of-limits reading needs a note, spares from stores, time, sign-off; the technician cannot
//     verify their own work on a critical machine;
//   - a breakdown from the machine page, closed with its cause and action; the reliability report; the critical flag
//     on work centres. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:maintenance   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/maintenance', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000,
  errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// The out-of-limits reading is refused on purpose (400 with a field message).
page.on('console', (m) => m.type() === 'error' && !/(400 \(Bad Request\)|409 \(Conflict\))/.test(m.text()) && errors.push(`console: ${m.text()}`));
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const L = (t) => page.getByLabel(t, { exact: true });
const dialog = () => page.getByRole('dialog');
const step = (s) => console.log('→', s);
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const pickEntity = async () => {
  if (await page.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await page.click('main button:has-text("Azeonics")', { timeout: 3000 }).catch(() => null);
};
const ist = (daysAgo) => new Date(Date.now() + 5.5 * 3600e3 - daysAgo * 86400e3).toISOString().slice(0, 10);

try {
  step('sign up + onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Maint Lead');
  await L('Work email').fill(`mnt${run}@azeonics.com`);
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

  step('machines, a spare in stores, a calendar (API)');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const call = async (method, path, data) => {
    const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  await call('POST', '/hsn-codes', { code: '84669390', kind: 'hsn', description: 'Machine tool parts', gstRate: '18', effectiveFrom: '2025-04-01' });
  const nos = (await call('GET', '/uoms')).find((x) => x.code === 'NOS').id;
  const belt = await call('POST', '/items', { code: 'SP-BELT', name: 'Spindle belt', type: 'consumable', stockUomId: nos, hsnCode: '84669390' });
  const sto = await call('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' });
  const rec = await call('POST', '/stock-entries', { purpose: 'receipt', postingDate: ist(0), lines: [{ itemId: belt.id, qty: '4', toWarehouseId: sto.id, rate: '2500' }] });
  await call('POST', `/stock-entries/${rec.id}/submit`, {});
  const cnc = await call('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' });
  await call('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'VMC', name: 'VMC 3-axis', critical: true });
  const lathe = await call('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'LATHE', name: 'CNC lathe' });
  await call('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) });

  step('a quarterly plan with a measured item and a spare');
  await page.goto(`${B}/app/maintenance/plans`);
  await pickEntity();
  await page.getByRole('button', { name: 'New plan' }).click();
  await L('Machine').selectOption({ label: 'VMC · VMC 3-axis' });
  await L('Name').fill('Quarterly service');
  await L('Every (days)').fill('90');
  await L('Machine down for (minutes)').fill('120');
  await L('Last done').fill(ist(86));
  await L('Task 1').fill('Spindle runout');
  await L('Unit 1').fill('mm');
  await L('Min 1').fill('0');
  await L('Max 1').fill('0.005');
  await dialog().getByRole('button', { name: 'Add a task' }).click();
  await L('Task 2').fill('Replace spindle belt');
  await L('Spare 2').selectOption({ label: 'SP-BELT' });
  await L('Spare qty 2').fill('1');
  await dialog().getByRole('button', { name: 'Add plan' }).click();
  const planRow = page.locator('tr', { hasText: 'Quarterly service' });
  await planRow.getByText('Due soon').waitFor();
  await planRow.getByText('every 90 days').waitFor();
  await shot('01-plans');

  step('the due list opens its order');
  await page.click('nav >> text=Due and orders');
  await page.waitForURL('**/app/maintenance');
  await page.locator('tr', { hasText: 'Quarterly service' }).getByText('Due soon').waitFor();
  await page.getByRole('button', { name: 'Open due orders' }).click();
  await page.getByText(/Opened .*\(Quarterly service\)/).waitFor();
  await shot('02-due');
  await page.getByRole('link', { name: /\/MO\// }).first().click();
  await page.waitForURL('**/app/maintenance/orders/**');
  await page.getByText('2 of 2 to do').waitFor();

  step('checklist: an out-of-limits reading needs a note');
  await L('Spindle runout reading').fill('0.008');
  await page.locator('tr', { hasText: 'Spindle runout' }).getByRole('button', { name: 'Done' }).click();
  await page.getByText(/is outside 0–0.005; add a note/).waitFor();
  await L('Spindle runout note').fill('Re-seated the tool holder; recheck next service');
  await page.locator('tr', { hasText: 'Spindle runout' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('tr', { hasText: 'Spindle runout' }).getByText('outside limits').waitFor();
  await page.getByText('1 of 2 to do').waitFor();

  step('spares from stores and time');
  await page.getByRole('button', { name: 'Issue spares' }).click();
  await L('From warehouse').selectOption({ label: 'STO · Stores' });
  expect((await L('Spare 1').inputValue()) === belt.id, 'the plan’s spare is suggested');
  await dialog().getByRole('button', { name: 'Issue', exact: true }).click();
  await page.getByText('SP-BELT × 1 NOS').waitFor();
  await page.getByRole('button', { name: 'Add time' }).click();
  await L('Minutes').fill('90');
  await L('Note').fill('Belt change');
  await dialog().getByRole('button', { name: 'Add' }).click();
  await page.getByText('Belt change').waitFor();
  await page.locator('tr', { hasText: 'Replace spindle belt' }).getByRole('button', { name: 'Done' }).click();
  await page.getByText('All done').waitFor();
  await page.getByText('₹5,200.00').first().waitFor(); // belt 2,500 + 1.5 h at 1,800

  step('sign-off; the technician does not verify their own work');
  await page.getByRole('button', { name: 'Mark done' }).click();
  await dialog().getByRole('button', { name: 'Mark done' }).click();
  await page.getByText(/This is a critical machine: a supervisor other than the technician verifies/).waitFor();
  expect((await page.getByRole('button', { name: 'Verify' }).count()) === 0, 'no Verify for the technician who signed off');
  await shot('03-order');

  step('a breakdown from the machine page');
  await page.goto(`${B}/app/machines/${lathe.id}`);
  await page.getByRole('heading', { name: 'Maintenance' }).waitFor();
  await page.getByRole('button', { name: 'Report breakdown' }).click();
  await L('What happened').fill('Spindle drive alarm 401, will not restart');
  await dialog().getByRole('button', { name: 'Report breakdown' }).click();
  await page.waitForURL('**/app/maintenance/orders/**');
  await page.getByText('Spindle drive alarm 401, will not restart').first().waitFor();
  await page.getByRole('button', { name: 'Mark done' }).click();
  await L('Cause').fill('Encoder cable chafed at the chain');
  await L('Action taken').fill('Replaced the cable, re-routed with a sleeve');
  await dialog().getByRole('button', { name: 'Mark done' }).click();
  await page.getByText('Encoder cable chafed at the chain').waitFor();
  await page.locator('header, main').getByText('Done', { exact: true }).first().waitFor();
  await page.goto(`${B}/app/machines/${lathe.id}`);
  await page.getByText('Last 90 days: 1 breakdown').waitFor();
  await shot('04-machine');

  step('reliability and cost; the critical flag on work centres');
  await page.click('nav >> text=Reliability and cost');
  await page.waitForURL('**/app/maintenance/reports');
  const lr = page.locator('tr', { hasText: 'CNC lathe' });
  await lr.waitFor();
  expect((await lr.locator('td').nth(1).innerText()).trim() === '1', 'one breakdown on the lathe');
  await page.locator('tr', { hasText: 'VMC 3-axis' }).getByText('₹2,500.00').waitFor();
  await shot('05-reports');
  await page.goto(`${B}/app/manufacturing/work-centres`);
  await page.getByRole('link', { name: 'VMC*' }).waitFor();

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/app/maintenance', '/app/maintenance/plans', '/app/maintenance/reports', `/app/machines/${lathe.id}`]) {
    await page.goto(`${B}${path}`);
    await page.locator('h1').waitFor();
    await page.waitForLoadState('networkidle');
    expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `no horizontal page scroll at 390 px on ${path}`);
  }
  await shot('06-mobile');
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
console.log('Maintenance walkthrough passed. Screenshots in', shots);
