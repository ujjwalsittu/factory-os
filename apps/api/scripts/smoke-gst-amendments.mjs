// GST returns PR 3 (decision 074b): corrections to a filed month are proposed as amendments in the next GSTR-1, a
// person includes or drops each, and GSTR-3B of the amending month carries the difference.
// Run with: node --env-file=../../.env scripts/smoke-gst-amendments.mjs (API on http://localhost:4000 or $API).
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { Client, gstin } from './accounting-test-helpers.mjs';
import { fixture } from './sales-notes-test-helpers.mjs';
import { createDb } from '../../../packages/db/dist/index.js';

const db = createDb(process.env.DATABASE_URL);
try {
  // October: a B2C sale (the fixture's invoice of 100), two B2B invoices and a credit note on the second.
  const { c, reg, item, inv } = await fixture('GST amendments', '18');
  const date = c.settings.cutoverDate;
  const oct = date.slice(0, 7);
  const nov = (() => { const [y, m] = oct.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; })();
  const buyer = await c.req('POST', '/parties', { code: 'B2B', name: 'Registered buyer', isCustomer: true, gstTreatment: 'registered', gstin: gstin('27AAACB1234B1Z'), stateCode: '27' }, 201);
  const sell = async (rate) => {
    const d = await c.req('POST', '/sales-invoices', { customerId: buyer.id, gstRegistrationId: reg.id, invoiceDate: date, placeOfSupplyStateCode: '27', lines: [{ itemId: item.id, qty: '1', rate, gstRate: '18' }] }, 201);
    await c.req('POST', `/sales-invoices/${d.id}/submit`, {}, 201);
    return c.req('GET', `/sales-invoices/${d.id}`);
  };
  const first = await sell('1000');
  const second = await sell('500');
  const note = await c.req('POST', '/sales-notes', { invoiceId: second.id, kind: 'credit', taxTreatment: 'gst', postingDate: date, reason: 'Price correction agreed', taxEligibilityConfirmed: true, lines: [{ invoiceLineId: second.lines[0].id, mode: 'value', taxableAmount: '40' }] }, 201);
  await c.req('POST', `/sales-notes/${note.id}/submit`, {}, 201);

  // File October with a second person approving.
  const prep = await c.req('POST', '/gst-returns/prepare', { gstRegistrationId: reg.id, period: oct }, 200);
  const roles = await c.req('GET', '/roles');
  const email = `gst-amend-${Date.now()}@example.com`;
  const invite = await c.req('POST', '/invitations', { email, roles: [{ roleId: roles.find((r) => r.name === 'Finance Controller').id, entityIds: [c.entityId] }] }, 201);
  await new Promise((r) => setTimeout(r, 11000));
  const fc = new Client();
  await fc.req('POST', '/auth/sign-up/email', { name: 'GST checker', email, password: 'Sup3r-secret-pw' });
  await fc.req('POST', '/invitations/accept', { token: invite.inviteUrl.split('/').at(-1) }, 201);
  fc.tenantId = c.tenantId; fc.entityId = c.entityId;
  for (const [i, r] of prep.entries()) {
    await c.req('POST', `/gst-returns/${r.id}/review`, {}, 200);
    await fc.req('POST', `/gst-returns/${r.id}/approve`, {}, 200);
    await fc.req('POST', `/gst-returns/${r.id}/file`, { arn: `AA27102600000${i}1`, filedOn: date }, 200);
  }
  const octG1 = prep.find((r) => r.kind === 'gstr1');

  // Nothing changed yet: November proposes nothing.
  assert.deepEqual((await c.req('GET', `/gst-returns/preview?gstRegistrationId=${reg.id}&period=${nov}`)).gstr1.amendments, []);

  // After filing: the first invoice and the credit note are cancelled, and the B2C sale too.
  const confirm = { confirmFiledReturn: true };
  await c.req('POST', `/sales-notes/${note.id}/cancel`, { reason: 'Issued against the wrong invoice', ...confirm }, 201);
  await c.req('POST', `/sales-invoices/${first.id}/cancel`, { reason: 'Raised in error', ...confirm }, 201);
  await c.req('POST', `/sales-invoices/${inv.id}/cancel`, { reason: 'Walk-in sale returned', ...confirm }, 201);

  // The filed October GSTR-1 shows only what changed (unchanged invoices are not reported as changed).
  const changed = (await c.req('GET', `/gst-returns/${octG1.id}`)).changedSinceFiling.map((x) => x.documentId).sort();
  assert.deepEqual(changed, [first.id, inv.id, note.id].sort());

  // November proposes one amendment per change: B2BA and CDNRA to zero, and B2CSA for October.
  const novPrep = await c.req('POST', '/gst-returns/prepare', { gstRegistrationId: reg.id, period: nov }, 200);
  const novG1 = novPrep.find((r) => r.kind === 'gstr1'), novG3 = novPrep.find((r) => r.kind === 'gstr3b');
  let read = await c.req('GET', `/gst-returns/${novG1.id}`);
  const am = read.snapshot.gstr1.amendments;
  assert.deepEqual(am.map((a) => [a.table, a.status]).sort(), [['b2ba', 'proposed'], ['b2csa', 'proposed'], ['cdnra', 'proposed']]);
  const byTable = Object.fromEntries(am.map((a) => [a.table, a]));
  assert.equal(byTable.b2ba.documentId, first.id);
  assert.equal(byTable.b2ba.originalPeriod, oct);
  assert.deepEqual(byTable.b2ba.difference, { taxable: '-1000.00', igst: '0.00', cgst: '-90.00', sgst: '-90.00', cess: '0.00' });
  assert.equal(byTable.cdnra.difference.taxable, '40.00', 'Cancelling a credit note of 40 adds 40 back');
  assert.deepEqual(byTable.b2csa.revised.rows.map((r) => r.taxable), ['0.00']);
  assert.equal(byTable.b2csa.key, `b2cs:${oct}`);
  // Undecided amendments change nothing yet, and stop the review.
  assert.equal((await c.req('GET', `/gst-returns/${novG3.id}`)).snapshot.gstr3b['3.1'].a.taxable, '0.00');
  await c.req('POST', `/gst-returns/${novG1.id}/review`, {}, 409);

  // Decide: include B2BA and B2CSA, drop CDNRA (a reason is required).
  const idOf = (key) => read.amendments.find((a) => a.key === key).id;
  await c.req('POST', `/gst-returns/${novG1.id}/amendments/${idOf(first.id)}/include`, {}, 200);
  await c.req('POST', `/gst-returns/${novG1.id}/amendments/${idOf(note.id)}/drop`, {}, 400);
  await c.req('POST', `/gst-returns/${novG1.id}/amendments/${idOf(note.id)}/drop`, { reason: 'Corrected with the buyer directly' }, 200);
  await c.req('POST', `/gst-returns/${novG1.id}/amendments/${idOf(`b2cs:${oct}`)}/include`, {}, 200);
  await c.req('POST', `/gst-returns/${octG1.id}/amendments/${idOf(first.id)}/include`, {}, 409);

  // November 3B carries the included differences: -1000 and -100 taxable, CGST and SGST -90 and -9.
  const g3 = (await c.req('GET', `/gst-returns/${novG3.id}`)).snapshot;
  assert.deepEqual(g3.gstr3b['3.1'].a, { taxable: '-1100.00', igst: '0.00', cgst: '-99.00', sgst: '-99.00', cess: '0.00' });
  assert.deepEqual(g3.gstr3b['6.1'], { igst: '0.00', cgst: '-99.00', sgst: '-99.00', cess: '0.00' });
  assert.ok(g3.checks.find((x) => x.name === 'GSTR-1 tax equals 3B 3.1 output tax').ok);

  // Preparing again keeps the decisions while the figures are unchanged.
  await c.req('POST', '/gst-returns/prepare', { gstRegistrationId: reg.id, period: nov }, 200);
  read = await c.req('GET', `/gst-returns/${novG1.id}`);
  assert.deepEqual(read.snapshot.gstr1.amendments.map((a) => [a.table, a.status]).sort(), [['b2ba', 'included'], ['b2csa', 'included'], ['cdnra', 'dropped']]);
  assert.equal(read.amendments.find((a) => a.key === note.id).reason, 'Corrected with the buyer directly');
  const audit = await db.$client.query("select action from audit_event where action like 'gst_amendment.%' and tenant_id = $1 order by occurred_at", [c.tenantId]);
  assert.deepEqual(audit.rows.map((r) => r.action), ['gst_amendment.include', 'gst_amendment.drop', 'gst_amendment.include']);

  // The export carries the offline tool's amendment files: B2BA with the original reference revised to zero, and B2CSA.
  const res = await fetch(`${c.base}/gst-returns/${novG1.id}/export`, { headers: { Origin: c.origin, Cookie: c.cookie, 'x-tenant-id': c.tenantId, 'x-entity-id': c.entityId } });
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const b2ba = new TextDecoder().decode(files['b2ba.csv']).split('\r\n')[1];
  const toolDate = (iso) => `${Number(iso.slice(8, 10))}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;
  const num = first.number.replace(/\//g, '\\/');
  assert.match(b2ba, new RegExp(`^27AAACB1234B1Z.,,${num},${toolDate(date)},${num},${toolDate(date)},0\\.00,27-Maharashtra,N,,Regular B2B,,18,0\\.00,0\\.00$`), b2ba);
  assert.ok(files['b2csa.csv'] && !files['cdnra.csv'], Object.keys(files).join(','));

  // The database itself refuses a dropped amendment without a reason.
  await assert.rejects(db.$client.query("update gst_amendment set reason = null where return_id = $1 and status = 'dropped'", [novG1.id]), /dropped_reason/);
  // Before November is filed, the October return does not yet name it as having reported anything.
  assert.equal((await c.req('GET', `/gst-returns/${octG1.id}`)).changedSinceFiling.find((x) => x.documentId === first.id).amendedIn, undefined);

  // File November; the October return names the amendment that reported each change.
  await c.req('POST', `/gst-returns/${novG1.id}/review`, {}, 200);
  await fc.req('POST', `/gst-returns/${novG1.id}/approve`, {}, 200);
  await fc.req('POST', `/gst-returns/${novG1.id}/file`, { arn: 'AA2711260000001', filedOn: date }, 200);
  await assert.rejects(db.$client.query("update gst_amendment set status = 'dropped', reason = 'Changed later' where return_id = $1", [novG1.id]), /filed/);
  const octNow = await c.req('GET', `/gst-returns/${octG1.id}`);
  assert.equal(octNow.changedSinceFiling.find((x) => x.documentId === first.id).amendedIn, nov);
  assert.equal(octNow.changedSinceFiling.find((x) => x.documentId === note.id).amendedIn, undefined, 'A dropped amendment reported nothing');

  // December: the included ones are settled, and the dropped one is not proposed again.
  const dec = (() => { const [y, m] = nov.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; })();
  assert.deepEqual((await c.req('GET', `/gst-returns/preview?gstRegistrationId=${reg.id}&period=${dec}`)).gstr1.amendments, []);

  // Isolation: another tenant cannot decide this return's amendments.
  const other = await new Client().init('GST amendments outsider');
  await other.req('POST', `/gst-returns/${novG1.id}/amendments/${idOf(first.id)}/include`, {}, 404);
  console.log('PASS gst amendments', c.checks + fc.checks + other.checks);
} finally {
  await db.$client.end();
}
