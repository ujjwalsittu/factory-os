import { chromium } from 'playwright';
// Phase 1a inventory walkthrough against running web + API (fresh tenant each run).
// Usage: pnpm --filter @factoryos/web e2e:inventory   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/inventory', import.meta.url).pathname;
import fs from 'node:fs'; fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000, errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png` });
const L = (t) => page.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);

step('sign up + onboard');
await page.goto(`${B}/sign-up`);
await L('Full name').fill('Stores Lead'); await L('Work email').fill(`stores${run}@azeonics.com`); await L('Password').fill('Sup3r-secret-pw');
await page.click('button[type=submit]'); await page.waitForURL('**/onboarding');
await L('Workspace (company group) name').fill('Azeonics Group'); await L('Legal name').fill('Azeonics Private Limited');
await L('Short name').fill('Azeonics'); await L('Code').fill('AZ'); await L('PAN').fill('AAACA1234B');
await page.click('button:has-text("Create workspace")'); await page.waitForURL('**/app');

step('items');
await page.click('nav >> text=Items'); await page.click('button:has-text("New item")');
await L('Code').fill('TI64-BAR-50'); await L('Name').fill('Ti-6Al-4V bar Ø50 mm');
await L('Stock unit').selectOption({ label: 'KG · Kilogram' }); await L('Tracking').selectOption('batch');
await L('HSN').fill('81089090'); await L('Drawing no.').fill('AZ-RM-001'); await L('Reorder level').fill('20');
await page.getByLabel('Incoming inspection required').check();
await shot('01-item-form');
await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('text=Ti-6Al-4V bar Ø50 mm');
await page.click('button:has-text("New item")');
await L('Code').fill('M4-SCREW'); await L('Name').fill('M4 × 10 screw, SS304'); await L('Type').selectOption('consumable');
await L('Stock unit').selectOption({ label: 'NOS · Numbers' });
await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('text=M4 × 10 screw');
await shot('02-items');

step('supplier');
await page.click('nav >> text=Customers & suppliers'); await page.click('button:has-text("New party")');
const C='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', f='29AAACT1234B1Z'; let s=0; for(let i=0;i<14;i++){const p=C.indexOf(f[i])*(i%2?2:1); s+=Math.floor(p/36)+p%36}
await L('Code').fill('TIMET'); await L('Legal name').fill('Titanium Metals India Pvt Ltd'); await L('GSTIN').fill(f + C[(36 - s % 36) % 36]);
await L('Credit days').fill('60'); await L('Udyam number').fill('UDYAM-KA-03-0001234'); await L('Category').selectOption('small');
await page.waitForSelector('text=Credit days above 45');
await shot('03-party-msme-warning');
await L('Credit days').fill('45');
await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('text=Titanium Metals India');

step('warehouses (entity gate)');
await page.click('nav >> text=Warehouses'); await page.waitForSelector('text=Choose a legal entity'); await shot('04-entity-gate');
await page.click('main button:has-text("Azeonics")'); await page.click('button:has-text("Create standard layout")');
await page.waitForSelector('text=Customer-owned material'); await shot('05-warehouses');

step('receipt into quarantine');
await page.click('nav >> text=Stock entries'); await page.click('a:has-text("New receipt")');
await page.waitForSelector('text=Receipts go to quarantine');
await L('Supplier').selectOption({ label: 'Titanium Metals India Pvt Ltd' }); await L('Delivery challan / invoice no.').fill('TMI/INV/7781');
const pickItem = async (row, term) => { const inp = page.getByLabel('Item', { exact: true }).nth(row); await inp.click(); await inp.fill(term); await page.locator('[role=option]').first().click(); };
await pickItem(0, 'TI64'); await L('Quantity').nth(0).fill('10'); await L('New batch number').nth(0).fill('HN-23-4471'); await L('Unit cost').nth(0).fill('5000');
await page.click('button:has-text("Add line")');
await pickItem(1, 'M4'); await L('Quantity').nth(1).fill('100'); await L('To warehouse').nth(1).selectOption({ label: 'STORES · Stores' }); await L('Unit cost').nth(1).fill('2');
await shot('06-receipt-form');
await page.click('button:has-text("Submit")'); await page.waitForSelector('text=AZ/SE/26-27/00001'); await page.waitForSelector('text=Total value');
await shot('07-receipt-submitted');

step('issue from quarantine is refused');
await page.goto(`${B}/app/inventory/entries/new?purpose=issue`);
await pickItem(0, 'TI64'); await L('Quantity').fill('2'); await L('From warehouse').selectOption({ label: 'QUAR · Quarantine' });
await L('Batch').selectOption({ index: 1 });
await page.click('button:has-text("Submit")'); await page.waitForSelector('text=is not available for issue');
await shot('08-quarantine-refused');

step('transfer QC-passed stock to stores');
await page.goto(`${B}/app/inventory/entries/new?purpose=transfer`);
await pickItem(0, 'TI64'); await L('Quantity').fill('10'); await L('Batch').selectOption({ index: 1 });
await page.click('button:has-text("Submit")'); await page.waitForSelector('text=AZ/SE/26-27/00002');

step('issue 4 kg');
await page.goto(`${B}/app/inventory/entries/new?purpose=issue`);
await pickItem(0, 'TI64'); await L('Quantity').fill('4'); await L('Batch').selectOption({ index: 1 });
await page.click('button:has-text("Submit")'); await page.waitForSelector('text=AZ/SE/26-27/00003'); await page.waitForSelector('text=₹20,000.00');
await shot('09-issue-valued');

step('balance + ledger');
await page.click('nav >> text=Stock balance'); await page.waitForSelector('text=HN-23-4471');
await page.waitForSelector('text=Below reorder level');
await shot('10-balance');
await page.click('a:has-text("TI64-BAR-50")'); await page.waitForURL('**/ledger**'); await page.waitForSelector('text=Balance qty');
await shot('11-ledger');

step('cancel the issue');
await page.click('a:has-text("AZ/SE/26-27/00003")'); await page.click('button:has-text("Cancel entry")');
await page.getByLabel('Reason (recorded in the audit log)').fill('Issued against wrong work order');
await page.getByRole('button', { name: 'Cancel entry' }).last().click();
await page.waitForSelector('text=Issued against wrong work order'); await shot('12-cancelled');

step('list + palette');
await page.click('nav >> text=Stock entries'); await page.waitForSelector('text=AZ/SE/26-27/00001'); await shot('13-entries');
await page.keyboard.press('Control+k'); await page.keyboard.type('new stock'); await shot('14-palette');
await page.keyboard.press('Escape');

step('dark balance');
await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
await page.click('nav >> text=Stock balance'); await page.waitForSelector('text=HN-23-4471'); await page.waitForTimeout(300); await shot('15-balance-dark');

await browser.close();
const unexpected = errors.filter((e) => !/400 \(Bad Request\)/.test(e));
console.log(unexpected.length ? `ERRORS:\n${unexpected.join('\n')}` : 'NO UNEXPECTED ERRORS');
if (unexpected.length) process.exit(1);
console.log('INVENTORY WALKTHROUGH OK');
