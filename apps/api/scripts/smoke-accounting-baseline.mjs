import assert from 'node:assert/strict';
import { Client, gstin } from './accounting-test-helpers.mjs';
const c = await new Client().init('Opening GRNI');
const date = (await c.req('GET', '/accounts/opening/reconciliation'))
  .cutoverDate;
const uoms = await c.req('GET', '/uoms');
await c.req('POST', '/warehouses/standard', {}, 201);
const wh = (await c.req('GET', '/warehouses')).find(
  (w) => w.code === 'STORES',
).id;
await c.req(
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
    description: 'Metal',
    gstRate: '18',
    effectiveFrom: '2025-04-01',
  },
  201,
);
await c.req(
  'POST',
  '/hsn-codes',
  {
    code: '998898',
    kind: 'sac',
    description: 'Services',
    gstRate: '18',
    effectiveFrom: '2025-04-01',
  },
  201,
);
const item = await c.req(
  'POST',
  '/items',
  {
    code: 'BASE',
    name: 'Baseline metal',
    type: 'raw_material',
    stockUomId: uoms.find((u) => u.code === 'NOS').id,
    hsnCode: '8108',
  },
  201,
);
const service = await c.req(
  'POST',
  '/items',
  {
    code: 'SERV',
    name: 'Technical service',
    type: 'service',
    isStockItem: false,
    stockUomId: uoms.find((u) => u.code === 'NOS').id,
    hsnCode: '998898',
  },
  201,
);
const supplier = await c.req(
  'POST',
  '/parties',
  {
    code: 'SUP',
    name: 'Opening supplier',
    isSupplier: true,
    gstin: gstin('27AAACB1234B1Z'),
  },
  201,
);
const po = await c.req(
  'POST',
  '/purchase-orders',
  {
    supplierId: supplier.id,
    orderDate: date,
    lines: [{ itemId: item.id, qty: '10', rate: '10' }],
  },
  201,
);
await c.req('POST', `/purchase-orders/${po.id}/submit`, {}, 201);
const pl = (await c.req('GET', `/purchase-orders/${po.id}`)).lines[0].id;
const receipt = await c.req(
  'POST',
  '/stock-entries',
  {
    purpose: 'receipt',
    postingDate: date,
    partyId: supplier.id,
    purchaseOrderId: po.id,
    lines: [{ itemId: item.id, poLineId: pl, qty: '10', toWarehouseId: wh }],
  },
  201,
);
await c.req('POST', `/stock-entries/${receipt.id}/submit`, {}, 201);
const preview = await c.req('GET', '/accounts/opening/reconciliation');
assert.equal(preview.grniValue, '100.000000');
await c.activate(
  [c.line('inventory', '100'), c.line('grni', '0', '100')],
  preview.receiptBaselines,
);
await c.req(
  'POST',
  `/stock-entries/${receipt.id}/cancel`,
  { reason: 'Historic source cannot be cancelled' },
  409,
);
async function bill(ref, qty) {
  return c.req(
    'POST',
    '/purchase-invoices',
    {
      supplierId: supplier.id,
      purchaseOrderId: po.id,
      supplierInvoiceNo: ref,
      supplierInvoiceDate: date,
      postingDate: date,
      lines: [{ itemId: item.id, poLineId: pl, qty, rate: '10' }],
    },
    201,
  );
}
const b1 = await bill('BASE-1', '6'),
  b2 = await bill('BASE-2', '6');
const race = await Promise.all([
  c.raw('POST', `/purchase-invoices/${b1.id}/submit`, {}),
  c.raw('POST', `/purchase-invoices/${b2.id}/submit`, {}),
]);
assert.deepEqual(race.map((r) => r.status).sort(), [201, 400]);
const tb = await c.req('GET', '/accounts/reports/trial-balance');
assert.equal(
  tb.accounts.find((a) => a.id === c.account('grni')).balance,
  '-40.000000',
);
assert.equal(
  tb.accounts.find((a) => a.id === c.account('inventory')).balance,
  '100.000000',
);
const svc = await c.req(
  'POST',
  '/purchase-invoices',
  {
    supplierId: supplier.id,
    supplierInvoiceNo: 'RCM-1',
    supplierInvoiceDate: date,
    postingDate: date,
    reverseCharge: true,
    lines: [{ itemId: service.id, qty: '1', rate: '100' }],
  },
  201,
);
await c.req('POST', `/purchase-invoices/${svc.id}/submit`, {}, 201);
const all = await c.req('GET', '/accounts/journals'),
  v = all.find(
    (v) => v.sourceType === 'purchase_invoice' && v.sourceId === svc.id,
  );
const detail = await c.req('GET', `/accounts/journals/${v.id}`);
assert.equal(
  detail.entries.find((e) => e.accountId === c.account('pending_cgst')).debit,
  '9.000000',
);
assert.equal(
  detail.entries.find((e) => e.accountId === c.account('rcm_cgst')).credit,
  '9.000000',
);
assert.ok(!detail.entries.some((e) => e.accountId === c.account('input_cgst')));
await c.req(
  'GET',
  '/accounts/reports/trial-balance?from=wrong',
  undefined,
  400,
);
await c.req(
  'GET',
  '/accounts/reports/trial-balance?from=2026-10-06&to=2026-10-05',
  undefined,
  400,
);
console.log(`Opening baseline and RCM checks passed (${c.checks}).`);
