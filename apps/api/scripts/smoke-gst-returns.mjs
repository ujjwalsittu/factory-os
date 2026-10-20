// GST returns PR 1 (decision 074): GSTR-1 and GSTR-3B prepared from the books per GSTIN and month, checked against
// each other and the ledger, maker-checker, filing, filed-month warnings, late documents, sheet exports, isolation.
// Run with: node --env-file=../../.env scripts/smoke-gst-returns.mjs (API on http://localhost:4000 or $API).
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { Client, gstin } from './accounting-test-helpers.mjs';
import { fixture } from './sales-notes-test-helpers.mjs';
import { createDb } from '../../../packages/db/dist/index.js';

const db = createDb(process.env.DATABASE_URL);
try {
  const { c, reg, item, invoice } = await fixture('GST returns', '18');
  const period = c.settings.cutoverDate.slice(0, 7);
  const next = (() => { const [y, m] = period.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; })();

  // A registered buyer (B2B), the fixture's unregistered buyer (B2CS) and a registered supplier (input tax).
  const buyer = await c.req('POST', '/parties', { code: 'B2B', name: 'Registered buyer', isCustomer: true, gstTreatment: 'registered', gstin: gstin('27AAACB1234B1Z'), stateCode: '27' }, 201);
  const b2bDraft = await c.req('POST', '/sales-invoices', { customerId: buyer.id, gstRegistrationId: reg.id, invoiceDate: c.settings.cutoverDate, placeOfSupplyStateCode: '27', lines: [{ itemId: item.id, qty: '2', rate: '500', gstRate: '18' }] }, 201);
  await c.req('POST', `/sales-invoices/${b2bDraft.id}/submit`, {}, 201);
  const b2b = await c.req('GET', `/sales-invoices/${b2bDraft.id}`);
  const supplier = await c.req('POST', '/parties', { code: 'SUP', name: 'Registered supplier', isSupplier: true, gstTreatment: 'registered', gstin: gstin('27AAACC1234B1Z'), stateCode: '27' }, 201);
  const pi = await c.req('POST', '/purchase-invoices', { supplierId: supplier.id, supplierInvoiceNo: 'S-1', supplierInvoiceDate: c.settings.cutoverDate, postingDate: c.settings.cutoverDate, lines: [{ itemId: item.id, qty: '1', rate: '200' }] }, 201);
  await c.req('POST', `/purchase-invoices/${pi.id}/submit`, {}, 201);

  // Preview: sections, 3B tables and checks straight from the books.
  const q = `gstRegistrationId=${reg.id}&period=${period}`;
  const p = await c.req('GET', `/gst-returns/preview?${q}`);
  const e = p.gstr1.entries.find((x) => x.documentId === b2b.id);
  assert.equal(e.section, 'b2b');
  assert.deepEqual(e.amounts, { taxable: '1000.00', igst: '0.00', cgst: '90.00', sgst: '90.00', cess: '0.00' });
  assert.equal(p.gstr1.totals.b2cs.taxable, '100.00', 'The unregistered intra-State sale is B2CS');
  assert.equal(p.gstr1.hsn.find((h) => h.part === 'b2b').uqc, 'NOS');
  assert.equal(p.gstr3b['3.1'].a.taxable, '1100.00');
  assert.equal(p.gstr3b['4'].a5.cgst, '18.00', 'Purchase input tax is "all other ITC"');
  assert.ok(p.checks.every((x) => x.ok), JSON.stringify(p.checks));
  await c.req('GET', `/gst-returns/preview?gstRegistrationId=${reg.id}&period=2026-13`, undefined, 400);

  // Prepare both returns as drafts; preparing again keeps one row per kind.
  const first = await c.req('POST', '/gst-returns/prepare', { gstRegistrationId: reg.id, period }, 200);
  assert.deepEqual(first.map((r) => r.kind).sort(), ['gstr1', 'gstr3b']);
  const again = await c.req('POST', '/gst-returns/prepare', { gstRegistrationId: reg.id, period }, 200);
  assert.deepEqual(again.map((r) => r.id).sort(), first.map((r) => r.id).sort(), 'Re-preparing replaces the drafts');
  assert.equal((await c.req('GET', '/gst-returns')).length, 2);
  const g1 = again.find((r) => r.kind === 'gstr1'), g3 = again.find((r) => r.kind === 'gstr3b');
  const read = await c.req('GET', `/gst-returns/${g1.id}`);
  assert.ok(read.lines.some((l) => l.documentId === b2b.id && l.section === 'b2b'));
  assert.ok(read.lines.some((l) => l.section === 'summary'), 'B2CS documents are recorded too');

  // Books changing after preparation stop the review until the return is prepared again.
  const stray = await invoice('10');
  await c.req('POST', `/gst-returns/${g1.id}/review`, {}, 409);
  await c.req('POST', `/sales-invoices/${stray.id}/cancel`, { reason: 'Raised by mistake' }, 201);
  await c.req('POST', '/gst-returns/prepare', { gstRegistrationId: reg.id, period }, 200);

  // Maker-checker: the preparer reviews but cannot approve; a finance controller approves and files.
  await c.req('POST', `/gst-returns/${g1.id}/review`, {}, 200);
  await c.req('POST', `/gst-returns/${g1.id}/approve`, {}, 403);
  const roles = await c.req('GET', '/roles');
  const role = roles.find((r) => r.name === 'Finance Controller');
  const email = `gst-checker-${Date.now()}@example.com`;
  const invite = await c.req('POST', '/invitations', { email, roles: [{ roleId: role.id, entityIds: [c.entityId] }] }, 201);
  await new Promise((r) => setTimeout(r, 11000));
  const fc = new Client();
  await fc.req('POST', '/auth/sign-up/email', { name: 'GST checker', email, password: 'Sup3r-secret-pw' });
  await fc.req('POST', '/invitations/accept', { token: invite.inviteUrl.split('/').at(-1) }, 201);
  fc.tenantId = c.tenantId; fc.entityId = c.entityId;
  await fc.req('POST', `/gst-returns/${g3.id}/approve`, {}, 409);
  await fc.req('POST', `/gst-returns/${g1.id}/approve`, {}, 200);
  await c.req('POST', '/gst-returns/prepare', { gstRegistrationId: reg.id, period }, 409);
  await fc.req('POST', `/gst-returns/${g1.id}/file`, { arn: 'x' }, 400);
  const filed = await fc.req('POST', `/gst-returns/${g1.id}/file`, { arn: 'AA2710260000001', filedOn: c.settings.cutoverDate }, 200);
  assert.equal(filed.status, 'filed');
  await c.req('POST', `/gst-returns/${g3.id}/review`, {}, 200);
  await fc.req('POST', `/gst-returns/${g3.id}/approve`, {}, 200);
  await fc.req('POST', `/gst-returns/${g3.id}/file`, { arn: 'AA2710260000002', filedOn: c.settings.cutoverDate }, 200);

  // A filed return's lines are frozen in the database too.
  await assert.rejects(db.$client.query("update gst_return_line set document_number = 'X' where return_id = $1", [g1.id]), /filed/);
  await assert.rejects(db.$client.query('delete from gst_return where id = $1', [g1.id]), /filed/);

  // Filed-month warning: cancelling needs confirmation and a reason, then shows as changed since filing.
  const blocked = await c.raw('POST', `/sales-invoices/${b2b.id}/cancel`, { reason: 'Wrong buyer' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'gst_return_filed');
  await c.req('POST', `/sales-invoices/${b2b.id}/cancel`, { reason: 'Wrong buyer', confirmFiledReturn: true }, 201);
  const changed = await c.req('GET', `/gst-returns/${g1.id}`);
  assert.ok(changed.changedSinceFiling.some((x) => x.documentId === b2b.id), 'The cancelled invoice shows as changed since filing');
  const changed3b = await c.req('GET', `/gst-returns/${g3.id}`);
  assert.deepEqual(changed3b.changedSinceFiling.map((x) => [x.documentId, x.what]), [[b2b.id, 'Cancelled or no longer in this month since filing']], 'The filed 3B names the cancelled invoice, nothing else');
  const audit = await db.$client.query("select 1 from audit_event where action = 'gst_return.filed_month_change' and target_id = $1", [b2b.id]);
  assert.equal(audit.rowCount, 1);

  // A document dated in the filed month and submitted later goes to the next return as late.
  const late = await c.req('POST', '/sales-invoices', { customerId: buyer.id, gstRegistrationId: reg.id, invoiceDate: c.settings.cutoverDate, placeOfSupplyStateCode: '27', lines: [{ itemId: item.id, qty: '1', rate: '300', gstRate: '18' }] }, 201);
  await c.req('POST', `/sales-invoices/${late.id}/submit`, {}, 409);
  await c.req('POST', `/sales-invoices/${late.id}/submit`, { confirmFiledReturn: true, filedReturnReason: 'Invoice raised late' }, 201);
  const nov = await c.req('POST', '/gst-returns/prepare', { gstRegistrationId: reg.id, period: next }, 200);
  const novG1 = await c.req('GET', `/gst-returns/${nov.find((r) => r.kind === 'gstr1').id}`);
  assert.equal(novG1.lines.find((l) => l.documentId === late.id)?.late, period, 'The late invoice is in the next GSTR-1, marked late');

  // A manual journal on an output tax ledger is a difference the ledger check names.
  const j = await c.req('POST', '/accounts/journals', { postingDate: c.settings.cutoverDate, narration: 'Stray tax entry', lines: [c.line('output_cgst', '5'), c.line('equity', '0', '5')] }, 201);
  await c.req('POST', `/accounts/journals/${j.id}/submit`);
  const glCheck = (await c.req('GET', `/gst-returns/preview?${q}`)).checks.find((x) => x.name === 'Output tax equals the output GST ledgers');
  assert.equal(glCheck.ok, false, JSON.stringify(glCheck));
  const jRead = await c.req('GET', `/accounts/journals/${j.id}`);
  assert.ok(glCheck.detail.includes(jRead.number), `The check names the journal: ${glCheck.detail}`);

  // Exports: a zip of section sheets.
  const res = await fetch(`${c.base}/gst-returns/${g1.id}/export`, { headers: { Origin: c.origin, Cookie: c.cookie, 'x-tenant-id': c.tenantId, 'x-entity-id': c.entityId } });
  assert.equal(res.status, 200);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  assert.ok(files['b2b.csv'] && files['hsn.csv'] && files['README.txt'], Object.keys(files).join(','));
  assert.match(new TextDecoder().decode(files['b2b.csv']), /27AAACB1234B1Z/);

  // Isolation: another tenant sees neither returns nor the registration.
  const other = await new Client().init('GST returns outsider');
  await other.req('GET', `/gst-returns/${g1.id}`, undefined, 404);
  await other.req('GET', `/gst-returns/preview?${q}`, undefined, 404);
  assert.equal((await other.req('GET', '/gst-returns')).length, 0);
  console.log('PASS gst returns', c.checks + fc.checks + other.checks);
} finally {
  await db.$client.end();
}
