// Quality (decision 048): gauges and calibration, inspection plans, final inspection holding output in Quarantine,
// measurements against limits, partial accept with an NCR, MRB dispositions (scrap with GL, rework order from MRB,
// use-as-is with a concession, return to vendor as a draft claim), in-process NCR on WIP, cancellation rules.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-quality.mjs
import assert from 'node:assert/strict';
import { Dec } from '../../../packages/core/dist/index.js';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Quality');
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
const qtyIn = async (itemId, warehouseId) => (await c.req('GET', `/stock/balance?itemId=${itemId}&warehouseId=${warehouseId}`)).rows?.reduce?.((s, r) => s.add(r.qty), Dec.ZERO) ?? (await c.req('GET', `/stock/balance?itemId=${itemId}&warehouseId=${warehouseId}`)).reduce((s, r) => s.add(r.qty), Dec.ZERO);

await c.activate();
const date = c.settings.cutoverDate;
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const bar = await c.req('POST', '/items', { code: 'AL7075', name: 'Al 7075 bar', type: 'raw_material', tracking: 'batch', stockUomId: u('KG'), hsnCode: '76042910' }, 201);
const brk = await c.req('POST', '/items', { code: 'BRK-Q', name: 'Bracket', type: 'finished_good', tracking: 'batch', stockUomId: u('NOS'), hsnCode: '76042910', requiresFinalInspection: true, revision: 'C' }, 201);
assert.equal(brk.requiresFinalInspection, true);
ok('item flagged for final inspection');
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const fg = await c.req('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' }, 201);

// ── Gauges ──
const mic = await c.req('POST', '/quality/gauges', { code: 'MIC-25', description: 'Micrometer 0–25 mm', type: 'Micrometer', intervalDays: 365, lastCalibrated: daysAgo(10) }, 201);
const old = await c.req('POST', '/quality/gauges', { code: 'CAL-150', description: 'Vernier 150 mm', intervalDays: 180, lastCalibrated: daysAgo(200) }, 201);
let gauges = await c.req('GET', '/quality/gauges');
assert.equal(gauges.find((g) => g.code === 'MIC-25').usable, true);
assert.match(gauges.find((g) => g.code === 'CAL-150').block, /was due/);
ok('micrometer in calibration; vernier overdue');
await fail('POST', '/quality/gauges', { code: 'MIC-25', description: 'dup', intervalDays: 30 }, 409, 'gauge codes are unique', /already exists/);

// ── Final inspection plan ──
const plan = await c.req('POST', '/quality/plans', {
  itemId: brk.id,
  stage: 'final',
  revision: 'A',
  characteristics: [
    { balloon: '1', description: 'Bore Ø10 H7', kind: 'dimension', nominal: '10', lowerLimit: '10.000', upperLimit: '10.015', unit: 'mm', method: 'Micrometer', isKey: true },
    { balloon: '2', description: 'Anodise finish', kind: 'visual', sampleSize: 1 },
  ],
}, 201);
await fail('POST', '/quality/plans', { itemId: brk.id, stage: 'in_process', revision: 'A', characteristics: [{ description: 'x', kind: 'visual' }] }, 400, 'an in-process plan names its operation', /routing operation/);
await c.req('POST', `/quality/plans/${plan.id}/activate`, {}, 201);
ok('final inspection plan rev A active');

// ── Work order output goes to Quarantine with an open inspection ──
const rec = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: date, lines: [{ itemId: bar.id, qty: '20', toWarehouseId: sto.id, newBatchNo: 'H-77', rate: '500' }] }, 201);
await c.req('POST', `/stock-entries/${rec.id}/submit`, {}, 201);
const heat = (await c.req('GET', `/batches?itemId=${bar.id}`))[0];
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'Milling', hourlyRate: '1200' }, 201);
const bom = await c.req('POST', '/manufacturing/boms', { itemId: brk.id, revision: 'A', materials: [{ itemId: bar.id, qty: '1' }], operations: [{ seq: 10, name: 'Mill', workCentreId: cnc.id }] }, 201);
await c.req('POST', `/manufacturing/boms/${bom.id}/activate`, {}, 201);
let wo = await c.req('POST', '/manufacturing/work-orders', { itemId: brk.id, plannedQty: '4', sourceWarehouseId: sto.id, targetWarehouseId: fg.id }, 201);
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/release`, {}, 201);
await c.req('POST', `/manufacturing/work-orders/${wo.id}/issue`, { postingDate: date, lines: [{ itemId: bar.id, qty: '4', batchId: heat.id }] }, 201);
const afterOut = await c.req('POST', `/manufacturing/work-orders/${wo.id}/output`, { postingDate: date, qty: '4', batchNo: 'BRK-L1' }, 201);
const out = afterOut.movements.find((m) => m.purpose === 'production_output' && m.status === 'submitted');
const qua = (await c.req('GET', '/warehouses')).find((w) => w.type === 'quarantine');
assert.ok(qua, 'a Quarantine warehouse exists');
eq(await qtyIn(brk.id, qua.id), '4', 'output of a flagged item lands in Quarantine');
eq(await qtyIn(brk.id, fg.id), '0', 'nothing in finished goods yet');
let queue = await c.req('GET', '/quality/inspections?status=draft&stage=final');
assert.equal(queue.length, 1);
let ir = await c.req('GET', `/quality/inspections/${queue[0].id}`);
assert.equal(ir.plan.revision, 'A');
assert.deepEqual(ir.characteristics.map((x) => x.samples), [4, 1]);
ok('the final inspection opened against plan A: 4 samples of the bore, 1 of the finish');

// Output with an open draft inspection can still be cancelled; the draft is withdrawn.
await c.req('POST', `/manufacturing/work-orders/${wo.id}/movements/${out.id}/cancel`, { reason: 'Wrong batch number' }, 201);
assert.equal((await c.req('GET', `/quality/inspections/${ir.id}`)).status, 'cancelled');
ok('cancelling the output withdraws its draft inspection');
await c.req('POST', `/manufacturing/work-orders/${wo.id}/output`, { postingDate: date, qty: '4', batchNo: 'BRK-L2' }, 201);
queue = await c.req('GET', '/quality/inspections?status=draft&stage=final');
ir = await c.req('GET', `/quality/inspections/${queue[0].id}`);
const [bore, finish] = ir.characteristics;

// ── Measurements ──
await fail('POST', `/quality/inspections/${ir.id}/results`, { results: [{ characteristicId: bore.id, sampleNo: 1, measured: '10.004', gaugeId: old.id }] }, 400, 'an overdue gauge is refused', /was due for calibration/);
await fail('POST', `/quality/inspections/${ir.id}/results`, { results: [{ characteristicId: bore.id, sampleNo: 5, measured: '10.004', gaugeId: mic.id }] }, 400, 'samples are capped at the plan', /only 4 samples/);
await c.req('POST', `/quality/inspections/${ir.id}/results`, {
  results: [
    { characteristicId: bore.id, sampleNo: 1, measured: '10.004', gaugeId: mic.id },
    { characteristicId: bore.id, sampleNo: 2, measured: '10.012', gaugeId: mic.id },
    { characteristicId: bore.id, sampleNo: 3, measured: '10.021', gaugeId: mic.id },
  ],
}, 201);
await fail('POST', `/quality/inspections/${ir.id}/submit`, { qtyAccepted: '4', qtyRejected: '0' }, 400, 'every planned sample must be recorded', /3 of 4 samples/);
await c.req('POST', `/quality/inspections/${ir.id}/results`, { results: [{ characteristicId: bore.id, sampleNo: 4, measured: '10.009', gaugeId: mic.id }, { characteristicId: finish.id, sampleNo: 1, pass: true }] }, 201);
ir = await c.req('GET', `/quality/inspections/${ir.id}`);
assert.deepEqual(ir.results.filter((r) => r.characteristicId === bore.id).map((r) => r.pass), [true, true, false, true]);
ok('10.021 is outside 10.000–10.015 and fails; the limits decide, not the inspector');
await fail('POST', `/quality/inspections/${ir.id}/submit`, { qtyAccepted: '4', qtyRejected: '0' }, 400, 'a failed characteristic can’t pass the lot', /reject the nonconforming/);
await fail('POST', `/quality/inspections/${ir.id}/submit`, { qtyAccepted: '3', qtyRejected: '1' }, 400, 'rejecting needs an NCR description', /Describe the nonconformance/);
await fail('POST', `/quality/inspections/${ir.id}/submit`, { qtyAccepted: '2', qtyRejected: '1', ncrDescription: 'Bore oversize' }, 400, 'accepted + rejected must cover the lot', /add up to 4/);
ir = await c.req('POST', `/quality/inspections/${ir.id}/submit`, { qtyAccepted: '3', qtyRejected: '1', ncrDescription: 'Bore oversize on piece 3 (10.021)' }, 201);
assert.equal(ir.outcome, 'partial');
assert.match(ir.ncr.number, /NCR/);
eq(await qtyIn(brk.id, fg.id), '3', 'three accepted brackets moved to finished goods');
const mrb = (await c.req('GET', '/warehouses')).find((w) => w.type === 'mrb');
eq(await qtyIn(brk.id, mrb.id), '1', 'the rejected bracket is on hold in MRB');
await fail('POST', `/manufacturing/work-orders/${wo.id}/movements/${(await c.req('GET', `/manufacturing/work-orders/${wo.id}`)).movements.find((m) => m.purpose === 'production_output' && m.status === 'submitted').id}/cancel`, { reason: 'Try to undo' }, 409, 'an inspected output can’t be cancelled', /has been recorded/);

// ── NCR: scrap the rejected bracket (books active) ──
const tb0 = await balances();
let n1 = await c.req('GET', `/quality/ncrs/${ir.ncr.id}`);
await fail('POST', `/quality/ncrs/${n1.id}/dispositions`, { lines: [{ kind: 'scrap', qty: '2', wasteCategory: 'rejected_parts' }] }, 400, 'dispositions cover the NCR quantity exactly', /exactly/);
await fail('POST', `/quality/ncrs/${n1.id}/dispositions`, { lines: [{ kind: 'scrap', qty: '1' }] }, 400, 'scrap needs a waste category', /waste category/);
await fail('POST', `/quality/ncrs/${n1.id}/approve`, {}, 400, 'nothing to approve before a proposal', /Propose/);
await c.req('POST', `/quality/ncrs/${n1.id}/dispositions`, { lines: [{ kind: 'scrap', qty: '1', wasteCategory: 'rejected_parts' }] }, 201);
n1 = await c.req('POST', `/quality/ncrs/${n1.id}/approve`, {}, 201);
assert.equal(n1.status, 'dispositioned');
assert.ok(n1.dispositions[0].stockEntryId);
eq(await qtyIn(brk.id, mrb.id), '0', 'the scrapped bracket left MRB');
const tb1 = await balances();
assert.ok(Dec.of(tb1.scrap ?? '0').gt(tb0.scrap ?? '0'));
ok(`GL: scrap debited ₹${Dec.of(tb1.scrap).sub(tb0.scrap ?? '0').toFixed(2)}`);
const waste = await c.req('GET', '/waste/balances');
assert.ok(JSON.stringify(waste).includes('rejected_parts'));
ok('the scrap entered the waste register');
n1 = await c.req('POST', `/quality/ncrs/${n1.id}/close`, {}, 201);
assert.equal(n1.status, 'closed');
ok('NCR closed');

// ── Manual NCR on bar stock: rework 1 kg, use-as-is 1 kg ──
let n2 = await c.req('POST', '/quality/ncrs', { itemId: bar.id, batchId: heat.id, qty: '2', fromWarehouseId: sto.id, description: 'Surface pitting found at goods-in recheck' }, 201);
eq(await qtyIn(bar.id, mrb.id), '2', 'manual NCR holds 2 kg in MRB');
await fail('POST', `/quality/ncrs/${n2.id}/dispositions`, { lines: [{ kind: 'use_as_is', qty: '2' }] }, 400, 'use-as-is needs a concession', /concession/);
await c.req('POST', `/quality/ncrs/${n2.id}/dispositions`, { lines: [{ kind: 'rework', qty: '1', note: 'Skim 0.2 mm' }, { kind: 'use_as_is', qty: '1', concessionRef: 'CON-2026-014' }] }, 201);
await fail('POST', `/quality/ncrs/${n2.id}/approve`, {}, 400, 'rework needs a work centre and destination', /work centre/);
n2 = await c.req('POST', `/quality/ncrs/${n2.id}/approve`, { reworkWorkCentreId: cnc.id, reworkTargetWarehouseId: sto.id }, 201);
const rework = n2.dispositions.find((d) => d.kind === 'rework');
assert.match(rework.reworkOrder, /WO/);
const rwo = await c.req('GET', `/manufacturing/work-orders/${rework.workOrderId}`);
assert.equal(rwo.status, 'released');
assert.equal(rwo.revision, 'Rework');
eq(rwo.cost.material, '500', 'the rework order issued the 1 kg from MRB at its FIFO cost');
eq(await qtyIn(bar.id, mrb.id), '0', 'MRB is empty');
eq(await qtyIn(bar.id, sto.id), '15', 'use-as-is returned 1 kg to stores (20 − 4 issued − 2 held + 1 = 15)');

// ── Return to vendor: a purchased, invoiced lot ──
const sup = await c.req('POST', '/parties', { code: 'ALCO', name: 'Alloy Co', isSupplier: true, gstin: gstin('27AAACL1234B1Z') }, 201);
const po = await c.req('POST', '/purchase-orders', { supplierId: sup.id, orderDate: date, lines: [{ itemId: bar.id, qty: '10', rate: '480', gstRate: '18' }] }, 201);
await c.req('POST', `/purchase-orders/${po.id}/submit`, {}, 201);
const poLine = (await c.req('GET', `/purchase-orders/${po.id}`)).lines[0];
const grn = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: date, partyId: sup.id, purchaseOrderId: po.id, lines: [{ itemId: bar.id, qty: '10', toWarehouseId: sto.id, newBatchNo: 'H-88', poLineId: poLine.id }] }, 201);
await c.req('POST', `/stock-entries/${grn.id}/submit`, {}, 201);
const pinv = await c.req('POST', '/purchase-invoices', { supplierId: sup.id, purchaseOrderId: po.id, supplierInvoiceNo: 'ALCO-1', supplierInvoiceDate: date, postingDate: date, lines: [{ itemId: bar.id, poLineId: poLine.id, qty: '10', rate: '480', gstRate: '18' }] }, 201);
await c.req('POST', `/purchase-invoices/${pinv.id}/submit`, {}, 201);
const h88 = (await c.req('GET', `/batches?itemId=${bar.id}`)).find((b) => b.batchNo === 'H-88');
let n3 = await c.req('POST', '/quality/ncrs', { itemId: bar.id, batchId: h88.id, qty: '3', fromWarehouseId: sto.id, description: 'Hardness below spec on MTC recheck' }, 201);
await c.req('POST', `/quality/ncrs/${n3.id}/dispositions`, { lines: [{ kind: 'return_to_vendor', qty: '3' }] }, 201);
n3 = await c.req('POST', `/quality/ncrs/${n3.id}/approve`, {}, 201);
const claimId = n3.dispositions[0].returnClaimId;
assert.ok(claimId);
const claim = await c.req('GET', `/buying/return-claims/${claimId}`);
assert.equal(claim.status, 'draft');
eq(claim.lines[0].qty, '3', 'return to vendor opened a draft supplier return claim for 3 kg');
eq(claim.lines[0].taxableAmount, '1440', 'at the invoice rate (3 × ₹480)');

// ── In-process inspection on WIP ──
const ops = (await c.req('GET', `/manufacturing/work-orders/${wo.id}`)).operations;
let ip = await c.req('POST', '/quality/inspections', { stage: 'in_process', itemId: brk.id, qty: '1', sourceType: 'operation', workOrderId: wo.id, operationId: ops[0].id }, 201);
await c.req('POST', `/quality/inspections/${ip.id}/results`, { results: [{ description: 'Flatness after roughing', pass: false, note: '0.08 mm' }] }, 201);
ip = await c.req('POST', `/quality/inspections/${ip.id}/submit`, { qtyAccepted: '0', qtyRejected: '1', ncrDescription: 'Flatness 0.08 mm after roughing' }, 201);
const wipNcr = await c.req('GET', `/quality/ncrs/${ip.ncr.id}`);
assert.equal(wipNcr.mrbWarehouseId, null);
assert.equal(wipNcr.workOrder, wo.number);
ok('an in-process failure raises an NCR on the work order, with no stock moved');

// ── Calibration failure lists the inspections that used the gauge ──
const cal = await c.req('POST', `/quality/gauges/${mic.id}/calibrations`, { calibratedOn: today, result: 'fail', agency: 'NABL lab' }, 201);
assert.ok(cal.suspect.some((s) => s.id === ir.id));
ok('a failed calibration lists the final inspection that used the micrometer');
gauges = await c.req('GET', '/quality/gauges');
assert.match(gauges.find((g) => g.code === 'MIC-25').block, /failed calibration/);
ok('the failed micrometer is blocked');
await c.req('POST', `/quality/gauges/${mic.id}/calibrations`, { calibratedOn: today, result: 'adjusted', agency: 'NABL lab', certificateNo: 'C-991' }, 201);
assert.equal((await c.req('GET', '/quality/gauges')).find((g) => g.code === 'MIC-25').usable, true);
ok('an adjusted calibration returns it to service');

console.log(`\nQuality smoke passed (${c.checks} request checks).`);
