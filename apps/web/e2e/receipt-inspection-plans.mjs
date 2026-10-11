import { chromium } from 'playwright';
// Receipt inspection plans (decision 052) against running web + API (fresh tenant each run): an item with an active
// incoming plan is received into quarantine; Incoming inspection shows the plan, "Inspect to plan" opens a draft for
// part of the line, readings with a gauge are saved, a failed diameter rejects part of the lot onto an NCR, and the
// incoming inspection list links to the results. An item without a plan keeps the one-step form. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:receipt-inspection-plans   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/receipt-inspection-plans', import.meta.url).pathname;
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
  await L('Full name').fill('Stores Inspector');
  await L('Work email').fill(`qi${run}@azeonics.com`);
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

  step('masters, an incoming plan, a gauge and a receipt into quarantine (API)');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const call = async (method, path, data) => {
    const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
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
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const uoms = await call('GET', '/uoms');
  const u = (c) => uoms.find((x) => x.code === c).id;
  const bar = await call('POST', '/items', { code: 'SS304', name: 'SS 304 bar', type: 'raw_material', tracking: 'batch', stockUomId: u('KG'), hsnCode: '72221111', requiresIncomingInspection: true });
  const bolt = await call('POST', '/items', { code: 'M8-BOLT', name: 'M8 bolt', type: 'raw_material', tracking: 'batch', stockUomId: u('NOS'), hsnCode: '73181500', requiresIncomingInspection: true });
  await call('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' });
  const qua = await call('POST', '/warehouses', { code: 'QUA', name: 'Quarantine', type: 'quarantine' });
  const sup = await call('POST', '/parties', { code: 'STEELCO', name: 'Steel Co', isSupplier: true, gstin: chk('27AAACS1234B1Z') });
  await call('POST', '/quality/gauges', { code: 'MIC-1', description: 'Outside micrometer', intervalDays: 365, lastCalibrated: today });
  const plan = await call('POST', '/quality/plans', {
    itemId: bar.id,
    stage: 'incoming',
    revision: 'A',
    characteristics: [
      { balloon: '1', description: 'Diameter Ø20', kind: 'dimension', nominal: '20', lowerLimit: '19.9', upperLimit: '20.1', unit: 'mm', sampleSize: 2 },
      { balloon: '2', description: 'Surface free of cracks', kind: 'visual', sampleSize: 1 },
    ],
  });
  await call('POST', `/quality/plans/${plan.id}/activate`, {});
  const grn = await call('POST', '/stock-entries', {
    purpose: 'receipt',
    postingDate: today,
    partyId: sup.id,
    lines: [
      { itemId: bar.id, qty: '10', toWarehouseId: qua.id, newBatchNo: `HT-${run}`, rate: '300' },
      { itemId: bolt.id, qty: '100', toWarehouseId: qua.id, newBatchNo: `BL-${run}`, rate: '5' },
    ],
  });
  await call('POST', `/stock-entries/${grn.id}/submit`, {});
  await page.reload();

  step('incoming inspection shows the plan; the bolt keeps the one-step form');
  await page.goto(`${B}/app/buying/inspections`);
  await pickEntity();
  const barRow = page.locator('tr', { hasText: 'SS304' });
  await barRow.getByText('Plan rev A').waitFor();
  expect((await page.locator('tr', { hasText: 'M8-BOLT' }).getByRole('button', { name: 'Inspect', exact: true }).count()) === 1, 'bolt keeps Inspect');
  await shot('01-pending');

  step('inspect 6 kg to plan: the draft opens on the inspection page');
  await barRow.getByRole('button', { name: 'Inspect to plan' }).click();
  await L('Quantity (KG)').fill('6');
  await page.click('dialog button:has-text("Start inspection")');
  await page.waitForURL('**/app/quality/inspections/**');
  await page.getByText(`From receipt`).waitFor();
  await page.getByText('Characteristics · plan rev A').waitFor();

  step('readings: one diameter out of tolerance');
  await L('1 sample 1').fill('20.02');
  await L('1 sample 2').fill('20.25');
  await L('Gauge for 1').selectOption({ label: 'MIC-1' });
  await L('2 sample 1').selectOption('pass');
  await page.click('button:has-text("Save readings")');
  await page.waitForResponse((r) => r.url().includes('/results') && r.status() === 201);
  await shot('02-readings');

  step('record result: 4 accepted, 2 rejected on an NCR');
  await page.click('main button:has-text("Record result")');
  await L('Accepted').fill('4');
  await L('Rejected').fill('2');
  await L('Nonconformance (for the NCR)').fill('Diameter 20.25 mm, over the 20.1 limit');
  await page.click('dialog button:has-text("Record result")');
  await page.getByText('Rejected quantity raised').waitFor();
  await shot('03-submitted');

  step('the incoming inspection list links the results; 4 kg still waits');
  await page.goto(`${B}/app/buying/inspections`);
  await pickEntity();
  const hist = page.locator('tr', { hasText: 'Recorded against inspection' });
  await hist.getByRole('link', { name: 'Results' }).waitFor();
  expect((await hist.getByRole('button', { name: 'Cancel' }).count()) === 0, 'a plan inspection has no Cancel button');
  const pendingCell = await page.locator('tr', { hasText: 'SS304' }).first().innerText();
  expect(/\b4\b/.test(pendingCell), `4 kg pending: ${pendingCell}`);

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('tr', { hasText: 'SS304' }).first().waitFor();
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
console.log('Receipt inspection plans walkthrough passed. Screenshots in', shots);
