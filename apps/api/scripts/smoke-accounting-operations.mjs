import assert from 'node:assert/strict';
import { Client, gstin } from './accounting-test-helpers.mjs';
const c = await new Client().init('Operational GL');
await c.activate();
const date = c.settings.cutoverDate;
const uoms = await c.req('GET', '/uoms');
await c.req('POST', '/warehouses/standard', {}, 201);
const warehouses = await c.req('GET', '/warehouses');
const wh = warehouses.find((w) => w.code === 'STORES').id;
const registration = await c.req(
  'POST',
  `/entities/${c.entityId}/gst-registrations`,
  { gstin: gstin('27AAACA1234B1Z') },
  201,
);
await c.req(
  'POST',
  '/hsn-codes',
  {
    code: '8108',
    kind: 'hsn',
    description: 'Titanium',
    gstRate: '18',
    effectiveFrom: '2025-04-01',
  },
  201,
);
const item = await c.req(
  'POST',
  '/items',
  {
    code: 'GL-TI',
    name: 'GL Titanium',
    type: 'raw_material',
    stockUomId: uoms.find((u) => u.code === 'NOS').id,
    hsnCode: '8108',
  },
  201,
);
const supplier = await c.req(
  'POST',
  '/parties',
  {
    code: 'SUP',
    name: 'GL Supplier',
    isSupplier: true,
    gstin: gstin('27AAACB1234B1Z'),
  },
  201,
);
const customer = await c.req(
  'POST',
  '/parties',
  {
    code: 'CUS',
    name: 'GL Customer',
    isCustomer: true,
    gstin: gstin('27AAACC1234B1Z'),
    addresses: [
      {
        label: 'Works',
        line1: 'Test Road',
        city: 'Pune',
        stateCode: '27',
        pincode: '411001',
      },
    ],
  },
  201,
);
const po = await c.req(
  'POST',
  '/purchase-orders',
  {
    supplierId: supplier.id,
    gstRegistrationId: registration.id,
    orderDate: date,
    lines: [{ itemId: item.id, qty: '10', rate: '10' }],
  },
  201,
);
await c.req('POST', `/purchase-orders/${po.id}/submit`, {}, 201);
const pod = await c.req('GET', `/purchase-orders/${po.id}`);
const poLineId = pod.lines[0].id;
async function stock(purpose, qty, rate) {
  const r = await c.req(
    'POST',
    '/stock-entries',
    {
      purpose,
      postingDate: date,
      ...(purpose === 'receipt' && {
        purchaseOrderId: po.id,
        partyId: supplier.id,
      }),
      lines: [
        {
          itemId: item.id,
          qty,
          ...(purpose === 'receipt'
            ? { rate, toWarehouseId: wh, poLineId }
            : { fromWarehouseId: wh }),
        },
      ],
    },
    201,
  );
  await c.req('POST', `/stock-entries/${r.id}/submit`, {}, 201);
  return r;
}
const receipt = await stock('receipt', '10', '10');
async function voucher(sourceType, sourceId) {
  const all = await c.req('GET', '/accounts/journals');
  const found = all.find(
    (j) =>
      j.sourceType === sourceType &&
      j.sourceId === sourceId &&
      j.purpose === 'main',
  );
  assert.ok(found, `Missing ${sourceType} GL`);
  return c.req('GET', `/accounts/journals/${found.id}`);
}
function amount(v, role, side) {
  return v.entries
    .filter((e) => e.accountId === c.account(role))
    .reduce((sum, e) => sum + BigInt(e[side].replace('.', '')), 0n)
    .toString();
}
const rv = await voucher('stock_entry', receipt.id);
assert.equal(amount(rv, 'inventory', 'debit'), '100000000');
assert.equal(amount(rv, 'grni', 'credit'), '100000000');
const issue = await stock('issue', '4');
const iv = await voucher('stock_entry', issue.id);
assert.equal(amount(iv, 'production', 'debit'), '40000000');
async function bill(number, qty, rate, itcEligible = true) {
  const b = await c.req(
    'POST',
    '/purchase-invoices',
    {
      supplierId: supplier.id,
      purchaseOrderId: po.id,
      gstRegistrationId: registration.id,
      supplierInvoiceNo: number,
      supplierInvoiceDate: date,
      postingDate: date,
      itcEligible,
      lines: [{ itemId: item.id, poLineId, qty, rate }],
    },
    201,
  );
  await c.req(
    'POST',
    `/purchase-invoices/${b.id}/submit`,
    { acceptRateVariance: true },
    201,
  );
  return b;
}
const bill1 = await bill('GL-BILL-1', '5', '12');
const b1 = await voucher('purchase_invoice', bill1.id);
assert.equal(amount(b1, 'grni', 'debit'), '50000000');
assert.equal(amount(b1, 'price_variance', 'debit'), '10000000');
assert.equal(amount(b1, 'input_cgst', 'debit'), '5400000');
assert.equal(amount(b1, 'creditors', 'credit'), '70800000');
const bill2 = await bill('GL-BILL-2', '5', '10', false);
const b2 = await voucher('purchase_invoice', bill2.id);
assert.equal(amount(b2, 'inventory', 'debit'), '5400000');
assert.equal(amount(b2, 'production', 'debit'), '3600000');
assert.equal(amount(b2, 'input_cgst', 'debit'), '0');
const balances = await c.req('GET', `/stock/balance?itemId=${item.id}`);
assert.ok(
  balances.some((b) => b.value === '65.40'),
  'tax capitalizes only remaining share',
);
await c.req(
  'POST',
  `/stock-entries/${issue.id}/cancel`,
  { reason: 'Must refuse after acquisition revaluation' },
  409,
);
const later = await stock('issue', '1');
await c.req(
  'POST',
  `/purchase-invoices/${bill2.id}/cancel`,
  { reason: 'Must refuse while stock has moved' },
  409,
);
await c.req(
  'POST',
  `/stock-entries/${later.id}/cancel`,
  { reason: 'Restore later issue' },
  201,
);
await c.req(
  'POST',
  `/purchase-invoices/${bill2.id}/cancel`,
  { reason: 'Reverse non-creditable tax allocation' },
  201,
);
const sales = await c.req(
  'POST',
  '/sales-invoices',
  {
    customerId: customer.id,
    gstRegistrationId: registration.id,
    invoiceDate: date,
    warehouseId: wh,
    lines: [{ itemId: item.id, qty: '2', rate: '20', warehouseId: wh }],
  },
  201,
);
await c.req('POST', `/sales-invoices/${sales.id}/submit`, {}, 201);
const sold = await c.req('GET', `/sales-invoices/${sales.id}`);
const revenue = await voucher('sales_invoice', sales.id);
assert.equal(amount(revenue, 'debtors', 'debit'), '47200000');
const delivery = await voucher('stock_entry', sold.stockEntryId);
assert.equal(amount(delivery, 'cogs', 'debit'), '20000000');
await c.req(
  'POST',
  `/sales-invoices/${sales.id}/cancel`,
  { reason: 'Reverse sales and delivery' },
  201,
);
assert.equal(
  (await c.req('GET', `/accounts/journals/${revenue.id}`)).reversal.entries
    .length,
  revenue.entries.length,
);
await c.req(
  'POST',
  `/purchase-invoices/${bill1.id}/cancel`,
  { reason: 'Release first billed allocation' },
  201,
);
await c.req(
  'POST',
  `/stock-entries/${issue.id}/cancel`,
  { reason: 'Restore original production issue' },
  201,
);
await c.req(
  'POST',
  `/stock-entries/${receipt.id}/cancel`,
  { reason: 'Reverse original received stock' },
  201,
);
const tb = await c.req('GET', '/accounts/reports/trial-balance');
assert.equal(tb.debit, tb.credit);
assert.ok(tb.accounts.every((a) => a.balance === '0.000000'));
console.log(`Operational accounting checks passed (${c.checks}).`);
