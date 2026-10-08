// Serial manufacturing, as-built and genealogy (decision 046): bracket serials made from a heat and its remnant,
// satellite assemblies built from bracket serials, cancel/rebuild frees components, backward/forward trees, recall CSV.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-genealogy.mjs
import assert from 'node:assert/strict';
import { Dec } from '../../../packages/core/dist/index.js';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Genealogy');
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

await c.activate();
const date = c.settings.cutoverDate;
await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/hsn-codes', { code: '88073000', kind: 'hsn', description: 'Spacecraft parts', gstRate: '18', effectiveFrom: '2025-04-01' }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const item = (code, name, type, tracking, uom, serialPrefix) => c.req('POST', '/items', { code, name, type, tracking, stockUomId: u(uom), hsnCode: '88073000', ...(serialPrefix ? { serialPrefix } : {}) }, 201);
const bar = await item('TI-BAR', 'Ti-6Al-4V bar', 'raw_material', 'batch', 'KG');
const screw = await item('M4', 'M4 screw', 'component', 'none', 'NOS');
const brk = await item('BRK-C', 'Bracket rev C', 'sub_assembly', 'serial', 'NOS', 'BRK');
const sat = await item('SAT-STR', 'Satellite structure', 'finished_good', 'serial', 'NOS', 'SAT');
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const fg = await c.req('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' }, 201);
const cus = await c.req('POST', '/parties', { code: 'ISRO', name: 'Space agency', isCustomer: true, gstin: gstin('27AAACS1234B1Z'), addresses: [{ label: 'HQ', line1: 'Road 1', city: 'Pune', stateCode: '27', pincode: '411001' }] }, 201);
const rec = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: date, lines: [
  { itemId: bar.id, qty: '10', toWarehouseId: sto.id, newBatchNo: 'HN-1', heatNo: 'HN-1', rate: '2000' },
  { itemId: screw.id, qty: '100', toWarehouseId: sto.id, rate: '5' },
] }, 201);
await c.req('POST', `/stock-entries/${rec.id}/submit`, {}, 201);
const hn1 = (await c.req('GET', `/batches?itemId=${bar.id}`))[0];
const cut = await c.req('POST', '/stock/cuts', { postingDate: date, itemId: bar.id, warehouseId: sto.id, batchId: hn1.id, qty: '3', lengthMm: '500' }, 201);
const r1 = (await c.req('GET', `/batches?itemId=${bar.id}`)).find((b) => b.batchNo === cut.remnantNo);
ok(`heat HN-1 received and remnant ${cut.remnantNo} (500 mm, 3 kg) cut`);

const wc = await c.req('POST', '/manufacturing/work-centres', { code: 'MILL', name: 'Milling', hourlyRate: '0' }, 201);
const bom = async (itemId, materials) => {
  const b = await c.req('POST', '/manufacturing/boms', { itemId, revision: 'A', materials, operations: [{ seq: 10, name: 'Make', workCentreId: wc.id }] }, 201);
  return c.req('POST', `/manufacturing/boms/${b.id}/activate`, {}, 201);
};
await fail('POST', '/manufacturing/boms', { itemId: sat.id, revision: 'X', materials: [{ itemId: brk.id, qty: '1.5' }], operations: [] }, 400, 'serial components are whole units on a BOM', /whole units/);
await bom(brk.id, [{ itemId: bar.id, qty: '0.5' }]);
await bom(sat.id, [{ itemId: brk.id, qty: '2' }, { itemId: screw.id, qty: '4', backflush: true }]);
ok('BOMs: bracket from bar, satellite from two bracket serials and backflushed screws');
const wo = async (itemId, qty) => {
  const w = await c.req('POST', '/manufacturing/work-orders', { itemId, plannedQty: qty, sourceWarehouseId: sto.id, targetWarehouseId: fg.id }, 201);
  return c.req('POST', `/manufacturing/work-orders/${w.id}/release`, {}, 201);
};

// ── Bracket serials from the heat and its remnant ──
let w1 = await wo(brk.id, '4');
w1 = await c.req('POST', `/manufacturing/work-orders/${w1.id}/issue`, { lines: [{ itemId: bar.id, batchId: r1.id, qty: '1' }, { itemId: bar.id, batchId: hn1.id, qty: '1' }] }, 201);
eq(w1.cost.wip, '4000', 'issued 1 kg from the remnant and 1 kg from the heat (₹4,000)');
await fail('POST', `/manufacturing/work-orders/${w1.id}/output`, { qty: '1.5' }, 400, 'serial output is in whole units', /whole units/);
w1 = await c.req('POST', `/manufacturing/work-orders/${w1.id}/output`, { qty: '4' }, 201);
const out1 = w1.movements.find((m) => m.purpose === 'production_output');
assert.deepEqual(out1.lines.map((l) => [l.batchNo, l.qty]), [['BRK-000001', '1.000000'], ['BRK-000002', '1.000000'], ['BRK-000003', '1.000000'], ['BRK-000004', '1.000000']]);
ok('output generated serials BRK-000001…000004, one line each');
assert.ok(out1.lines.every((l) => Dec.of(l.value).eq('1000')));
ok('each bracket serial carries ₹1,000 (equal split of the actual cost)');
const brks = (await c.req('GET', `/batches?itemId=${brk.id}&inStock=true`)).sort((a, b) => a.batchNo.localeCompare(b.batchNo));
const [b1, b2, b3, b4] = brks.map((b) => b.id);
assert.ok(brks.every((b) => b.kind === 'serial'));

// ── Satellites built from bracket serials ──
let w2 = await wo(sat.id, '2');
await fail('POST', `/manufacturing/work-orders/${w2.id}/issue`, { lines: [{ itemId: brk.id, qty: '1' }] }, 400, 'serial issue names the serial', /choose the serial/);
w2 = await c.req('POST', `/manufacturing/work-orders/${w2.id}/issue`, { lines: [b1, b2, b3, b4].map((id) => ({ itemId: brk.id, batchId: id, qty: '1', warehouseId: fg.id })) }, 201);
await fail('POST', `/manufacturing/work-orders/${w2.id}/output`, { qty: '2' }, 400, 'as-built is required for serial assemblies', /component serials for each/);
await fail('POST', `/manufacturing/work-orders/${w2.id}/output`, { qty: '2', asBuilt: [[b1], [b2, b3, b4]] }, 400, 'each assembly takes exactly the BOM count', /needs 2 serial/);
await fail('POST', `/manufacturing/work-orders/${w2.id}/output`, { qty: '2', asBuilt: [[b1, b1], [b3, b4]] }, 400, 'a component serial can be chosen once', /listed twice/);
w2 = await c.req('POST', `/manufacturing/work-orders/${w2.id}/output`, { qty: '2', asBuilt: [[b1, b2], [b3, b4]] }, 201);
let outs = w2.movements.filter((m) => m.purpose === 'production_output');
assert.deepEqual(outs[0].lines.map((l) => l.batchNo), ['SAT-000001', 'SAT-000002']);
assert.ok(outs[0].lines.every((l) => Dec.of(l.value).eq('2020')));
ok('satellites SAT-000001/2 built, each ₹2,020 (two brackets + four screws)');
// Rebuild with a different pairing: cancel frees the components.
w2 = await c.req('POST', `/manufacturing/work-orders/${w2.id}/movements/${outs[0].id}/cancel`, { reason: 'Wrong pairing recorded' }, 201);
w2 = await c.req('POST', `/manufacturing/work-orders/${w2.id}/output`, { qty: '2', asBuilt: [[b1, b3], [b2, b4]] }, 201);
outs = w2.movements.filter((m) => m.purpose === 'production_output' && m.status === 'submitted');
assert.deepEqual(outs[0].lines.map((l) => l.batchNo), ['SAT-000003', 'SAT-000004']);
ok('cancelled output frees its components; rebuilt as SAT-000003 (BRK-1+3) and SAT-000004 (BRK-2+4)');
const sats = await c.req('GET', `/batches?itemId=${sat.id}&inStock=true`);
const s3 = sats.find((s) => s.batchNo === 'SAT-000003').id;

// ── Sell one satellite ──
const inv = await c.req('POST', '/sales-invoices', { customerId: cus.id, invoiceDate: date, lines: [{ itemId: sat.id, qty: '1', rate: '50000', warehouseId: fg.id, batchId: s3 }] }, 201);
const invSub = await c.req('POST', `/sales-invoices/${inv.id}/submit`, {}, 201);

// ── Genealogy ──
const found = await c.req('GET', '/manufacturing/genealogy?q=SAT-0000');
assert.ok(found.some((f) => f.batchNo === 'SAT-000003'));
ok('search finds serials');
const back = await c.req('GET', `/manufacturing/genealogy/${s3}?direction=backward`);
const names = (n) => n.children.map((x) => x.batchNo).sort();
assert.deepEqual(names(back.root), ['BRK-000001', 'BRK-000003']);
assert.ok(back.root.children.every((x) => x.via.type === 'as_built'));
ok('backward: SAT-000003 contains exactly BRK-000001 and BRK-000003 (as-built)');
const brk1 = back.root.children.find((x) => x.batchNo === 'BRK-000001');
assert.deepEqual(names(brk1), [cut.remnantNo, 'HN-1'].sort());
ok('backward: BRK-000001 made from the remnant and heat HN-1');
const hnNode = brk1.children.find((x) => x.batchNo === 'HN-1');
assert.equal(hnNode.receipts.length, 1);
ok('backward reaches the purchase receipt of HN-1');
assert.deepEqual(back.root.deliveries.map((d) => [d.customer, d.invoice]), [['Space agency', invSub.number]]);
ok(`SAT-000003 shipped to the customer on ${invSub.number}`);

const fwd = await c.req('GET', `/manufacturing/genealogy/${hn1.id}?direction=forward`);
const all = [];
const walk = (n) => (all.push(n), n.children.forEach(walk));
walk(fwd.root);
const reached = new Set(all.map((n) => n.batchNo));
for (const no of [cut.remnantNo, 'BRK-000001', 'BRK-000004', 'SAT-000003', 'SAT-000004']) assert.ok(reached.has(no), no);
assert.ok(!reached.has('SAT-000001') && !reached.has('SAT-000002'));
ok('forward from HN-1: remnant → brackets → satellites SAT-000003/4 (cancelled SAT-000001/2 excluded)');
const recall = await c.req('GET', `/manufacturing/genealogy/${hn1.id}/recall`);
const satRows = recall.rows.filter((r) => r.itemCode === 'SAT-STR');
assert.deepEqual(satRows.map((r) => [r.batchNo, r.deliveries.length, r.stock.length]).sort(), [['SAT-000003', 1, 0], ['SAT-000004', 0, 1]]);
ok('recall list: SAT-000003 at the customer, SAT-000004 still in finished goods');
const csv = await fetch(`${c.base}/manufacturing/genealogy/${hn1.id}/recall.csv`, { headers: { Cookie: c.cookie, 'x-tenant-id': c.tenantId, 'x-entity-id': c.entityId, Origin: c.origin } });
assert.equal(csv.status, 200);
const text = await csv.text();
assert.match(text, /"SAT-000003".*"Space agency"/);
assert.match(text, /^"Level","Item"/);
c.checks++;
ok('recall list exports as CSV');

console.log(`\nGenealogy smoke passed: ${c.checks} checks`);
