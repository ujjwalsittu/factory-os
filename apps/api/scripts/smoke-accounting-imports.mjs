import assert from 'node:assert/strict';
import { Client, gstin } from './accounting-test-helpers.mjs';
const c = await new Client().init('Import GL');
await c.activate();
const date = c.settings.cutoverDate;
const reg = await c.req(
  'POST',
  `/entities/${c.entityId}/gst-registrations`,
  { gstin: gstin('27AAACA1234B1Z') },
  201,
);
await c.req('PATCH', `/gst-registrations/${reg.id}`, {
  lutArn: 'AD2704260000123',
  lutValidFrom: '2026-04-01',
  lutValidTo: '2027-03-31',
});
const uoms = await c.req('GET', '/uoms');
await c.req('POST', '/warehouses/standard', {}, 201);
const wh = (await c.req('GET', '/warehouses')).find(
  (w) => w.code === 'STORES',
).id;
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
const item = await c.req(
  'POST',
  '/items',
  {
    code: 'IMP',
    name: 'Import metal',
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
    code: 'OVER',
    name: 'Overseas supplier',
    isSupplier: true,
    gstTreatment: 'overseas',
  },
  201,
);
const po = await c.req(
  'POST',
  '/purchase-orders',
  {
    supplierId: supplier.id,
    orderDate: date,
    currency: 'USD',
    exchangeRate: '80',
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
    purchaseOrderId: po.id,
    partyId: supplier.id,
    lines: [{ itemId: item.id, qty: '10', toWarehouseId: wh, poLineId: pl }],
  },
  201,
);
await c.req('POST', `/stock-entries/${receipt.id}/submit`, {}, 201);
const bill = await c.req(
  'POST',
  '/purchase-invoices',
  {
    supplierId: supplier.id,
    purchaseOrderId: po.id,
    supplierInvoiceNo: 'USD-1',
    supplierInvoiceDate: date,
    postingDate: date,
    currency: 'USD',
    exchangeRate: '85',
    lines: [{ itemId: item.id, poLineId: pl, qty: '5', rate: '12' }],
  },
  201,
);
await c.req(
  'POST',
  `/purchase-invoices/${bill.id}/submit`,
  { acceptRateVariance: true },
  201,
);
async function voucher(type, id) {
  const all = await c.req('GET', '/accounts/journals');
  const v = all.find(
    (j) => j.sourceType === type && j.sourceId === id && j.purpose === 'main',
  );
  assert.ok(v, `Missing ${type} GL`);
  return c.req('GET', `/accounts/journals/${v.id}`);
}
const bv = await voucher('purchase_invoice', bill.id);
assert.equal(
  bv.entries.find((e) => e.accountId === c.account('forex')).debit,
  '300.000000',
);
assert.equal(
  bv.entries.find((e) => e.accountId === c.account('price_variance')).debit,
  '800.000000',
);
assert.equal(
  bv.entries.find((e) => e.accountId === c.account('grni')).debit,
  '4000.000000',
);
assert.equal(
  bv.entries.find((e) => e.accountId === c.account('creditors')).credit,
  '5100.000000',
);
const lcv = await c.req(
  'POST',
  '/landed-costs',
  {
    postingDate: date,
    boeNo: 'BOE-GL-1',
    boeDate: date,
    portCode: 'INNSA1',
    importIgst: '20',
    customsItcEligible: true,
    receiptIds: [receipt.id],
    charges: [{ chargeType: 'bcd', amount: '100', basis: 'value' }],
  },
  201,
);
await c.req('POST', `/landed-costs/${lcv.id}/submit`, {}, 201);
const lv = await voucher('landed_cost', lcv.id);
assert.equal(
  lv.entries.find((e) => e.accountId === c.account('input_igst')).debit,
  '20.000000',
);
assert.equal(
  lv.entries.find((e) => e.accountId === c.account('inventory')).debit,
  '100.000000',
);
assert.equal(
  lv.entries.find((e) => e.accountId === c.account('landed_clearing')).credit,
  '100.000000',
);
await c.req(
  'POST',
  '/accounts/journals',
  {
    postingDate: date,
    narration: 'Invalid double customs credit',
    clearingSourceId: lcv.id,
    lines: [c.line('input_igst', '20'), c.line('bank', '0', '20')],
  },
  400,
);
const clearing = await c.req(
  'POST',
  '/accounts/journals',
  {
    postingDate: date,
    narration: 'Clear landed cost accrual',
    clearingSourceId: lcv.id,
    lines: [c.line('landed_clearing', '100'), c.line('bank', '0', '100')],
  },
  201,
);
await c.req('POST', `/accounts/journals/${clearing.id}/submit`);
await c.req(
  'POST',
  `/landed-costs/${lcv.id}/cancel`,
  { reason: 'Must refuse unreversed clearing journal' },
  409,
);
await c.req('POST', `/accounts/journals/${clearing.id}/cancel`, {
  reason: 'Restore clearing accrual',
});
const customer = await c.req(
  'POST',
  '/parties',
  {
    code: 'EXP',
    name: 'Foreign customer',
    isCustomer: true,
    gstTreatment: 'overseas',
  },
  201,
);
const sale = await c.req(
  'POST',
  '/sales-invoices',
  {
    customerId: customer.id,
    invoiceDate: date,
    currency: 'USD',
    exchangeRate: '85',
    supplyType: 'export_under_lut',
    lines: [{ itemId: item.id, warehouseId: wh, qty: '2', rate: '20' }],
  },
  201,
);
await c.req('POST', `/sales-invoices/${sale.id}/submit`, {}, 201);
const sv = await voucher('sales_invoice', sale.id);
assert.equal(
  sv.entries.find((e) => e.accountId === c.account('debtors')).debit,
  '3400.000000',
);
assert.ok(!sv.entries.some((e) => e.accountId === c.account('output_igst')));
await c.req(
  'POST',
  `/landed-costs/${lcv.id}/cancel`,
  { reason: 'Cannot reverse after goods dispatch' },
  409,
);
await c.req(
  'POST',
  `/sales-invoices/${sale.id}/cancel`,
  { reason: 'Restore export stock' },
  201,
);
await c.req(
  'POST',
  `/landed-costs/${lcv.id}/cancel`,
  { reason: 'Reverse customs accrual' },
  201,
);
const blocked = await c.req(
  'POST',
  '/landed-costs',
  {
    postingDate: date,
    boeNo: 'BOE-GL-2',
    boeDate: date,
    portCode: 'INNSA1',
    importIgst: '20',
    receiptIds: [receipt.id],
    charges: [{ chargeType: 'bcd', amount: '100', basis: 'value' }],
  },
  201,
);
await c.req('POST', `/landed-costs/${blocked.id}/submit`, {}, 400);
const body = {
  postingDate: date,
  boeNo: 'BOE-GL-2',
  boeDate: date,
  portCode: 'INNSA1',
  importIgst: '20',
  customsItcEligible: false,
  receiptIds: [receipt.id],
  charges: [{ chargeType: 'bcd', amount: '100', basis: 'value' }],
};
await c.req('PUT', `/landed-costs/${blocked.id}`, body);
await c.req('POST', `/landed-costs/${blocked.id}/submit`, {}, 201);
const nv = await voucher('landed_cost', blocked.id);
assert.equal(
  nv.entries
    .filter((e) => e.accountId === c.account('inventory'))
    .reduce((s, e) => s + BigInt(e.debit.replace('.', '')), 0n),
  120000000n,
);
assert.ok(!nv.entries.some((e) => e.accountId === c.account('input_igst')));
console.log(`Import/export accounting checks passed (${c.checks}).`);
