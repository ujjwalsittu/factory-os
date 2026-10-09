import { chromium } from 'playwright';
// Manufacturing 2d walkthrough (decision 048) against running web + API (fresh tenant each run, API with STORAGE_DRIVER=local):
// item quality flags → inspection plan → gauge and calibration → output held in Quarantine → final inspection with a
// failed sample → NCR to MRB, scrap disposition, close → FAI Forms 1–3 with an attachment, refused while Form 3 fails → certificate pack; mobile.
// Usage: pnpm --filter @factoryos/web e2e:quality   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/quality', import.meta.url).pathname;
import fs from 'node:fs'; fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000, errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
let expected = 0; // refusals the walkthrough provokes on purpose
page.on('console', (m) => m.type() === 'error' && !(expected && /status of 400/.test(m.text()) && expected--) && errors.push(`console: ${m.text()}`));
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const L = (t) => page.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);
const pickEntity = async () => {
  if (await page.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await page.click('main button:has-text("Azeonics")', { timeout: 3000 }).catch(() => null); // the gate can flash while the workspace loads
};

step('sign up + onboard');
await page.goto(`${B}/sign-up`);
await L('Full name').fill('Quality Engineer'); await L('Work email').fill(`qa${run}@azeonics.com`); await L('Password').fill('Sup3r-secret-pw');
await page.click('button[type=submit]'); await page.waitForURL('**/onboarding');
await L('Workspace (company group) name').fill('Azeonics Group'); await L('Legal name').fill('Azeonics Private Limited');
await L('Short name').fill('Azeonics'); await L('Code').fill('AZ'); await L('PAN').fill('AAACA1234B');
await page.click('button:has-text("Create workspace")'); await page.waitForURL('**/app');

step('masters, a heat with its mill certificate, a BOM (API)');
const me = await (await ctx.request.get(`${B}/api/me`)).json();
const T = me.tenants[0].id;
const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
const call = async (method, path, data) => { const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data }); if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`); return r.json(); };
const chk = (base) => { const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = 0; for (let i = 0; i < 14; i++) { const v = chars.indexOf(base[i]) * (i % 2 ? 2 : 1); s += Math.floor(v / 36) + (v % 36); } return base + chars[(36 - (s % 36)) % 36]; };
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const uoms = await call('GET', '/uoms');
const u = (c) => uoms.find((x) => x.code === c).id;
const bar = await call('POST', '/items', { code: 'TI64', name: 'Ti-6Al-4V bar', type: 'raw_material', tracking: 'batch', stockUomId: u('KG'), hsnCode: '81089090' });
const lug = await call('POST', '/items', { code: 'LUG-B', name: 'Antenna lug', type: 'finished_good', tracking: 'batch', stockUomId: u('NOS'), hsnCode: '88073000', revision: 'B', drawingNo: 'AZ-DRG-1042', requiresFai: true });
const sto = await call('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' });
const fg = await call('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' });
const supplier = await call('POST', '/parties', { code: 'TIMET', name: 'Titanium Metals', isSupplier: true, gstin: chk('27AAACT1234B1Z') });
const rec = await call('POST', '/stock-entries', { purpose: 'receipt', postingDate: today, partyId: supplier.id, lines: [{ itemId: bar.id, qty: '10', toWarehouseId: sto.id, newBatchNo: 'HT-5501', heatNo: 'HT-5501', rate: '3000' }] });
await call('POST', `/stock-entries/${rec.id}/submit`, {});
const heat = (await call('GET', `/batches?itemId=${bar.id}`))[0];
const up = await ctx.request.fetch(`${B}/api/attachments?${new URLSearchParams({ ownerType: 'batch', ownerId: heat.id, kind: 'mtc', fileName: 'MTC HT-5501.pdf' })}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/pdf' }, data: Buffer.from('%PDF-1.4\nmill certificate\n%%EOF\n') });
if (up.status() !== 201) throw new Error(`attachment upload: ${up.status()} ${await up.text()}`);
const wc = await call('POST', '/manufacturing/work-centres', { code: 'MILL', name: 'Milling', hourlyRate: '1500' });
const bom = await call('POST', '/manufacturing/boms', { itemId: lug.id, revision: 'A', materials: [{ itemId: bar.id, qty: '0.5' }], operations: [{ seq: 10, name: 'Mill', workCentreId: wc.id }] });
await call('POST', `/manufacturing/boms/${bom.id}/activate`, {});
await page.reload();

step('item master: flag the lug for final inspection');
await page.goto(`${B}/app/masters/items`); await pickEntity();
await pickEntity();
await page.click('text=Antenna lug');
await page.getByLabel(/Final inspection before release/).check();
if (!(await page.getByLabel(/First article inspection before invoicing/).isChecked())) throw new Error('requiresFai should show as checked');
await page.click('dialog button:has-text("Save")');
await page.waitForSelector('dialog', { state: 'detached' });
if (!(await call('GET', `/items/${lug.id}`)).requiresFinalInspection) throw new Error('flag not saved');

step('inspection plan: two ballooned characteristics, activate');
await page.click('nav >> text=Inspection plans');
await page.waitForURL('**/quality/plans');
await page.goto(`${B}/app/quality/plans/new`); await pickEntity();
await page.locator('input[role=combobox]').first().fill('LUG-B');
await page.locator('[role=option]:has-text("LUG-B")').first().click();
await L('Balloon 1').fill('1'); await L('Description 1').fill('Bore Ø10');
await L('Min 1').fill('10.00'); await L('Max 1').fill('10.05'); await L('Unit 1').fill('mm'); await L('Samples 1').fill('2');
await L('Key characteristic 1').check();
await page.click('button:has-text("Add characteristic")');
await L('Balloon 2').fill('2'); await L('Description 2').fill('Proof load 2 kN'); await L('Kind 2').selectOption('functional'); await L('Samples 2').fill('1');
await page.click('button:has-text("Create draft")');
await page.waitForURL(/\/quality\/plans\/[0-9a-f-]{36}$/);
await page.click('button:has-text("Activate")');
await page.waitForSelector('text=active');
await shot('01-plan');

step('gauge register: add a micrometer, record a calibration');
await page.goto(`${B}/app/quality/gauges`); await pickEntity();
await page.click('button:has-text("New gauge")');
await L('Code').fill('MIC-01'); await L('Description').fill('Outside micrometer 0–25 mm'); await L('Last calibrated').fill(today);
await page.click('dialog button:has-text("Add gauge")');
await page.waitForSelector('text=In calibration');
await page.click('td >> text=MIC-01');
await page.click('button:has-text("Record calibration")');
await L('Agency').fill('NABL lab'); await L('Certificate no.').fill(`CAL-${run}`);
await page.click('dialog button:has-text("Record")');
await page.waitForSelector(`text=cert CAL-${run}`);
await shot('02-gauges');

step('work order output goes to Quarantine with a final inspection open (API)');
let wo = await call('POST', '/manufacturing/work-orders', { itemId: lug.id, plannedQty: '4', sourceWarehouseId: sto.id, targetWarehouseId: fg.id });
wo = await call('POST', `/manufacturing/work-orders/${wo.id}/release`, {});
await call('POST', `/manufacturing/work-orders/${wo.id}/issue`, { postingDate: today, lines: [{ itemId: bar.id, qty: '2', batchId: heat.id }] });
await call('POST', `/manufacturing/work-orders/${wo.id}/output`, { postingDate: today, qty: '4', batchNo: 'LUG-L1' });
const lot = (await call('GET', `/batches?itemId=${lug.id}`)).find((b) => b.batchNo === 'LUG-L1');

step('final inspection: one bore oversize, reject 1');
await page.click('nav >> text=Inspections');
await page.waitForSelector('text=LUG-L1');
await shot('03-inspections');
const draft = (await call('GET', '/quality/inspections?status=draft&stage=final'))[0];
await page.goto(`${B}/app/quality/inspections/${draft.id}`); await pickEntity();
await page.waitForSelector('text=Waiting in Quarantine');
await L('1 sample 1').fill('10.02'); await L('1 sample 2').fill('10.09');
await L('Gauge for 1').selectOption({ label: 'MIC-01' });
await L('2 sample 1').selectOption('pass');
await page.click('button:has-text("Save readings")');
await page.waitForSelector('text=10.09 ✗');
await page.click('main button:has-text("Record result")');
await page.waitForSelector('text=A characteristic failed');
await L('Accepted').fill('3'); await L('Rejected').fill('1');
await L('Nonconformance (for the NCR)').fill('Bore Ø10 oversize at 10.09');
await page.click('dialog button:has-text("Record result")');
await page.waitForSelector('text=Rejected quantity raised');
await shot('04-inspection-partial');
const fgStock = await call('GET', `/batches?itemId=${lug.id}&inStock=true&warehouseId=${fg.id}`);
if (Number(fgStock[0]?.qty) !== 3) throw new Error(`3 accepted should be in finished goods, got ${JSON.stringify(fgStock)}`);

step('NCR: scrap the reject from MRB, close');
await page.locator('text=Rejected quantity raised').locator('a').click();
await page.waitForURL(/\/quality\/ncrs\/[0-9a-f-]{36}$/);
await page.waitForSelector('text=On hold in MRB');
await page.click('button:has-text("Propose disposition")');
await page.click('dialog button:has-text("Propose")');
await page.click('button:has-text("MRB approve")');
await page.click('dialog button:has-text("Approve and post")');
await page.waitForSelector('text=Dispositioned');
await page.click('button:has-text("Close NCR")');
await page.waitForSelector('main >> text=Closed');
await shot('05-ncr-closed');

step('work order lists its final inspection; start an in-process check');
await page.goto(`${B}/app/manufacturing/work-orders/${wo.id}`); await pickEntity();
await page.waitForSelector('main >> text=Output of an item that needs final inspection');
await page.waitForSelector('main li >> text=Partial');
await page.click('button:has-text("In-process check")');
await page.click('dialog button:has-text("Start")');
await page.waitForURL(/\/quality\/inspections\/[0-9a-f-]{36}$/);
await page.waitForSelector('text=No active inspection plan for this item and stage');
await shot('06-in-process-check');

step('FAI: create from the first-article lot, attach; a nonconforming Form 3 blocks submission');
await page.click('nav >> text=First article');
await page.click('button:has-text("New FAI")');
await page.locator('dialog input[role=combobox]').fill('LUG-B');
await page.locator('[role=option]:has-text("LUG-B")').first().click();
await page.waitForSelector('text=Required now: first build');
await L('First-article lot / serial').selectOption({ label: 'LUG-L1' });
await L('Final inspection (Form 3)').selectOption({ index: 1 });
await page.click('dialog button:has-text("Create")');
await page.waitForURL(/\/quality\/fai\/[0-9a-f-]{36}$/);
await page.waitForSelector('text=AZ-DRG-1042');
await page.waitForSelector('td >> text=HT-5501');
await page.waitForSelector('text=Proof load 2 kN: pass');
await L('Attach file').setInputFiles({ name: 'Signed FAI LUG-B.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nsigned fai\n%%EOF\n') });
await page.waitForSelector('text=Signed FAI LUG-B.pdf');
await page.waitForSelector('td >> text=10…10.05 mm');
// The first article had an oversize bore: Form 3 doesn't conform, so the FAI can't go for approval.
expected = 1;
await page.click('button:has-text("Submit for approval")');
await page.waitForSelector('text=can only be submitted when Form 3 conforms');
await shot('07-fai');

step('genealogy: certificate pack zip');
await page.goto(`${B}/app/manufacturing/genealogy?batch=${lot.id}`); await pickEntity();
await page.waitForSelector('text=LUG-B · LUG-L1');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Certificate pack")')]);
const zip = fs.readFileSync(await dl.path());
if (zip.subarray(0, 2).toString() !== 'PK' || !zip.includes(Buffer.from('MTC HT-5501.pdf'))) throw new Error('certificate pack should be a zip with the mill certificate');
await shot('08-genealogy-pack');

step('mobile');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${B}/app/quality/inspections/${draft.id}`); await pickEntity(); await page.waitForSelector('text=Bore Ø10'); await shot('09-mobile-inspection');
await page.goto(`${B}/app/quality/ncrs`); await pickEntity(); await page.click('button[role=tab]:has-text("Closed")'); await page.waitForSelector('text=Bore Ø10 oversize'); await shot('10-mobile-ncrs');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
if (overflow) throw new Error('horizontal page scroll at 390 px');

await browser.close();
if (errors.length) { console.error('Browser errors:\n' + errors.join('\n')); process.exit(1); }
console.log('Quality walkthrough passed. Screenshots in', shots);
