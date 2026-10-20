// GST returns in the browser (decision 074): preview, prepare, review, the filed-month warning on cancelling an
// invoice, "changed since filing", sheet export, the unit's GST code, and the pages at phone width.
// Needs the API and web running; WEB_URL overrides http://localhost:3000.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = new URL('./shots/gst-returns/', import.meta.url).pathname;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gstin = (first) => {
  let n = 0;
  for (let i = 0; i < 14; i++) {
    const p = C.indexOf(first[i]) * (i % 2 ? 2 : 1);
    n += Math.floor(p / 36) + (p % 36);
  }
  return first + C[(36 - (n % 36)) % 36];
};
let scope = {};
async function call(method, path, data, expected) {
  const res = await ctx.request.fetch(`${B}/api${path}`, { method, data, headers: { origin: B, ...scope } });
  const body = await res.json().catch(() => null);
  if (expected) assert.equal(res.status(), expected, `${method} ${path}: ${JSON.stringify(body)}`);
  else assert.ok(res.ok(), `${method} ${path}: ${res.status()} ${JSON.stringify(body)}`);
  return body;
}

try {
  console.log('→ books with a B2B and a B2C sale');
  const email = `gst${Date.now()}@example.com`;
  await call('POST', '/auth/sign-up/email', { name: 'GST Preparer', email, password: 'Sup3r-secret-pw' });
  const w = await call('POST', '/tenants', { name: 'GST Browser', entity: { legalName: 'GST Browser Private Limited', shortName: 'GST Browser', code: 'GB', pan: 'AAACA1234B' } }, 201);
  scope = { 'x-tenant-id': w.tenant.id, 'x-entity-id': w.entity.id };
  const reg = await call('POST', `/entities/${w.entity.id}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
  const uom = (await call('GET', '/uoms')).find((u) => u.code === 'NOS');
  await call('POST', '/hsn-codes', { code: '998313', kind: 'sac', description: 'Consulting', gstRate: '18', cessRate: '0', effectiveFrom: '2025-04-01' }, 201);
  const item = await call('POST', '/items', { code: 'SVC', name: 'Consulting', type: 'service', stockUomId: uom.id, hsnCode: '998313' }, 201);
  const w2 = await call('PUT', '/accounts/opening', { lines: [], bills: [], settlements: [], receiptBaselines: [] });
  const rec = await call('GET', '/accounts/opening/reconciliation');
  await call('POST', '/accounts/opening/activate', { worksheetId: w2.id, reviewedToken: rec.snapshotToken });
  const date = (await call('GET', '/accounts/settings')).cutoverDate;
  const period = date.slice(0, 7);
  const buyer = await call('POST', '/parties', { code: 'B2B', name: 'Registered buyer', isCustomer: true, gstTreatment: 'registered', gstin: gstin('27AAACB1234B1Z'), stateCode: '27' }, 201);
  const shopper = await call('POST', '/parties', { code: 'B2C', name: 'Walk-in buyer', isCustomer: true, gstTreatment: 'unregistered', stateCode: '27' }, 201);
  const sell = async (customerId, rate) => {
    const d = await call('POST', '/sales-invoices', { customerId, gstRegistrationId: reg.id, invoiceDate: date, placeOfSupplyStateCode: '27', lines: [{ itemId: item.id, qty: '1', rate, gstRate: '18' }] }, 201);
    await call('POST', `/sales-invoices/${d.id}/submit`, {}, 201);
    return d;
  };
  const b2b = await sell(buyer.id, '1000');
  await sell(shopper.id, '200');

  console.log('→ preview and prepare');
  await page.goto(`${B}/app/compliance/gst-returns`);
  await page.locator('main').getByRole('button', { name: 'GST Browser', exact: true }).click();
  await page.getByLabel('Month', { exact: true }).selectOption(period);
  await page.getByText('Outward taxable value (3.1a)').waitFor();
  await page.getByText('₹1,200.00').first().waitFor();
  await page.getByText('Output tax equals the output GST ledgers').waitFor();
  await page.screenshot({ path: `${SHOTS}01-preview.png`, fullPage: true });
  await page.getByRole('tab', { name: 'GSTR-3B' }).click();
  await page.getByText('(A)(5) All other ITC').waitFor();
  await page.getByRole('button', { name: 'Prepare returns' }).click();
  await page.waitForURL('**/app/compliance/gst-returns/*');
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await page.getByText('The person who prepared the return cannot approve it').waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export sheets' }).click()]);
  assert.match(download.suggestedFilename(), /\.zip$/);
  await page.screenshot({ path: `${SHOTS}02-reviewed.png`, fullPage: true });
  const returnUrl = page.url();

  console.log('→ a finance controller approves and records filing in a separate session');
  const roles = await call('GET', '/roles');
  const fcCtx = await browser.newContext();
  const fcEmail = `fc2${Date.now()}@example.com`;
  const inv2 = await call('POST', '/invitations', { email: fcEmail, roles: [{ roleId: roles.find((r) => r.name === 'Finance Controller').id, entityIds: [w.entity.id] }] }, 201);
  await new Promise((r) => setTimeout(r, 11000));
  const fcPost = async (path, data, expected) => {
    const res = await fcCtx.request.post(`${B}/api${path}`, { data, headers: { origin: B, ...scope } });
    assert.equal(res.status(), expected, `${path}: ${await res.text()}`);
  };
  await fcPost('/auth/sign-up/email', { name: 'GST Checker', email: fcEmail, password: 'Sup3r-secret-pw' }, 200);
  await fcPost('/invitations/accept', { token: inv2.inviteUrl.split('/').at(-1) }, 201);
  const fcPage = await fcCtx.newPage();
  await fcPage.goto(returnUrl);
  await fcPage.locator('main').getByRole('button', { name: 'GST Browser', exact: true }).click().catch(() => null);
  await fcPage.getByRole('button', { name: 'Approve' }).click();
  await fcPage.getByRole('button', { name: 'Record filing…' }).click();
  await fcPage.getByLabel('ARN', { exact: true }).fill('AA2710260000001');
  await fcPage.getByRole('button', { name: 'Record filing', exact: true }).click();
  await fcPage.getByText('Filed', { exact: true }).first().waitFor();
  await fcCtx.close();

  console.log('→ cancelling an invoice in the filed month asks for a reason');
  await page.goto(`${B}/app/selling/invoices/${b2b.id}`);
  await page.getByRole('button', { name: 'Cancel invoice' }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Billed to the wrong buyer');
  await page.getByRole('dialog').getByRole('button', { name: /Cancel invoice/ }).click();
  await page.getByText("This month's GST return is filed").waitFor();
  await page.screenshot({ path: `${SHOTS}03-filed-month-warning.png` });
  await page.getByRole('button', { name: 'Change anyway' }).click();
  await page.getByText('Billed to the wrong buyer').first().waitFor();
  await page.goto(returnUrl);
  await page.getByText('Changed since filing').waitFor();
  await page.screenshot({ path: `${SHOTS}04-changed-since-filing.png`, fullPage: true });

  console.log('→ GST unit code on units');
  await page.goto(`${B}/app/masters/units`);
  const select = page.getByLabel('GST unit code for NOS');
  assert.equal(await select.inputValue(), 'NOS');
  await select.selectOption('PCS');
  await page.waitForResponse((r) => r.url().includes('/api/uoms') && r.request().method() === 'GET');
  assert.equal(await page.getByLabel('GST unit code for NOS').inputValue(), 'PCS');

  console.log('→ phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, url] of [
    ['05-mobile-list', `${B}/app/compliance/gst-returns`],
    ['06-mobile-return', returnUrl],
  ]) {
    await page.goto(url);
    await page.locator('main h1').first().waitFor();
    await page.getByText('Checks', { exact: true }).first().waitFor();
    await page.waitForTimeout(500);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(wide <= 390, `${name} scrolls sideways (${wide}px)`);
    await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('PASS gst returns browser');
} finally {
  await browser.close();
}
