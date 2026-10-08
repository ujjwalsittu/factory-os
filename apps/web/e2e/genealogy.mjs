import { chromium } from 'playwright';
// Manufacturing 2b walkthrough (decision 046) against running web + API (fresh tenant each run):
// cut a remnant on the issue screen, make bracket serials, build satellites with as-built, trace in Genealogy, mobile.
// Usage: pnpm --filter @factoryos/web e2e:genealogy   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/genealogy', import.meta.url).pathname;
import fs from 'node:fs'; fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000, errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const L = (t) => page.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);

step('sign up + onboard');
await page.goto(`${B}/sign-up`);
await L('Full name').fill('Quality Lead'); await L('Work email').fill(`gen${run}@azeonics.com`); await L('Password').fill('Sup3r-secret-pw');
await page.click('button[type=submit]'); await page.waitForURL('**/onboarding');
await L('Workspace (company group) name').fill('Azeonics Group'); await L('Legal name').fill('Azeonics Private Limited');
await L('Short name').fill('Azeonics'); await L('Code').fill('AZ'); await L('PAN').fill('AAACA1234B');
await page.click('button:has-text("Create workspace")'); await page.waitForURL('**/app');

step('items, BOMs, stock (API)');
const me = await (await ctx.request.get(`${B}/api/me`)).json();
const T = me.tenants[0].id;
const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
const call = async (method, path, data) => { const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data }); if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`); return r.json(); };
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const uoms = await call('GET', '/uoms');
const u = (c) => uoms.find((x) => x.code === c).id;
const item = (code, name, type, tracking, uom, serialPrefix) => call('POST', '/items', { code, name, type, tracking, stockUomId: u(uom), hsnCode: '88073000', ...(serialPrefix ? { serialPrefix } : {}) });
const bar = await item('TI-BAR', 'Ti-6Al-4V bar', 'raw_material', 'batch', 'KG');
const brk = await item('BRK-C', 'Bracket rev C', 'sub_assembly', 'serial', 'NOS', 'BRK');
const sat = await item('SAT-STR', 'Satellite structure', 'finished_good', 'serial', 'NOS', 'SAT');
const sto = await call('POST', '/warehouses', { code: 'STO', name: 'Main stores', type: 'stores' });
const fg = await call('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' });
const rec = await call('POST', '/stock-entries', { purpose: 'receipt', postingDate: today, lines: [{ itemId: bar.id, qty: '10', toWarehouseId: sto.id, newBatchNo: 'HN-4471', heatNo: 'HN-4471', rate: '2000' }] });
await call('POST', `/stock-entries/${rec.id}/submit`, {});
const wc = await call('POST', '/manufacturing/work-centres', { code: 'MILL', name: 'Milling', hourlyRate: '1200' });
for (const [itemId, materials] of [[brk.id, [{ itemId: bar.id, qty: '0.5' }]], [sat.id, [{ itemId: brk.id, qty: '2' }]]]) {
  const b = await call('POST', '/manufacturing/boms', { itemId, revision: 'A', materials, operations: [{ seq: 10, name: 'Make', workCentreId: wc.id }] });
  await call('POST', `/manufacturing/boms/${b.id}/activate`, {});
}
const release = async (itemId, qty, source) => {
  const w = await call('POST', '/manufacturing/work-orders', { itemId, plannedQty: qty, sourceWarehouseId: source, targetWarehouseId: fg.id });
  return call('POST', `/manufacturing/work-orders/${w.id}/release`, {});
};
const w1 = await release(brk.id, '2', sto.id);
await page.reload();

step('issue screen: cut a remnant, then issue');
await page.goto(`${B}/app/manufacturing/work-orders/${w1.id}`);
await page.waitForSelector('text=Choose a legal entity'); await page.click('main button:has-text("Azeonics")');
await page.click('button:has-text("Issue material")');
await page.waitForSelector('dialog >> text=HN-4471');
await page.click('dialog button:has-text("Cut…")');
await L('Remnant weight').fill('3'); await L('Length (mm)').fill('500');
await page.click('dialog button:has-text("Cut remnant")');
await page.waitForSelector('dialog >> text=HN-4471-R1');
await page.waitForSelector('dialog >> text=Remnant 500 mm');
// Use the remnant rather than the oldest-first suggestion from the full bar.
await L('Issue TI-BAR HN-4471').fill('0');
await L('Issue TI-BAR HN-4471-R1').fill('1');
await shot('01-issue-with-remnant');
await page.click('dialog button:has-text("Issue")');
await page.waitForSelector('text=₹2,000.00');

step('output: generated serials');
await page.click('button:has-text("Record output")');
await page.waitForSelector('text=One serial number is generated per unit');
await page.click('button:has-text("Receive output")');
await page.waitForSelector('text=BRK-000002');
await shot('02-serial-output');

step('satellite: issue bracket serials, as-built on output');
const w2 = await release(sat.id, '1', fg.id);
await page.goto(`${B}/app/manufacturing/work-orders/${w2.id}`);
await page.click('button:has-text("Issue material")');
await page.waitForSelector('dialog >> text=BRK-000001');
await page.click('dialog button:has-text("Issue")');
await page.waitForSelector('text=BRK-000002');
await page.click('button:has-text("Record output")');
await L('Assembly 1 BRK-C 1').selectOption({ label: 'BRK-000001' });
await L('Assembly 1 BRK-C 2').selectOption({ label: 'BRK-000002' });
await shot('03-as-built');
await page.click('button:has-text("Receive output")');
await page.waitForSelector('button:has-text("SAT-000001")');

step('genealogy: backward and forward');
await page.click('nav >> text=Genealogy');
await L('Search serial, lot or heat').fill('SAT-0000');
await page.click('button:has-text("SAT-000001")');
await page.waitForSelector('text=via as-built');
await page.waitForSelector('main >> text=HN-4471-R1');
await page.waitForSelector('text=Received');
await shot('04-backward');
await L('Search serial, lot or heat').fill('HN-4471');
await page.locator('button:has-text("HN-4471")').first().click();
await page.click('button[role=tab]:has-text("Went into")');
await page.waitForSelector('text=Recall list');
await page.waitForSelector('td:has-text("SAT-000001")');
await shot('05-forward-recall');

step('remnants page');
await page.click('nav >> text=Remnants');
await page.waitForSelector('td >> text=HN-4471-R1');
await shot('06-remnants');

step('mobile');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${B}/app/manufacturing/genealogy`); await page.waitForSelector('text=Search to start'); await shot('07-mobile-genealogy');

await browser.close();
if (errors.length) { console.error('Browser errors:\n' + errors.join('\n')); process.exit(1); }
console.log('Genealogy walkthrough passed. Screenshots in', shots);
