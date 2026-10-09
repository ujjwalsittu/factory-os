// Job work outward (decision 047): challans into an "At vendor" warehouse, receipts that consume there at exact
// FIFO value, outsourced work-order operations with an output gate, deadlines and cancellation rules.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-job-work.mjs
import assert from 'node:assert/strict';
import { Dec } from '../../../packages/core/dist/index.js';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('JobWork');
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
  ok(label);
};
const balances = async () => Object.fromEntries((await c.req('GET', '/accounts/reports/trial-balance')).accounts.filter((a) => a.role).map((a) => [a.role, a.balance]));
const bins = async (itemId, warehouseId) => c.req('GET', `/batches?itemId=${itemId}&inStock=true${warehouseId ? `&warehouseId=${warehouseId}` : ''}`);

await c.activate();
const date = c.settings.cutoverDate;
await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const item = (code, name, type, tracking, uom, extra = {}) => c.req('POST', '/items', { code, name, type, tracking, stockUomId: u(uom), hsnCode: '76041010', ...extra }, 201);
const bar = await item('TI-BAR', 'Ti-6Al-4V bar', 'raw_material', 'batch', 'KG');
const forging = await item('TI-FORG', 'Ti forging blank', 'sub_assembly', 'batch', 'NOS');
const brk = await item('BRK-HT', 'Heat-treated bracket', 'finished_good', 'batch', 'NOS');
const fixture = await item('FIX-01', 'Milling fixture', 'tool', 'none', 'NOS', { jobWorkExemptTool: true });
const wh = (code, name, type) => c.req('POST', '/warehouses', { code, name, type }, 201);
const sto = await wh('STO', 'Main stores', 'stores');
const fg = await wh('FG', 'Finished goods', 'finished_goods');
const rec = await c.req('POST', '/stock-entries', {
  purpose: 'receipt',
  postingDate: date,
  lines: [
    { itemId: bar.id, qty: '10', toWarehouseId: sto.id, newBatchNo: 'HN-1', heatNo: 'HN-1', rate: '2000' },
    { itemId: bar.id, qty: '10', toWarehouseId: sto.id, newBatchNo: 'HN-2', heatNo: 'HN-2', rate: '2500' },
    { itemId: fixture.id, qty: '1', toWarehouseId: sto.id, rate: '40000' },
  ],
}, 201);
await c.req('POST', `/stock-entries/${rec.id}/submit`, {}, 201);
const heat = Object.fromEntries((await bins(bar.id)).map((b) => [b.batchNo, b.id]));

// ── Job workers ──
await fail('POST', '/parties', { code: 'X', name: 'Not a supplier', isCustomer: true, isJobWorker: true, gstTreatment: 'unregistered', stateCode: '27' }, 400, 'a job worker must be a supplier', /job worker is a supplier/);
const forger = await c.req('POST', '/parties', { code: 'FORGE', name: 'Bharat Forge Works', isSupplier: true, isJobWorker: true, gstin: gstin('29AAACB1234B1Z') }, 201);
const plater = await c.req('POST', '/parties', { code: 'HT', name: 'Pune Heat Treaters', isSupplier: true, isJobWorker: true, gstin: gstin('27AAACP1234B1Z') }, 201);
const plain = await c.req('POST', '/parties', { code: 'PLAIN', name: 'Ordinary supplier', isSupplier: true, gstin: gstin('27AAACO1234B1Z') }, 201);
const jw = await c.req('GET', '/parties?role=job_worker');
assert.deepEqual(jw.map((p) => p.code).sort(), ['FORGE', 'HT']);
ok('suppliers can be marked as job workers and listed');

// ── Conversion: Ti bar → forging blanks at a job worker in another state ──
await fail('POST', '/manufacturing/job-work', { supplierId: plain.id, targetItemId: forging.id, targetQty: '4', materials: [{ itemId: bar.id, qty: '6' }] }, 400, 'only job workers take job work', /not marked as a job worker/);
let order = await c.req('POST', '/manufacturing/job-work', { supplierId: forger.id, targetItemId: forging.id, targetQty: '4', targetWarehouseId: sto.id, natureOfWork: 'Closed-die forging', materials: [{ itemId: bar.id, qty: '6' }] }, 201);
assert.equal(order.status, 'draft');
assert.match(order.number, /JWO/);
ok(`conversion order ${order.number} created as a draft`);
await fail('POST', `/manufacturing/job-work/${order.id}/challans`, { postingDate: date, fromWarehouseId: sto.id, lines: [{ itemId: forging.id, qty: '1' }] }, 400, 'only the order’s materials can be sent', /not on this order/);
await fail('POST', `/manufacturing/job-work/${order.id}/challans`, { postingDate: date, fromWarehouseId: sto.id, lines: [{ itemId: bar.id, batchId: heat['HN-1'], qty: '11' }] }, 400, 'cannot send more than is in stock', /not enough/i);
const ch1 = await c.req('POST', `/manufacturing/job-work/${order.id}/challans`, { postingDate: date, fromWarehouseId: sto.id, lines: [{ itemId: bar.id, batchId: heat['HN-1'], qty: '4' }, { itemId: bar.id, batchId: heat['HN-2'], qty: '2' }] }, 201);
assert.match(ch1.number, /^JW\/\d\d-\d\d\/\d{5}$/);
assert.ok(ch1.number.length <= 16);
ok(`challan ${ch1.number} is at most 16 characters (rule 55)`);
assert.equal(ch1.interstate, true);
assert.match(ch1.warning, /e-way bill/);
ok('a job worker in another state makes the challan interstate, with an e-way bill reminder');
order = await c.req('GET', `/manufacturing/job-work/${order.id}`);
assert.equal(order.status, 'open');
const line1 = order.challans[0].lines.find((l) => l.batchNo === 'HN-1');
eq(line1.value, '8000', 'challan value is the FIFO cost: HN-1 4 kg × ₹2,000');
eq(order.challans[0].lines.find((l) => l.batchNo === 'HN-2').value, '5000', 'HN-2 2 kg × ₹2,500');
assert.equal(line1.goodsType, 'input');
const oneYear = `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
assert.equal(line1.dueBy, date.endsWith('02-29') ? `${Number(date.slice(0, 4)) + 1}-02-28` : oneYear);
ok('inputs are due back within one year (Sec 143)');
eq(order.atVendor, '6', 'six kg are at the job worker');
const vendorWh = (await c.req('GET', '/warehouses')).find((w) => w.code === 'JW-FORGE');
assert.equal(vendorWh.type, 'at_job_worker');
assert.equal(vendorWh.availableForIssue, false);
ok('the "At Bharat Forge Works" warehouse was created on first use, not available for issue');
const atVendor = await bins(bar.id, vendorWh.id);
assert.deepEqual(atVendor.map((b) => [b.batchNo, Dec.of(b.qty).toString()]).sort(), [['HN-1', '4.000000'], ['HN-2', '2.000000']]);
ok('the heats sit in the vendor warehouse with their identity');
let tb = await balances();
eq(tb.inventory, '85000', 'sending for job work moves no value: inventory still ₹85,000');
await fail('POST', '/stock-entries', { purpose: 'transfer', postingDate: date, lines: [{ itemId: bar.id, batchId: heat['HN-1'], qty: '1', fromWarehouseId: vendorWh.id, toWarehouseId: sto.id }] }, 201, 'draft transfer from the vendor warehouse can be written…').then(async (draft) => {
  await fail('POST', `/stock-entries/${draft.id}/submit`, {}, 400, '…but is refused on submit: only job work moves it', /only with job work/);
});
await fail('POST', '/stock-entries', { purpose: 'job_work_out', postingDate: date, lines: [{ itemId: bar.id, batchId: heat['HN-1'], qty: '1', fromWarehouseId: sto.id, toWarehouseId: vendorWh.id }] }, 400, 'job work movements cannot be written by hand', /purpose/);

// Receive: 4 forgings from 5.5 kg used (0.5 kg loss, 0.3 kg of it returned as scrap), HN-1 first.
await fail('POST', `/manufacturing/job-work/${order.id}/receipts`, { postingDate: date, consumed: [{ itemId: bar.id, qty: '7' }], received: [{ qty: '4' }] }, 400, 'cannot consume more than is at the job worker', /Only 6\.000000 is open/);
await fail('POST', `/manufacturing/job-work/${order.id}/receipts`, { postingDate: date, consumed: [{ itemId: bar.id, qty: '1', lossQty: '0.8', scrapQty: '0.5' }], received: [{ qty: '1' }] }, 400, 'loss and scrap are part of what was used', /part of the quantity used/);
const r1 = await c.req('POST', `/manufacturing/job-work/${order.id}/receipts`, { postingDate: date, jobWorkerChallanNo: 'BFW/771', jobWorkerChallanDate: date, consumed: [{ itemId: bar.id, qty: '5.5', lossQty: '0.2', scrapQty: '0.3' }], received: [{ qty: '4', batchNo: 'FG-001' }] }, 201);
order = await c.req('GET', `/manufacturing/job-work/${order.id}`);
const got = order.receipts[0];
eq(got.lines[0].value, '11750', 'forgings valued at the exact FIFO cost consumed: 4 kg HN-1 (₹8,000) + 1.5 kg HN-2 (₹3,750)');
assert.deepEqual(got.consumed.map((x) => [x.qty, x.lossQty, x.scrapQty]), [['4.000000', '0.200000', '0.300000'], ['1.500000', '0.000000', '0.000000']]);
ok('the receipt discharges the HN-1 line first, then HN-2, carrying loss and scrap');
eq(order.atVendor, '0.5', 'half a kg of HN-2 is still at the job worker');
const forgings = await bins(forging.id);
assert.equal(forgings[0].batchNo, 'FG-001');
eq(forgings[0].qty, '4', 'four forgings in stores');
tb = await balances();
eq(tb.inventory, '85000', 'no GL: value moved from bar to forgings inside inventory');
await fail('POST', `/manufacturing/job-work/challans/${ch1.id}/cancel`, { reason: 'Sent by mistake' }, 409, 'a challan with goods back cannot be cancelled', /receipts first/);
await fail('POST', `/manufacturing/job-work/${order.id}/close`, { reason: 'Done here' }, 409, 'an order with goods still out cannot be closed', /still at the job worker/);

// Genealogy passes through the job worker.
const back = await c.req('GET', `/manufacturing/genealogy/${forgings[0].id}?direction=backward`);
assert.deepEqual(back.root.children.map((x) => [x.batchNo, x.via.type, x.via.number]).sort(), [['HN-1', 'job_work', order.number], ['HN-2', 'job_work', order.number]]);
ok('genealogy: forging FG-001 was made from HN-1 and HN-2 via the job work order');
const fwd = await c.req('GET', `/manufacturing/genealogy/${heat['HN-1']}?direction=forward`);
assert.ok(fwd.root.children.some((x) => x.batchNo === 'FG-001' && x.via.type === 'job_work'));
ok('genealogy: HN-1 went into FG-001');

// Cancel the receipt: stock goes back to the job worker exactly.
await c.req('POST', `/manufacturing/job-work/receipts/${r1.id}/cancel`, { reason: 'Wrong quantity' }, 201);
order = await c.req('GET', `/manufacturing/job-work/${order.id}`);
eq(order.atVendor, '6', 'cancelling the receipt puts all 6 kg back at the job worker');
assert.equal((await bins(forging.id)).length, 0);
ok('the forgings are gone from stock');
await fail('POST', `/manufacturing/job-work/receipts/${r1.id}/cancel`, { reason: 'Again please' }, 409, 'a receipt cannot be cancelled twice', /already cancelled/);
await c.req('POST', `/manufacturing/job-work/${order.id}/receipts`, { postingDate: date, consumed: [{ itemId: bar.id, qty: '6' }], received: [{ qty: '3', batchNo: 'FG-002' }, { qty: '1', batchNo: 'FG-003' }] }, 201);
order = await c.req('GET', `/manufacturing/job-work/${order.id}`);
const vals = order.receipts.find((r) => r.status === 'submitted').lines.map((l) => l.value);
eq(Dec.of(vals[0]).add(vals[1]), '13000', 'two received lots share the consumed ₹13,000 exactly');
eq(vals[0], '9750', 'by quantity: 3 of 4 → ₹9,750');
await c.req('POST', `/manufacturing/job-work/${order.id}/close`, { reason: 'All forgings back' }, 201);
ok('order closed once nothing is at the job worker');

// ── Processing charge on a conversion: the forger's service invoice adds to the forgings' FIFO value ──
const service = await c.req('POST', '/items', { code: 'SVC-JW', name: 'Job work charges', type: 'service', isStockItem: false, stockUomId: u('NOS'), hsnCode: '998898' }, 201);
const liveReceipt = order.receipts.find((r) => r.status === 'submitted');
const invoice = (supplierId, no, lines) => c.req('POST', '/purchase-invoices', { supplierId, supplierInvoiceNo: no, supplierInvoiceDate: date, postingDate: date, lines }, 201);
await fail('POST', '/purchase-invoices', { supplierId: plater.id, supplierInvoiceNo: 'X-1', supplierInvoiceDate: date, postingDate: date, lines: [{ itemId: service.id, qty: '1', rate: '2000', gstRate: '18', jobWorkReceiptId: liveReceipt.id }] }, 400, 'a processing charge must come from the same job worker', /another job worker/);
await fail('POST', '/purchase-invoices', { supplierId: forger.id, supplierInvoiceNo: 'X-2', supplierInvoiceDate: date, postingDate: date, lines: [{ itemId: bar.id, qty: '1', rate: '2000', gstRate: '18', jobWorkReceiptId: liveReceipt.id }] }, 400, 'a processing charge uses a service item', /service item/);
const pi = await invoice(forger.id, 'BFW-INV-1', [{ itemId: service.id, qty: '4', rate: '500', gstRate: '18', jobWorkReceiptId: liveReceipt.id }]);
await c.req('POST', `/purchase-invoices/${pi.id}/submit`, {}, 201);
tb = await balances();
eq(tb.inventory, '87000', 'the ₹2,000 processing charge raises inventory: the forgings are still on hand');
eq(tb.purchases ?? '0', '0', 'nothing goes to purchases');
order = await c.req('GET', `/manufacturing/job-work/${order.id}`);
eq(order.charged, '2000', 'the order shows ₹2,000 charged');
const dup = await invoice(forger.id, 'BFW-INV-2', [{ itemId: service.id, qty: '1', rate: '100', gstRate: '18', jobWorkReceiptId: liveReceipt.id }]);
await fail('POST', `/purchase-invoices/${dup.id}/submit`, {}, 409, 'one live invoice charges a receipt', /already charges/);
await fail('POST', `/manufacturing/job-work/receipts/${liveReceipt.id}/cancel`, { reason: 'Wrong forgings' }, 409, 'a charged receipt cannot be cancelled', /charges this receipt/);
await c.req('POST', `/purchase-invoices/${pi.id}/cancel`, { reason: 'Rate dispute' }, 201);
tb = await balances();
eq(tb.inventory, '85000', 'cancelling the invoice takes the charge back out exactly');

// ── Same-item processing: heat-treat a heat; the batch keeps its number ──
const ht = await c.req('POST', '/manufacturing/job-work', { supplierId: plater.id, targetItemId: bar.id, targetQty: '2', targetWarehouseId: sto.id, natureOfWork: 'Solution treatment and ageing', materials: [{ itemId: bar.id, qty: '2' }] }, 201);
const ch2 = await c.req('POST', `/manufacturing/job-work/${ht.id}/challans`, { postingDate: date, fromWarehouseId: sto.id, lines: [{ itemId: bar.id, batchId: heat['HN-2'], qty: '2' }] }, 201);
assert.equal(ch2.interstate, false);
assert.equal(ch2.warning, null);
ok('a job worker in our state: intrastate, no e-way bill reminder');
await c.req('POST', `/manufacturing/job-work/${ht.id}/receipts`, { postingDate: date, consumed: [{ itemId: bar.id, batchId: heat['HN-2'], qty: '2' }], received: [{ qty: '2' }] }, 201);
const hn2 = (await bins(bar.id, sto.id)).filter((b) => b.batchNo === 'HN-2');
assert.equal(hn2.length, 1);
eq(hn2[0].qty, '8', 'HN-2 is back in stores as HN-2 (8 kg again): same-item processing keeps the heat');

// ── Capital goods and tool exemption ──
const fx = await c.req('POST', '/manufacturing/job-work', { supplierId: plater.id, targetItemId: fixture.id, targetQty: '1', targetWarehouseId: sto.id, natureOfWork: 'Nitriding', materials: [{ itemId: fixture.id, qty: '1' }] }, 201);
await c.req('POST', `/manufacturing/job-work/${fx.id}/challans`, { postingDate: date, fromWarehouseId: sto.id, lines: [{ itemId: fixture.id, qty: '1' }] }, 201);
const fxd = await c.req('GET', `/manufacturing/job-work/${fx.id}`);
assert.equal(fxd.challans[0].lines[0].goodsType, 'capital_good');
assert.equal(fxd.challans[0].lines[0].dueBy, null);
ok('a fixture is a capital good flagged as a tool: no return limit');

// ── Outsourced operation on a work order ──
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'Milling', hourlyRate: '1200' }, 201);
await fail('POST', '/manufacturing/boms', { itemId: brk.id, revision: 'A', materials: [{ itemId: bar.id, qty: '0.5' }], operations: [{ seq: 20, name: 'Heat treat', outsourced: true, supplierId: plain.id }] }, 400, 'an outsourced operation needs a job worker, not any supplier', /job worker/);
const b = await c.req('POST', '/manufacturing/boms', { itemId: brk.id, revision: 'A', materials: [{ itemId: bar.id, qty: '0.5' }], operations: [{ seq: 10, name: 'Rough mill', workCentreId: cnc.id }, { seq: 20, name: 'Heat treat', outsourced: true, supplierId: plater.id }] }, 201);
assert.equal(b.operations[1].outsourced, true);
assert.equal(b.operations[1].workCentreId, null);
ok('BOM operation 20 is outsourced to the heat treater, with no work centre');
await c.req('POST', `/manufacturing/boms/${b.id}/activate`, {}, 201);
let wo = await c.req('POST', '/manufacturing/work-orders', { itemId: brk.id, plannedQty: '4', sourceWarehouseId: sto.id, targetWarehouseId: fg.id }, 201);
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/release`, {}, 201);
const htOp = wo.operations.find((o) => o.seq === 20);
assert.equal(htOp.outsourced, true);
assert.equal(htOp.supplier, 'Pune Heat Treaters');
ok('the released work order carries the outsourced operation and its job worker');
await fail('POST', '/manufacturing/job-cards', { operationId: htOp.id }, 400, 'no job cards on an outsourced operation', /job worker/);
await c.req('POST', `/manufacturing/work-orders/${wo.id}/issue`, { postingDate: date, lines: [{ itemId: bar.id, qty: '2', batchId: heat['HN-1'] }] }, 201);
await fail('POST', `/manufacturing/work-orders/${wo.id}/output`, { postingDate: date, qty: '1' }, 409, 'output is held until the outsourced operation returns pieces', /only 0 good pieces are back/);
await fail('POST', `/manufacturing/work-orders/${wo.id}/operations/${htOp.id}/send`, { postingDate: date, qty: '5' }, 400, 'cannot send more pieces than planned', /more pieces/);
const opCh = await c.req('POST', `/manufacturing/work-orders/${wo.id}/operations/${htOp.id}/send`, { postingDate: date, qty: '4' }, 201);
let jwState = await c.req('GET', `/manufacturing/work-orders/${wo.id}/job-work`);
eq(jwState.operations[0].atVendor, '4', 'four pieces are at the heat treater');
const opOrder = await c.req('GET', `/manufacturing/job-work/${jwState.orders[0].id}`);
assert.equal(opOrder.kind, 'operation');
eq(opOrder.challans[0].lines[0].value, '4000', 'challan value: WIP ₹4,000 over the 4 pieces in progress');
tb = await balances();
eq(tb.wip, '4000', 'sending work-order pieces moves no GL; WIP stays ₹4,000');
await c.req('POST', `/manufacturing/work-orders/${wo.id}/operations/${htOp.id}/receive`, { postingDate: date, qty: '3', rejectedQty: '1', jobWorkerChallanNo: 'PHT/55' }, 201);
jwState = await c.req('GET', `/manufacturing/work-orders/${wo.id}/job-work`);
eq(jwState.operations[0].good, '3', 'three good pieces back');
eq(jwState.operations[0].atVendor, '0', 'one rejected at the heat treater: nothing left there');
await fail('POST', `/manufacturing/work-orders/${wo.id}/output`, { postingDate: date, qty: '4' }, 409, 'output cannot pass the good pieces returned', /only 3 good pieces/);
await c.req('POST', `/manufacturing/work-orders/${wo.id}/output`, { postingDate: date, qty: '3' }, 201);
ok('three brackets received from the work order');
const opReceipt = (await c.req('GET', `/manufacturing/job-work/${jwState.orders[0].id}`)).receipts[0];
await fail('POST', `/manufacturing/job-work/receipts/${opReceipt.id}/cancel`, { reason: 'Miscounted' }, 409, 'cannot cancel a job work receipt the output already counted', /cancel the later outputs/);
await fail('POST', `/manufacturing/job-work/challans/${opCh.id}/cancel`, { reason: 'Wrong vendor' }, 409, 'cannot cancel a challan whose pieces came back', /receipts first/);

// ── Processing charge on an outsourced operation goes into the work order's WIP ──
let woView = await c.req('GET', `/manufacturing/work-orders/${wo.id}`);
const wipBefore = woView.cost.wip;
const tbBefore = await balances();
const htInv = await invoice(plater.id, 'PHT-INV-9', [{ itemId: service.id, qty: '4', rate: '300', gstRate: '18', jobWorkReceiptId: opReceipt.id }]);
await c.req('POST', `/purchase-invoices/${htInv.id}/submit`, {}, 201);
woView = await c.req('GET', `/manufacturing/work-orders/${wo.id}`);
eq(woView.cost.jobWork, '1200', 'the heat treater’s ₹1,200 is job work cost on the work order');
eq(woView.cost.wip, Dec.of(wipBefore).add('1200'), 'WIP grows by ₹1,200');
tb = await balances();
eq(Dec.of(tb.wip).sub(tbBefore.wip), '1200', 'GL: WIP debited ₹1,200 instead of purchases');
await c.req('POST', `/purchase-invoices/${htInv.id}/cancel`, { reason: 'Wrong invoice' }, 201);
woView = await c.req('GET', `/manufacturing/work-orders/${wo.id}`);
eq(woView.cost.jobWork, '0', 'cancelling the invoice reverses the WIP charge');

// ── Books inactive (decision 034): stock value still moves, no GL ──
{
  const d = await new Client().init('JobWorkInactive');
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  await d.req('POST', `/entities/${d.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
  const du = await d.req('GET', '/uoms');
  const dU = (code) => du.find((x) => x.code === code).id;
  const rod = await d.req('POST', '/items', { code: 'ROD', name: 'Rod', type: 'raw_material', tracking: 'none', stockUomId: dU('KG'), hsnCode: '76041010' }, 201);
  const ring = await d.req('POST', '/items', { code: 'RING', name: 'Rolled ring', type: 'sub_assembly', tracking: 'none', stockUomId: dU('NOS'), hsnCode: '76041010' }, 201);
  const svc = await d.req('POST', '/items', { code: 'SVC', name: 'Ring rolling', type: 'service', isStockItem: false, stockUomId: dU('NOS'), hsnCode: '998898' }, 201);
  const st = await d.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
  const r0 = await d.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: today, lines: [{ itemId: rod.id, qty: '10', toWarehouseId: st.id, rate: '100' }] }, 201);
  await d.req('POST', `/stock-entries/${r0.id}/submit`, {}, 201);
  const roller = await d.req('POST', '/parties', { code: 'RR', name: 'Ring Rollers', isSupplier: true, isJobWorker: true, gstin: gstin('27AAACR1234B1Z') }, 201);
  const o = await d.req('POST', '/manufacturing/job-work', { supplierId: roller.id, targetItemId: ring.id, targetQty: '2', targetWarehouseId: st.id, materials: [{ itemId: rod.id, qty: '10' }] }, 201);
  await d.req('POST', `/manufacturing/job-work/${o.id}/challans`, { postingDate: today, fromWarehouseId: st.id, lines: [{ itemId: rod.id, qty: '10' }] }, 201);
  const rr = await d.req('POST', `/manufacturing/job-work/${o.id}/receipts`, { postingDate: today, consumed: [{ itemId: rod.id, qty: '10' }], received: [{ qty: '2' }] }, 201);
  const inv = await d.req('POST', '/purchase-invoices', { supplierId: roller.id, supplierInvoiceNo: 'RR-1', supplierInvoiceDate: today, postingDate: today, lines: [{ itemId: svc.id, qty: '2', rate: '150', gstRate: '18', jobWorkReceiptId: rr.id }] }, 201);
  await d.req('POST', `/purchase-invoices/${inv.id}/submit`, {}, 201);
  const rings = (await d.req('GET', `/stock/balance?itemId=${ring.id}`)).rows ?? (await d.req('GET', `/stock/balance?itemId=${ring.id}`));
  eq(rings.reduce((s, r) => s.add(r.value ?? '0'), Dec.ZERO), '1300', 'books inactive: two rings valued ₹1,000 of rod plus the ₹300 charge');
  const journals = await d.raw('GET', '/accounts/reports/day-book');
  assert.ok(journals.status !== 200 || (journals.data.rows ?? journals.data).length === 0);
  ok('books inactive: no journal posted');
}

console.log(`\nJob work smoke passed (${c.checks} request checks).`);
