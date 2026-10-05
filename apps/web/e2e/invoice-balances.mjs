import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { Client, gstin } from '../../api/scripts/accounting-test-helpers.mjs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const c = new Client(); c.origin = B;
await c.init('Invoice balance browser');
const customer = await c.req('POST', '/parties', { code: 'CUS', name: 'Balance customer', isCustomer: true, gstTreatment: 'unregistered', stateCode: '27' }, 201);
const supplier = await c.req('POST', '/parties', { code: 'SUP', name: 'Balance supplier', isSupplier: true, gstTreatment: 'unregistered', stateCode: '27' }, 201);
const reg = await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
const uom = (await c.req('GET', '/uoms')).find(u => u.code === 'NOS');
await c.req('POST', '/hsn-codes', { code: '9983', kind: 'sac', description: 'Balance services', gstRate: '0', effectiveFrom: '2025-04-01' }, 201);
const item = await c.req('POST', '/items', { code: 'SVC', name: 'Balance service', type: 'service', stockUomId: uom.id, hsnCode: '9983' }, 201);
await c.activate();
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext();
await context.addCookies(c.cookie.split('; ').map(cookie => { const i = cookie.indexOf('='); return { name: cookie.slice(0,i), value: cookie.slice(i+1), url: B }; }));
await context.addInitScript(({ tenantId, entityId }) => { localStorage.setItem('fos.tenant', tenantId); localStorage.setItem(`fos.entity.${tenantId}`, entityId); }, { tenantId: c.tenantId, entityId: c.entityId });
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(15000);
page.on('pageerror', e => errors.push(e.message));
try {
  for (const type of ['purchase', 'sales']) {
    const input = type === 'purchase' ? { supplierId: supplier.id, gstRegistrationId: reg.id, supplierInvoiceNo: 'BALANCE-100', supplierInvoiceDate: c.settings.cutoverDate, postingDate: c.settings.cutoverDate } : { customerId: customer.id, gstRegistrationId: reg.id, invoiceDate: c.settings.cutoverDate, placeOfSupplyStateCode: '27' };
    const invoice = await c.req('POST', `/${type}-invoices`, { ...input, lines: [{ itemId: item.id, qty: '1', rate: '100', gstRate: '0' }] }, 201);
    await c.req('POST', `/${type}-invoices/${invoice.id}/submit`, {}, 201);
    await page.goto(`${B}/app/${type === 'purchase' ? 'buying' : 'selling'}/invoices/${invoice.id}`);
    await page.getByText(/Remaining bill balance:.*INR 100\.000000/).waitFor();
    await page.getByRole('button', { name: 'Cancel invoice', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('Reverse balance browser invoice');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel invoice', exact: true }).click();
    await page.getByText(/Remaining bill balance:.*INR 0\.000000/).waitFor();
  }
  assert.deepEqual(errors, []);
  console.log('PASS active sales/purchase balances and cancellation refresh without reload');
} catch (error) {
  await page.screenshot({ path: '/tmp/shared-invoice-balances-failure.png', fullPage: true });
  throw error;
} finally { await browser.close(); }
