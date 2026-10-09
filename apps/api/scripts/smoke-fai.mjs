// First article inspection (AS9102) and certificate packs (decision 048): Forms 1–3 from item, genealogy, job work
// and the final inspection; maker-checker approval; the sales-invoice gate; process-change trigger; zip pack.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-fai.mjs   (API with STORAGE_DRIVER=local)
import assert from 'node:assert/strict';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Fai');
const fail = async (method, path, body, status, label, pattern, who = c) => {
  const r = await who.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const headers = (who = c) => ({ Cookie: who.cookie, 'x-tenant-id': who.tenantId, 'x-entity-id': who.entityId, Origin: who.origin });
const attach = async (ownerType, ownerId, kind, fileName, text) => {
  const r = await fetch(`${c.base}/attachments?${new URLSearchParams({ ownerType, ownerId, kind, fileName })}`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/pdf' }, body: Buffer.from(`%PDF-1.4\n${text}\n%%EOF\n`) });
  assert.equal(r.status, 201, await r.text());
};

const date = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const reg = await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const bar = await c.req('POST', '/items', { code: 'TI64', name: 'Ti-6Al-4V bar', type: 'raw_material', tracking: 'batch', stockUomId: u('KG'), hsnCode: '81089090' }, 201);
const lugBody = { code: 'LUG-B', name: 'Antenna lug', type: 'finished_good', tracking: 'batch', stockUomId: u('NOS'), hsnCode: '88073000', revision: 'B', drawingNo: 'AZ-DRG-1042', requiresFinalInspection: true, requiresFai: true };
const lug = await c.req('POST', '/items', lugBody, 201);
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const fg = await c.req('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' }, 201);
const supplier = await c.req('POST', '/parties', { code: 'TIMET', name: 'Titanium Metals', isSupplier: true, gstin: gstin('27AAACT1234B1Z') }, 201);
const anodiser = await c.req('POST', '/parties', { code: 'ANOD', name: 'Pune Anodisers', isSupplier: true, isJobWorker: true, gstin: gstin('27AAACP1234B1Z') }, 201);
const customer = await c.req('POST', '/parties', { code: 'ISRO', name: 'Space customer', isCustomer: true, gstin: gstin('29AAACI1234B1Z'), addresses: [{ label: 'Site', line1: 'Road 1', city: 'Bengaluru', stateCode: '29', pincode: '560001' }] }, 201);
const rec = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: date, partyId: supplier.id, lines: [{ itemId: bar.id, qty: '10', toWarehouseId: sto.id, newBatchNo: 'HT-5501', heatNo: 'HT-5501', rate: '3000' }] }, 201);
await c.req('POST', `/stock-entries/${rec.id}/submit`, {}, 201);
const heat = (await c.req('GET', `/batches?itemId=${bar.id}`))[0];
await attach('batch', heat.id, 'mtc', 'MTC HT-5501.pdf', 'mill certificate');

const plan = await c.req('POST', '/quality/plans', {
  itemId: lug.id,
  stage: 'final',
  revision: 'A',
  characteristics: [
    { balloon: '1', description: 'Hole Ø6.0', kind: 'dimension', nominal: '6', lowerLimit: '6.00', upperLimit: '6.05', unit: 'mm', isKey: true },
    { balloon: '2', description: 'Anodise thickness', kind: 'dimension', lowerLimit: '10', upperLimit: '25', unit: 'µm', sampleSize: 1 },
    { balloon: '3', description: 'Proof load 2 kN', kind: 'functional', sampleSize: 1 },
  ],
}, 201);
await c.req('POST', `/quality/plans/${plan.id}/activate`, {}, 201);
const mic = await c.req('POST', '/quality/gauges', { code: 'MIC', description: 'Micrometer', intervalDays: 365, lastCalibrated: date }, 201);

// Make two lugs with an outsourced anodise step.
const wc = await c.req('POST', '/manufacturing/work-centres', { code: 'MILL', name: 'Milling', hourlyRate: '1500' }, 201);
const bom = await c.req('POST', '/manufacturing/boms', { itemId: lug.id, revision: 'A', materials: [{ itemId: bar.id, qty: '0.5' }], operations: [{ seq: 10, name: 'Mill', workCentreId: wc.id }, { seq: 20, name: 'Anodise', outsourced: true, supplierId: anodiser.id }] }, 201);
await c.req('POST', `/manufacturing/boms/${bom.id}/activate`, {}, 201);
let wo = await c.req('POST', '/manufacturing/work-orders', { itemId: lug.id, plannedQty: '2', sourceWarehouseId: sto.id, targetWarehouseId: fg.id }, 201);
wo = await c.req('POST', `/manufacturing/work-orders/${wo.id}/release`, {}, 201);
await c.req('POST', `/manufacturing/work-orders/${wo.id}/issue`, { postingDate: date, lines: [{ itemId: bar.id, qty: '1', batchId: heat.id }] }, 201);
const anodise = wo.operations.find((o) => o.seq === 20);
await c.req('POST', `/manufacturing/work-orders/${wo.id}/operations/${anodise.id}/send`, { postingDate: date, qty: '2' }, 201);
await c.req('POST', `/manufacturing/work-orders/${wo.id}/operations/${anodise.id}/receive`, { postingDate: date, qty: '2', jobWorkerChallanNo: 'PA/90' }, 201);
const jw = await c.req('GET', `/manufacturing/work-orders/${wo.id}/job-work`);
const jwo = await c.req('GET', `/manufacturing/job-work/${jw.orders[0].id}`);
await attach('job_work_receipt', jwo.receipts[0].id, 'coc', 'Anodise CoC PA-90.pdf', 'certificate of conformance');
await c.req('POST', `/manufacturing/work-orders/${wo.id}/output`, { postingDate: date, qty: '2', batchNo: 'LUG-L1' }, 201);
const lot = (await c.req('GET', `/batches?itemId=${lug.id}`)).find((b) => b.batchNo === 'LUG-L1');
let ir = (await c.req('GET', '/quality/inspections?status=draft&stage=final'))[0];
ir = await c.req('GET', `/quality/inspections/${ir.id}`);
const [hole, coat, proof] = ir.characteristics;
await c.req('POST', `/quality/inspections/${ir.id}/results`, {
  results: [
    { characteristicId: hole.id, sampleNo: 1, measured: '6.02', gaugeId: mic.id },
    { characteristicId: hole.id, sampleNo: 2, measured: '6.03', gaugeId: mic.id },
    { characteristicId: coat.id, sampleNo: 1, measured: '18' },
    { characteristicId: proof.id, sampleNo: 1, pass: true, note: 'Held 2 kN for 30 s' },
  ],
}, 201);
await c.req('POST', `/quality/inspections/${ir.id}/submit`, { qtyAccepted: '2', qtyRejected: '0' }, 201);
await attach('inspection_record', ir.id, 'cmm', 'CMM LUG-L1.pdf', 'cmm report');
ok('two lugs made, anodised by a job worker, final inspection passed into finished goods');

// ── Gate: no invoice before the FAI ──
let req = await c.req('GET', `/quality/fai-requirement?itemId=${lug.id}`);
assert.equal(req.reason, 'first_build');
ok('first build of rev B needs an FAI');
const invoice = async (qty) => {
  const inv = await c.req('POST', '/sales-invoices', { customerId: customer.id, invoiceDate: date, gstRegistrationId: reg.id, lines: [{ itemId: lug.id, qty, rate: '9000', gstRate: '18', warehouseId: fg.id, batchId: lot.id }] }, 201);
  return inv;
};
const inv1 = await invoice('1');
await fail('POST', `/sales-invoices/${inv1.id}/submit`, {}, 400, 'the invoice is refused until the FAI is approved', /first article inspection \(first build\)/);

// ── FAI with Forms 1–3 ──
let f = await c.req('POST', '/quality/fais', { itemId: lug.id, batchId: lot.id, inspectionRecordId: ir.id }, 201);
assert.equal(f.reason, 'first_build');
assert.match(f.number, /FAI/);
assert.equal(f.forms.form1.partNumber, 'LUG-B');
assert.equal(f.forms.form1.revision, 'B');
assert.equal(f.forms.form1.drawingNo, 'AZ-DRG-1042');
assert.equal(f.forms.form1.serialOrLot, 'LUG-L1');
ok('Form 1: part, revision B, drawing and the first-article lot');
assert.ok(f.forms.form2.materials.some((m) => m.lot === 'HT-5501' && m.supplier === 'Titanium Metals'));
ok('Form 2: heat HT-5501 from Titanium Metals, from genealogy');
assert.ok(f.forms.form2.specialProcesses.some((p) => p.process === 'Anodise' && p.supplier === 'Pune Anodisers'));
ok('Form 2: anodising by Pune Anodisers, from the outsourced operation');
assert.deepEqual(f.forms.form2.functionalTests, [{ description: 'Proof load 2 kN', result: 'pass' }]);
ok('Form 2: proof-load functional test');
assert.deepEqual(f.forms.form3.characteristics.map((x) => [x.balloon, x.results.join('/'), x.result]), [['1', '6.020000/6.030000', 'pass'], ['2', '18.000000', 'pass'], ['3', 'OK', 'pass']]);
ok('Form 3: three ballooned characteristics with results');
await fail('POST', '/quality/fais', { itemId: lug.id }, 409, 'one FAI in progress per item', /already in progress/);
f = await c.req('POST', `/quality/fais/${f.id}/submit`, {}, 201);
assert.equal(f.status, 'submitted');
await fail('POST', `/quality/fais/${f.id}/approve`, {}, 409, 'the preparer can’t approve their own FAI', /someone other/);

// A second person approves.
const role = await c.req('POST', '/roles', { name: 'FAI approver', permissions: ['quality.fai.read', 'quality.fai.approve'] }, 201);
const approver = new Client();
const email = `fai-approver-${Date.now()}@example.com`;
const invitation = await c.req('POST', '/invitations', { email, roles: [{ roleId: role.id, entityIds: [c.entityId] }] }, 201);
await approver.req('POST', '/auth/sign-up/email', { name: 'Quality head', email, password: 'Sup3r-secret-pw' });
await approver.req('POST', '/invitations/accept', { token: invitation.inviteUrl.split('/').at(-1) }, 201);
approver.tenantId = c.tenantId;
approver.entityId = c.entityId;
await fail('POST', `/quality/fais/${f.id}/reject`, { note: 'no' }, 400, 'a rejection needs a reason', /reason/, approver);
f = await approver.req('POST', `/quality/fais/${f.id}/approve`, { note: 'Conforms to drawing rev B' }, 201);
assert.equal(f.status, 'approved');
assert.equal(f.decidedByName, 'Quality head');
ok('approved by a second person');
req = await c.req('GET', `/quality/fai-requirement?itemId=${lug.id}`);
assert.equal(req.reason, null);
await c.req('POST', `/sales-invoices/${inv1.id}/submit`, {}, 201);
ok('with the FAI approved the lug invoices');

// ── A process change needs a new FAI ──
await c.req('PATCH', `/items/${lug.id}`, { ...Object.fromEntries(Object.entries(lugBody).filter(([k]) => k !== 'code')), faiProcessChange: true }, 200);
req = await c.req('GET', `/quality/fai-requirement?itemId=${lug.id}`);
assert.equal(req.reason, 'process_change');
const inv2 = await invoice('1');
await fail('POST', `/sales-invoices/${inv2.id}/submit`, {}, 400, 'after a process change the next invoice waits for a new FAI', /process change/);

// ── Certificate pack ──
const pack = await c.req('GET', `/quality/certificate-pack/${lot.id}`);
assert.deepEqual(pack.files.map((x) => x.kind).sort(), ['cmm', 'coc', 'mtc']);
ok('the pack collects the heat MTC, the anodiser CoC and the CMM report along the genealogy');
const zip = await fetch(`${c.base}/quality/certificate-pack/${lot.id}?format=zip`, { headers: headers() });
assert.equal(zip.status, 200);
assert.equal(zip.headers.get('content-type'), 'application/zip');
const bytes = Buffer.from(await zip.arrayBuffer());
assert.equal(bytes.subarray(0, 2).toString(), 'PK');
assert.ok(bytes.includes(Buffer.from('manifest.txt')) && bytes.includes(Buffer.from('mtc/MTC HT-5501.pdf')));
ok('the zip holds the files and a manifest');

console.log(`\nFAI smoke passed (${c.checks} request checks).`);
