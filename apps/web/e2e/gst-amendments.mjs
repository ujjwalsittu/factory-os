// GST amendments in the browser (decision 074b): a filed month's cancelled invoice and B2C sale are proposed in the
// next GSTR-1; the person includes one, drops one with a reason, and the return moves on. Desktop and 390 px.
// Needs the API and web running; WEB_URL overrides http://localhost:3000.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = new URL('./shots/gst-amendments/', import.meta.url).pathname;
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
  const w = await call('POST', '/tenants', { name: 'GST Amend', entity: { legalName: 'GST Browser Private Limited', shortName: 'GST Amend', code: 'GB', pan: 'AAACA1234B' } }, 201);
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

  const shop = await sell(shopper.id, '200');
  const next = (() => { const [y, m] = period.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; })();

  console.log('→ file the month: prepared here, approved and filed by a finance controller');
  const prepared = await call('POST', '/gst-returns/prepare', { gstRegistrationId: reg.id, period });
  const roles = await call('GET', '/roles');
  const fcEmail = `fca${Date.now()}@example.com`;
  const invite = await call('POST', '/invitations', { email: fcEmail, roles: [{ roleId: roles.find((r) => r.name === 'Finance Controller').id, entityIds: [w.entity.id] }] }, 201);
  await new Promise((r) => setTimeout(r, 11000));
  const fcCtx = await browser.newContext();
  const fcPost = async (path, data, expected = 200) => {
    const res = await fcCtx.request.post(`${B}/api${path}`, { data, headers: { origin: B, ...scope } });
    assert.equal(res.status(), expected, `${path}: ${await res.text()}`);
  };
  await fcPost('/auth/sign-up/email', { name: 'GST Checker', email: fcEmail, password: 'Sup3r-secret-pw' });
  await fcPost('/invitations/accept', { token: invite.inviteUrl.split('/').at(-1) }, 201);
  for (const [i, r] of prepared.entries()) {
    await call('POST', `/gst-returns/${r.id}/review`, {});
    await fcPost(`/gst-returns/${r.id}/approve`, {});
    await fcPost(`/gst-returns/${r.id}/file`, { arn: `AA271026000000${i}`, filedOn: date });
  }
  await fcCtx.close();

  console.log('→ cancel two filed documents; the next month proposes amendments');
  await call('POST', `/sales-invoices/${b2b.id}/cancel`, { reason: 'Raised in error', confirmFiledReturn: true }, 201);
  await call('POST', `/sales-invoices/${shop.id}/cancel`, { reason: 'Sale returned', confirmFiledReturn: true }, 201);
  const nextReturns = await call('POST', '/gst-returns/prepare', { gstRegistrationId: reg.id, period: next });
  const g1 = nextReturns.find((r) => r.kind === 'gstr1');
  await page.goto(`${B}/app/compliance/gst-returns/${g1.id}`);
  await page.locator('main').getByRole('button', { name: 'GST Amend', exact: true }).click().catch(() => null);
  await page.getByText('Amendments to filed months').waitFor();
  await page.getByText('B2BA (9A)').waitFor();
  await page.getByText('B2CSA (10)').waitFor();
  assert.equal(await page.getByText('Needs a decision').count(), 2);
  await page.screenshot({ path: `${SHOTS}01-proposed.png`, fullPage: true });
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await page.getByText('Each amendment to a filed month needs a decision first').waitFor();

  console.log('→ include the B2BA, drop the B2CSA with a reason, then review');
  const rowOf = (label) => page.locator('tr', { hasText: label });
  await rowOf('B2BA (9A)').getByRole('button', { name: 'Include' }).click();
  await rowOf('B2BA (9A)').getByText('Included').waitFor();
  await rowOf('B2CSA (10)').getByRole('button', { name: 'Drop…' }).click();
  const drop = page.getByRole('button', { name: 'Drop amendment' });
  assert.equal(await drop.isDisabled(), true, 'A reason is needed to drop');
  await page.getByLabel('Reason', { exact: true }).fill('Refunded and reported with the buyer');
  await drop.click();
  await rowOf('B2CSA (10)').getByText('Refunded and reported with the buyer').waitFor();
  assert.equal(await page.getByText('Each amendment to a filed month needs a decision first').count(), 0, 'The refusal clears once decided');
  await page.screenshot({ path: `${SHOTS}02-decided.png`, fullPage: true });
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await page.getByText('The person who prepared the return cannot approve it').waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export sheets' }).click()]);
  assert.match(download.suggestedFilename(), /\.zip$/);

  console.log('→ phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByText('Amendments to filed months').waitFor();
  await page.waitForTimeout(500);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(wide <= 390, `the return page scrolls sideways (${wide}px)`);
  await page.screenshot({ path: `${SHOTS}03-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS gst amendments browser');
} finally {
  await browser.close();
}
