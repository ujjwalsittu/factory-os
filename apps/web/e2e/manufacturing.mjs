import { chromium } from 'playwright';
// Manufacturing slice 2a walkthrough (decision 044) against running web + API (fresh tenant each run):
// work centre → BOM → work order → issue by heat → shop-floor job card → output at actual cost → close, trace, mobile.
// Usage: pnpm --filter @factoryos/web e2e:manufacturing   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/manufacturing', import.meta.url).pathname;
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
await L('Full name').fill('Production Lead'); await L('Work email').fill(`mfg${run}@azeonics.com`); await L('Password').fill('Sup3r-secret-pw');
await page.click('button[type=submit]'); await page.waitForURL('**/onboarding');
await L('Workspace (company group) name').fill('Azeonics Group'); await L('Legal name').fill('Azeonics Private Limited');
await L('Short name').fill('Azeonics'); await L('Code').fill('AZ'); await L('PAN').fill('AAACA1234B');
await page.click('button:has-text("Create workspace")'); await page.waitForURL('**/app');

step('items, warehouses and raw material (API)');
const me = await (await ctx.request.get(`${B}/api/me`)).json();
const T = me.tenants[0].id;
const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
const call = async (method, path, data) => { const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data }); if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`); return r.json(); };
const uoms = await call('GET', '/uoms');
const u = (c) => uoms.find((x) => x.code === c).id;
const bar = await call('POST', '/items', { code: 'TI-BAR-50', name: 'Ti-6Al-4V bar Ø50', type: 'raw_material', tracking: 'batch', stockUomId: u('KG'), hsnCode: '81082000' });
await call('POST', '/items', { code: 'M4-SCREW', name: 'M4 screw A4', type: 'component', tracking: 'none', stockUomId: u('NOS'), hsnCode: '73181500' });
await call('POST', '/items', { code: 'BRK-001', name: 'Satellite bracket', type: 'finished_good', tracking: 'batch', stockUomId: u('NOS'), hsnCode: '88073000' });
const screw = (await call('GET', '/items?q=M4-SCREW'))[0];
const sto = await call('POST', '/warehouses', { code: 'STO', name: 'Main stores', type: 'stores' });
await call('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' });
const rec = await call('POST', '/stock-entries', { purpose: 'receipt', postingDate: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), lines: [
  { itemId: bar.id, qty: '10', toWarehouseId: sto.id, newBatchNo: 'HN-4471', heatNo: 'HN-4471', rate: '2000' },
  { itemId: screw.id, qty: '100', toWarehouseId: sto.id, rate: '5' },
] });
await call('POST', `/stock-entries/${rec.id}/submit`, {});
await page.reload();

step('work centre with machine');
await page.click('nav >> text=Work centres');
await page.waitForSelector('text=Choose a legal entity'); await page.click('main button:has-text("Azeonics")');
await page.waitForSelector('text=No work centres yet');
await page.click('button:has-text("New work centre")');
await L('Code').fill('CNC5'); await L('Hourly rate (₹)').fill('1200'); await L('Name').fill('5-axis milling');
await page.click('dialog button:has-text("Save")'); await page.waitForSelector('td:has-text("CNC5")');
await page.click('button:has-text("Add machine")');
await L('Machine code').fill('M-03'); await L('Machine name').fill('DMG Mori DMU 50');
await page.click('dialog button:has-text("Save")'); await page.waitForSelector('td span:has-text("M-03")');
await shot('01-work-centres');

step('BOM with materials and an operation');
await page.click('nav >> text=Bills of materials');
await page.click('a:has-text("New BOM")');
const pickItem = async (combo, code) => { await combo.click(); await page.keyboard.type(code); await page.locator(`[role=option]:has-text("${code}")`).first().click(); };
await pickItem(page.getByRole('combobox').first(), 'BRK-001');
await pickItem(page.getByRole('combobox').nth(1), 'TI-BAR-50');
await L('Quantity of material 1').fill('0.5');
await page.click('button:has-text("Add material")');
await pickItem(page.getByRole('combobox').nth(2), 'M4-SCREW');
await L('Quantity of material 2').fill('4');
await L('Backflush material 2').check();
await page.click('button:has-text("Add operation")');
await L('Name of operation 1').fill('Mill complete');
await L('Work centre of operation 1').selectOption({ label: 'CNC5 · 5-axis milling' });
await L('Setup minutes of operation 1').fill('30'); await L('Run minutes per unit of operation 1').fill('6');
await page.click('button:has-text("Save draft")');
await page.waitForURL(/\/boms\/[0-9a-f-]{36}$/);
await page.click('button:has-text("Activate")');
await page.waitForSelector('text=Active revisions are frozen');
await shot('02-bom');

step('work order: create, release');
await page.click('nav >> text=Work orders');
await page.waitForSelector('text=No work orders');
await page.click('button:has-text("New work order")');
await pickItem(page.getByRole('combobox').first(), 'BRK-001');
await L('Quantity (NOS)').fill('10');
await L('Issue material from').selectOption({ label: 'Main stores' });
await L('Receive output into').selectOption({ label: 'Finished goods' });
await page.click('button:has-text("Create draft")');
await page.waitForURL(/\/work-orders\/[0-9a-f-]{36}$/);
await page.click('button:has-text("Release")');
await page.waitForSelector('text=AZ/WO/');
const number = (await page.locator('h1').innerText()).match(/AZ\/WO\/\S+/)[0];

step('issue by heat (suggested)');
await page.click('button:has-text("Issue material")');
await page.waitForSelector('text=HN-4471');
const sug = await L('Issue TI-BAR-50 HN-4471').inputValue();
if (sug !== '5') throw new Error(`expected 5 kg suggested, got ${sug}`);
await shot('03-issue');
await page.click('dialog button:has-text("Issue")');
await page.waitForSelector('text=₹10,000.00');

step('shop floor: start, pause, resume, stop');
await page.click('nav >> text=Shop floor');
await page.click(`button[aria-label="Start op 10 on ${number}"]`);
await page.waitForSelector('text=My job');
await page.click('button:has-text("Pause")');
await page.click('dialog button:has-text("Pause")');
await page.waitForSelector('text=paused: Tool change');
await page.click('button:has-text("Resume")');
await page.waitForSelector('button:has-text("Pause")');
await page.click('button:has-text("Stop")');
await L('Good').fill('10');
await page.click('button:has-text("Stop and record")');
await page.waitForSelector('text=My job', { state: 'detached' });
await shot('04-shop-floor');

step('output at actual cost, close, trace');
await page.goto(`${B}/app/manufacturing`);
await page.click(`a:has-text("${number}")`);
await page.click('button:has-text("Record output")');
await page.waitForSelector('text=This output completes the order');
await page.click('button:has-text("Receive output")');
await page.waitForSelector('text=Output value');
await page.waitForSelector(`button:has-text("${number}")`);
const wip = await page.locator('p:has-text("Still in WIP") + p').innerText();
if (!/₹0\.00/.test(wip)) throw new Error(`WIP should be empty after the final output, got ${wip}`);
await shot('05-output');
await page.click(`button:has-text("${number}")`);
await page.waitForSelector('text=HN-4471');
await shot('06-trace');
await page.click('dialog button:has-text("Close")');
await page.click('button:has-text("Close")');
await page.click('button:has-text("Close work order")');
await page.waitForSelector('text=Closed');
await page.waitForSelector('button:has-text("Reopen")');
await shot('07-closed');

step('mobile shop floor');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${B}/app/manufacturing/shop-floor`); await page.waitForSelector('text=Nothing released'); await shot('08-mobile-shop-floor');
await page.goto(`${B}/app/manufacturing`); await page.waitForSelector(`text=${number}`); await shot('09-mobile-work-orders');

await browser.close();
if (errors.length) { console.error('Browser errors:\n' + errors.join('\n')); process.exit(1); }
console.log('Manufacturing walkthrough passed. Screenshots in', shots);
