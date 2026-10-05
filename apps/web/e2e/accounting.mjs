import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const B = process.env.WEB_URL ?? 'http://localhost:3001';
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
);
const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  }),
  page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const L = (t) => page.getByLabel(t, { exact: true });
try {
  console.log('→ onboard accounting tenant');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Finance Lead');
  await L('Work email').fill(`acct${Date.now()}@example.com`);
  await L('Password').fill('Sup3r-secret-pw');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding');
  await L('Workspace (company group) name').fill('GL Browser');
  await L('Legal name').fill('GL Private Limited');
  await L('Short name').fill('GL Browser');
  await L('Code').fill('GL');
  await L('PAN').fill('AAACA1234B');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL('**/app');
  await page.goto(`${B}/app/accounts/setup`);
  await page.getByText('Choose a legal entity', { exact: true }).waitFor();
  await page
    .locator('main')
    .getByRole('button', { name: 'GL Browser', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Save opening worksheet', exact: true })
    .waitFor();
  await page.goto(`${B}/app/accounts/trial-balance`);
  await page
    .getByText(
      'Accounting inactive. These books exclude operational transactions and have no reconciled opening balances.',
      { exact: true },
    )
    .waitFor();
  await page.goto(`${B}/app/accounts/setup`);
  await page
    .getByRole('button', { name: 'Save opening worksheet', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Review reconciliation', exact: true })
    .click();
  await page.getByText('Ready to activate', { exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'Activate accounting', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm cut-over', exact: true })
    .click();
  await page.getByText('Accounting active', { exact: true }).waitFor();
  console.log('→ chart and exact journal lifecycle');
  await page
    .getByRole('link', { name: 'Chart of accounts', exact: true })
    .first()
    .click();
  await page.getByText('Cash-in-Hand', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'New group', exact: true }).click();
  await L('Group name').fill('Workshop assets');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await page.getByText('Workshop assets', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'New ledger', exact: true }).click();
  await L('Ledger code').fill('TOOLS');
  await L('Ledger name').fill('Workshop tools');
  await L('Account group').selectOption({ label: 'Workshop assets · asset' });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Edit ledger Workshop tools', exact: true })
    .click();
  await L('Ledger name').fill('Workshop equipment');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await page.getByText('Workshop equipment', { exact: true }).waitFor();
  await page
    .getByRole('link', { name: 'Journals', exact: true })
    .first()
    .click();
  await page.getByRole('link', { name: 'New journal', exact: true }).click();
  await L('Narration').fill('Owner invests cash');
  await L('Account 1').selectOption({ label: 'CASH · Cash' });
  await L('Debit 1').fill('100.000001');
  await L('Account 2').selectOption({ label: 'EQUITY · Opening capital' });
  await L('Credit 2').fill('100.000001');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.waitForURL(/\/accounts\/journals\/[a-f0-9-]+$/);
  await page
    .getByRole('button', { name: 'Submit journal', exact: true })
    .click();
  await page.getByText('submitted', { exact: true }).waitFor();
  const journalUrl = page.url();
  await page
    .getByRole('link', { name: 'Trial balance', exact: true })
    .first()
    .click();
  await page.getByRole('link', { name: 'Cash', exact: true }).click();
  await page.getByRole('link', { name: /GL\/JV\/.*00001/ }).click();
  await page.waitForURL(journalUrl);
  assert.equal(page.url(), journalUrl);
  await page
    .getByRole('button', { name: 'Cancel journal', exact: true })
    .click();
  await L('Cancellation reason').fill('Reverse opening test investment');
  await page
    .getByRole('button', { name: 'Confirm cancellation', exact: true })
    .click();
  await page.getByText('cancelled', { exact: true }).waitFor();
  await page.getByRole('link', { name: /View reversal/ }).waitFor();
  console.log('→ day book, export and mobile');
  await page
    .getByRole('link', { name: 'Day book', exact: true })
    .first()
    .click();
  await page.getByText('Reversal of', { exact: false }).waitFor();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  await download;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${B}/app/accounts/trial-balance`);
  await page
    .getByRole('heading', { name: 'Trial balance', exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  console.log('→ scoped read-only finance access');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const tenantId = me.tenants[0].id;
  const hdr = { Origin: B, 'x-tenant-id': tenantId };
  const entities = await (
    await ctx.request.get(`${B}/api/entities`, { headers: hdr })
  ).json();
  const entityId = entities[0].id;
  const scope = { ...hdr, 'x-entity-id': entityId };
  const req = async (path, data) => {
    const r = await ctx.request.post(`${B}/api${path}`, {
      headers: scope,
      data,
    });
    assert.ok(r.ok(), await r.text());
    return r.json();
  };
  const role = await req('/roles', {
    name: 'Finance viewer',
    permissions: [
      'accounts.voucher.read',
      'accounts.account.read',
      'accounts.setup.read',
      'accounts.report.read',
    ],
  });
  const email = `glviewer${Date.now()}@example.com`;
  const invitation = await req('/invitations', {
    email,
    roles: [{ roleId: role.id, entityIds: [entityId] }],
  });
  const viewer = await browser.newContext();
  try {
    const signup = await viewer.request.post(`${B}/api/auth/sign-up/email`, {
      headers: { Origin: B },
      data: { name: 'Finance viewer', email, password: 'Sup3r-secret-pw' },
    });
    assert.ok(signup.ok(), await signup.text());
    const accept = await viewer.request.post(`${B}/api/invitations/accept`, {
      headers: { Origin: B },
      data: { token: invitation.inviteUrl.split('/').pop() },
    });
    assert.ok(accept.ok(), await accept.text());
    const vp = await viewer.newPage();
    vp.setDefaultTimeout(15000);
    vp.on('pageerror', (e) => errors.push(e.message));
    await vp.goto(journalUrl);
    await vp
      .getByText('Owner invests cash', { exact: false })
      .first()
      .waitFor();
    for (const name of ['Save draft', 'Submit journal', 'Cancel journal'])
      assert.equal(
        await vp.getByRole('button', { name, exact: true }).count(),
        0,
      );
    await vp.goto(`${B}/app/accounts/trial-balance`);
    await vp.getByText('Trial balance totals', { exact: true }).waitFor();
    assert.equal(
      await vp
        .getByRole('button', { name: 'Export JSON', exact: true })
        .count(),
      0,
    );
    for (const path of [
      '/accounts/journals',
      '/accounts/opening/activate',
      '/accounts/reports/trial-balance/export',
    ]) {
      const res = path.endsWith('/export')
        ? await viewer.request.get(`${B}/api${path}`, { headers: scope })
        : await viewer.request.post(`${B}/api${path}`, {
            headers: scope,
            data: {},
          });
      assert.equal(res.status(), 403, path);
    }
    const other = await req('/entities', {
      legalName: 'Other entity',
      shortName: 'Other',
      code: 'OTH',
      pan: 'AAACB1234B',
    });
    const cross = await viewer.request.get(
      `${B}/api/accounts/reports/trial-balance`,
      { headers: { ...scope, 'x-entity-id': other.id } },
    );
    assert.equal(cross.status(), 403);
  } finally {
    await viewer.close();
  }
  console.log('→ active receipt source links');
  await page.setViewportSize({ width: 1400, height: 900 });
  await req('/warehouses/standard', {});
  const read = async (path) => {
    const r = await ctx.request.get(`${B}/api${path}`, { headers: scope });
    assert.ok(r.ok(), await r.text());
    return r.json();
  };
  const uoms = await read('/uoms'),
    wh = (await read('/warehouses')).find((w) => w.code === 'STORES');
  const item = await req('/items', {
    code: 'GL-METAL',
    name: 'Accounting metal',
    type: 'raw_material',
    stockUomId: uoms.find((u) => u.code === 'NOS').id,
  });
  const date = (await read('/accounts/settings')).cutoverDate;
  const receipt = await req('/stock-entries', {
    purpose: 'receipt',
    postingDate: date,
    reference: 'Accounting browser receipt',
    lines: [
      { itemId: item.id, qty: '2', rate: '1.250001', toWarehouseId: wh.id },
    ],
  });
  await req(`/stock-entries/${receipt.id}/submit`, {});
  await page.goto(`${B}/app/inventory/entries/${receipt.id}`);
  await page.getByText('Accounting vouchers', { exact: true }).waitFor();
  await page.getByRole('link', { name: /GL\/JV\/.* · submitted/ }).click();
  await page.getByRole('link', { name: /source document/i }).waitFor();
  const tb = await read('/accounts/reports/trial-balance');
  assert.equal(tb.debit, '2.500002');
  assert.equal(tb.credit, '2.500002');
  assert.deepEqual(errors, []);
  console.log('Accounting walkthrough passed.');
} finally {
  await browser.close();
}
