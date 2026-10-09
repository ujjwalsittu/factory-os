// ITC-04 and job work deadlines (decision 047; evidence docs/compliance/itc04-evidence.md).
// Table 4 from challans, Table 5A from receipts with the original challan, rule 45(3) periods, CSV export,
// Sec 143 deadlines with amber/red states, the Commissioner's extension cap and deemed-supply marking.
// Dates are relative to today so the deadline states stay meaningful. Books stay inactive.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-itc04.mjs
import assert from 'node:assert/strict';
import { Dec, itc04Period } from '../../../packages/core/dist/index.js';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Itc04');
const fail = async (method, path, body, status, label, pattern) => {
  const r = await c.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const shift = (days) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dReceipt = shift(-460);
const dOld = shift(-430); // due one year later: 65 days ago → overdue
const dRecent = shift(-350); // due in 15 days → amber
const dBack = shift(-340);

await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/hsn-codes', { code: '72249099', kind: 'hsn', description: 'Alloy steel bars', gstRate: '18', effectiveFrom: '2017-07-01' }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const bar = await c.req('POST', '/items', { code: '17-4PH', name: '17-4PH bar', type: 'raw_material', tracking: 'none', stockUomId: u('KG'), hsnCode: '72249099' }, 201);
const die = await c.req('POST', '/items', { code: 'DIE-7', name: 'Forging die', type: 'tool', tracking: 'none', stockUomId: u('NOS'), hsnCode: '72249099', jobWorkExemptTool: true }, 201);
const gauge = await c.req('POST', '/items', { code: 'GAUGE', name: 'Thread gauge', type: 'gauge', tracking: 'none', stockUomId: u('NOS'), hsnCode: '72249099' }, 201);
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const rec = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: dReceipt, lines: [{ itemId: bar.id, qty: '100', toWarehouseId: sto.id, rate: '300' }, { itemId: die.id, qty: '1', toWarehouseId: sto.id, rate: '90000' }, { itemId: gauge.id, qty: '1', toWarehouseId: sto.id, rate: '5000' }] }, 201);
await c.req('POST', `/stock-entries/${rec.id}/submit`, {}, 201);
const jw = await c.req('POST', '/parties', { code: 'HT', name: 'Nashik Heat Treat', isSupplier: true, isJobWorker: true, gstin: gstin('27AAACN1234B1Z') }, 201);

const order = await c.req('POST', '/manufacturing/job-work', { supplierId: jw.id, targetItemId: bar.id, targetQty: '60', targetWarehouseId: sto.id, natureOfWork: 'Hardening', materials: [{ itemId: bar.id, qty: '60' }, { itemId: die.id, qty: '1' }, { itemId: gauge.id, qty: '1' }] }, 201);
const ch1 = await c.req('POST', `/manufacturing/job-work/${order.id}/challans`, { postingDate: dOld, fromWarehouseId: sto.id, lines: [{ itemId: bar.id, qty: '40' }, { itemId: die.id, qty: '1' }] }, 201);
const ch2 = await c.req('POST', `/manufacturing/job-work/${order.id}/challans`, { postingDate: dRecent, fromWarehouseId: sto.id, lines: [{ itemId: bar.id, qty: '20' }, { itemId: gauge.id, qty: '1' }] }, 201);
await c.req('POST', `/manufacturing/job-work/${order.id}/receipts`, { postingDate: dBack, jobWorkerChallanNo: 'NHT/12', jobWorkerChallanDate: dBack, consumed: [{ itemId: bar.id, qty: '30', lossQty: '1', scrapQty: '0.5' }], received: [{ qty: '28.5' }] }, 201);
ok('two challans and a receipt back-dated around a year');

// ── Deadlines ──
let dl = await c.req('GET', '/compliance/itc04/deadlines');
const byChallan = (no, code) => dl.lines.find((l) => l.challanNo === no && l.itemCode === code);
const old = byChallan(ch1.number, '17-4PH');
assert.equal(old.state, 'overdue');
assert.equal(Dec.of(old.open).toString(), '10.000000');
ok('inputs sent over a year ago with 10 kg not back are overdue');
assert.equal(byChallan(ch2.number, '17-4PH').state, 'due_soon');
ok('inputs due within 30 days are amber');
const dieLine = byChallan(ch1.number, 'DIE-7');
assert.equal(dieLine.goodsType, 'capital_good');
assert.equal(dieLine.due, null);
assert.equal(dieLine.state, 'open');
ok('a forging die (capital-goods tool) has no deadline');
const gaugeLine = byChallan(ch2.number, 'GAUGE');
assert.equal(gaugeLine.goodsType, 'capital_good');
assert.equal(gaugeLine.due, `${Number(dRecent.slice(0, 4)) + 3}${dRecent.slice(4)}`);
ok('a gauge is a capital good: three years');
assert.ok(dl.soon >= 2);
ok(`dashboard count: ${dl.soon} lines due soon or overdue`);

// Extension: at most one more year for inputs.
const recent = byChallan(ch2.number, '17-4PH');
const tooFar = `${Number(recent.dueBy.slice(0, 4)) + 1}${recent.dueBy.slice(4)}`;
await fail('POST', `/manufacturing/job-work/challan-lines/${recent.id}/extend`, { extendedDueBy: shift(800), extensionRef: 'CGST/NSK/2026/14' }, 400, 'an extension beyond one more year is refused (Sec 143(1) proviso)', /no later than/);
await c.req('POST', `/manufacturing/job-work/challan-lines/${recent.id}/extend`, { extendedDueBy: tooFar, extensionRef: 'CGST/NSK/2026/14' }, 201);
dl = await c.req('GET', '/compliance/itc04/deadlines');
assert.equal(byChallan(ch2.number, '17-4PH').state, 'open');
ok('extended by the Commissioner for a year: no longer amber');

// Deemed supply after the deadline.
await fail('POST', `/manufacturing/job-work/challan-lines/${recent.id}/deemed-supply`, { invoiceNo: 'AZ/26-27/00009' }, 400, 'deemed supply only after the deadline passes', /has not passed/);
await c.req('POST', `/manufacturing/job-work/challan-lines/${old.id}/deemed-supply`, { invoiceNo: 'AZ/26-27/00010' }, 201);
dl = await c.req('GET', '/compliance/itc04/deadlines');
assert.equal(byChallan(ch1.number, '17-4PH').state, 'deemed_supply');
ok('the overdue line is marked as a deemed supply with its invoice number');
await fail('POST', `/manufacturing/job-work/challan-lines/${old.id}/deemed-supply`, { invoiceNo: 'AZ/26-27/00011' }, 409, 'a deemed supply is recorded once', /Already recorded/);
await fail('POST', `/manufacturing/job-work/${order.id}/close`, { reason: 'Finished with this vendor' }, 409, 'the order cannot close while undeemed goods are out', /still at the job worker/);

// ── The return for the periods ──
const p1 = itc04Period(dOld, 'half_yearly');
await fail('PUT', '/compliance/itc04/settings', { fy: '2026', frequency: 'annual' }, 400, 'the FY is written like 2026-27', /2026-27/);
const fy1 = p1.label.slice(0, 7);
await c.req('PUT', '/compliance/itc04/settings', { fy: fy1, frequency: 'half_yearly' }, 200);
const r1 = await c.req('GET', `/compliance/itc04?period=${encodeURIComponent(p1.label)}`);
assert.equal(r1.period.due, p1.due);
assert.equal(r1.frequency, 'half_yearly');
assert.equal(r1.configuredFrequency, 'half_yearly');
const t4 = r1.gstins[0].table4.filter((x) => x.challanNo === ch1.number);
assert.equal(t4.length, 2);
const t4bar = t4.find((x) => x.description.startsWith('17-4PH'));
assert.equal(t4bar.taxableValue, '12000.00');
assert.equal(t4bar.cgstRate, '9.000000');
assert.equal(t4bar.igstRate, null);
assert.equal(t4bar.goodsType, 'input');
ok(`Table 4 (${p1.label}): challan ${ch1.number}, 40 kg at ₹12,000, intrastate 9% + 9%`);
const p3 = itc04Period(dBack, 'half_yearly');
const fy3 = p3.label.slice(0, 7);
if (fy3 !== fy1) await c.req('PUT', '/compliance/itc04/settings', { fy: fy3, frequency: 'half_yearly' }, 200);
const r3 = await c.req('GET', `/compliance/itc04?period=${encodeURIComponent(p3.label)}`);
const t5 = r3.gstins[0].table5a;
assert.deepEqual(
  t5.map((x) => [x.originalChallanNo, x.jobWorkerChallanNo, Dec.of(x.qty).toString(), Dec.of(x.lossQty).toString(), Dec.of(x.scrapQty).toString(), x.natureOfWork]),
  [[ch1.number, 'NHT/12', '28.500000', '1.000000', '0.500000', 'Hardening']],
);
ok(`Table 5A (${p3.label}): 30 kg discharged against the original challan ${ch1.number} — 28.5 back, 1 lost, 0.5 scrap`);
await c.req('PUT', '/compliance/itc04/settings', { fy: fy1, frequency: 'annual' }, 200);
const annual = await c.req('GET', `/compliance/itc04?period=${fy1}`);
assert.equal(annual.period.label, fy1);
assert.equal(annual.period.due, `${Number(fy1.slice(0, 4)) + 1}-04-25`);
assert.equal(annual.configuredFrequency, 'annual');
ok(`annual filer: the period is the financial year, due 25 April`);
const csv = await fetch(`${c.base}/compliance/itc04/export.csv?period=${encodeURIComponent(p3.label)}`, { headers: { Cookie: c.cookie, 'x-tenant-id': c.tenantId, 'x-entity-id': c.entityId, Origin: c.origin } });
assert.equal(csv.status, 200);
const text = await csv.text();
assert.match(text, /FORM GST ITC-04 fields/);
assert.match(text, new RegExp(`"5A","27AAACA1234B1Z.","27AAACN1234B1Z.","","Nashik Heat Treat","${ch1.number.replaceAll('/', '\\/')}"`));
ok('CSV export carries Table 5A with both GSTINs and the original challan');

console.log(`\nITC-04 smoke passed (${c.checks} request checks).`);
