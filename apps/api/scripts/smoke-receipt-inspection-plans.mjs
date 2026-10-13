// Receipt inspection plans (decision 052): a purchase receipt of an item with an active incoming plan is inspected
// against it — draft record per quantity, every planned sample with a calibrated gauge, accepted stock to stores, an
// NCR (MRB) for the rejected quantity with return to vendor, and the 1b inspection row kept in step. Items without a
// plan and customer-owned material keep the quick form; drafts can be withdrawn and go with a cancelled receipt.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-receipt-inspection-plans.mjs
import assert from 'node:assert/strict';
import { Dec } from '../../../packages/core/dist/index.js';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Receipt plans');
const fail = async (method, path, body, status, label, pattern) => {
  const r = await c.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const eq = (a, b, label) => {
  assert.equal(Dec.of(a).toString(), Dec.of(b).toString(), `${label}: ${a} ≠ ${b}`);
  c.checks++;
  ok(label);
};
const qtyIn = async (itemId, warehouseId) => {
  const r = await c.req('GET', `/stock/balance?itemId=${itemId}&warehouseId=${warehouseId}`);
  return (r.rows ?? r).reduce((s, x) => s.add(x.qty), Dec.ZERO);
};

await c.activate();
const date = c.settings.cutoverDate;
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const bar = await c.req('POST', '/items', { code: 'SS304', name: 'SS 304 bar', type: 'raw_material', tracking: 'batch', stockUomId: u('KG'), hsnCode: '72221111', requiresIncomingInspection: true }, 201);
const bolt = await c.req('POST', '/items', { code: 'M8-BOLT', name: 'M8 bolt', type: 'raw_material', tracking: 'batch', stockUomId: u('NOS'), hsnCode: '73181500', requiresIncomingInspection: true }, 201);
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const qua = await c.req('POST', '/warehouses', { code: 'QUA', name: 'Quarantine', type: 'quarantine' }, 201);
const sup = await c.req('POST', '/parties', { code: 'STEELCO', name: 'Steel Co', isSupplier: true, gstin: gstin('27AAACS1234B1Z') }, 201);
const cus = await c.req('POST', '/parties', { code: 'CUST', name: 'Customer Ltd', isCustomer: true, gstin: gstin('27AAACC1234B1Z') }, 201);
const mic = await c.req('POST', '/quality/gauges', { code: 'MIC-1', description: 'Micrometer', intervalDays: 365, lastCalibrated: today }, 201);

// Incoming plan for the bar: a diameter on 2 samples and a visual check on every piece (capped at whole units).
const plan = await c.req('POST', '/quality/plans', {
  itemId: bar.id,
  stage: 'incoming',
  revision: 'A',
  characteristics: [
    { balloon: '1', description: 'Diameter Ø20', kind: 'dimension', nominal: '20', lowerLimit: '19.9', upperLimit: '20.1', unit: 'mm', sampleSize: 2 },
    { balloon: '2', description: 'Surface free of cracks', kind: 'visual', sampleSize: 1 },
  ],
}, 201);
await c.req('POST', `/quality/plans/${plan.id}/activate`, {}, 201);
ok('incoming plan rev A active for the bar');

// A purchase receipt into quarantine, invoiced so that return to vendor can find the lot's invoice.
const po = await c.req('POST', '/purchase-orders', { supplierId: sup.id, orderDate: date, lines: [{ itemId: bar.id, qty: '10', rate: '300', gstRate: '18' }, { itemId: bolt.id, qty: '100', rate: '5', gstRate: '18' }] }, 201);
await c.req('POST', `/purchase-orders/${po.id}/submit`, {}, 201);
const poLines = (await c.req('GET', `/purchase-orders/${po.id}`)).lines;
const grn = await c.req('POST', '/stock-entries', {
  purpose: 'receipt',
  postingDate: date,
  partyId: sup.id,
  purchaseOrderId: po.id,
  lines: [
    { itemId: bar.id, qty: '10', toWarehouseId: qua.id, newBatchNo: 'HT-1', poLineId: poLines.find((l) => l.itemId === bar.id).id },
    { itemId: bolt.id, qty: '100', toWarehouseId: qua.id, newBatchNo: 'BL-1', poLineId: poLines.find((l) => l.itemId === bolt.id).id },
  ],
}, 201);
await c.req('POST', `/stock-entries/${grn.id}/submit`, {}, 201);
const pinv = await c.req('POST', '/purchase-invoices', {
  supplierId: sup.id,
  purchaseOrderId: po.id,
  supplierInvoiceNo: 'SC-1',
  supplierInvoiceDate: date,
  postingDate: date,
  lines: poLines.map((l) => ({ itemId: l.itemId, poLineId: l.id, qty: l.qty, rate: l.rate, gstRate: '18' })),
}, 201);
await c.req('POST', `/purchase-invoices/${pinv.id}/submit`, {}, 201);

let pending = await c.req('GET', '/inspections/pending');
const barLine = pending.find((p) => p.itemId === bar.id);
const boltLine = pending.find((p) => p.itemId === bolt.id);
assert.equal(barLine.planRevision, 'A');
assert.equal(boltLine.planRevision, null);
eq(barLine.pending, '10', 'the pending list shows the bar with plan rev A and 10 kg waiting');

// The quick form is refused for a planned item; it still works for an item without a plan.
await fail('POST', '/inspections', { receiptLineId: barLine.receiptLineId, inspectionDate: today, qtyAccepted: '10', qtyRejected: '0' }, 400, 'the quick form is refused when an incoming plan is active', /incoming inspection plan/);
await c.req('POST', '/inspections', { receiptLineId: boltLine.receiptLineId, inspectionDate: today, qtyAccepted: '100', qtyRejected: '0' }, 201);
eq(await qtyIn(bolt.id, sto.id), '100', 'an item without a plan keeps the quick accept/reject form');

// Opening plan inspections: quantity is reserved against the line.
await fail('POST', '/quality/inspections/receipt', { receiptLineId: boltLine.receiptLineId, qty: '1' }, 400, 'no plan, no plan inspection', /no active incoming inspection plan|waiting/);
await fail('POST', '/quality/inspections/receipt', { receiptLineId: barLine.receiptLineId, qty: '11' }, 400, 'cannot open more than is waiting', /Only 10\.000/);
let rec = await c.req('POST', '/quality/inspections/receipt', { receiptLineId: barLine.receiptLineId, qty: '6' }, 201);
assert.equal(rec.status, 'draft');
assert.equal(rec.stage, 'incoming');
assert.equal(rec.plan.revision, 'A');
assert.equal(rec.receipt.number, grn.number ?? rec.receipt.number);
assert.equal(rec.acceptWarehouse, 'Stores');
ok('a draft incoming inspection for 6 kg opens against plan rev A, from the receipt');
pending = await c.req('GET', '/inspections/pending');
eq(pending.find((p) => p.itemId === bar.id).inProgress, '6', 'the pending list shows 6 kg in progress');
eq(pending.find((p) => p.itemId === bar.id).pending, '4', 'and 4 kg still waiting');
await fail('POST', '/quality/inspections/receipt', { receiptLineId: barLine.receiptLineId, qty: '5' }, 400, 'the open draft reserves its quantity', /Only 4\.000/);

// A second draft is withdrawn: nothing moved, the quantity is free again.
const spare = await c.req('POST', '/quality/inspections/receipt', { receiptLineId: barLine.receiptLineId, qty: '4' }, 201);
await c.req('POST', `/quality/inspections/${spare.id}/cancel`, { reason: 'Opened twice by mistake' }, 201);
pending = await c.req('GET', '/inspections/pending');
eq(pending.find((p) => p.itemId === bar.id).pending, '4', 'a withdrawn draft frees its quantity');
eq(await qtyIn(bar.id, qua.id), '10', 'nothing left quarantine');

// Results: every planned sample is needed before submit.
const [dia, crack] = rec.characteristics;
await c.req('POST', `/quality/inspections/${rec.id}/results`, { results: [{ characteristicId: dia.id, sampleNo: 1, measured: '20.02', gaugeId: mic.id }] }, 201);
await fail('POST', `/quality/inspections/${rec.id}/submit`, { qtyAccepted: '6', qtyRejected: '0' }, 400, 'submit needs every planned sample', /1 of 2 samples/);
rec = await c.req('POST', `/quality/inspections/${rec.id}/results`, {
  results: [
    { characteristicId: dia.id, sampleNo: 2, measured: '20.25', gaugeId: mic.id },
    { characteristicId: crack.id, sampleNo: 1, pass: true },
  ],
}, 201);
assert.equal(rec.results.find((r) => r.characteristicId === dia.id && r.sampleNo === 2).pass, false);
ok('a diameter outside the limits is recorded as failing');
await fail('POST', `/quality/inspections/${rec.id}/submit`, { qtyAccepted: '6', qtyRejected: '0' }, 400, 'a failed characteristic cannot be accepted in full', /reject the nonconforming/);
await fail('POST', `/quality/inspections/${rec.id}/submit`, { qtyAccepted: '4', qtyRejected: '2' }, 400, 'rejecting needs the nonconformance described', /Describe the nonconformance/);
rec = await c.req('POST', `/quality/inspections/${rec.id}/submit`, { qtyAccepted: '4', qtyRejected: '2', ncrDescription: 'Diameter 20.25 mm, over the 20.1 limit' }, 201);
assert.equal(rec.status, 'submitted');
assert.equal(rec.outcome, 'partial');
assert.ok(rec.ncr?.number);
ok(`submitted: 4 kg accepted, 2 kg rejected with NCR ${rec.ncr.number}`);
const mrb = (await c.req('GET', '/warehouses')).find((w) => w.type === 'mrb');
eq(await qtyIn(bar.id, sto.id), '4', 'accepted stock moved to stores');
eq(await qtyIn(bar.id, mrb.id), '2', 'rejected stock is held in MRB under the NCR');
eq(await qtyIn(bar.id, qua.id), '4', 'the uninspected 4 kg stays in quarantine');

// The 1b inspection row keeps receipts, lists and guards in step.
const list = await c.req('GET', '/inspections');
const qi = list.find((x) => x.itemCode === 'SS304');
assert.ok(qi, 'the incoming inspection list shows the plan inspection');
assert.equal(qi.status, 'submitted');
assert.equal(qi.result, 'partial');
eq(qi.qtyAccepted, '4', '1b row: 4 accepted');
eq(qi.qtyRejected, '2', '1b row: 2 rejected');
assert.match(qi.checks, new RegExp(rec.number));
ok('the 1b row names the inspection record');
pending = await c.req('GET', '/inspections/pending');
eq(pending.find((p) => p.itemId === bar.id).pending, '4', 'receipt pending is 10 − 6 inspected = 4');
await fail('POST', `/inspections/${qi.id}/cancel`, { reason: 'Try to undo the plan inspection' }, 409, 'a submitted plan inspection stands (corrections go through its NCR)', /NCR|recorded against a plan/);
await fail('POST', `/quality/inspections/${rec.id}/cancel`, { reason: 'Try to cancel it' }, 409, 'the record itself cannot be cancelled either', /already submitted|stands/);

// Return to vendor from the NCR opens a supplier return claim at the invoice rate.
let n = await c.req('POST', `/quality/ncrs/${rec.ncr.id}/dispositions`, { lines: [{ kind: 'return_to_vendor', qty: '2' }] }, 201);
n = await c.req('POST', `/quality/ncrs/${rec.ncr.id}/approve`, {}, 201);
const claim = await c.req('GET', `/buying/return-claims/${n.dispositions[0].returnClaimId}`);
eq(claim.lines[0].qty, '2', 'return to vendor opened a supplier return claim for 2 kg');
eq(claim.lines[0].taxableAmount, '600', 'at the invoice rate (2 × ₹300)');

// Customer-owned material keeps the quick form even with a plan.
const own = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: date, ownerPartyId: cus.id, lines: [{ itemId: bar.id, qty: '3', toWarehouseId: qua.id, newBatchNo: 'CUST-1' }] }, 201);
await c.req('POST', `/stock-entries/${own.id}/submit`, {}, 201);
pending = await c.req('GET', '/inspections/pending');
const ownLine = pending.find((p) => p.itemId === bar.id && p.ownerName === 'Customer Ltd');
assert.equal(ownLine.planRevision, null);
await fail('POST', '/quality/inspections/receipt', { receiptLineId: ownLine.receiptLineId, qty: '3' }, 400, 'customer-owned material is not inspected against the plan', /Customer-owned/);
await c.req('POST', '/inspections', { receiptLineId: ownLine.receiptLineId, inspectionDate: today, qtyAccepted: '3', qtyRejected: '0' }, 201);
ok('customer-owned material keeps the quick form');

// A receipt cancelled while a draft is open withdraws the draft.
const grn2 = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: date, partyId: sup.id, lines: [{ itemId: bar.id, qty: '5', toWarehouseId: qua.id, newBatchNo: 'HT-2', rate: '300' }] }, 201);
await c.req('POST', `/stock-entries/${grn2.id}/submit`, {}, 201);
pending = await c.req('GET', '/inspections/pending');
const l2 = pending.find((p) => p.receiptId === grn2.id);
const d2 = await c.req('POST', '/quality/inspections/receipt', { receiptLineId: l2.receiptLineId, qty: '5' }, 201);
await c.req('POST', `/stock-entries/${grn2.id}/cancel`, { reason: 'Wrong supplier challan' }, 201);
const after = await c.req('GET', `/quality/inspections/${d2.id}`);
assert.equal(after.status, 'cancelled');
ok('cancelling the receipt withdraws its open draft');

// A receipt without a purchase order that has been inspected cannot be cancelled until its inspection is (plan and quick form).
const grn3 = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: date, partyId: sup.id, lines: [{ itemId: bar.id, qty: '2', toWarehouseId: qua.id, newBatchNo: 'HT-3', rate: '300' }] }, 201);
await c.req('POST', `/stock-entries/${grn3.id}/submit`, {}, 201);
pending = await c.req('GET', '/inspections/pending');
const l3 = pending.find((p) => p.receiptId === grn3.id);
let r3 = await c.req('POST', '/quality/inspections/receipt', { receiptLineId: l3.receiptLineId, qty: '2' }, 201);
await c.req('POST', `/quality/inspections/${r3.id}/results`, { results: [{ characteristicId: dia.id, sampleNo: 1, measured: '20.01', gaugeId: mic.id }, { characteristicId: dia.id, sampleNo: 2, measured: '20.03', gaugeId: mic.id }, { characteristicId: crack.id, sampleNo: 1, pass: true }] }, 201);
r3 = await c.req('POST', `/quality/inspections/${r3.id}/submit`, { qtyAccepted: '2', qtyRejected: '0' }, 201);
await fail('POST', `/stock-entries/${grn3.id}/cancel`, { reason: 'Wrong challan' }, 409, 'a receipt without a PO, plan-inspected, is not cancelled', /has been inspected/);
await fail('POST', `/stock-entries/${own.id}/cancel`, { reason: 'Wrong challan' }, 409, 'nor one inspected with the quick form', /has been inspected/);
ok('receipts without a purchase order keep the inspected check on cancel');

console.log(`\nReceipt inspection plans smoke passed (${c.checks} request checks).`);
