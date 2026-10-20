// Tally months as FactoryOS documents (decisions 075 and 075a) in the browser, desktop and phone:
//   - Books by month sets the cut-over month to Tally;
//   - a Day Book with a custom voucher type stays history until the type and its income ledger are mapped there;
//   - the import then creates a submitted sales invoice marked "From Tally", linked from the preview and from history;
//   - an edited voucher replaces its invoice (both linked) and a receipt from Tally settles it (decisions 075a, 075b);
//   - switching the month back previews the documents it reverses and reverses them.
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
  // A bank ledger from Tally, for the receipt later on.
  const bank = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE><LEDGER NAME="HDFC Bank"><GUID>e2e-bank</GUID><PARENT>Bank Accounts</PARENT><ALTERID>1</ALTERID></LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  const bankImport = await call('POST', '/tally/imports', undefined, { files: { name: 'Master.xml', mimeType: 'text/xml', buffer: utf16(bank) } });
  await call('POST', `/tally/imports/${bankImport.id}/commit`, {});
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
  const ledger = (name, amount, party = false, agst = null) =>
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${name}</LEDGERNAME><ISPARTYLEDGER>${party ? 'Yes' : 'No'}</ISPARTYLEDGER><AMOUNT>${amount}</AMOUNT>${agst ? `<BILLALLOCATIONS.LIST><NAME>${agst}</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>${amount}</AMOUNT></BILLALLOCATIONS.LIST>` : ''}</ALLLEDGERENTRIES.LIST>`;
  const voucher = (type, guid, number, alter, body) =>
    `<TALLYMESSAGE><VOUCHER VCHTYPE="${type}" ACTION="Create"><DATE>${day}</DATE><GUID>${guid}</GUID><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${number}</VOUCHERNUMBER><ALTERID>${alter}</ALTERID>${body}</VOUCHER></TALLYMESSAGE>`;
  const envelope = (body) =>
    `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>${body}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  const sale = (alter, net, tax) =>
    voucher('Sales GST', 'e2e-sales-gst-1', 'SG/0001', alter, `${ledger('Acme Castings Pvt Ltd', `-${(net + 2 * tax).toFixed(2)}`, true)}${ledger('Machining Charges', net.toFixed(2))}${ledger('CGST', tax.toFixed(2))}${ledger('Output SGST', tax.toFixed(2))}`);
  const daybook = envelope(sale(1, 1000, 90));
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
  const firstInvoiceUrl = page.url();
  await main.getByText('From Tally', { exact: true }).waitFor();
  await main.getByText(/with Tally's number and amounts/).waitFor();
  await shot('invoice');
  console.log('  ✓ a submitted sales invoice marked From Tally');

  await page.goto(`${B}/app/accounts/tally/history`);
  await main.getByRole('link', { name: 'Sales GST SG/0001' }).click();
  await main.getByRole('link', { name: 'sales invoice' }).waitFor();
  console.log('  ✓ the history voucher links to the document');

  console.log('→ an edited voucher replaces its invoice; a receipt from Tally settles it');
  const later = envelope(`${sale(2, 1100, 99)}${voucher('Receipt', 'e2e-receipt-1', 'R/0001', 1, `${ledger('Acme Castings Pvt Ltd', '500.00', true, 'SG/0001')}${ledger('HDFC Bank', '-500.00')}`)}`);
  await page.goto(`${B}/app/accounts/tally`);
  await L('Tally XML or zip files').setInputFiles({ name: 'DayBook.xml', mimeType: 'text/xml', buffer: utf16(later) });
  await main.getByRole('button', { name: 'Read files', exact: true }).click();
  await page.waitForURL(/\/app\/accounts\/tally\/[0-9a-f-]{36}$/);
  await main.getByText(/1 were edited in Tally and will replace their documents/).waitFor();
  await shot('resync-preview');
  await main.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('dialog').getByText(/1 documents were edited in Tally/).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await main.getByText('Imported', { exact: true }).waitFor();
  await page.goto(firstInvoiceUrl);
  await main.getByText(/Reversed: Edited in Tally/).waitFor();
  await main.getByRole('link', { name: 'the edited sales invoice' }).click();
  await main.getByText(/Updated from Tally/).waitFor();
  await main.getByRole('link', { name: 'the earlier sales invoice' }).waitFor();
  await shot('resynced-invoice');
  console.log('  ✓ the edited invoice links its earlier version, which shows as reversed');
  const receipt = (await call('GET', '/accounts/settlements')).find((x) => x.number === 'R/0001');
  assert.equal(receipt.source, 'tally');
  assert.equal(receipt.allocated, '500.00', 'the receipt settles the invoice by its reference');
  await page.goto(`${B}/app/accounts/settlements/${receipt.id}`);
  await main.getByText('From Tally', { exact: true }).waitFor();
  assert.equal(await main.getByRole('button', { name: 'Cancel', exact: true }).count(), 0, 'a receipt from Tally changes only through Tally');
  await shot('receipt');
  console.log('  ✓ the receipt from Tally is marked and cannot be cancelled here');

  console.log('→ switching the month back reverses its Tally documents');
  await page.goto(`${B}/app/accounts/tally/books`);
  await main.getByRole('group', { name: `Book for ${monthName}` }).getByRole('button', { name: 'FactoryOS', exact: true }).click();
  const sw = page.getByRole('dialog');
  await sw.getByRole('link', { name: 'Receipt R/0001' }).waitFor();
  await sw.getByRole('link', { name: 'Sales invoice SG/0001' }).waitFor();
  await shot('switch-back');
  await sw.getByRole('button', { name: 'Reverse 2 documents', exact: true }).click();
  await main.getByRole('group', { name: `Book for ${monthName}` }).getByRole('button', { name: 'FactoryOS', exact: true, pressed: true }).waitFor();
  assert.equal((await call('GET', `/accounts/settlements/${receipt.id}`)).status, 'cancelled');
  console.log('  ✓ the month is FactoryOS again and its documents are reversed');

  console.log('→ phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${B}/app/accounts/tally/books`);
  await main.getByText('FactoryOS', { exact: true }).first().waitFor();
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
