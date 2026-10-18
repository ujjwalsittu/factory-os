import { chromium } from 'playwright';
// Record pages, Related and Accounting panels, record search (decision 070) against running web + API. A new workspace
// with active books and a purchase chain (order, receipt, invoice): the item and party pages list what is around them,
// a document's Related panel and Accounting panel link onward, the palette finds records by number, item and party and opens
// them, and a person with only item and party access sees no documents anywhere. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:records   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/records', import.meta.url).pathname;
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
async function entity(page) {
  if (await page.waitForSelector('text=Choose a legal entity', { timeout: 2500 }).catch(() => null)) await page.click('main button:has-text("Azeonics")', { timeout: 3000 }).catch(() => null);
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  watch(page);
  step('sign up, create a workspace, activate books and build a purchase chain');
  const email = `rec${run}@azeonics.com`;
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
  const sheet = await call('PUT', '/accounts/opening', { lines: [], bills: [], settlements: [], receiptBaselines: [] });
  const recon = await call('GET', '/accounts/opening/reconciliation');
  await call('POST', '/accounts/opening/activate', { worksheetId: sheet.id, reviewedToken: recon.snapshotToken });
  const reg = await call('POST', `/entities/${E}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') });
  await call('POST', '/hsn-codes', { code: '8108', kind: 'hsn', description: 'Titanium', gstRate: '18', effectiveFrom: '2025-04-01' });
  const nos = (await call('GET', '/uoms')).find((u) => u.code === 'NOS').id;
  await call('POST', '/warehouses/standard', {});
  const wh = (await call('GET', '/warehouses')).find((w) => w.code === 'STORES').id;
  const sup = await call('POST', '/parties', { code: 'TIMET', name: 'Timet Metals', isSupplier: true, gstin: gstin('27AAACB1234B1Z') });
  const rod = await call('POST', '/items', { code: 'TI-ROD', name: 'Titanium rod', type: 'raw_material', tracking: 'batch', stockUomId: nos, hsnCode: '8108' });
  const date = (await call('GET', '/accounts/settings')).cutoverDate;
  const po = await call('POST', '/purchase-orders', { supplierId: sup.id, gstRegistrationId: reg.id, orderDate: date, lines: [{ itemId: rod.id, qty: '10', rate: '10' }] });
  await call('POST', `/purchase-orders/${po.id}/submit`, {});
  const poD = await call('GET', `/purchase-orders/${po.id}`);
  const rcpt = await call('POST', '/stock-entries', { postingDate: date, purpose: 'receipt', purchaseOrderId: po.id, partyId: sup.id, lines: [{ itemId: rod.id, qty: '10', rate: '10', toWarehouseId: wh, poLineId: poD.lines[0].id, newBatchNo: 'HEAT-77' }] });
  await call('POST', `/stock-entries/${rcpt.id}/submit`, {});
  const bill = await call('POST', '/purchase-invoices', { supplierId: sup.id, purchaseOrderId: po.id, gstRegistrationId: reg.id, supplierInvoiceNo: 'TM-1', supplierInvoiceDate: date, postingDate: date, itcEligible: true, lines: [{ itemId: rod.id, poLineId: poD.lines[0].id, qty: '10', rate: '10' }] });
  await call('POST', `/purchase-invoices/${bill.id}/submit`, {});
  const poNo = poD.number;
  const billNo = (await call('GET', `/purchase-invoices/${bill.id}`)).number;

  step('item page: details, stock by batch, recent movements; opened from the items list');
  await page.goto(`${B}/app/masters/items`);
  await entity(page);
  await page.getByRole('link', { name: 'Open TI-ROD' }).click();
  await page.waitForURL(/\/masters\/items\/[0-9a-f-]{36}$/);
  await page.getByRole('heading', { name: /TI-ROD/ }).waitFor();
  await entity(page); // activity is per legal entity: the page asks for one
  const stock = page.locator('[data-section="stock"]');
  page.on('response', async (r) => r.url().includes('/overview') && console.log('  overview', r.status(), (await r.text()).slice(0, 200)));
  await stock.waitFor({ timeout: 8000 }).catch(async () => { console.log((await page.locator('main').innerText()).slice(0, 500)); throw new Error('stock section did not appear'); });
  expect((await stock.innerText()).includes('HEAT-77'), 'stock is listed by batch');
  expect(await page.locator('[data-section="movements"]').count(), 'recent movements are listed');
  await shot(page, 'desktop-item');
  await noSideways(page, 'item page');

  step('party page: orders, receipts and invoices; follow an order');
  await page.goto(`${B}/app/masters/parties`);
  await entity(page);
  await page.getByRole('link', { name: 'Open Timet Metals' }).click();
  await page.waitForURL(/\/masters\/parties\/[0-9a-f-]{36}$/);
  await page.getByRole('heading', { name: 'Timet Metals' }).waitFor();
  await entity(page);
  for (const s of ['purchase-orders', 'receipts', 'purchase-invoices']) await page.locator(`[data-section="${s}"]`).waitFor();
  expect((await page.locator('main').getByRole('link', { name: 'Outstanding' }).count()) === 1, 'a link to Outstanding');
  await shot(page, 'desktop-party');
  await page.locator('[data-section="purchase-orders"]').getByRole('link', { name: new RegExp(poNo.replace(/[/]/g, '\\/')) }).click();
  await page.waitForURL(/\/buying\/orders\/[0-9a-f-]{36}$/);

  step('purchase order: Related lists the receipt and invoice; follow the invoice, see its Accounting and Related panels');
  const related = page.locator('[data-related="purchase_order"]');
  await related.waitFor();
  expect((await related.innerText()).includes(billNo), 'the invoice is in the chain');
  await shot(page, 'desktop-po-related');
  await related.getByRole('link', { name: new RegExp(billNo.replace(/[/]/g, '\\/')) }).click();
  await page.waitForURL(/\/buying\/invoices\/[0-9a-f-]{36}$/);
  await page.getByText('Accounting vouchers').waitFor();
  const invRelated = page.locator('[data-related="purchase_invoice"]');
  await invRelated.waitFor();
  expect((await invRelated.innerText()).includes(poNo), 'the invoice leads back to its order');
  await shot(page, 'desktop-invoice-panels');

  step('palette: a document number, an item code and a party name, with the keyboard');
  await page.goto(`${B}/app`);
  await entity(page);
  const openPalette = async (p) => {
    await p.keyboard.press('Control+k');
    return p.getByRole('combobox', { name: /|/ }).first();
  };
  await openPalette(page);
  const box = page.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox');
  await box.fill(poNo);
  const hit = page.getByRole('option', { name: new RegExp(`Purchase orders.*${poNo.replace(/[/]/g, '\\/')}`) });
  page.on('response', async (r) => r.url().includes('/api/search') && console.log('  search', r.status(), (await r.text()).slice(0, 160)));
  await hit.waitFor({ timeout: 8000 }).catch(async () => { console.log(await page.getByRole('dialog', { name: 'Command palette' }).innerText()); throw new Error('record result did not appear'); });
  await box.press('Enter');
  await page.waitForURL(/\/buying\/orders\/[0-9a-f-]{36}$/);
  await openPalette(page);
  await box.fill('ti-rod');
  await page.getByRole('option', { name: /Items.*TI-ROD/ }).waitFor({ timeout: 8000 });
  await page.getByRole('option', { name: /Items.*TI-ROD/ }).click();
  await page.waitForURL(/\/masters\/items\/[0-9a-f-]{36}$/);
  await openPalette(page);
  await box.fill('HEAT-77');
  await page.getByRole('option', { name: /Batches and serials.*HEAT-77/ }).waitFor({ timeout: 8000 });
  await openPalette(page).catch(() => undefined);
  await page.keyboard.press('Escape');
  await openPalette(page);
  await box.fill('timet');
  await page.getByRole('option', { name: /Parties.*Timet Metals/ }).waitFor({ timeout: 8000 });
  await shot(page, 'desktop-palette');
  await page.keyboard.press('Escape');

  step('a person with only item and party access: no documents on pages, no records in the palette');
  const role = await call('POST', '/roles', { name: 'Masters reader', permissions: ['masters.item.read', 'masters.party.read'] });
  const readerEmail = `recr${run}@azeonics.com`;
  const inv = await call('POST', '/invitations', { email: readerEmail, roles: [{ roleId: role.id, entityIds: [E] }] });
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  expect((await ctx2.request.post(`${B}/api/auth/sign-up/email`, { data: { name: 'Reader', email: readerEmail, password: 'Sup3r-secret-pw' }, headers: { Origin: B } })).ok(), 'reader signs up');
  expect((await ctx2.request.post(`${B}/api/invitations/accept`, { data: { token: inv.inviteUrl.split('/').at(-1) }, headers: { Origin: B } })).ok(), 'reader accepts');
  const p2 = await ctx2.newPage();
  watch(p2);
  await p2.goto(`${B}/app/masters/items/${rod.id}`);
  await entity(p2);
  await p2.getByRole('heading', { name: /TI-ROD/ }).waitFor({ timeout: 10000 }).catch(async () => { console.log(p2.url(), (await p2.locator('body').innerText()).slice(0, 400)); throw new Error('reader item page did not open'); });
  await p2.getByText('Nothing recorded for this item yet').waitFor();
  expect((await p2.locator('[data-section]').count()) === 0, 'no sections without stock, order or movement access');
  await p2.keyboard.press('Control+k');
  const box2 = p2.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox');
  await box2.fill(poNo);
  await p2.waitForTimeout(1200);
  expect((await p2.getByRole('option', { name: /Purchase orders/ }).count()) === 0, 'no purchase order in the reader palette');
  await box2.fill('timet');
  await p2.getByRole('option', { name: /Parties.*Timet Metals/ }).waitFor({ timeout: 8000 });
  await ctx2.close();
  await ctx.close();

  step('phone: item and party pages and the palette at 390 px');
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
  const p3 = await ctx3.newPage();
  watch(p3);
  await p3.goto(`${B}/sign-in`);
  await L(p3, 'Email').fill(email).catch(async () => L(p3, 'Work email').fill(email));
  await L(p3, 'Password').fill('Sup3r-secret-pw');
  await p3.click('button[type=submit]');
  await p3.waitForURL('**/app**');
  for (const [path, heading] of [[`/app/masters/items/${rod.id}`, /TI-ROD/], [`/app/masters/parties/${sup.id}`, /Timet Metals/], [`/app/buying/orders/${po.id}`, /./]]) {
    await p3.goto(`${B}${path}`);
    await entity(p3);
    await p3.getByRole('heading', { name: heading }).first().waitFor();
    await p3.waitForTimeout(800);
    await noSideways(p3, path);
  }
  await shot(p3, 'phone-party');
  await ctx3.close();

  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
  console.log('✓ records');
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
