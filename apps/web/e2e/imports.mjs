import { chromium } from 'playwright';
// Imports walkthrough (decisions 026–028) against running web + API (fresh tenant each run):
// USD purchase order → receipt at the PO rate → landed cost voucher with Bill of Entry → stock revalued.
// Usage: pnpm --filter @factoryos/web e2e:imports   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/imports', import.meta.url).pathname;
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
const gstin = (f) => { const C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = 0; for (let i = 0; i < 14; i++) { const p = C.indexOf(f[i]) * (i % 2 ? 2 : 1); s += Math.floor(p / 36) + (p % 36); } return f + C[(36 - (s % 36)) % 36]; };

step('sign up + onboard');
await page.goto(`${B}/sign-up`);
await L('Full name').fill('Imports Lead'); await L('Work email').fill(`imports${run}@azeonics.com`); await L('Password').fill('Sup3r-secret-pw');
await page.click('button[type=submit]'); await page.waitForURL('**/onboarding');
await L('Workspace (company group) name').fill('Azeonics Group'); await L('Legal name').fill('Azeonics Private Limited');
await L('Short name').fill('Azeonics'); await L('Code').fill('AZ'); await L('PAN').fill('AAACA1234B');
await page.click('button:has-text("Create workspace")'); await page.waitForURL('**/app');

step('masters through the API');
const me = await (await ctx.request.get(`${B}/api/me`)).json();
const T = me.tenants[0].id;
const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
const post = async (path, data) => { const r = await ctx.request.post(`${B}/api${path}`, { headers: H, data }); if (!r.ok()) throw new Error(`${path}: ${r.status()} ${await r.text()}`); return r.json(); };
const get = async (path) => (await ctx.request.get(`${B}/api${path}`, { headers: H })).json();
const KG = (await get('/uoms')).find((u) => u.code === 'KG').id;
await post(`/entities/${E}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') });
await post('/hsn-codes', { code: '81089090', kind: 'hsn', description: 'Titanium bars, other', gstRate: '18', effectiveFrom: '2025-04-01' });
await post('/warehouses/standard', {});
const TI = (await post('/items', { code: 'TI64-BAR-50', name: 'Ti-6Al-4V bar Ø50 mm', type: 'raw_material', tracking: 'batch', stockUomId: KG, hsnCode: '81089090' })).id;
await post('/parties', { code: 'BAOJI', name: 'Baoji Titanium Industry Co', isSupplier: true, gstTreatment: 'overseas' });
await post('/parties', { code: 'NSCHA', name: 'Nhava Sheva Clearing Agency', isSupplier: true, gstin: gstin('27AAACN1234B1Z') });
await page.reload();
await page.click('nav >> text=Purchase orders');
await page.waitForSelector('text=Choose a legal entity'); await page.click('main button:has-text("Azeonics")');

step('USD purchase order');
await page.click('a:has-text("New purchase order")');
await L('Supplier').selectOption({ label: 'Baoji Titanium Industry Co' });
await L('Currency').selectOption('USD');
await L('Exchange rate (₹ per 1 USD)').fill('80');
const item = page.getByLabel('Item', { exact: true }).first(); await item.click(); await item.fill('TI64'); await page.locator('[role=option]').first().click();
await L('Quantity').fill('100'); await L('Rate').fill('25');
await page.waitForSelector('text=Import: IGST paid at customs');
await page.waitForSelector('text=$2,500.00');
await shot('01-usd-po');
await page.click('button:has-text("Submit")'); await page.waitForSelector('text=AZ/PO/26-27/0001');

step('receive: cost filled in rupees at the PO rate');
await page.click('a:has-text("Receive goods")');
await page.waitForSelector('text=USD 25 × ₹80');
await L('New batch number').fill('HT-IMP-0711'); await L('Delivery challan / invoice no.').fill('BL MSCU7781');
await shot('02-receipt-from-usd-po');
await page.click('button:has-text("Submit")'); await page.waitForSelector('text=AZ/SE/26-27/00001');
await page.waitForSelector('text=₹2,00,000.00');

step('40 kg issued before the duty bill arrives (API)');
const batchId = (await get(`/batches?itemId=${TI}&inStock=true`))[0].id;
const STORES = (await get('/warehouses')).find((w) => w.code === 'STORES').id;
const iss = await post('/stock-entries', { purpose: 'issue', postingDate: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), reference: 'WO-1', lines: [{ itemId: TI, qty: '40', fromWarehouseId: STORES, batchId }] });
await post(`/stock-entries/${iss.id}/submit`, {});

step('landed cost voucher with Bill of Entry');
await page.click('nav >> text=Landed cost');
await page.waitForSelector('text=No landed cost vouchers'); await page.click('a:has-text("New landed cost")');
await L('Bill of Entry no.').fill('4417823'); await L('Port code').fill('innsa1');
await L('Customs exchange rate (₹)').fill('80.10'); await L('Assessable value (₹)').fill('200000'); await L('Import IGST paid (₹)').fill('41400');
await page.getByLabel('Include AZ/SE/26-27/00001').check();
await L('Charge amount').nth(0).fill('20000');
await L('Charge amount').nth(1).fill('2000');
await page.click('button:has-text("Add charge")');
await L('Charge type').nth(2).selectOption('clearing');
await L('Billed by').nth(2).selectOption({ label: 'Nhava Sheva Clearing Agency' });
await L('Document number').nth(2).fill('NSC/889');
await L('Charge amount').nth(2).fill('3000');
await page.waitForSelector('text=₹25,000.00');
await page.waitForSelector('text=60 of 100');
await shot('03-landed-cost-preview');
await page.click('button:has-text("Submit")');
await page.waitForSelector('text=AZ/LCV/26-27/00001');
await page.waitForSelector('text=₹10,000.00 variance');
await page.waitForSelector('text=₹2,000.00 → ₹2,250.00/KG');
await shot('04-landed-cost-posted');

step('stock and ledger reflect it');
await page.click('nav >> text=Stock balance'); await page.waitForSelector('text=₹1,35,000.00'); await shot('05-balance-revalued');
await page.goto(`${B}/app/inventory/ledger?itemId=${TI}`);
await page.waitForSelector('text=Landed cost').catch(() => {}); await shot('06-ledger');

step('cancel is guarded');
await page.goto(`${B}/app/inventory/entries/${iss.id}`);
await page.click('button:has-text("Cancel entry")'); await L('Reason (recorded in the audit log)').fill('wrong work order');
await page.click('button:has-text("Cancel entry") >> nth=-1');
await page.waitForSelector('text=was added to this stock after it was issued'); await shot('07-cancel-guard');

await browser.close();
const unexpected = errors.filter((e) => !e.includes('409 (Conflict)')); // the guarded cancel returns 409 on purpose
if (unexpected.length) { console.error('Browser errors:\n' + unexpected.join('\n')); process.exit(1); }
console.log('Imports walkthrough passed. Screenshots in', shots);
