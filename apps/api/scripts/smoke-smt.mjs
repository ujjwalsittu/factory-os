// SMT traceability (decision 065), end to end through the API:
//   - masters: paste items, boards per panel;
//   - containers: reels and paste jars from lots in stock, the MSL and paste clocks;
//   - feeder setup: wrong part, busy slot, splice, expiry and bake, paste thaw;
//   - panels: serials reserved per board, placement and depaneling scans, scrap;
//   - output of the boards and cancel/re-output reusing their serials;
//   - trace from a board to its reels and back from a reel or a lot;
//   - print jobs through the edge key (claim, retry, fail, reprint), ZPL download, isolation.
// Clocks are moved back by inserting older container events in the local database (test-only time travel).
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-smt.mjs   (DATABASE_URL from the env or ../../.env)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('SMT line');
const fail = async (method, path, body, status, label, pattern, who = c) => {
  const r = await who.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const API = `${process.env.API ?? 'http://localhost:4000'}/api`;
const dbUrl = process.env.DATABASE_URL ?? fs.readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1];
/** Test-only: a container event `hoursAgo` in the past (events are append-only, so older ones are inserted). */
const pastEvent = (containerId, kind, hoursAgo) =>
  execFileSync('psql', [dbUrl, '-qtAc', `insert into smt_container_event (tenant_id, container_id, kind, at, created_by) select tenant_id, id, '${kind}', now() - interval '${hoursAgo} hours', created_by from smt_container where id = '${containerId}'`]);
const edge = async (key, method, path, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, ...(body && { body: JSON.stringify(body) }) });
  c.checks++;
  return { status: r.status, data: await r.json() };
};

// ── Masters ──
await c.activate();
const date = c.settings.cutoverDate;
await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
await c.req('POST', '/hsn-codes', { code: '85340000', kind: 'hsn', description: 'Printed circuits', gstRate: '18', effectiveFrom: '2025-04-01' }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const mk = (code, name, o = {}) => c.req('POST', '/items', { code, name, type: 'component', tracking: 'batch', stockUomId: u('NOS'), hsnCode: '85340000', ...o }, 201);
const pcba = await mk('OBC-PCBA', 'On-board computer PCBA', { type: 'finished_good', tracking: 'serial', serialPrefix: 'OBC', revision: 'B' });
const mcu = await mk('IC-MCU', 'Microcontroller QFN-64', { mslLevel: '3' });
const res = await mk('RES-10K', 'Resistor 10k 0402');
const pcb = await mk('PCB-OBC', 'Bare board OBC');
const cap = await mk('CAP-1U', 'Capacitor 1µF 0603');
await fail('POST', '/items', { code: 'PASTE-X', name: 'Paste', type: 'consumable', tracking: 'batch', stockUomId: u('KG'), hsnCode: '85340000', pasteThawMinutes: 240 }, 400, 'paste needs both thaw and open times', /both/);
await fail('POST', '/items', { code: 'PASTE-Y', name: 'Paste', type: 'consumable', tracking: 'none', stockUomId: u('KG'), hsnCode: '85340000', pasteThawMinutes: 240, pasteOpenHours: 24 }, 400, 'paste must be batch-tracked', /batch-tracked/);
const paste = await mk('PASTE-SAC305', 'Solder paste SAC305 500 g', { type: 'consumable', stockUomId: u('KG'), pasteThawMinutes: 240, pasteOpenHours: 24 });
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const fg = await c.req('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' }, 201);
const receive = async (lines) => {
  const e = await c.req('POST', '/stock-entries', { postingDate: date, purpose: 'receipt', lines: lines.map(([itemId, qty, lot, rate, expiryDate]) => ({ itemId, qty, toWarehouseId: sto.id, newBatchNo: lot, rate, ...(expiryDate && { expiryDate }) })) }, 201);
  return c.req('POST', `/stock-entries/${e.id}/submit`, {}, 201);
};
await receive([
  [mcu.id, '100', 'MCU-L1', '120'],
  [mcu.id, '100', 'MCU-L2', '125'],
  [res.id, '5000', 'RES-L1', '0.2'],
  [pcb.id, '20', 'PCB-L1', '400'],
  [cap.id, '1000', 'CAP-L1', '0.5'],
  [paste.id, '2', 'PASTE-L1', '9000', '2099-12-31'],
]);
const lot = async (itemId, no) => (await c.req('GET', `/batches?itemId=${itemId}`)).find((b) => b.batchNo === no);
const lots = { mcu1: await lot(mcu.id, 'MCU-L1'), mcu2: await lot(mcu.id, 'MCU-L2'), res: await lot(res.id, 'RES-L1'), pcb: await lot(pcb.id, 'PCB-L1'), cap: await lot(cap.id, 'CAP-L1'), paste: await lot(paste.id, 'PASTE-L1') };
assert.ok(Object.values(lots).every(Boolean), 'lots found');
const smt = await c.req('POST', '/manufacturing/work-centres', { code: 'SMT', name: 'SMT line 1', hourlyRate: '3000' }, 201);
const placer = await c.req('POST', `/manufacturing/work-centres/${smt.id}/machines`, { code: 'AIMEX', name: 'FUJI AIMEX IIIc' }, 201);
const printerM = await c.req('POST', `/manufacturing/work-centres/${smt.id}/machines`, { code: 'GPX', name: 'FUJI GPX-CII paste printer' }, 201);
const bomBody = { itemId: pcba.id, revision: 'B', quantity: '1', boardsPerPanel: 4, materials: [{ itemId: mcu.id, qty: '1' }, { itemId: res.id, qty: '10' }, { itemId: pcb.id, qty: '1' }, { itemId: paste.id, qty: '0.01' }], operations: [{ seq: 10, name: 'SMT', workCentreId: smt.id, setupMinutes: '30', runMinutesPerUnit: '2' }] };
await fail('POST', '/manufacturing/boms', { ...bomBody, itemId: pcb.id, materials: [{ itemId: res.id, qty: '1' }] }, 400, 'boards per panel only for serial-tracked items', /serial-tracked/);
let bom = await c.req('POST', '/manufacturing/boms', bomBody, 201);
assert.equal(bom.boardsPerPanel, 4);
bom = await c.req('POST', `/manufacturing/boms/${bom.id}/activate`, {}, 201);
let wo = await c.req('POST', '/manufacturing/work-orders', { itemId: pcba.id, plannedQty: '8', sourceWarehouseId: sto.id, targetWarehouseId: fg.id }, 201);
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/release`, {}, 201);
await c.req('POST', `/manufacturing/work-orders/${wo.id}/issue`, { lines: [{ itemId: mcu.id, batchId: lots.mcu1.id, qty: '4' }, { itemId: mcu.id, batchId: lots.mcu2.id, qty: '4' }, { itemId: res.id, batchId: lots.res.id, qty: '80' }, { itemId: pcb.id, batchId: lots.pcb.id, qty: '8' }, { itemId: paste.id, batchId: lots.paste.id, qty: '0.08' }] }, 201);
ok('PCBA rev B, 4 boards per panel; work order for 8 released and materials issued');

// ── Printer behind the edge ──
const ed = await c.req('POST', '/plant/edges', { code: 'NM1', name: 'Plant edge' }, 201);
await fail('POST', '/plant/printers', { edgeId: ed.id, code: 'ZT-1', name: 'Line printer', host: '10.20.0.50', dpi: 250, widthMm: 50, heightMm: 25 }, 400, 'printer dpi is 203, 300 or 600');
await fail('POST', '/plant/printers', { edgeId: ed.id, code: 'ZT-1', name: 'Line printer', host: '10.20.0.50; rm', widthMm: 50, heightMm: 25 }, 400, 'printer host is a plain name or address');
const zt = await c.req('POST', '/plant/printers', { edgeId: ed.id, code: 'ZT-1', name: 'Line printer', host: '10.20.0.50', dpi: 300, widthMm: 50, heightMm: 25 }, 201);
const small = await c.req('POST', '/plant/printers', { edgeId: ed.id, code: 'ZT-2', name: 'Board label printer', host: '10.20.0.51', dpi: 600, widthMm: 20, heightMm: 10 }, 201);
ok('two label printers behind the plant edge');

// ── Reels and paste jars ──
const reel = (batchId, qty, o = {}) => c.req('POST', '/manufacturing/smt/containers', { kind: 'reel', batchId, qty, ...o }, 201);
const r1 = await reel(lots.mcu1.id, '50', { printerId: zt.id });
assert.equal(r1.container.code, 'R-MCU-L1-01');
assert.equal(r1.job.status, 'queued');
const r2 = (await reel(lots.mcu2.id, '50')).container;
const r3 = (await reel(lots.mcu1.id, '40', { code: 'SUP-REEL-778' })).container;
const rRes = (await reel(lots.res.id, '5000')).container;
const rCap = (await reel(lots.cap.id, '1000')).container;
await fail('POST', '/manufacturing/smt/containers', { kind: 'reel', batchId: lots.mcu1.id, qty: '10', code: 'SUP-REEL-778' }, 409, 'container codes are unique', /already exists/);
await fail('POST', '/manufacturing/smt/containers', { kind: 'paste', batchId: lots.res.id, qty: '1' }, 400, 'a paste jar needs a paste item', /paste thaw/);
await fail('POST', '/manufacturing/smt/containers', { kind: 'reel', batchId: lots.paste.id, qty: '1' }, 400, 'a paste is not a reel', /paste jar/);
const j1 = (await c.req('POST', '/manufacturing/smt/containers', { kind: 'paste', batchId: lots.paste.id, qty: '0.5' }, 201)).container;
const j2 = (await c.req('POST', '/manufacturing/smt/containers', { kind: 'paste', batchId: lots.paste.id, qty: '0.5' }, 201)).container;
assert.equal(j1.code, 'PJ-PASTE-L1-01');
ok('reels from lots in stock (auto or supplier codes) and paste jars; a label queued for the first');

let d = await c.req('GET', `/manufacturing/smt/containers/${r1.container.id}`);
assert.deepEqual([d.status.phase, d.status.clock.floorMinutes, d.status.blocked], ['sealed', 168 * 60, null]);
await fail('POST', `/manufacturing/smt/containers/${r1.container.id}/events`, { kind: 'cabinet_in' }, 409, 'a sealed reel cannot go into the dry cabinet', /sealed/);
await fail('POST', `/manufacturing/smt/containers/${r1.container.id}/events`, { kind: 'out_of_fridge' }, 400, 'reels have no paste events');
ok('a new MSL 3 reel is sealed with 168 h of floor life');

// ── Feeder setup ──
const load = (machineId, slot, code, o = {}) => c.raw('POST', '/manufacturing/smt/feeder/load', { workOrderId: wo.id, machineId, slot, code, ...o });
const loaded = async (machineId, slot, code, o) => {
  const r = await load(machineId, slot, code, o);
  assert.equal(r.status, 201, `${code} on ${slot}: ${JSON.stringify(r.data)}`);
  c.checks++;
  return r.data;
};
const refusedLoad = async (machineId, slot, code, pattern, label, o) => {
  const r = await load(machineId, slot, code, o);
  assert.equal(r.status, 409, `${label}: ${JSON.stringify(r.data)}`);
  assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
};
await refusedLoad(placer.id, 'F7', rCap.code, /Wrong part: CAP-1U/, 'a part that is not on the work order is refused');
let setup = await loaded(placer.id, 'F1', r1.container.code);
d = await c.req('GET', `/manufacturing/smt/containers/${r1.container.id}`);
assert.equal(d.status.phase, 'open');
assert.equal(d.events[0].kind, 'opened');
await refusedLoad(placer.id, 'F1', r2.code, /Slot F1 holds R-MCU-L1-01/, 'a busy slot is refused without a splice');
await refusedLoad(placer.id, 'F5', r1.container.code, /already on AIMEX slot F1/, 'a reel is on one feeder at a time');
await refusedLoad(placer.id, 'F9', r2.code, /Nothing to splice|empty/, 'a splice needs a reel to replace', { splice: true });
// A reel whose floor life ran out: opened 200 h ago.
pastEvent(r3.id, 'opened', 200);
await refusedLoad(placer.id, 'F3', r3.code, /Floor life used up/, 'a reel past its floor life must be baked first');
await c.req('POST', `/manufacturing/smt/containers/${r3.id}/events`, { kind: 'baked', note: '125 °C 24 h' }, 201);
d = await c.req('GET', `/manufacturing/smt/containers/${r3.id}`);
assert.deepEqual([d.status.phase, d.status.clock.usedMinutes, d.status.blocked], ['sealed', 0, null]);
ok('a bake resets the floor life');
setup = await loaded(placer.id, 'F2', rRes.code);
// Paste: cold, then thawing, then ready (out of the fridge 5 h ago).
await refusedLoad(printerM.id, 'PASTE', j1.code, /fridge/, 'cold paste is refused');
await c.req('POST', `/manufacturing/smt/containers/${j1.id}/events`, { kind: 'out_of_fridge' }, 201);
await refusedLoad(printerM.id, 'PASTE', j1.code, /Still thawing/, 'paste is refused while it thaws');
pastEvent(j2.id, 'out_of_fridge', 5);
setup = await loaded(printerM.id, 'PASTE', j2.code);
d = await c.req('GET', `/manufacturing/smt/containers/${j2.id}`);
assert.equal(d.status.phase, 'open');
ok('thawed paste loads on the printer and its open time starts');
assert.deepEqual(
  setup.materials.map((m) => [m.code, m.loaded]),
  [['IC-MCU', ['AIMEX F1']], ['RES-10K', ['AIMEX F2']], ['PCB-OBC', []], ['PASTE-SAC305', ['GPX PASTE']]],
);
ok('the work order shows what is loaded for each material');

// ── Panels ──
await fail('POST', `/manufacturing/smt/work-orders/${wo.id}/panels`, { count: 3 }, 409, 'panels only for the planned quantity', /At most 2/);
const pp = await c.req('POST', `/manufacturing/smt/work-orders/${wo.id}/panels`, { count: 2, printerId: zt.id }, 201);
assert.deepEqual(pp.panels.map((p) => p.code), [`P-${wo.number}-001`, `P-${wo.number}-002`]);
assert.deepEqual(pp.panels[0].serials, ['OBC-000001', 'OBC-000002', 'OBC-000003', 'OBC-000004']);
assert.deepEqual(pp.panels[1].serials, ['OBC-000005', 'OBC-000006', 'OBC-000007', 'OBC-000008']);
assert.match(pp.job.label, /001 … .*002/);
await fail('POST', `/manufacturing/smt/work-orders/${wo.id}/panels`, { count: 1 }, 409, 'no more panels than the order needs', /whole quantity/);
ok('two panels with eight board serials reserved and one label job');

const scan = (code, step, o = {}) => c.raw('POST', '/manufacturing/smt/panels/scan', { code, step, ...o });
const [P1, P2] = pp.panels.map((p) => p.code);
await fail('POST', '/manufacturing/smt/panels/scan', { code: P1, step: 'placed' }, 400, 'placement needs the machine', /placement machine/);
await fail('POST', '/manufacturing/smt/panels/scan', { code: P1, step: 'depaneled' }, 409, 'a panel is placed before it is depaneled', /placed yet/);
const empty = await c.req('POST', '/manufacturing/work-centres', { code: 'SMT2', name: 'SMT line 2', hourlyRate: '3000' }, 201);
const placer2 = await c.req('POST', `/manufacturing/work-centres/${empty.id}/machines`, { code: 'AIMEX-2', name: 'Second placer' }, 201);
await fail('POST', '/manufacturing/smt/panels/scan', { code: P1, step: 'placed', machineId: placer2.id }, 409, 'placement on a machine with nothing loaded is refused', /set up the feeders/);
const s1 = await scan(P1, 'placed', { machineId: placer.id });
assert.equal(s1.status, 201, JSON.stringify(s1.data));
assert.deepEqual(s1.data.notLoaded.sort(), ['PASTE-SAC305', 'PCB-OBC']);
await fail('POST', '/manufacturing/smt/panels/scan', { code: P1, step: 'placed', machineId: placer.id }, 409, 'a panel is placed once', /was placed/);
ok('panel 1 placed on AIMEX; materials not on its feeders are listed');

// Splice the MCU slot to reel 2, then place panel 2.
await loaded(placer.id, 'F1', r2.code, { splice: true });
d = await c.req('GET', `/manufacturing/smt/containers/${r1.container.id}`);
assert.equal(d.load, null);
const s2 = await scan(P2, 'placed', { machineId: placer.id });
assert.equal(s2.status, 201);
ok('a splice swaps F1 to the next reel; panel 2 is placed after it');

const dp = await scan(P1, 'depaneled', { printerId: small.id });
assert.equal(dp.status, 201, JSON.stringify(dp.data));
assert.equal(dp.data.job.label, `Boards of ${P1}`);
await fail('POST', '/manufacturing/smt/boards/scrap', { serial: 'OBC-000002', reason: 'AOI: bridged QFN pins, not repairable' }, 201, 'a board is scrapped with a reason');
await fail('POST', '/manufacturing/smt/boards/scrap', { serial: 'OBC-000002', reason: 'again' }, 409, 'a board is scrapped once', /already scrapped/);
ok('panel 1 depaneled with board labels; one board scrapped');

// ── Output ──
await fail('POST', `/manufacturing/work-orders/${wo.id}/output`, { qty: '4' }, 409, 'output takes only depaneled good boards', /Only 3 depaneled boards/);
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/output`, { qty: '3' }, 201);
let out = wo.movements.filter((m) => m.purpose === 'production_output');
assert.deepEqual(out[0].lines.map((l) => l.batchNo), ['OBC-000001', 'OBC-000003', 'OBC-000004']);
await fail('POST', `/manufacturing/work-orders/${wo.id}/output`, { qty: '1', boards: ['OBC-000001'] }, 409, 'a board is output once', /Not waiting for output/);
await fail('POST', `/manufacturing/work-orders/${wo.id}/output`, { qty: '1', boards: ['OBC-000005'] }, 409, 'a board on a panel not yet depaneled is not output', /Not waiting/);
await c.req('POST', '/manufacturing/smt/panels/scan', { code: P2, step: 'depaneled' }, 201);
await fail('POST', `/manufacturing/work-orders/${wo.id}/output`, { qty: '2', boards: ['OBC-000006'] }, 400, 'the scanned boards match the quantity', /Scan 2 boards/);
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/output`, { qty: '2', boards: ['OBC-000006', 'OBC-000005'] }, 201);
out = wo.movements.filter((m) => m.purpose === 'production_output' && m.status === 'submitted');
assert.deepEqual(out.map((m) => m.lines.map((l) => l.batchNo)).flat().sort(), ['OBC-000001', 'OBC-000003', 'OBC-000004', 'OBC-000005', 'OBC-000006']);
ok('output takes the reserved serials: oldest first, or scanned');

// Cancel the last output; the same boards go out again with their serials.
const last = out.find((m) => m.lines.some((l) => l.batchNo === 'OBC-000006'));
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/movements/${last.id}/cancel`, { reason: 'Booked to the wrong warehouse' }, 201);
setup = await c.req('GET', `/manufacturing/smt/work-orders/${wo.id}`);
assert.deepEqual([setup.counts.output, setup.counts.waiting, setup.counts.scrapped], [3, 4, 1]);
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/output`, { qty: '2', boards: ['OBC-000005', 'OBC-000006'] }, 201);
const again = wo.movements.filter((m) => m.purpose === 'production_output' && m.status === 'submitted').at(-1);
assert.deepEqual(again.lines.map((l) => l.batchNo), ['OBC-000005', 'OBC-000006']);
assert.deepEqual(again.lines.map((l) => l.batchId), last.lines.map((l) => l.batchId).reverse());
ok('a cancelled output frees its boards; output again reuses their serial batches');
// A unit received by hand under a reserved board serial is not taken over by that board's output.
const handRec = await c.req('POST', '/stock-entries', { postingDate: date, purpose: 'receipt', lines: [{ itemId: pcba.id, qty: '1', toWarehouseId: sto.id, newBatchNo: 'OBC-000008', rate: '5000' }] }, 201);
await c.req('POST', `/stock-entries/${handRec.id}/submit`, {}, 201);
await fail('POST', `/manufacturing/work-orders/${wo.id}/output`, { qty: '1', boards: ['OBC-000008'] }, 409, 'a serial batch from elsewhere is not reused for a board', /from elsewhere/);
await fail('POST', '/manufacturing/smt/boards/scrap', { serial: 'OBC-000007', reason: 'Wrong order scanned', workOrderId: pcba.id }, 404, 'scrap scoped to a work order finds only its boards', /on this work order/);

// ── Trace ──
const t1 = await c.req('GET', '/manufacturing/smt/boards/OBC-000001');
assert.equal(t1.panel.code, P1);
assert.deepEqual(t1.reels.map((r) => [r.slot, r.container.code, r.batchNo]), [['F1', 'R-MCU-L1-01', 'MCU-L1'], ['F2', rRes.code, 'RES-L1']]);
assert.equal(t1.reels[0].atPlacement.phase, 'open');
const t6 = await c.req('GET', '/manufacturing/smt/boards/OBC-000006');
assert.deepEqual(t6.reels.map((r) => [r.slot, r.batchNo]), [['F1', 'MCU-L2'], ['F2', 'RES-L1']]);
const byBatch = await c.req('GET', `/manufacturing/smt/batches/${t6.batchId}`);
assert.equal(byBatch.board.serialNo, 'OBC-000006');
ok('each board shows the reels and lots it was placed with (before and after the splice)');
const recall = await c.req('GET', `/manufacturing/smt/batches/${lots.mcu1.id}`);
assert.deepEqual(recall.boards.map((b) => [b.serialNo, b.scrapped]), [['OBC-000001', false], ['OBC-000002', true], ['OBC-000003', false], ['OBC-000004', false]]);
const viaReel = await c.req('GET', `/manufacturing/smt/containers/${r2.id}`);
assert.deepEqual(viaReel.boards.map((b) => b.serialNo), ['OBC-000005', 'OBC-000006', 'OBC-000007', 'OBC-000008']);
const resolved = await c.req('GET', `/manufacturing/smt/resolve?code=${encodeURIComponent(P2)}`);
assert.equal(resolved.kind, 'panel');
assert.equal((await c.req('GET', '/manufacturing/smt/resolve?code=OBC-000003')).kind, 'board');
ok('recall: lot MCU-L1 → panel 1 boards; reel 2 → panel 2 boards; scans resolve');

// ── Containers after use ──
await fail('POST', `/manufacturing/smt/containers/${rRes.id}/events`, { kind: 'cabinet_in' }, 409, 'a loaded reel goes into the cabinet only after unloading', /unload it first/);
d = await c.req('POST', `/manufacturing/smt/containers/${rRes.id}/events`, { kind: 'empty' }, 201);
assert.deepEqual([d.status.phase, d.load], ['empty', null]);
await c.req('POST', '/manufacturing/smt/feeder/unload', { workOrderId: wo.id, machineId: placer.id, slot: 'F1' }, 201);
await c.req('POST', `/manufacturing/smt/containers/${r2.id}/events`, { kind: 'cabinet_in' }, 201);
d = await c.req('GET', `/manufacturing/smt/containers/${r2.id}`);
assert.equal(d.status.phase, 'cabinet');
const list = await c.req('GET', '/manufacturing/smt/containers');
assert.equal(list.some((x) => x.code === rRes.code), false);
assert.equal((await c.req('GET', '/manufacturing/smt/containers?all=1')).some((x) => x.code === rRes.code), true);
ok('emptying a loaded reel unloads it; the dry cabinet pauses another; empties leave the list');

// ── Printing through the edge ──
assert.equal((await edge('fos_edge_nope', 'GET', '/iot/print-jobs')).status, 401);
const claimed = await edge(ed.key, 'GET', '/iot/print-jobs');
assert.equal(claimed.status, 200);
assert.deepEqual(claimed.data.jobs.map((j) => j.host), ['10.20.0.50', '10.20.0.50', '10.20.0.51']);
assert.ok(claimed.data.jobs[0].zpl.startsWith('^XA'));
assert.equal((await edge(ed.key, 'GET', '/iot/print-jobs')).data.jobs.length, 0);
const [ja, jb, jc] = claimed.data.jobs;
assert.equal((await edge(ed.key, 'POST', `/iot/print-jobs/${ja.id}/result`, { ok: true })).data.status, 'printed');
assert.equal((await edge(ed.key, 'POST', `/iot/print-jobs/${jb.id}/result`, { ok: false, error: 'Connection refused' })).data.status, 'queued');
assert.equal((await edge(ed.key, 'POST', `/iot/print-jobs/${jc.id}/result`, { ok: true })).data.status, 'printed');
ok('the edge claims queued jobs once, reports printed or retries a failure');
for (let i = 0; i < 2; i++) {
  const [j] = (await edge(ed.key, 'GET', '/iot/print-jobs')).data.jobs;
  assert.equal(j.id, jb.id);
  await edge(ed.key, 'POST', `/iot/print-jobs/${j.id}/result`, { ok: false, error: 'Paper out' });
}
let jobs = await c.req('GET', '/plant/print-jobs');
const failed = jobs.find((j) => j.id === jb.id);
assert.deepEqual([failed.status, failed.attempts, failed.error], ['failed', 3, 'Paper out']);
const re = await c.req('POST', `/plant/print-jobs/${jb.id}/reprint`, {}, 201);
assert.equal(re.status, 'queued');
// Retiring a printer fails its queued and in-flight labels.
await c.req('POST', `/plant/printers/${small.id}/test`, {}, 201);
const inFlight = (await edge(ed.key, 'GET', '/iot/print-jobs')).data.jobs.find((j) => j.host === '10.20.0.51');
assert.ok(inFlight);
await c.req('POST', `/plant/printers/${small.id}/retire`, {}, 201);
jobs = await c.req('GET', '/plant/print-jobs');
assert.deepEqual([jobs.find((j) => j.id === inFlight.id).status, jobs.find((j) => j.id === inFlight.id).error], ['failed', 'The printer was retired']);
ok('retiring a printer fails its labels in flight too');
const theirs = await new Client().init('Elsewhere SMT');
const theirEdge = await theirs.req('POST', '/plant/edges', { code: 'X1', name: 'Theirs' }, 201);
assert.equal((await edge(theirEdge.key, 'GET', '/iot/print-jobs')).data.jobs.length, 0);
assert.equal((await edge(theirEdge.key, 'POST', `/iot/print-jobs/${re.id}/result`, { ok: true })).status, 404);
ok('after three failures a job stays failed; reprint queues it again; other edges see none of it');

// ZPL download and isolation
const zr = await fetch(`${API}/manufacturing/smt/labels/panel/${pp.panels[0].id}?printerId=${zt.id}`, { headers: { Origin: c.origin, Cookie: c.cookie, 'x-tenant-id': c.tenantId, 'x-entity-id': c.entityId } });
const zpl = await zr.text();
assert.equal(zr.status, 200);
assert.match(zr.headers.get('content-type'), /text\/plain/);
assert.match(zpl, /\^BXN,4,200\^FH_\^FDP-/);
c.checks++;
await fail('GET', `/manufacturing/smt/containers/${r1.container.id}`, undefined, 404, 'another tenant cannot read our reels', undefined, theirs);
await fail('GET', '/manufacturing/smt/boards/OBC-000001', undefined, 404, 'or trace our boards', undefined, theirs);
await fail('POST', '/manufacturing/smt/feeder/load', { workOrderId: wo.id, machineId: placer.id, slot: 'F1', code: r2.code }, 404, 'or load our feeders', undefined, theirs);
ok('ZPL downloads at the printer size; isolation holds');

console.log(`\nSMT smoke passed (${c.checks + theirs.checks} request checks).`);
