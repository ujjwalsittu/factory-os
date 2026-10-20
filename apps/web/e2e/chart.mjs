// Chart of accounts and Accounting setup (decision 071) in the browser, desktop and phone:
//   - setup shows posting accounts in sections with plain labels, each offering only fitting ledgers;
//   - the chart is one tree under five classifications, with search, filters and "Used for" badges;
//   - a ledger and a sub-group can be added from a group; at 390 px nothing scrolls sideways.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }),
  page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const L = (t) => page.getByLabel(t, { exact: true });
const main = page.locator('main');
try {
  console.log('→ onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Chart Lead');
  await L('Work email').fill(`chart${Date.now()}@example.com`);
  await L('Password').fill('Sup3r-secret-pw');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding');
  await L('Workspace (company group) name').fill('Chart Browser');
  await L('Legal name').fill('Chart Private Limited');
  await L('Short name').fill('Chart Browser');
  await L('Code').fill('CH');
  await L('PAN').fill('AAACA1234B');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL('**/app');

  console.log('→ setup: posting accounts in sections');
  await page.goto(`${B}/app/accounts/setup`);
  await main.getByRole('button', { name: 'Chart Browser', exact: true }).click();
  for (const s of ['Cash and bank', 'Sales and receivables', 'Purchases and payables', 'GST and other taxes', 'Stock and production', 'Other adjustments'])
    await main.getByRole('region', { name: s }).waitFor();
  const inputCgst = L('Input CGST');
  assert.match(await inputCgst.locator('option:checked').innerText(), /Input CGST · INPUT_CGST/);
  const offered = await inputCgst.locator('option').allInnerTexts();
  assert.ok(!offered.some((o) => /SALES|OUTPUT_CGST|CREDITORS/.test(o)), 'no income, liability or other-role ledgers for an asset role');
  assert.ok(!offered.some((o) => /INPUT_SGST/.test(o)), 'a ledger another role uses is left out');
  const groupsShown = await inputCgst.locator('optgroup').evaluateAll((gs) => gs.map((g) => g.label));
  assert.ok(groupsShown.includes('Input tax credits'), 'options are grouped by group');
  await page.getByText('CGST credit on purchases', { exact: true }).waitFor();
  console.log('  ✓ sections, plain labels, hints and classification-filtered options');

  console.log('→ chart: tree, search, filters');
  await page.goto(`${B}/app/accounts/chart`);
  for (const r of ['Assets', 'Liabilities', 'Equity', 'Income', 'Expenses']) await main.getByText(r, { exact: true }).first().waitFor();
  await main.getByRole('button', { name: 'Input tax credits', exact: true }).waitFor();
  await main.getByText('Used for: Goods received not invoiced', { exact: true }).waitFor();
  await L('Search ledgers').fill('cgst');
  await main.getByText('Used for: Input CGST', { exact: true }).waitFor();
  assert.equal(await main.getByText('Used for: Sales', { exact: true }).count(), 0, 'search hides other ledgers');
  await L('Search ledgers').fill('');
  await main.getByRole('button', { name: 'Income', exact: true }).click();
  await main.getByText('Used for: Sales', { exact: true }).waitFor();
  assert.equal(await main.getByText('Used for: Bank', { exact: true }).count(), 0, 'the Income filter hides assets');
  await main.getByRole('button', { name: 'All', exact: true }).click();
  const cash = main.getByRole('button', { name: 'Cash-in-Hand', exact: true });
  await cash.click();
  assert.equal(await cash.getAttribute('aria-expanded'), 'false');
  assert.equal(await main.getByText('Used for: Cash', { exact: true }).count(), 0, 'a collapsed group hides its ledgers');
  await cash.click();
  console.log('  ✓ five classifications, search, root filter and collapsing');

  console.log('→ chart: add a sub-group and a ledger from a group');
  await main.getByRole('button', { name: 'Add sub-group to Bank Accounts', exact: true }).click();
  await L('Group name').fill('Branch banks');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await main.getByRole('button', { name: 'Branch banks', exact: true }).waitFor();
  await main.getByRole('button', { name: 'Add ledger to Branch banks', exact: true }).click();
  assert.match(await L('Account group').locator('option:checked').innerText(), /Branch banks/);
  await L('Ledger code').fill('BR1');
  await L('Ledger name').fill('Pune branch bank');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await main.getByText('Pune branch bank', { exact: true }).waitFor();
  console.log('  ✓ sub-group and ledger added in place');

  console.log('→ phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/app/accounts/chart', '/app/accounts/setup']) {
    await page.goto(`${B}${path}`);
    await main.getByText(path.endsWith('chart') ? 'Used for: Bank' : 'Cash and bank', { exact: true }).waitFor();
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, `${path} scrolls sideways (${w}px)`);
  }
  console.log('  ✓ no sideways scroll at 390 px');
  assert.deepEqual(errors, []);
  console.log('chart walkthrough passed');
} finally {
  await browser.close();
}
