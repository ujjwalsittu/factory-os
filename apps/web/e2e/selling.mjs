import assert from 'node:assert/strict';
import { chromium } from 'playwright';
// Real selling UI → API → PostgreSQL. Removing conversion, delivery selection,
// statutory print, or settings makes the corresponding assertions fail.
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
);
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const L = (t) => page.getByLabel(t, { exact: true });
const waitForData = async (read, predicate, label) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await read();
    if (predicate(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.fail(label);
};
const gstin = (f) => {
  const C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let s = 0;
  for (let i = 0; i < 14; i++) {
    const p = C.indexOf(f[i]) * (i % 2 ? 2 : 1);
    s += Math.floor(p / 36) + (p % 36);
  }
  return f + C[(36 - (s % 36)) % 36];
};
try {
  console.log('→ sign up and seed a selling tenant');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Sales Lead');
  await L('Work email').fill(`selling${Date.now()}@example.com`);
  await L('Password').fill('Sup3r-secret-pw');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding');
  await L('Workspace (company group) name').fill('Selling Test');
  await L('Legal name').fill('Azeonics Private Limited');
  await L('Short name').fill('Azeonics');
  await L('Code').fill('AZ');
  await L('PAN').fill('AAACA1234B');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL('**/app');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const entities = await (
    await ctx.request.get(`${B}/api/entities`, {
      headers: { 'x-tenant-id': T },
    })
  ).json();
  const E = entities[0].id,
    H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const req = async (method, path, data) => {
    const r = await ctx.request.fetch(`${B}/api${path}`, {
      method,
      headers: H,
      data,
    });
    assert.ok(r.ok(), `${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const reg = await req('POST', `/entities/${E}/gst-registrations`, {
    gstin: gstin('27AAACA1234B1Z'),
    address: {
      line1: 'Factory Road',
      city: 'Mumbai',
      stateCode: '27',
      pincode: '400001',
    },
  });
  const units = await req('GET', '/uoms');
  await req('POST', '/hsn-codes', {
    code: '8108',
    kind: 'hsn',
    description: 'Titanium',
    gstRate: '18',
    effectiveFrom: '2025-04-01',
  });
  await req('POST', '/warehouses/standard', {});
  const whs = await req('GET', '/warehouses'),
    stores = whs.find((w) => w.type === 'stores');
  const item = await req('POST', '/items', {
    code: 'SELL-TI',
    name: 'Titanium bracket',
    type: 'finished_good',
    tracking: 'batch',
    stockUomId: units.find((u) => u.code === 'NOS').id,
    hsnCode: '8108',
  });
  const customer = await req('POST', '/parties', {
    code: 'CUSTOMER',
    name: 'Space Customer',
    isCustomer: true,
    gstin: gstin('27AAACB1234B1Z'),
    creditDays: 30,
    addresses: [
      {
        label: 'Billing',
        line1: 'Customer Road',
        city: 'Pune',
        stateCode: '27',
        pincode: '411001',
      },
      {
        label: 'Accounts',
        line1: 'Accounts Road',
        city: 'Thane',
        stateCode: '27',
        pincode: '400601',
      },
    ],
  });
  const receipt = await req('POST', '/stock-entries', {
    purpose: 'receipt',
    postingDate: new Date().toISOString().slice(0, 10),
    lines: [
      {
        itemId: item.id,
        qty: '10',
        rate: '100',
        toWarehouseId: stores.id,
        newBatchNo: 'HEAT-SELL-1',
      },
    ],
  });
  await req('POST', `/stock-entries/${receipt.id}/submit`, {});
  await page.goto(`${B}/app/selling/quotations`);
  await page.getByText('Choose a legal entity', { exact: true }).waitFor();
  await page
    .locator('main')
    .getByRole('button', { name: 'Azeonics', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'New quotation', exact: true })
    .waitFor({ timeout: 10000 });
  console.log('→ quotation with live GST, then conversion to order');
  await page.getByRole('link', { name: 'New quotation', exact: true }).click();
  await L('Customer').selectOption(customer.id);
  await L('Item').fill('SELL-TI');
  await page.locator('[role=option]').first().click();
  await L('Quantity').fill('2');
  await L('Rate').fill('1000');
  await page.getByText('₹2,360.00', { exact: true }).waitFor();
  console.log('→ autosave preserves edits during a slow request');
  const draft = await waitForData(
    () => req('GET', '/quotations'),
    (rows) => rows.length === 1,
    'quotation autosaved',
  );
  let delayed = false,
    release;
  const saving = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/quotations/*', async (route) => {
    if (route.request().method() === 'PUT' && !delayed) {
      delayed = true;
      release();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    await route.continue();
  });
  await L('Rate').fill('1100');
  await saving;
  await L('Rate').fill('1000');
  await waitForData(
    () => req('GET', `/quotations/${draft[0].id}`),
    (d) => delayed && d.lines[0].rate === '1100.000000',
    'slow autosave finished',
  );
  await waitForData(
    () => req('GET', `/quotations/${draft[0].id}`),
    (d) => d.lines[0].rate === '1000.000000',
    'latest edit saved after earlier request',
  );
  await page.unroute('**/api/quotations/*');
  console.log('→ autosave resumes after correcting a validation error');
  await L('Quantity').fill('0');
  await page.getByText('Not saved or submitted', { exact: true }).waitFor();
  await L('Quantity').fill('2');
  await L('Rate').fill('1050');
  await waitForData(
    () => req('GET', `/quotations/${draft[0].id}`),
    (d) => d.lines[0].rate === '1050.000000',
    'corrected draft autosaved',
  );
  await L('Rate').fill('1000');
  await waitForData(
    () => req('GET', `/quotations/${draft[0].id}`),
    (d) => d.lines[0].rate === '1000.000000',
    'restored draft autosaved',
  );
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page
    .getByRole('button', { name: 'Create sales order', exact: true })
    .click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('link', { name: 'Create invoice', exact: true }).click();
  console.log('→ choose warehouse and heat, submit invoice, verify delivery');
  await L('Warehouse').selectOption(stores.id);
  await L('Batch').selectOption({ label: 'HEAT-SELL-1 · 10' });
  console.log('→ reopening a draft preserves the selected billing address');
  await L('Billing address').selectOption('Accounts');
  await L('Shipping address').selectOption('Billing');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.waitForURL(/\/invoices\/[a-f0-9-]+$/);
  await page.reload();
  await L('Billing address').waitFor();
  await L('Billing address')
    .locator('option[value="Accounts"]')
    .waitFor({ state: 'attached' });
  assert.equal(await L('Billing address').inputValue(), 'Accounts');
  assert.equal(await L('Shipping address').inputValue(), 'Billing');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('link', { name: 'Print / PDF', exact: true }).waitFor();
  const invoiceId = page.url().split('/').pop();
  const inv = await req('GET', `/sales-invoices/${invoiceId}`);
  assert.equal(inv.status, 'submitted');
  assert.ok(inv.stockEntryId);
  assert.equal(inv.grandTotal, '2360.00');
  const balances = await req('GET', `/stock/balance?itemId=${item.id}`);
  assert.ok(
    JSON.stringify(balances).includes('8.000000'),
    'invoice ships exactly 2 units',
  );
  console.log(
    '→ statutory print includes snapshot, GST, heat and invoice number',
  );
  await page.getByRole('link', { name: 'Print / PDF', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Tax invoice', exact: true })
    .waitFor();
  const print = await page.locator('main').innerText();
  for (const expected of [
    inv.number,
    'Space Customer',
    'Customer Road',
    'HEAT-SELL-1',
    'CGST',
    'SGST',
  ])
    assert.ok(print.includes(expected), `print contains ${expected}`);
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 794, height: 1123 });
  assert.equal(
    await page
      .locator('article table')
      .evaluate(
        (table) =>
          table.getBoundingClientRect().width >
          table.closest('article').getBoundingClientRect().width + 1,
      ),
    false,
    'all invoice columns fit the printable width',
  );
  await page.pdf({
    path: process.env.PDF_PATH ?? '/tmp/factoryos-selling-invoice.pdf',
    format: 'A4',
  });
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1400, height: 900 });
  console.log('→ forward-only series, LUT and credit-limit settings');
  await page.goto(`${B}/app/settings/number-series`);
  const row = page.getByRole('row').filter({ hasText: 'Tax invoice' });
  await row.getByRole('button', { name: 'Set next number' }).click();
  await L('Next value').fill('100');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await row.getByText('100', { exact: true }).waitFor();
  const series = await req('GET', '/number-series');
  assert.equal(
    series.find((s) => s.docType === `sales_invoice:${reg.id}`).nextValue,
    100,
  );
  await row.getByRole('button', { name: 'Set next number' }).click();
  await L('Next value').fill('1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByText(/backwards|forward|lower|at least|less than/)
    .waitFor();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await page.goto(`${B}/app/settings/entities`);
  await page.getByRole('button', { name: 'Edit LUT', exact: true }).click();
  await L('LUT ARN').fill('AD2704260000123');
  await L('Valid from').fill('2026-04-01');
  await L('Valid to').fill('2027-03-31');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('AD2704260000123', { exact: false }).waitFor();
  await page.goto(`${B}/app/masters/parties`);
  await page.getByText('Space Customer', { exact: true }).click();
  await L('Credit limit (₹)').fill('2000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const updated = await req('GET', '/parties?role=customer');
  assert.equal(
    updated.find((p) => p.id === customer.id).creditLimit,
    '2000.00',
  );
  console.log('→ cancel reverses delivery through reason confirmation');
  await page.goto(`${B}/app/selling/invoices/${invoiceId}`);
  await page
    .getByRole('button', { name: 'Cancel invoice', exact: true })
    .click();
  await L('Reason').fill('Customer withdrew the order');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel invoice', exact: true })
    .click();
  await page.getByText('Cancelled', { exact: true }).first().waitFor();
  const cancelled = await req('GET', `/sales-invoices/${invoiceId}`);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(
    (await req('GET', `/stock-entries/${cancelled.stockEntryId}`)).status,
    'cancelled',
  );
  console.log(
    '→ submit-only approver can review credit warnings without editing',
  );
  const reviewDraft = await req('POST', '/sales-invoices', {
    customerId: customer.id,
    gstRegistrationId: reg.id,
    invoiceDate: inv.invoiceDate,
    lines: [
      {
        itemId: item.id,
        qty: '2',
        rate: '1000',
        warehouseId: stores.id,
        batchId: inv.lines[0].batchId,
      },
    ],
  });
  const role = await req('POST', '/roles', {
    name: 'Sales approver',
    permissions: [
      'selling.sales_invoice.read',
      'selling.sales_invoice.submit',
      'selling.sales_invoice.approve',
    ],
  });
  const email = `approver${Date.now()}@example.com`;
  const invitation = await req('POST', '/invitations', {
    email,
    roles: [{ roleId: role.id, entityIds: [E] }],
  });
  const reviewer = await browser.newContext();
  try {
    const signup = await reviewer.request.post(`${B}/api/auth/sign-up/email`, {
      headers: { Origin: B },
      data: { email, name: 'Approver', password: 'Sup3r-secret-pw' },
    });
    assert.ok(signup.ok(), await signup.text());
    const accept = await reviewer.request.post(`${B}/api/invitations/accept`, {
      headers: { Origin: B },
      data: { token: invitation.inviteUrl.split('/').pop() },
    });
    assert.ok(accept.ok(), await accept.text());
    const reviewPage = await reviewer.newPage();
    reviewPage.setDefaultTimeout(15000);
    await reviewPage.goto(`${B}/app/selling/invoices/${reviewDraft.id}`);
    // Entity-scoped members are automatically placed in their sole allowed entity.
    await reviewPage
      .getByText('Space Customer', { exact: false })
      .first()
      .waitFor();
    assert.equal(
      await reviewPage
        .getByRole('button', { name: 'Save draft', exact: true })
        .count(),
      0,
    );
    await reviewPage
      .getByRole('button', { name: 'Submit', exact: true })
      .click();
    await reviewPage
      .getByRole('button', { name: 'Override and submit', exact: true })
      .click();
    await reviewPage.getByText('Submitted', { exact: true }).first().waitFor();
    const approved = await req('GET', `/sales-invoices/${reviewDraft.id}`);
    assert.equal(approved.creditOverride, true);
    assert.equal(approved.status, 'submitted');
  } finally {
    await reviewer.close();
  }
  console.log('→ foreign-currency export under LUT prints its declaration');
  const foreign = await req('POST', '/parties', {
    code: 'EXPORT',
    name: 'Orbit Abroad',
    isCustomer: true,
    gstTreatment: 'overseas',
    stateCode: '96',
    addresses: [
      {
        label: 'Office',
        line1: 'Orbit Avenue',
        city: 'London',
        stateCode: '96',
        pincode: '000000',
        country: 'GB',
      },
    ],
  });
  await page.goto(`${B}/app/selling/invoices/new`);
  await L('Customer').selectOption(foreign.id);
  await L('Supply type').selectOption('export_under_lut');
  await L('Currency').selectOption('USD');
  await L('Exchange rate (₹ per 1 USD)').fill('88');
  await L('Item').fill('SELL-TI');
  await page.locator('[role=option]').first().click();
  await L('Quantity').fill('1');
  await L('Rate').fill('20');
  await L('Warehouse').selectOption(stores.id);
  await L('Batch').selectOption({ label: 'HEAT-SELL-1 · 8' });
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('link', { name: 'Print / PDF', exact: true }).click();
  await page
    .getByText('Supply meant for export under LUT without payment of IGST', {
      exact: true,
    })
    .waitFor();
  await page.getByText('LUT ARN: AD2704260000123', { exact: true }).waitFor();
  const exportedId = page.url().split('/').at(-2);
  const exported = await req('GET', `/sales-invoices/${exportedId}`);
  assert.equal(exported.currency, 'USD');
  assert.equal(exported.igst, '0.00');
  assert.equal(exported.grandTotal, '20.00');
  assert.equal(exported.lutArn, 'AD2704260000123');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${B}/app/selling/invoices`);
  await page
    .getByRole('heading', { name: 'Sales invoices', exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    'no mobile overflow',
  );
  assert.deepEqual(errors, []);
  console.log('Selling walkthrough passed.');
} finally {
  await browser.close();
}
