// Customer-supplied material + waste register walkthrough against running web + API.
// Usage: pnpm --filter @factoryos/web e2e:customer-material   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
import { chromium } from 'playwright';

const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/customer-material', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000;
const errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png` });
const L = (t) => page.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);
const gstin = (f) => { const C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = 0; for (let i = 0; i < 14; i++) { const p = C.indexOf(f[i]) * (i % 2 ? 2 : 1); s += Math.floor(p / 36) + (p % 36); } return f + C[(36 - (s % 36)) % 36]; };
const pickItem = async (row, term) => { const inp = L('Item').nth(row); await inp.click(); await inp.fill(term); await page.locator('[role=option]').first().click(); };
const newEntry = async (purpose) => { await page.goto(`${B}/app/inventory/entries/new?purpose=${purpose}`); await page.waitForSelector('text=Material belongs to'); };
const submitExpect = async (text) => { await page.click('button:has-text("Submit")'); await page.waitForSelector(`text=${text}`); };

step('sign up + onboard + masters');
await page.goto(`${B}/sign-up`);
await L('Full name').fill('Plant Head'); await L('Work email').fill(`plant${run}@azeonics.com`); await L('Password').fill('Sup3r-secret-pw');
await page.click('button[type=submit]'); await page.waitForURL('**/onboarding');
await L('Workspace (company group) name').fill('Azeonics Group'); await L('Legal name').fill('Azeonics Private Limited');
await L('Short name').fill('Azeonics'); await L('Code').fill('AZ'); await L('PAN').fill('AAACA1234B');
await page.click('button:has-text("Create workspace")'); await page.waitForURL('**/app');
await page.goto(`${B}/app/masters/items?new=1`);
await L('Code').fill('AL7075-PLATE'); await L('Name').fill('Al 7075-T6 plate'); await L('Stock unit').selectOption({ label: 'KG · Kilogram' }); await L('Tracking').selectOption('batch');
await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('text=Al 7075-T6 plate');
await page.goto(`${B}/app/masters/parties?new=1`);
await L('Code').fill('SKYR'); await L('Legal name').fill('Skyroot Aerospace'); await page.getByLabel('Customer', { exact: true }).check(); await page.getByLabel('Supplier', { exact: true }).uncheck();
await L('GSTIN').fill(gstin('36AAACS1234B1Z')); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('text=Skyroot Aerospace');
await page.click('header button[aria-haspopup=listbox]'); await page.click('[role=option]:has-text("Azeonics")');
await page.goto(`${B}/app/inventory/warehouses`); await page.click('button:has-text("Create standard layout")'); await page.waitForSelector('text=Customer-owned material');

step('customer sends material');
await newEntry('receipt');
await L('Material belongs to').selectOption({ label: 'Skyroot Aerospace' });
await L("Customer's challan no.").fill('SKY/DC/1001');
await pickItem(0, 'AL7075'); await L('Quantity').fill('50'); await L('New batch number').fill('SKY-HT-77');
await page.waitForSelector('text=No cost');
await shot('01-customer-receipt');
await submitExpect('AZ/SE/26-27/00001'); await page.waitForSelector("text=Skyroot Aerospace's material");

step('QC transfer, consume, scrap, return');
await newEntry('transfer'); await L('Material belongs to').selectOption({ label: 'Skyroot Aerospace' });
await pickItem(0, 'AL7075'); await L('Quantity').fill('50'); await L('Batch').selectOption({ index: 1 }); await submitExpect('AZ/SE/26-27/00002');
await newEntry('issue'); await L('Material belongs to').selectOption({ label: 'Skyroot Aerospace' }); await L('Job / work order ref.').fill('WO-1');
await pickItem(0, 'AL7075'); await L('Quantity').fill('30'); await L('Batch').selectOption({ index: 1 }); await submitExpect('AZ/SE/26-27/00003');
await newEntry('scrap'); await L('Material belongs to').selectOption({ label: 'Skyroot Aerospace' }); await L('NCR / reason ref.').fill('NCR-12');
await pickItem(0, 'AL7075'); await L('Quantity').fill('2'); await L('From warehouse').selectOption({ label: 'STORES · Stores' }); await L('Batch').selectOption({ index: 1 });
await L('Waste category').selectOption('rejected_parts'); await shot('02-scrap-form'); await submitExpect('AZ/SE/26-27/00004');
await newEntry('return'); await L('Material belongs to').selectOption({ label: 'Skyroot Aerospace' }); await L('Return challan no.').fill('AZ/RDC/1');
await pickItem(0, 'AL7075'); await L('Quantity').fill('10'); await L('Batch').selectOption({ index: 1 }); await submitExpect('AZ/SE/26-27/00005');

step('waste register');
await page.click('nav >> text=Waste register'); await page.waitForSelector('text=Rejected parts');
await page.click('button:has-text("Record waste")');
await L('Material').fill('Al 7075 swarf'); await L('Belongs to').selectOption({ label: 'Skyroot Aerospace' }); await L('From job / work order').fill('WO-1'); await L('Quantity').fill('6.5');
await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('text=Al 7075 swarf');
await page.click('button:has-text("Record disposal")');
await L('Waste stream').selectOption({ index: 1 });
await L('Method').selectOption('authorised_recycler');
await page.waitForSelector("text=Customer's consent");
await L('Quantity').fill('4'); await L('Challan / invoice no.').fill('GMR/22'); await L("Customer's consent").fill('Skyroot email 06-Oct-2026');
await shot('03-disposal-with-consent');
await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('text=Consent: Skyroot email');
await shot('04-waste-register');

step('statement');
await page.click('nav >> text=Customer material'); await L('Customer').selectOption({ label: 'Skyroot Aerospace' });
await L('From').fill('2026-04-01');
await page.waitForSelector('text=Documents in the period');
const cells = await page.locator('table').first().locator('tbody tr').first().locator('td').allTextContents();
console.log('statement row:', cells.map((c) => c.trim()).join(' | '));
if (!cells.join('|').includes('50') || !cells.join('|').includes('30') || !cells.at(-1).includes('8')) throw new Error('statement numbers wrong');
await shot('05-statement');
await page.emulateMedia({ media: 'print' }); await page.screenshot({ path: `${shots}/06-statement-print.png`, fullPage: true }); await page.emulateMedia({ media: 'screen' });

step('balance by owner');
await page.click('nav >> text=Stock balance'); await L('Owner').selectOption({ label: "Skyroot Aerospace's material" });
await page.locator("tbody >> text=Skyroot Aerospace's").first().waitFor(); await shot('07-balance-owner');

await browser.close();
const unexpected = errors.filter((e) => !/400 \(Bad Request\)/.test(e));
console.log(unexpected.length ? `ERRORS:\n${unexpected.join('\n')}` : 'NO UNEXPECTED ERRORS');
if (unexpected.length) process.exit(1);
console.log('CUSTOMER MATERIAL WALKTHROUGH OK');
