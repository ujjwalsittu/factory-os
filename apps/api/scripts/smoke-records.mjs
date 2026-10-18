// Record pages, Related chain and record search (decision 070), end to end through the API:
//   - item and party overviews: the sections present with their rows, absent without the permission;
//   - the Related chain both ways for quotation, order, invoice, purchase order, receipt and purchase invoice;
//   - record search: documents by number (exact first), items, parties, batches; permission filtering, limit, input rules;
//   - the Accounting panel read for a receipt/payment;
//   - a second workspace sees nothing of the first.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-records.mjs   (DATABASE_URL from the env or ../../.env)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { Client, gstin } from './accounting-test-helpers.mjs';

const dbUrl = process.env.DATABASE_URL ?? fs.readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1];
const psql = (q) => execFileSync('psql', [dbUrl, '-qtAc', q]).toString().trim();

let checks = 0;
const ok = (label) => (checks++, console.log(`✓ ${label}`));
const c = await new Client().init('Records');
await c.activate();
const date = c.settings.cutoverDate;
const registration = await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/hsn-codes', { code: '8108', kind: 'hsn', description: 'Titanium', gstRate: '18', effectiveFrom: '2025-04-01' }, 201);
const nos = (await c.req('GET', '/uoms')).find((u) => u.code === 'NOS').id;
await c.req('POST', '/warehouses/standard', {}, 201);
const wh = (await c.req('GET', '/warehouses')).find((w) => w.code === 'STORES').id;
const supplier = await c.req('POST', '/parties', { code: 'SUPR', name: 'Record Supplier', isSupplier: true, gstin: gstin('27AAACB1234B1Z') }, 201);
const customer = await c.req('POST', '/parties', { code: 'CUSR', name: 'Record Customer', isCustomer: true, gstin: gstin('27AAACC1234B1Z'), addresses: [{ label: 'Works', line1: 'Test Road', city: 'Pune', stateCode: '27', pincode: '411001' }] }, 201);
const rod = await c.req('POST', '/items', { code: 'ROD-REC', name: 'Titanium rod', type: 'raw_material', tracking: 'batch', stockUomId: nos, hsnCode: '8108' }, 201);
const press = await c.req('POST', '/items', { code: 'PRESS-REC', name: 'Hydraulic press', type: 'asset', stockUomId: nos, hsnCode: '8108' }, 201);

// ── A purchase chain: order → receipt → invoice ──
const po = await c.req('POST', '/purchase-orders', { supplierId: supplier.id, gstRegistrationId: registration.id, orderDate: date, lines: [{ itemId: rod.id, qty: '10', rate: '10' }] }, 201);
await c.req('POST', `/purchase-orders/${po.id}/submit`, {}, 201);
const poNumber = (await c.req('GET', `/purchase-orders/${po.id}`)).number;
const openBefore = await c.req('GET', `/items/${rod.id}/overview`);
assert.ok(openBefore.sections.find((s) => s.id === 'open-po')?.rows.some((r) => r.id === po.id), 'the open order is listed on the item');
ok('an item page lists its open purchase order before anything is received');

const poLineId = (await c.req('GET', `/purchase-orders/${po.id}`)).lines[0].id;
const receipt = await c.req('POST', '/stock-entries', { postingDate: date, purpose: 'receipt', purchaseOrderId: po.id, partyId: supplier.id, lines: [{ itemId: rod.id, qty: '10', rate: '10', toWarehouseId: wh, poLineId, newBatchNo: 'HEAT-R1' }] }, 201);
await c.req('POST', `/stock-entries/${receipt.id}/submit`, {}, 201);
const bill = await c.req('POST', '/purchase-invoices', { supplierId: supplier.id, purchaseOrderId: po.id, gstRegistrationId: registration.id, supplierInvoiceNo: 'REC-B1', supplierInvoiceDate: date, postingDate: date, itcEligible: true, lines: [{ itemId: rod.id, poLineId, qty: '10', rate: '10' }] }, 201);
await c.req('POST', `/purchase-invoices/${bill.id}/submit`, {}, 201);
const billNumber = (await c.req('GET', `/purchase-invoices/${bill.id}`)).number;
const assetBill = await c.req('POST', '/purchase-invoices', { supplierId: supplier.id, gstRegistrationId: registration.id, supplierInvoiceNo: 'REC-A1', supplierInvoiceDate: date, postingDate: date, itcEligible: true, lines: [{ itemId: press.id, qty: '1', rate: '5000' }] }, 201);
await c.req('POST', `/purchase-invoices/${assetBill.id}/submit`, {}, 201);

const item = await c.req('GET', `/items/${rod.id}/overview`);
const sec = (o, id) => o.sections.find((s) => s.id === id);
assert.equal(item.needsEntity, false);
assert.ok(sec(item, 'stock').rows.some((r) => r.detail.includes('HEAT-R1')), 'stock by batch');
assert.ok(sec(item, 'movements').rows.length >= 1, 'recent movements');
assert.equal(sec(item, 'open-po'), undefined, 'a fully received order is no longer open');
ok('the item page shows stock by batch and recent movements, and drops the order once received');
const assetPage = await c.req('GET', `/items/${press.id}/overview`);
assert.ok(sec(assetPage, 'asset-invoices').rows.length === 1, 'an asset lists its purchase invoices');
ok('an asset page lists the purchase invoices it appears on');

const sup = await c.req('GET', `/parties/${supplier.id}/overview`);
for (const id of ['purchase-orders', 'receipts', 'purchase-invoices']) assert.ok(sec(sup, id)?.rows.length, `supplier section ${id}`);
assert.equal(sec(sup, 'quotations'), undefined, 'a supplier has no customer sections');
assert.equal(sup.outstandingHref, '/app/accounts/outstanding');
ok('a supplier page shows orders, receipts and invoices, and links to Outstanding');

// ── Related chain ──
const rel = (type, id) => c.req('GET', `/related/${type}/${id}`);
const has = (r, section, id) => r.sections.find((s) => s.id === section)?.rows.some((x) => x.id === id);
const relPo = await rel('purchase_order', po.id);
assert.ok(has(relPo, 'stock_entry', receipt.id) && has(relPo, 'purchase_invoice', bill.id), 'order → receipt and invoice');
const relReceipt = await rel('stock_entry', receipt.id);
assert.ok(has(relReceipt, 'purchase_order', po.id) && has(relReceipt, 'purchase_invoice', bill.id), 'receipt → order and invoice');
const relBill = await rel('purchase_invoice', bill.id);
assert.ok(has(relBill, 'purchase_order', po.id), 'invoice → order');
assert.equal(relPo.sections.find((s) => s.id === 'stock_entry').rows[0].href, `/app/inventory/entries/${receipt.id}`);
ok('purchase chain: order, receipt and invoice link both ways');

// ── A sales chain: quotation → order → invoice ──
const stockUp = await c.req('POST', '/stock-entries', { postingDate: date, purpose: 'receipt', lines: [{ itemId: rod.id, qty: '5', rate: '10', toWarehouseId: wh, newBatchNo: 'HEAT-R2' }] }, 201);
await c.req('POST', `/stock-entries/${stockUp.id}/submit`, {}, 201);
const batch2 = (await c.req('GET', `/batches?itemId=${rod.id}`)).find((b) => b.batchNo === 'HEAT-R2');
const q = await c.req('POST', '/quotations', { customerId: customer.id, gstRegistrationId: registration.id, quotationDate: date, lines: [{ itemId: rod.id, qty: '2', rate: '20' }] }, 201);
await c.req('POST', `/quotations/${q.id}/submit`, {}, 201);
const order = await c.req('POST', `/quotations/${q.id}/order`, {}, 201);
await c.req('POST', `/sales-orders/${order.id}/submit`, {}, 201);
const soLine = (await c.req('GET', `/sales-orders/${order.id}`)).lines[0].id;
const inv = await c.req('POST', '/sales-invoices', { customerId: customer.id, gstRegistrationId: registration.id, invoiceDate: date, salesOrderId: order.id, lines: [{ itemId: rod.id, qty: '2', rate: '20', soLineId: soLine, warehouseId: wh, batchId: batch2.id }] }, 201);
await c.req('POST', `/sales-invoices/${inv.id}/submit`, {}, 201);
const relQ = await rel('quotation', q.id);
assert.ok(has(relQ, 'sales_order', order.id) && has(relQ, 'sales_invoice', inv.id), 'quotation → order and invoice');
const relSo = await rel('sales_order', order.id);
assert.ok(has(relSo, 'quotation', q.id) && has(relSo, 'sales_invoice', inv.id), 'order → quotation and invoice');
const relInv = await rel('sales_invoice', inv.id);
assert.ok(has(relInv, 'sales_order', order.id) && has(relInv, 'quotation', q.id), 'invoice → order and quotation');
const cus = await c.req('GET', `/parties/${customer.id}/overview`);
for (const id of ['quotations', 'sales-orders', 'sales-invoices']) assert.ok(sec(cus, id)?.rows.length, `customer section ${id}`);
ok('sales chain: quotation, order and invoice link both ways; the customer page lists them');
await fail('GET', `/related/not_a_type/${inv.id}`, 400, 'an unknown document type is refused');

// ── Receipts and payments reach the invoice and the Accounting panel ──
const bank = c.accounts.find((a) => a.role === 'bank').id;
const pay = await c.req('POST', '/accounts/settlements', { direction: 'payment', partyId: supplier.id, postingDate: date, accountId: bank, amount: '50', allocations: [] }, 201);
await c.req('POST', `/accounts/settlements/${pay.id}/submit`, {}, 200);
const status = await c.req('GET', `/accounts/source-status?sourceType=settlement&sourceId=${pay.id}`);
assert.equal(status.state, 'posted');
assert.ok(status.vouchers.length >= 1, 'the settlement voucher is listed');
ok('the Accounting panel read works for a receipt or payment');
// A payment allocated to the invoice shows on the invoice's chain.
const billId = psql(`select id from trade_bill where entity_id = '${c.entityId}' and source_type = 'purchase_invoice' and source_id = '${bill.id}'`);
assert.ok(billId, 'the invoice created a payable bill');
const pay2 = await c.req('POST', '/accounts/settlements', { direction: 'payment', partyId: supplier.id, postingDate: date, accountId: bank, amount: '20', allocations: [{ billId, amount: '20' }] }, 201);
await c.req('POST', `/accounts/settlements/${pay2.id}/submit`, {}, 200);
const relBill2 = await rel('purchase_invoice', bill.id);
assert.ok(has(relBill2, 'settlement', pay2.id), 'invoice → the payment allocated to it');
assert.ok(!has(relBill2, 'settlement', pay.id), 'an unallocated payment is not on the invoice');
ok('a payment allocated to an invoice appears on the invoice chain');
const supAfter = await c.req('GET', `/parties/${supplier.id}/overview`);
assert.ok(sec(supAfter, 'settlements')?.rows.some((r) => r.id === pay.id), 'the payment is on the supplier page');
ok('a payment appears on the supplier page');

// ── Search ──
const search = (q, who = c) => who.req('GET', `/search?q=${encodeURIComponent(q)}`);
const byPo = await search(poNumber);
assert.equal(byPo.results[0].id, po.id, 'a document number finds the document, exact match first');
assert.equal(byPo.results[0].type, 'purchase_order');
assert.equal(byPo.results[0].href, `/app/buying/orders/${po.id}`);
assert.ok((await search('rod-rec')).results.some((r) => r.type === 'item' && r.id === rod.id), 'items by code, any case');
assert.ok((await search('titanium')).results.some((r) => r.type === 'item'), 'items by name');
assert.ok((await search('Record Supp')).results.some((r) => r.type === 'party' && r.id === supplier.id), 'parties by name');
assert.ok((await search(supplier.gstin ?? gstin('27AAACB1234B1Z').slice(0, 8))).results.some((r) => r.type === 'party'), 'parties by GSTIN');
assert.ok((await search('HEAT-R1')).results.some((r) => r.type === 'batch'), 'batches by number');
assert.ok((await search(billNumber)).results.some((r) => r.type === 'purchase_invoice' && r.id === bill.id), 'invoices by number');
ok('search finds documents (exact first), items, parties and batches');
await fail('GET', '/search?q=a', 400, 'one character is refused');
assert.ok((await search('Record C')).results.some((r) => r.type === 'party'), 'sanity: a plain phrase matches the customer');
assert.deepEqual((await search('Rec%C')).results, [], 'a percent sign is a literal, not a wildcard');
assert.deepEqual((await search('Rec_rd')).results, [], 'an underscore is a literal, not a wildcard');
assert.ok((await search('rec')).results.length <= 20, 'at most 20 results');
ok('search input rules: two characters minimum, wildcards are literal, 20 results at most');

// ── A person with only item and party access ──
await new Promise((r) => setTimeout(r, 20e3));
const role = await c.req('POST', '/roles', { name: 'Masters reader', permissions: ['masters.item.read', 'masters.party.read'] }, 201);
const email = `reader-${Date.now()}@example.com`;
const inv2 = await c.req('POST', '/invitations', { email, roles: [{ roleId: role.id, entityIds: [c.entityId] }] }, 201);
const reader = new Client();
await reader.req('POST', '/auth/sign-up/email', { name: 'Masters Reader', email, password: 'Sup3r-secret-pw' });
await reader.req('POST', '/invitations/accept', { token: inv2.inviteUrl.split('/').at(-1) }, 201);
reader.tenantId = c.tenantId;
reader.entityId = c.entityId;
const rItem = await reader.req('GET', `/items/${rod.id}/overview`);
assert.deepEqual(rItem.sections, [], 'no stock, orders or movements without those permissions');
const rParty = await reader.req('GET', `/parties/${supplier.id}/overview`);
assert.deepEqual(rParty.sections, [], 'no documents on the party page without those permissions');
assert.equal(rParty.outstandingHref, null);
const rRel = await reader.req('GET', `/related/purchase_order/${po.id}`);
assert.deepEqual(rRel.sections, [], 'no related documents without read access');
const rSearch = await search('rec', reader);
assert.ok(rSearch.results.length > 0 && rSearch.results.every((r) => r.type === 'item' || r.type === 'party'), 'search returns only items and parties');
assert.equal((await search(poNumber, reader)).results.filter((r) => r.type === 'purchase_order').length, 0, 'a document number finds nothing without access');
await reader.raw('GET', `/accounts/source-status?sourceType=settlement&sourceId=${pay.id}`).then((r) => assert.equal(r.status, 403, 'the Accounting panel read needs access'));
ok('a person with only item and party access sees no documents, in pages, chains, search or the panel');

// ── Another workspace ──
const other = await new Client().init('Records Other');
const r404 = await other.raw('GET', `/items/${rod.id}/overview`);
assert.equal(r404.status, 404);
assert.equal((await other.raw('GET', `/parties/${supplier.id}/overview`)).status, 404);
assert.deepEqual((await other.req('GET', `/related/purchase_order/${po.id}`)).sections, []);
assert.deepEqual((await search('Record', other)).results, []);
ok('another workspace sees none of it');

console.log(`Records smoke: ${checks} groups, ${checks + c.checks + reader.checks + other.checks} request checks, all passing`);

async function fail(method, path, status, label) {
  const r = await c.raw(method, path);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  ok(label);
}
