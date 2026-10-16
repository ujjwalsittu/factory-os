import { chromium } from 'playwright';
// Add new from any list (decision 069, slice 3) against running web + API. On a new workspace with no supplier, no
// item and no unit of measure: a purchase order gets its supplier, an item (with a new unit and HSN code inside the
// item form) and a duplicate-code recovery without leaving the page; a sales invoice gets a customer; a stock entry a
// warehouse; a BOM a work centre; a journal a ledger; a person without create permission sees no option. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:create-from-lists   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/create-from-lists', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000,
  errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const L = (p, t) => p.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
};
const shot = (p, n) => p.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const NEW = (noun) => `＋ Add new ${noun}…`;
const dialogs = (p) => p.locator('dialog[open]');
/** Rejects when the page scrolls sideways. */
const noSideways = async (p, what) => expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${what}: the page scrolls sideways`);


/** A GSTIN with a valid check character built from a 14-character prefix. */
function gstin(first) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  [...first].forEach((ch, i) => {
    const v = chars.indexOf(ch) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  });
  return first + chars[(36 - (sum % 36)) % 36];
}

async function signUp(ctx, page, tag) {
  const email = `${tag}${run}@azeonics.com`;
  await page.goto(`${B}/sign-up`);
  await L(page, 'Full name').fill('Owner');
  await L(page, 'Work email').fill(email);
  await L(page, 'Password').fill('Sup3r-secret-pw');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding');
  await L(page, 'Workspace (company group) name').fill('Azeonics Group');
  await L(page, 'Legal name').fill('Azeonics Private Limited');
  await L(page, 'Short name').fill('Azeonics');
  await L(page, 'Code').fill('AZ');
  await L(page, 'PAN').fill('AAACA1234B');
  await page.click('button:has-text("Create workspace")');
  await page.waitForURL('**/app');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const call = async (method, path, data) => {
    const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  return { T, E, call };
}
async function entity(page) {
  if (await page.waitForSelector('text=Choose a legal entity', { timeout: 2500 }).catch(() => null)) await page.click('main button:has-text("Azeonics")', { timeout: 3000 }).catch(() => null);
}

/** Purchase order: supplier, then an item with a new unit and HSN code, from the fields themselves. */
async function purchaseOrder(page, suffix, shotName) {
  step(`purchase order: add a supplier from the field (${suffix})`);
  await page.goto(`${B}/app/buying/orders/new`);
  await entity(page);
  const supplier = page.getByLabel('Supplier', { exact: true });
  await supplier.waitFor();
  await page.getByRole('button', { name: 'No suppliers yet. Add one.' }).click();
  let d = dialogs(page);
  expect(await d.getByRole('heading', { name: 'New customer or supplier' }).count(), 'the supplier form opens');
  await L(d, 'Code').fill(`ACME${suffix}`);
  await L(d, 'Legal name').fill(`Acme Metals ${suffix}`);
  await L(d, 'GST treatment').selectOption('unregistered');
  await shot(page, `${shotName}-supplier-dialog`);
  await d.getByRole('button', { name: 'Save' }).click();
  await d.waitFor({ state: 'detached' });
  await page.waitForFunction((n) => document.querySelector('select')?.selectedOptions[0]?.textContent === n, `Acme Metals ${suffix}`, { timeout: 8000 });
  expect(page.url().includes('/buying/orders/new'), 'the page did not navigate');

  step(`purchase order: add an item from the line, with a unit and an HSN code inside it (${suffix})`);
  const combo = page.getByRole('combobox', { name: 'Item' }).first();
  await combo.click();
  await combo.fill(`Brass rod ${suffix}`);
  const addRow = page.getByRole('option', { name: new RegExp(`Add “Brass rod ${suffix}” as a new item`) });
  await addRow.waitFor();
  await combo.press('ArrowDown'); // no results, so the add row is the only one and already active
  await combo.press('Enter');
  d = dialogs(page);
  expect(await d.getByRole('heading', { name: 'New item' }).count(), 'the item form opens');
  expect((await L(d, 'Name').inputValue()) === `Brass rod ${suffix}`, 'the name is pre-filled from the search text');
  await L(d, 'Code').fill(`BRASS${suffix}`);
  await L(d, 'Stock unit').selectOption({ label: NEW('unit') });
  const units = dialogs(page).last();
  expect(await units.getByRole('heading', { name: 'Add unit' }).count(), 'the unit form opens inside the item form');
  await L(units, 'Code').fill(`BX${suffix}`);
  await L(units, 'Name').fill('Box');
  await units.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 1);
  await page.waitForFunction((code) => [...document.querySelectorAll('dialog[open] select')].some((s) => s.selectedOptions[0]?.textContent?.startsWith(code)), `BX${suffix}`, { timeout: 8000 }); // the new unit is selected in the item form
  await L(dialogs(page), 'HSN').fill('74071010');
  await dialogs(page).getByRole('button', { name: 'Add 74071010 to the HSN/SAC list' }).click();
  const hsn = dialogs(page).last();
  expect(await hsn.getByRole('heading', { name: 'Add HSN / SAC code' }).count(), 'the HSN form opens inside the item form');
  expect((await L(hsn, 'Code').inputValue()) === '74071010', 'the typed code is pre-filled');
  await L(hsn, 'Description').fill('Brass bars and rods');
  await hsn.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 1);
  await shot(page, `${shotName}-item-dialog`);
  await dialogs(page).getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0, null, { timeout: 8000 });
  const picked = await combo.inputValue();
  expect(picked.startsWith(`BRASS${suffix}`), `the new item is on the line (${picked})`);
  expect((await supplier.evaluate((s) => s.selectedOptions[0]?.textContent)) === `Acme Metals ${suffix}`, 'the supplier is still chosen');
  expect(page.url().includes('/buying/orders/new'), 'still on the same page');

  step(`purchase order: a duplicate code offers the existing item (${suffix})`);
  const second = page.getByRole('combobox', { name: 'Item' }).first();
  await second.click();
  await second.fill('Another rod');
  await second.press('ArrowDown');
  await second.press('Enter');
  d = dialogs(page);
  await L(d, 'Code').fill(`BRASS${suffix}`);
  await L(d, 'Stock unit').selectOption({ index: 1 });
  await d.getByRole('button', { name: 'Save' }).click();
  await d.getByRole('button', { name: 'Use the existing item' }).click();
  await d.waitFor({ state: 'detached' });
  expect((await second.inputValue()).startsWith(`BRASS${suffix}`), 'the existing item is chosen');
  await noSideways(page, 'purchase order');
  await shot(page, `${shotName}-done`);
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  watch(page);
  step('sign up and create a workspace');
  const { E, call } = await signUp(ctx, page, 'cfl');

  await purchaseOrder(page, 'D', 'desktop');

  step('sales invoice: add a customer from the field');
  await page.goto(`${B}/app/selling/invoices/new`);
  await entity(page);
  await page.getByRole('button', { name: 'No customers yet. Add one.' }).click();
  let d = dialogs(page);
  await L(d, 'Code').fill('CUSTD');
  await L(d, 'Legal name').fill('Customer D');
  await L(d, 'GST treatment').selectOption('unregistered');
  await d.getByRole('button', { name: 'Save' }).click();
  await d.waitFor({ state: 'detached' });
  await page.waitForFunction(() => [...document.querySelectorAll('select')].some((s) => s.selectedOptions[0]?.textContent === 'Customer D'), null, { timeout: 8000 });

  step('stock entry: add a warehouse from the field');
  await page.goto(`${B}/app/inventory/entries/new`);
  await entity(page);
  const wh = page.locator('select[aria-label="To warehouse"], select[aria-label="From warehouse"]').first();
  await wh.waitFor();
  await wh.selectOption({ label: NEW('warehouse') });
  d = dialogs(page);
  expect(await d.getByRole('heading', { name: 'Add warehouse or bin' }).count(), 'the warehouse form opens');
  await L(d, 'Code').fill('QA-BIN');
  await L(d, 'Name').fill('QA bin');
  await d.getByRole('button', { name: 'Save' }).click();
  await d.waitFor({ state: 'detached' });
  await page.waitForFunction(() => [...document.querySelectorAll('select')].some((s) => s.selectedOptions[0]?.textContent?.startsWith('QA-BIN')), null, { timeout: 8000 });

  step('journal: add a ledger from the line');
  await page.goto(`${B}/app/accounts/journals/new`);
  await entity(page);
  const ledger = page.locator('select[aria-label="Account 1"]');
  if (await ledger.count()) {
    await ledger.selectOption({ label: NEW('ledger') });
    d = dialogs(page);
    expect(await d.getByRole('heading', { name: 'New ledger' }).count(), 'the ledger form opens');
    await d.getByRole('button', { name: 'Cancel' }).click();
    await d.waitFor({ state: 'detached' });
  } else step('(accounts not active on this workspace: ledger field not shown, skipped)');

  step('BOM: add a work centre from the operation field');
  await page.goto(`${B}/app/manufacturing/boms/new`);
  await entity(page);
  await page.getByRole('button', { name: 'Add operation' }).click();
  const wc = page.locator('select[aria-label^="Work centre of operation"]').first();
  await wc.waitFor();
  {
    await wc.selectOption({ label: NEW('work centre') });
    d = dialogs(page);
    await L(d, 'Code').fill('LATHE');
    await L(d, 'Name').fill('Lathe shop');
    await L(d, 'Hourly rate (₹)').fill('500');
    await d.getByRole('button', { name: 'Save' }).click();
    await d.waitFor({ state: 'detached' });
    await page.waitForFunction(() => [...document.querySelectorAll('select')].some((s) => s.selectedOptions[0]?.textContent?.startsWith('LATHE')), null, { timeout: 8000 });
  }

  step('asset purchase: an asset item, a new asset ledger from the line, posted to that ledger');
  const supplierRec = await call('POST', '/parties', { code: 'MACHCO', name: 'Machine Co', isSupplier: true, gstTreatment: 'unregistered' });
  await call('POST', `/entities/${E}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') });
  await call('POST', '/hsn-codes', { code: '8479', kind: 'hsn', description: 'Machinery', gstRate: '18', effectiveFrom: '2025-04-01' });
  const nos = (await call('GET', '/uoms')).find((u) => u.code === 'NOS').id;
  await call('POST', '/items', { code: 'LATHE-1', name: 'CNC lathe', type: 'asset', stockUomId: nos, hsnCode: '8479' });
  const sheet = await call('PUT', '/accounts/opening', { lines: [], bills: [], settlements: [], receiptBaselines: [] });
  const recon = await call('GET', '/accounts/opening/reconciliation');
  await call('POST', '/accounts/opening/activate', { worksheetId: sheet.id, reviewedToken: recon.snapshotToken });
  await page.goto(`${B}/app/buying/invoices/new`);
  await entity(page);
  await page.getByLabel('Supplier', { exact: true }).selectOption({ label: 'Machine Co' });
  await L(page, 'Supplier invoice no.').fill('MC-1');
  const pick = page.getByRole('combobox', { name: 'Item' }).first();
  await pick.click();
  await pick.fill('LATHE');
  await page.getByRole('option', { name: /LATHE-1/ }).click();
  await page.getByLabel('Quantity', { exact: true }).first().fill('1');
  await page.getByLabel('Rate', { exact: true }).first().fill('50000');
  const ledgerField = page.locator('select[aria-label^="Asset ledger for line"]');
  await ledgerField.waitFor();
  expect((await ledgerField.evaluate((s) => s.selectedOptions[0]?.textContent)) === 'Fixed assets (default)', 'the default is the Fixed assets mapping');
  await ledgerField.selectOption({ label: NEW('asset ledger') });
  d = dialogs(page);
  expect(await d.getByRole('heading', { name: 'New ledger' }).count(), 'the ledger form opens');
  await L(d, 'Ledger code').fill('PLANT');
  await L(d, 'Ledger name').fill('Plant and machinery');
  const groupOptions = await L(d, 'Account group').locator('option').allTextContents();
  expect(groupOptions.length > 1 && groupOptions.slice(1).every((t) => t.endsWith('· asset')), `only asset groups are offered (${groupOptions.join(' | ')})`);
  await L(d, 'Account group').selectOption({ index: 1 });
  await d.getByRole('button', { name: 'Save' }).click();
  await d.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('select[aria-label^="Asset ledger for line"]')?.selectedOptions[0]?.textContent?.startsWith('PLANT'), null, { timeout: 8000 });
  await shot(page, 'desktop-asset-invoice');
  await page.getByRole('button', { name: /Save draft/ }).click();
  await page.waitForURL(/\/buying\/invoices\/[0-9a-f-]{36}$/, { timeout: 15000 });
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByText(/Submitted|submitted/).first().waitFor({ timeout: 15000 });
  const journals = await call('GET', '/accounts/journals');
  const pv = journals.find((j) => j.sourceType === 'purchase_invoice' && j.purpose === 'main');
  expect(!!pv, 'the purchase invoice posted a voucher');
  const detail = await call('GET', `/accounts/journals/${pv.id}`);
  const plant = (await call('GET', '/accounts/accounts')).find((a) => a.code === 'PLANT');
  expect(detail.entries.some((e) => e.accountId === plant.id && Number(e.debit) === 50000), 'the new asset ledger was debited with the taxable value');

  step('a person without create permission sees no Add new option');
  const role = await call('POST', '/roles', { name: 'Buyer (read only)', permissions: ['masters.party.read', 'masters.item.read', 'buying.purchase_order.create', 'buying.purchase_order.read'] });
  const clerkEmail = `cflclerk${run}@azeonics.com`;
  const inv = await call('POST', '/invitations', { email: clerkEmail, roles: [{ roleId: role.id, entityIds: [E] }] });
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const su = await ctx2.request.post(`${B}/api/auth/sign-up/email`, { data: { name: 'Read Only', email: clerkEmail, password: 'Sup3r-secret-pw' }, headers: { Origin: B } });
  expect(su.ok(), 'clerk signs up');
  const acc = await ctx2.request.post(`${B}/api/invitations/accept`, { data: { token: inv.inviteUrl.split('/').at(-1) }, headers: { Origin: B } });
  expect(acc.ok(), 'clerk accepts');
  const p2 = await ctx2.newPage();
  watch(p2);
  await p2.goto(`${B}/app/buying/orders/new`);
  await entity(p2);
  const s2 = p2.getByLabel('Supplier', { exact: true });
  await s2.waitFor();
  expect((await s2.locator('option', { hasText: 'Add new' }).count()) === 0, 'no Add new supplier without permission');
  const c2 = p2.getByRole('combobox', { name: 'Item' }).first();
  await c2.click();
  await c2.fill('Something new');
  expect((await p2.getByRole('option', { name: /as a new item/ }).count()) === 0, 'no add row in the item search without permission');
  await ctx2.close();

  await ctx.close();

  step('phone: the same purchase order flow at 390 px');
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
  const p3 = await ctx3.newPage();
  watch(p3);
  await signUp(ctx3, p3, 'cflm');
  await purchaseOrder(p3, 'M', 'phone');
  const box = await dialogs(p3).count();
  expect(box === 0, 'no dialog left open');
  await ctx3.close();

  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
  console.log('✓ create from lists');
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
