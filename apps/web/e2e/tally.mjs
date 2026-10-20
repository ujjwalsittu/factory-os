// Tally import (decision 072) in the browser, desktop and phone:
//   - the page explains the export steps; uploading an export only reads it;
//   - the preview groups records by kind and action; a conflict blocks Import until it is decided;
//   - Import creates the records; uploading the same export again finds everything unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS;
const fixture = fs.readFileSync(new URL('../../../packages/core/fixtures/tally/masters.xml', import.meta.url), 'utf8');
// One party with a GSTIN that fails its checksum, to make a conflict.
const withConflict = fixture.replace(
  '</REQUESTDATA>',
  '<TALLYMESSAGE><LEDGER NAME="Typo Traders"><GUID>e2e-typo</GUID><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>27AAACT9999X1Z1</PARTYGSTIN><ALTERID>1</ALTERID></LEDGER></TALLYMESSAGE></REQUESTDATA>',
);
const utf16 = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }),
  page = await ctx.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const L = (t) => page.getByLabel(t, { exact: true });
const main = page.locator('main');
const show = (label) => main.getByRole('group', { name: 'Show' }).getByRole('button', { name: label, exact: true });
const shot = (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
try {
  console.log('→ onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Tally Lead');
  await L('Work email').fill(`tally${Date.now()}@example.com`);
  await L('Password').fill('Sup3r-secret-pw');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding');
  await L('Workspace (company group) name').fill('Tally Browser');
  await L('Legal name').fill('Tally Private Limited');
  await L('Short name').fill('Tally Browser');
  await L('Code').fill('TB');
  await L('PAN').fill('AAACA1234B');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL('**/app');

  console.log('→ upload reads without saving');
  await page.goto(`${B}/app/accounts/tally`);
  await main.getByRole('button', { name: 'Tally Browser', exact: true }).click().catch(() => {});
  await main.getByText('Export from TallyPrime', { exact: true }).waitFor();
  await main.getByText('No imports yet.', { exact: true }).waitFor();
  await L('Tally XML or zip files').setInputFiles({ name: 'Master.xml', mimeType: 'text/xml', buffer: utf16(withConflict) });
  await main.getByRole('button', { name: 'Read files', exact: true }).click();
  await page.waitForURL(/\/app\/accounts\/tally\/[0-9a-f-]{36}$/);
  await main.getByText('Fixture Engineering Private Limited', { exact: true }).waitFor();
  await main.getByText('Waiting for review', { exact: true }).waitFor();
  const blocked = main.getByRole('button', { name: '1 to decide before import', exact: true });
  assert.ok(await blocked.isDisabled(), 'Import is blocked while a conflict is open');
  await main.getByText('Opening balances and stock', { exact: true }).waitFor();
  await main.getByText('None, the openings balance', { exact: true }).waitFor();
  await shot('tally-preview');
  console.log('  ✓ preview with a conflict, Import blocked; openings balance');

  console.log('→ decide and import');
  await show('Needs a decision').click();
  const typo = main.locator('li', { hasText: 'Typo Traders' }).first();
  await typo.getByText(/is not valid/).waitFor();
  await typo.getByRole('button', { name: 'Create', exact: true }).click();
  await main.getByRole('button', { name: 'Import', exact: true }).waitFor();
  await show('All').click();
  await main.getByRole('button', { name: /^Customers & suppliers/ }).click();
  await main.getByText('Acme Castings Pvt Ltd', { exact: true }).waitFor();
  await main.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await main.getByText('Imported', { exact: true }).waitFor();
  assert.equal(await main.getByRole('button', { name: 'Discard', exact: true }).count(), 0);
  await main.getByRole('link', { name: 'opening stock drafts', exact: true }).waitFor();
  await page.goto(`${B}/app/masters/parties`);
  await main.getByText('Acme Castings Pvt Ltd').first().waitFor();
  console.log('  ✓ a decided conflict unblocks Import; parties exist afterwards');

  console.log('→ same export again changes nothing');
  await page.goto(`${B}/app/accounts/tally`);
  await L('Tally XML or zip files').setInputFiles({ name: 'Master.xml', mimeType: 'text/xml', buffer: utf16(withConflict) });
  await main.getByRole('button', { name: 'Read files', exact: true }).click();
  await page.waitForURL(/\/app\/accounts\/tally\/[0-9a-f-]{36}$/);
  await main.getByRole('button', { name: 'Import', exact: true }).waitFor();
  await main.getByRole('button', { name: /^Customers & suppliers/ }).click();
  await show('Create').click();
  await main.getByText('Nothing matches these filters.', { exact: true }).waitFor();
  assert.equal(await main.getByText('Nothing matches these filters.', { exact: true }).count(), 1, 'nothing would be created');
  console.log('  ✓ re-import proposes no new records');

  console.log('→ an unbalanced export needs the difference accepted');
  await page.goto(`${B}/app/accounts/tally`);
  const unbalanced = withConflict.replace('<OPENINGBALANCE>4,79,535.50</OPENINGBALANCE>', '<OPENINGBALANCE>4,79,000.00</OPENINGBALANCE>');
  await L('Tally XML or zip files').setInputFiles({ name: 'Master.xml', mimeType: 'text/xml', buffer: utf16(unbalanced) });
  await main.getByRole('button', { name: 'Read files', exact: true }).click();
  await page.waitForURL(/\/app\/accounts\/tally\/[0-9a-f-]{36}$/);
  await main.getByText(/do not balance/).waitFor();
  await main.getByText(/already has \d+ lines? and \d+ bills?/).waitFor();
  await main.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const importButton = dialog.getByRole('button', { name: 'Import', exact: true });
  assert.ok(await importButton.isDisabled(), 'Import waits for the difference to be accepted');
  await dialog.getByRole('checkbox').check();
  await importButton.click();
  await main.getByText('Imported', { exact: true }).waitFor();
  console.log('  ✓ the difference and the worksheet warning show; Import waits for acceptance');

  console.log('→ phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await main.getByText('Opening balances and stock', { exact: true }).waitFor();
  await shot('tally-phone');
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w <= 390, `no sideways scroll (${w}px)`);
  await page.goto(`${B}/app/accounts/tally`);
  await main.getByText('Export from TallyPrime', { exact: true }).waitFor();
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  console.log('  ✓ no sideways scroll at 390 px');
  assert.deepEqual(errors, []);
  console.log('tally walkthrough passed');
} catch (e) {
  await shot('tally-failure');
  throw e;
} finally {
  await browser.close();
}
