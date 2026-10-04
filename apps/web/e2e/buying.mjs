import { chromium } from 'playwright';
// Slice 1b buying walkthrough against running web + API (fresh tenant each run):
// PO with live GST → receive against the PO → incoming inspection → purchase invoice with rate variance.
// Usage: pnpm --filter @factoryos/web e2e:buying   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/buying', import.meta.url).pathname;
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
await L('Full name').fill('Purchase Lead'); await L('Work email').fill(`buyer${run}@azeonics.com`); await L('Password').fill('Sup3r-secret-pw');
await page.click('button[type=submit]'); await page.waitForURL('**/onboarding');
await L('Workspace (company group) name').fill('Azeonics Group'); await L('Legal name').fill('Azeonics Private Limited');
await L('Short name').fill('Azeonics'); await L('Code').fill('AZ'); await L('PAN').fill('AAACA1234B');
await page.click('button:has-text("Create workspace")'); await page.waitForURL('**/app');

step('masters through the API (covered by other walkthroughs)');
const me = await (await ctx.request.get(`${B}/api/me`)).json();
const T = me.tenants[0].id;
const ents = await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json();
const E = ents[0].id;
const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
const post = async (path, data) => { const r = await ctx.request.post(`${B}/api${path}`, { headers: H, data }); if (!r.ok()) throw new Error(`${path}: ${r.status()} ${await r.text()}`); return r.json(); };
const uoms = await (await ctx.request.get(`${B}/api/uoms`, { headers: H })).json();
const KG = uoms.find((u) => u.code === 'KG').id;
await post(`/entities/${E}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') });
await post('/hsn-codes', { code: '81089090', kind: 'hsn', description: 'Titanium bars, other', gstRate: '18', effectiveFrom: '2025-04-01' });
await post('/warehouses/standard', {});
await post('/items', { code: 'TI64-BAR-50', name: 'Ti-6Al-4V bar Ø50 mm', type: 'raw_material', tracking: 'batch', stockUomId: KG, hsnCode: '81089090', requiresIncomingInspection: true });
await post('/parties', { code: 'TIMET', name: 'Titanium Metals India Pvt Ltd', isSupplier: true, gstin: gstin('27AAACT1234B1Z'), msmeCategory: 'small', msmeUdyam: 'UDYAM-MH-03-0001234', creditDays: 60 });
await page.reload();

step('nav: Buying section is live');
await page.click('nav >> text=Purchase orders');
await page.waitForSelector('text=Choose a legal entity'); await page.click('main button:has-text("Azeonics")');
await page.waitForSelector('text=No open purchase orders'); await shot('01-po-list-empty');

step('purchase order with live GST');
await page.click('a:has-text("New purchase order")');
await L('Supplier').selectOption({ label: 'Titanium Metals India Pvt Ltd' });
await page.waitForSelector('text=MSME small');
const item = page.getByLabel('Item', { exact: true }).first(); await item.click(); await item.fill('TI64'); await page.locator('[role=option]').first().click();
await L('Quantity').fill('50'); await L('Rate').fill('5000');
await page.waitForSelector('text=Intra-state: CGST + SGST');
await page.waitForSelector('text=₹2,95,000.00'); // 2,50,000 + 18%
await page.waitForSelector('option:has-text("18 (HSN)")', { state: 'attached' });
await shot('02-po-form-live-gst');
await page.click('button:has-text("Submit")'); await page.waitForSelector('text=AZ/PO/26-27/0001');
await page.waitForSelector('text=Nothing received or billed yet.');
await shot('03-po-submitted');

step('receive against the PO');
await page.click('a:has-text("Receive goods")');
await page.waitForSelector('text=Receiving against');
await page.waitForSelector('text=50 pending on PO', { timeout: 8000 }).catch(async (e) => { await shot('debug-receipt'); throw e; });
await L('Quantity').fill('30'); await L('New batch number').fill('HN-24-1101');
await L('Delivery challan / invoice no.').fill('TMI/DC/88');
await shot('04-receipt-from-po');
await page.click('button:has-text("Submit")'); await page.waitForSelector('text=AZ/SE/26-27/00001');
await page.waitForSelector('text=₹1,50,000.00'); // valued at the PO rate

step('incoming inspection: accept 28, reject 2');
await page.click('nav >> text=Incoming inspection');
await page.waitForSelector('text=HN-24-1101'); await shot('05-inspection-queue');
await page.click('button:has-text("Inspect")');
await L('Accepted (KG)').fill('28'); await L('Rejected (KG)').fill('2');
await L('Checks done').fill('MTC verified against AMS 4928; UT clear');
await shot('06-inspect-dialog');
await page.click('button:has-text("Record and move stock")');
await page.waitForSelector('text=Partly accepted'); await page.waitForSelector('text=Nothing waiting');
await shot('07-inspected');
await page.click('nav >> text=Stock balance');
await page.waitForSelector('td >> text=STORES'); await page.waitForSelector('td >> text=MRB');
await shot('08-balance-after-inspection');

step('purchase invoice from the PO, with a rate variance');
await page.click('nav >> text=Purchase orders'); await page.click('text=AZ/PO/26-27/0001');
await page.waitForSelector('text=AZ/SE/26-27/00001');
await page.click('a:has-text("Record invoice")');
await page.waitForSelector('text=30 received, unbilled');
await page.waitForSelector('text=payment is due within 45 days');
await L('Supplier invoice no.').fill('tmi/26/0457');
await L('Rate').fill('5100');
await page.waitForSelector('text=₹1,80,540.00'); // 30 × 5100 = 1,53,000 + 18%
await shot('09-invoice-form');
await page.click('button:has-text("Submit")');
await page.waitForSelector('text=Rate differs from the purchase order');
await shot('10-rate-variance');
await page.click('button:has-text("Accept variance and submit")');
await page.waitForSelector('text=AZ/PI/26-27/00001');
await page.waitForSelector('text=TMI/26/0457');
await page.waitForSelector('text=MSME Small');
await shot('11-invoice-submitted');

step('lists');
await page.click('nav >> text=Purchase invoices'); await page.waitForSelector('text=Titanium Metals India Pvt Ltd'); await shot('12-invoice-list');
await page.click('nav >> text=Purchase orders'); await page.waitForSelector('text=60%'); await shot('13-po-list');

step('mobile');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${B}/app/buying/inspections`); await page.waitForSelector('text=Inspections'); await shot('14-mobile-inspections');

await browser.close();
const unexpected = errors.filter((e) => !e.includes('400 (Bad Request)')); // the rate-variance step returns 400 on purpose
if (unexpected.length) { console.error('Browser errors:\n' + unexpected.join('\n')); process.exit(1); }
console.log('Buying walkthrough passed. Screenshots in', shots);
