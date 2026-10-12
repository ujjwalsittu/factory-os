import { chromium } from 'playwright';
// SMT line (decision 065) against running web + API (fresh tenant each run):
//   - setup through the API: a panelized PCBA, its parts in stock, a released order, an edge and a label printer;
//   - in the browser: open a reel, load reels on feeder slots (a wrong part is refused), print panel labels;
//   - scan a panel into placement and at depaneling;
//   - after output, the board's page shows its reels and lots; Plant → Devices lists the printer and its labels.
// Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:smt   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/smt', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000,
  errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/409 \(Conflict\)/.test(m.text()) && errors.push(`console: ${m.text()}`));
page.on('response', (r) => r.status() === 400 && errors.push(`400: ${r.request().method()} ${r.url()}`));
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const L = (t) => page.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const pickEntity = async () => {
  if (await page.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await page.click('main button:has-text("Azeonics")', { timeout: 3000 }).catch(() => null);
};
const scan = async (label, code) => {
  await L(label).fill(code);
  await L(label).press('Enter');
};

try {
  step('sign up + onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Line Lead');
  await L('Work email').fill(`smt${run}@azeonics.com`);
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

  step('a panelized PCBA, parts in stock, a released order, an edge and a printer (API)');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const call = async (method, path, data) => {
    const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  await call('POST', '/hsn-codes', { code: '85340000', kind: 'hsn', description: 'Printed circuits', gstRate: '18', effectiveFrom: '2025-04-01' });
  const uoms = await call('GET', '/uoms');
  const nos = uoms.find((x) => x.code === 'NOS').id;
  const mk = (code, name, o = {}) => call('POST', '/items', { code, name, type: 'component', tracking: 'batch', stockUomId: nos, hsnCode: '85340000', ...o });
  const pcba = await mk('OBC-PCBA', 'On-board computer PCBA', { type: 'finished_good', tracking: 'serial', serialPrefix: 'OBC', revision: 'B' });
  const mcu = await mk('IC-MCU', 'Microcontroller QFN-64', { mslLevel: '3' });
  const res = await mk('RES-10K', 'Resistor 10k 0402');
  const cap = await mk('CAP-1U', 'Capacitor 1µF 0603');
  const sto = await call('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' });
  const fg = await call('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' });
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const rec = await call('POST', '/stock-entries', {
    purpose: 'receipt',
    postingDate: today,
    lines: [
      { itemId: mcu.id, qty: '50', toWarehouseId: sto.id, newBatchNo: 'MCU-L1', rate: '120' },
      { itemId: res.id, qty: '1000', toWarehouseId: sto.id, newBatchNo: 'RES-L1', rate: '0.2' },
      { itemId: cap.id, qty: '1000', toWarehouseId: sto.id, newBatchNo: 'CAP-L1', rate: '0.5' },
    ],
  });
  await call('POST', `/stock-entries/${rec.id}/submit`, {});
  const lot = async (itemId) => (await call('GET', `/batches?itemId=${itemId}`))[0];
  const [mcuLot, resLot, capLot] = [await lot(mcu.id), await lot(res.id), await lot(cap.id)];
  const smt = await call('POST', '/manufacturing/work-centres', { code: 'SMT', name: 'SMT line 1', hourlyRate: '3000' });
  await call('POST', `/manufacturing/work-centres/${smt.id}/machines`, { code: 'AIMEX', name: 'FUJI AIMEX IIIc' });
  let bom = await call('POST', '/manufacturing/boms', { itemId: pcba.id, revision: 'B', quantity: '1', boardsPerPanel: 2, materials: [{ itemId: mcu.id, qty: '1' }, { itemId: res.id, qty: '10' }], operations: [{ seq: 10, name: 'SMT', workCentreId: smt.id, setupMinutes: '30', runMinutesPerUnit: '2' }] });
  bom = await call('POST', `/manufacturing/boms/${bom.id}/activate`, {});
  let wo = await call('POST', '/manufacturing/work-orders', { itemId: pcba.id, plannedQty: '4', sourceWarehouseId: sto.id, targetWarehouseId: fg.id });
  wo = await call('POST', `/manufacturing/work-orders/${wo.id}/release`, {});
  await call('POST', `/manufacturing/work-orders/${wo.id}/issue`, { lines: [{ itemId: mcu.id, batchId: mcuLot.id, qty: '4' }, { itemId: res.id, batchId: resLot.id, qty: '40' }] });
  const edge = await call('POST', '/plant/edges', { code: 'NM1', name: 'Plant edge' });
  await call('POST', '/plant/printers', { edgeId: edge.id, code: 'ZT-1', name: 'Line printer', host: '10.20.0.50', widthMm: 50, heightMm: 25 });
  const rM = (await call('POST', '/manufacturing/smt/containers', { kind: 'reel', batchId: mcuLot.id, qty: '50' })).container;
  const rR = (await call('POST', '/manufacturing/smt/containers', { kind: 'reel', batchId: resLot.id, qty: '1000' })).container;
  const rC = (await call('POST', '/manufacturing/smt/containers', { kind: 'reel', batchId: capLot.id, qty: '1000' })).container;

  step('SMT line: choose the order, machine and printer');
  await page.reload();
  await page.click('nav >> text=SMT line');
  await page.waitForURL('**/app/manufacturing/smt');
  await pickEntity();
  await L('Work order').selectOption({ index: 1 });
  await L('Machine').selectOption({ label: 'AIMEX · FUJI AIMEX IIIc (SMT)' });
  await L('Label printer').selectOption({ label: 'ZT-1 · 50×25 mm' });

  step('reels: the MSL reel is sealed; open it');
  await page.getByRole('tab', { name: 'Reels and paste' }).click();
  const mcuRow = page.locator('tr', { hasText: rM.code });
  await mcuRow.getByText('Sealed').waitFor();
  await mcuRow.getByRole('button', { name: 'Opened' }).click();
  await mcuRow.getByText(/floor life left/).waitFor();
  await shot('01-reels');

  step('feeder setup by scanning: a wrong part is refused');
  await page.getByRole('tab', { name: 'Feeder setup' }).click();
  await L('Slot').fill('F1');
  await scan('Reel or paste jar', rM.code);
  await page.getByText(`${rM.code} loaded on F1`).waitFor();
  await L('Slot').fill('F2');
  await scan('Reel or paste jar', rR.code);
  await page.getByText(`${rR.code} loaded on F2`).waitFor();
  await L('Slot').fill('F7');
  await scan('Reel or paste jar', rC.code);
  await page.getByText('Wrong part: CAP-1U').waitFor();
  await page.locator('tr', { hasText: 'Microcontroller QFN-64' }).getByText('AIMEX F1', { exact: true }).first().waitFor();
  await shot('02-setup');

  step('panels: print labels, scan into placement, then depaneled');
  await page.getByRole('tab', { name: 'Panels' }).click();
  await L('New panels').fill('2');
  await page.click('main button:has-text("Print panel labels")');
  const P1 = `P-${wo.number}-001`;
  await page.getByText(new RegExp(`2 panels ${P1}.*sent to ZT-1`)).waitFor();
  await scan('Panel', P1);
  await page.getByText(`${P1} placed`).waitFor();
  await page.getByRole('radio', { name: 'Depaneled' }).click();
  await scan('Panel', P1);
  await page.getByText(new RegExp(`${P1} depaneled; board labels sent to ZT-1`)).waitFor();
  const panelRow = page.locator('tr', { hasText: P1 });
  await panelRow.getByText('OBC-000001').waitFor();
  await shot('03-panels');

  step('output the two boards; the board page shows its reels');
  await call('POST', `/manufacturing/work-orders/${wo.id}/output`, { qty: '2' });
  await page.reload();
  await page.getByRole('tab', { name: 'Panels' }).click();
  await page.locator('tr', { hasText: P1 }).getByRole('link', { name: 'OBC-000001' }).click();
  await page.waitForURL('**/app/inventory/batches/**');
  await page.getByText('Position 1 on panel').waitFor();
  const reelRow = page.locator('tr', { hasText: 'IC-MCU' });
  await reelRow.getByRole('link', { name: 'MCU-L1' }).waitFor();
  await reelRow.getByText(rM.code, { exact: true }).waitFor();
  await shot('04-board');
  await reelRow.getByRole('link', { name: 'MCU-L1' }).click();
  await page.getByText('Boards built with this lot').waitFor();
  await page.locator('tr', { hasText: 'OBC-000002' }).getByText(P1).waitFor();

  step('Plant → Devices: the printer and its labels');
  await page.click('nav >> text=Devices');
  await page.waitForURL('**/app/plant/devices');
  await page.locator('tr', { hasText: 'ZT-1' }).getByText('10.20.0.50:9100').waitFor();
  await page.getByText(`Boards of ${P1}`).waitFor();
  await shot('05-printers');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/app/manufacturing/smt', '/app/plant/devices']) {
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
console.log('SMT walkthrough passed. Screenshots in', shots);
