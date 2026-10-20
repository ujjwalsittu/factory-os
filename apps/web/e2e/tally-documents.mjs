// Tally months as FactoryOS documents (decisions 075 and 075a) in the browser, desktop and phone:
//   - Books by month sets the cut-over month to Tally;
//   - a Day Book with a custom voucher type stays history until the type and its income ledger are mapped there;
//   - the import then creates a submitted sales invoice marked "From Tally", linked from the preview and from history.
// Usage: pnpm --filter @factoryos/web e2e:tally-documents   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { gstin } from '../../api/scripts/accounting-test-helpers.mjs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/tally-documents', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const utf16 = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
const run = Date.now() % 100000;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const L = (t) => page.getByLabel(t, { exact: true });
const main = page.locator('main');
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const fits = async () => assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, `no sideways scroll on ${page.url()}`);
let scope = {};
const call = async (method, path, data, multipart) => {
  const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: { Origin: B, 'x-tenant-id': scope.tenantId ?? '', 'x-entity-id': scope.entityId ?? '' }, ...(multipart ? { multipart } : data !== undefined ? { data } : {}) });
  assert.ok(r.ok(), `${method} ${path}: ${r.status()} ${await r.text()}`);
  return r.json();
};

try {
  console.log('→ onboard, then masters, GSTIN and a service item through the API');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Tally Months');
  await L('Work email').fill(`tallydocs${run}@example.com`);
  await L('Password').fill('Sup3r-secret-pw');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding');
  await L('Workspace (company group) name').fill('Tally Months');
  await L('Legal name').fill('Tally Months Private Limited');
  await L('Short name').fill('Tally Months');
  await L('Code').fill('TM');
  await L('PAN').fill('AAACA1234B');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL('**/app');
  const me = await call('GET', '/me');
  scope.tenantId = me.tenants[0].id;
  scope.entityId = (await call('GET', '/me/context')).entities[0].id;
  // One customer from Tally (linked by the import), then accounting activated with empty openings: that sets the cut-over.
  const masters = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE><LEDGER NAME="Acme Castings Pvt Ltd"><GUID>e2e-acme</GUID><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>${gstin('27AAACA9999B1Z')}</PARTYGSTIN><ALTERID>1</ALTERID></LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  const imp = await call('POST', '/tally/imports', undefined, { files: { name: 'Master.xml', mimeType: 'text/xml', buffer: utf16(masters) } });
  await call('POST', `/tally/imports/${imp.id}/commit`, {});
  await call('POST', `/entities/${scope.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B2Z') });
  await call('GET', '/accounts/settings');
  const w = await call('PUT', '/accounts/opening', { lines: [], bills: [], settlements: [], receiptBaselines: [] });
  const rec = await call('GET', '/accounts/opening/reconciliation');
  await call('POST', '/accounts/opening/activate', { worksheetId: w.id, reviewedToken: rec.snapshotToken });
  const nos = (await call('GET', '/uoms')).find((u) => u.code === 'NOS');
  await call('POST', '/items', { code: 'SVC-MACH', name: 'Machining', type: 'service', isStockItem: false, stockUomId: nos.id, hsnCode: '998898' });
  const { cutoverDate } = await call('GET', '/tally/books');
  const month = cutoverDate.slice(0, 7);

  console.log('→ Books by month: keep the cut-over month in Tally');
  await page.goto(`${B}/app/accounts/tally`);
  await main.getByRole('button', { name: 'Tally Months', exact: true }).click().catch(() => {});
  await main.getByRole('link', { name: 'Books by month', exact: true }).click();
  await page.waitForURL('**/app/accounts/tally/books');
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  await main.getByRole('group', { name: `Book for ${monthName}` }).getByRole('button', { name: 'Tally', exact: true }).click();
  await main.getByText('Kept in Tally', { exact: true }).waitFor();
  await shot('books');
  console.log('  ✓ month set to Tally');

  console.log('→ a Day Book with a custom type stays history until mapped');
  const day = cutoverDate.replace(/-/g, '');
  const ledger = (name, amount, party = false) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${name}</LEDGERNAME><ISPARTYLEDGER>${party ? 'Yes' : 'No'}</ISPARTYLEDGER><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
  const daybook = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>
<TALLYMESSAGE><VOUCHER VCHTYPE="Sales GST" ACTION="Create"><DATE>${day}</DATE><GUID>e2e-sales-gst-1</GUID><VOUCHERTYPENAME>Sales GST</VOUCHERTYPENAME><VOUCHERNUMBER>SG/0001</VOUCHERNUMBER><ALTERID>1</ALTERID>
${ledger('Acme Castings Pvt Ltd', '-1180.00', true)}${ledger('Machining Charges', '1000.00')}${ledger('CGST', '90.00')}${ledger('Output SGST', '90.00')}
</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  await main.getByRole('link', { name: '← Tally import' }).click();
  await L('Tally XML or zip files').setInputFiles({ name: 'DayBook.xml', mimeType: 'text/xml', buffer: utf16(daybook) });
  await main.getByRole('button', { name: 'Read files', exact: true }).click();
  await page.waitForURL(/\/app\/accounts\/tally\/[0-9a-f-]{36}$/);
  const importUrl = page.url();
  await main.getByText(/0 vouchers in months kept in Tally will become FactoryOS documents/).waitFor();
  await main.getByText(/Voucher type "Sales GST" is not mapped/).waitFor();
  console.log('  ✓ the custom type is listed as staying history');

  await main.getByRole('link', { name: 'map voucher types and ledgers' }).click().catch(async () => page.goto(`${B}/app/accounts/tally/books`));
  await page.waitForURL('**/app/accounts/tally/books');
  const mapped = page.waitForResponse((r) => r.url().endsWith('/tally/mappings/voucher-types') && r.ok());
  await L('Sales GST becomes').selectOption('sales_invoice');
  await mapped;
  await L('Tally ledger').fill('Machining Charges');
  await L('Service item').selectOption({ label: 'SVC-MACH · Machining' });
  await main.getByRole('button', { name: 'Save', exact: true }).click();
  await main.locator('li').filter({ hasText: 'Machining Charges' }).getByText('SVC-MACH · Machining', { exact: true }).waitFor();
  await shot('mappings');
  console.log('  ✓ voucher type and ledger mapped');

  console.log('→ the import now creates the document');
  await page.goto(importUrl);
  await main.getByText(/1 vouchers in months kept in Tally will become FactoryOS documents/).waitFor();
  await main.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('dialog').getByText(/1 vouchers in months kept in Tally become submitted FactoryOS documents/).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await main.getByText('Imported', { exact: true }).waitFor();
  await main.getByRole('button', { name: 'Documents', exact: false }).first().click();
  await main.getByRole('link', { name: 'Open the document' }).click();
  await page.waitForURL(/\/app\/selling\/invoices\/[0-9a-f-]{36}$/);
  await main.getByText('From Tally', { exact: true }).waitFor();
  await main.getByText(/with Tally's number and amounts/).waitFor();
  await shot('invoice');
  console.log('  ✓ a submitted sales invoice marked From Tally');

  await page.goto(`${B}/app/accounts/tally/history`);
  await main.getByRole('link', { name: 'Sales GST SG/0001' }).click();
  await main.getByRole('link', { name: 'sales invoice' }).waitFor();
  console.log('  ✓ the history voucher links to the document');

  console.log('→ phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${B}/app/accounts/tally/books`);
  await main.getByText('Kept in Tally', { exact: true }).waitFor();
  await fits();
  await shot('books-phone');
  await page.goto(importUrl);
  await main.getByText('Imported', { exact: true }).waitFor();
  await fits();
  console.log('  ✓ no sideways scroll at 390 px');
  assert.deepEqual(errors, []);
  console.log('tally documents walkthrough passed');
} catch (e) {
  await shot('failure');
  throw e;
} finally {
  await browser.close();
}
