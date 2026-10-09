import { chromium } from 'playwright';
// Manufacturing 2c walkthrough (decision 047) against running web + API (fresh tenant each run):
// subcontract order → challan (print) → receive back; outsourced work-order operation → send, receive, output;
// processing charge; ITC-04 return and deadlines; mobile.
// Usage: pnpm --filter @factoryos/web e2e:job-work   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/job-work', import.meta.url).pathname;
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
const pickEntity = async () => {
  if (await page.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await page.click('main button:has-text("Azeonics")');
};

step('sign up + onboard');
await page.goto(`${B}/sign-up`);
await L('Full name').fill('Production Planner'); await L('Work email').fill(`jw${run}@azeonics.com`); await L('Password').fill('Sup3r-secret-pw');
await page.click('button[type=submit]'); await page.waitForURL('**/onboarding');
await L('Workspace (company group) name').fill('Azeonics Group'); await L('Legal name').fill('Azeonics Private Limited');
await L('Short name').fill('Azeonics'); await L('Code').fill('AZ'); await L('PAN').fill('AAACA1234B');
await page.click('button:has-text("Create workspace")'); await page.waitForURL('**/app');

step('masters, stock and a BOM with an outsourced operation (API)');
const me = await (await ctx.request.get(`${B}/api/me`)).json();
const T = me.tenants[0].id;
const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
const call = async (method, path, data) => { const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data }); if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`); return r.json(); };
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const chk = (base) => { const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = 0; for (let i = 0; i < 14; i++) { const v = chars.indexOf(base[i]) * (i % 2 ? 2 : 1); s += Math.floor(v / 36) + (v % 36); } return base + chars[(36 - (s % 36)) % 36]; };
await call('POST', `/entities/${E}/gst-registrations`, { gstin: chk('27AAACA1234B1Z') });
const uoms = await call('GET', '/uoms');
const u = (c) => uoms.find((x) => x.code === c).id;
const item = (code, name, type, tracking, uom, extra = {}) => call('POST', '/items', { code, name, type, tracking, stockUomId: u(uom), hsnCode: '72249099', ...extra });
const bar = await item('17-4PH', '17-4PH bar', 'raw_material', 'batch', 'KG');
const blank = await item('BLANK', 'Forged blank', 'sub_assembly', 'batch', 'NOS');
const lug = await item('LUG-A', 'Mounting lug', 'finished_good', 'none', 'NOS');
await call('POST', '/items', { code: 'SVC-JW', name: 'Job work charges', type: 'service', isStockItem: false, stockUomId: u('NOS'), hsnCode: '998898' });
const sto = await call('POST', '/warehouses', { code: 'STO', name: 'Main stores', type: 'stores' });
const fg = await call('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' });
const rec = await call('POST', '/stock-entries', { purpose: 'receipt', postingDate: today, lines: [{ itemId: bar.id, qty: '50', toWarehouseId: sto.id, newBatchNo: 'HT-901', heatNo: 'HT-901', rate: '400' }] });
await call('POST', `/stock-entries/${rec.id}/submit`, {});
await call('POST', '/parties', { code: 'PHT', name: 'Pune Heat Treaters', isSupplier: true, gstin: chk('27AAACP1234B1Z') });
const wc = await call('POST', '/manufacturing/work-centres', { code: 'MILL', name: 'Milling', hourlyRate: '1200' });
await page.reload();

step('masters: mark the supplier as a job worker');
await page.goto(`${B}/app/masters/parties`);
await pickEntity();
await page.click('text=Pune Heat Treaters');
await page.getByLabel('Job worker').check();
await page.click('dialog button:has-text("Save")');
await page.waitForSelector('td >> text=Job worker');
const ht = (await call('GET', '/parties?role=job_worker'))[0];

step('BOM with an outsourced heat-treatment operation');
const b = await call('POST', '/manufacturing/boms', { itemId: lug.id, revision: 'A', materials: [{ itemId: bar.id, qty: '0.5' }], operations: [{ seq: 10, name: 'Mill', workCentreId: wc.id }, { seq: 20, name: 'Heat treat', outsourced: true, supplierId: ht.id }] });
await page.goto(`${B}/app/manufacturing/boms/${b.id}`);
await pickEntity();
await L('Job worker of operation 2').waitFor();
if ((await L('Work centre of operation 2').inputValue()) !== 'job_worker') throw new Error('operation 20 should show as outsourced');
await shot('01-bom-outsourced');
await call('POST', `/manufacturing/boms/${b.id}/activate`, {});

step('subcontract order: forge blanks from bar');
await page.goto(`${B}/app/manufacturing/job-work`);
await page.click('button:has-text("New subcontract order")');
await L('Job worker').selectOption({ label: 'Pune Heat Treaters' });
await L('Nature of job work').fill('Closed-die forging');
await page.locator('dialog input[role=combobox]').first().fill('BLANK');
await page.locator('[role=option]:has-text("BLANK")').first().click();
await page.locator('dialog').getByLabel(/^Quantity \(/).fill('10');
await L('Receive into').selectOption({ label: 'Main stores' });
await page.click('dialog button:has-text("Add material")');
await page.locator('dialog input[role=combobox]').last().fill('17-4PH');
await page.locator('[role=option]:has-text("17-4PH")').first().click();
await page.locator('dialog input[inputmode=decimal]').last().fill('6');
await shot('02-new-order');
await page.click('dialog button:has-text("Create order")');
await page.waitForURL('**/manufacturing/job-work/*');
await page.waitForSelector('text=Nothing sent yet');

step('send material on a delivery challan');
await page.click('button:has-text("Send material")');
await L('From warehouse').selectOption({ label: 'Main stores' });
await L('Batch 17-4PH 1').selectOption({ index: 1 });
await L('Send 17-4PH 1').fill('6');
await page.click('dialog button:has-text("Issue challan")');
await page.waitForSelector('text=JW/');
await page.waitForSelector('text=₹2,400.00');
await shot('03-challan-issued');
await page.click('a:has-text("JW/")');
await page.waitForSelector('text=Delivery challan');
await page.waitForSelector('text=not a supply');
await shot('04-challan-print');
await page.goBack();

step('receive forged blanks back');
await page.click('button:has-text("Receive back")');
await L('Used 17-4PH HT-901').fill('6');
await L('Lost 17-4PH HT-901').fill('0.4');
await L('Received 1').fill('10');
await page.click('dialog button:has-text("Receive")');
await page.waitForSelector('text=10 good');
await shot('05-received');

step('work order: send pieces for heat treatment, receive, output');
let wo = await call('POST', '/manufacturing/work-orders', { itemId: lug.id, plannedQty: '4', sourceWarehouseId: sto.id, targetWarehouseId: fg.id });
wo = await call('POST', `/manufacturing/work-orders/${wo.id}/release`, {});
await call('POST', `/manufacturing/work-orders/${wo.id}/issue`, { lines: [{ itemId: bar.id, qty: '2', batchId: (await call('GET', `/batches?itemId=${bar.id}&inStock=true&warehouseId=${sto.id}`))[0].id }] });
await page.goto(`${B}/app/manufacturing/work-orders/${wo.id}`);
await page.waitForSelector('text=Job worker');
await page.click('button:has-text("Send…")');
await page.click('dialog button:has-text("Issue challan")');
await page.waitForSelector('text=4 with job worker');
if (await page.locator('button:has-text("Send…")').count()) throw new Error('all pieces are out: Send should be hidden');
await page.click('button:has-text("Receive…")');
await page.locator('dialog').getByLabel('Good pieces').fill('4');
await page.click('dialog button:has-text("Receive")');
await page.waitForSelector('button:has-text("Receive…")', { state: 'detached' });
await shot('06-work-order-outsourced');
await page.click('button:has-text("Record output")');
await page.click('button:has-text("Receive output")');
await page.waitForSelector('text=Output');

step('processing charge on the heat treater’s invoice (API) shows on the order');
const orders = await call('GET', '/manufacturing/job-work');
const conv = orders.find((o) => o.kind === 'conversion');
const detail = await call('GET', `/manufacturing/job-work/${conv.id}`);
const svc = (await call('GET', '/items?q=SVC-JW&stockOnly=false'))[0];
const inv = await call('POST', '/purchase-invoices', { supplierId: ht.id, supplierInvoiceNo: `PHT-${run}`, supplierInvoiceDate: today, postingDate: today, lines: [{ itemId: svc.id, qty: '10', rate: '150', gstRate: '18', jobWorkReceiptId: detail.receipts[0].id }] });
await call('POST', `/purchase-invoices/${inv.id}/submit`, {});
await page.goto(`${B}/app/manufacturing/job-work/${conv.id}`);
await page.waitForSelector('text=Charged by');
await page.waitForSelector('text=₹1,500.00');

step('ITC-04: return and deadlines');
await page.click('nav >> text=ITC-04');
await page.waitForSelector('text=Table 4');
await page.waitForSelector('td >> text=17-4PH 17-4PH bar');
await shot('07-itc04-return');
await page.click('button[role=tab]:has-text("Deadlines")');
await page.waitForSelector('text=Goods still at job workers');
await shot('08-itc04-deadlines');

step('mobile');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${B}/app/manufacturing/job-work/${conv.id}`); await page.waitForSelector('text=Delivery challans'); await shot('09-mobile-order');

await browser.close();
if (errors.length) { console.error('Browser errors:\n' + errors.join('\n')); process.exit(1); }
console.log('Job work walkthrough passed. Screenshots in', shots);
