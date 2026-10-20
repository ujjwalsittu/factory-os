// Tally import of masters (decision 072), end to end through the API:
//   - read and stage a TallyPrime XML export (UTF-16, as Tally writes it): nothing is written to masters;
//   - a primary group the company created is classified from Tally's flags, and the ledgers in it follow;
//   - proposed actions: standard groups and units link, tax ledgers wait for opening balances, new records are new;
//   - commit creates groups under their parents, ledgers, customers and suppliers with GSTIN, warehouses and items;
//   - importing the same export again changes nothing; a newer ALTERID updates; a new object is added;
//   - an existing party is linked by GSTIN, never duplicated; ambiguous matches and bad GSTINs block commit until decided;
//   - a commit that cannot complete writes nothing; another workspace sees none of it; discarded imports stay closed.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-tally.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Client, gstin } from './accounting-test-helpers.mjs';

const fixture = fs.readFileSync(new URL('../../../packages/core/fixtures/tally/masters.xml', import.meta.url), 'utf8');
const daybook = fs.readFileSync(new URL('../../../packages/core/fixtures/tally/daybook.xml', import.meta.url), 'utf8');
const utf16 = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
let checks = 0;
const ok = (label) => (checks++, console.log(`✓ ${label}`));
/** Sign-ups are rate limited; new workspaces are spaced out. */
const pause = () => new Promise((r) => setTimeout(r, 30000));

/** Multipart upload with the client's session. */
async function upload(c, files, expected = 201) {
  const form = new FormData();
  for (const [name, bytes] of files) form.append('files', new Blob([bytes]), name);
  const res = await fetch(`${c.base}/tally/imports`, {
    method: 'POST',
    headers: { Origin: c.origin, Cookie: c.cookie, 'x-tenant-id': c.tenantId, 'x-entity-id': c.entityId },
    body: form,
  });
  const data = await res.json();
  assert.equal(res.status, expected, JSON.stringify(data));
  return data;
}
const rows = async (c, id, q = '') => (await c.req('GET', `/tally/imports/${id}/rows?limit=200${q}`)).data;
const row = (list, name) => {
  const r = list.find((x) => x.name === name);
  assert.ok(r, `staged row ${name}`);
  return r;
};

// ── First import into a new workspace ──
const c = await new Client().init('Tally Import');
const partiesBefore = (await c.req('GET', '/parties?limit=500')).length ?? (await c.req('GET', '/parties?limit=500')).data.length;
const imp = await upload(c, [['Master.xml', utf16(fixture)]]);
assert.equal(imp.status, 'read');
assert.equal(imp.company, 'Fixture Engineering Private Limited');
assert.match(imp.warnings.join(' '), /1 voucher type not imported/);
let list = await rows(c, imp.id);
const action = (name) => row(list, name).action;
assert.equal(action('Sundry Debtors'), 'link');
assert.equal(action('Current Assets'), 'link');
assert.equal(action('Domestic Debtors'), 'new');
assert.equal(action('Factory Overheads'), 'new');
assert.equal(action('Statutory Receivables'), 'new', "the company's own primary group is classified from its flags");
assert.equal(action('GST Receivables'), 'new');
assert.equal(action('Input CGST'), 'link', 'a tax ledger in an own group links to the standard posting ledger');
assert.equal(row(list, 'Acme Castings Pvt Ltd').kind, 'party');
assert.equal(action('Acme Castings Pvt Ltd'), 'new');
assert.equal(action('Bharat Steel Traders'), 'new');
assert.equal(action('HDFC Bank CA 0042'), 'new');
assert.equal(action('CGST'), 'skip');
assert.equal(action('Nos'), 'link');
assert.equal(action('Kgs'), 'link', 'Kgs links to KG, not a duplicate unit');
assert.equal(action('Raw Materials'), 'skip');
assert.equal(action('MS Round Bar 25mm'), 'new');
assert.equal(list.filter((r) => r.action === 'conflict').length, 0);
const accountsBefore = (await c.req('GET', '/accounts/accounts')).length;
assert.equal((await c.req('GET', '/accounts/accounts')).length, accountsBefore, 'reading writes nothing');
ok('a UTF-16 export is read and staged: standard groups and units link, tax ledgers wait, the rest is new, nothing written');

const done = await c.req('POST', `/tally/imports/${imp.id}/commit`, {}, 201);
assert.equal(done.status, 'committed');
const groups = await c.req('GET', '/accounts/groups');
const g = (n) => groups.find((x) => x.name === n);
assert.equal(g('Domestic Debtors').parentId, g('Sundry Debtors').id);
assert.equal(g('Factory Overheads').parentId, g('Indirect Expenses').id);
assert.equal(g('Factory Overheads').root, 'expense');
assert.equal(g('Statutory Receivables').root, 'asset');
assert.equal(g('Statutory Receivables').parentId, null);
assert.equal(g('GST Receivables').parentId, g('Statutory Receivables').id);
const accounts = await c.req('GET', '/accounts/accounts');
const hdfc = accounts.find((a) => a.name === 'HDFC Bank CA 0042');
assert.equal(hdfc.groupId, g('Bank Accounts').id);
assert.equal(accounts.find((a) => a.name === 'Power and Fuel').groupId, g('Factory Overheads').id);
assert.ok(!accounts.some((a) => a.name === 'CGST'), 'the skipped tax ledger was not created');
assert.equal(accounts.length, accountsBefore + 3);
const parties = (await c.req('GET', '/parties?limit=500'));
const plist = parties.data ?? parties;
const acme = plist.find((p) => p.gstin === '27AAACA1234B1ZI');
assert.ok(acme && acme.isCustomer && !acme.isSupplier && acme.name === 'Acme Castings Pvt Ltd' && acme.creditDays === 30 && acme.stateCode === '27');
const bharat = plist.find((p) => p.gstin === '27AABCB5678C1ZQ');
assert.ok(bharat && bharat.isSupplier && !bharat.isCustomer);
const items = await c.req('GET', '/items?limit=500');
const ilist = items.data ?? items;
const bar = ilist.find((i) => i.name === 'MS Round Bar 25mm');
const uoms = await c.req('GET', '/uoms');
assert.equal(bar.stockUomId, uoms.find((u) => u.code === 'KG').id);
assert.equal(bar.hsnCode, '7214');
assert.equal(bar.tracking, 'batch');
assert.equal(bar.code, 'MSRB25', 'the Tally alias becomes the item code');
const whs = await c.req('GET', '/warehouses');
assert.ok(whs.some((w) => w.name === 'Main Location') && whs.some((w) => w.name === 'Bhosari Stores'));
ok('commit creates groups under their parents, ledgers in the right groups, customers and suppliers, warehouses and items');

// ── Opening balances and stock (decisions 072 and 073) ──
const committed = await c.req('GET', `/tally/imports/${imp.id}`);
assert.equal(committed.openings.difference, '0.000000', "the fixture's openings balance");
assert.equal(committed.openings.stock, '87535.000000');
const ws = await c.req('GET', '/accounts/opening');
const settings = await c.req('GET', '/accounts/settings');
const roleId = (r) => settings.mappings?.[r] ?? accounts.find((a) => a.role === r)?.id;
const lineFor = (accountId, extra = {}) => ws.lines.filter((l) => l.accountId === accountId && Object.entries(extra).every(([k, v]) => l[k] === v));
const amount = (l) => (l.debit !== '0' ? `D${Number(l.debit)}` : `C${Number(l.credit)}`);
assert.deepEqual(lineFor(hdfc.id).map(amount), ['D310500'], 'a bank balance goes to the created ledger');
assert.deepEqual(lineFor(accounts.find((a) => a.name === "Proprietor's Capital").id).map(amount), ['C479535.5']);
assert.deepEqual(lineFor(roleId('input_cgst')).map(amount), ['D4500'], 'a skipped CGST ledger with a debit balance goes to Input CGST');
assert.deepEqual(lineFor(roleId('inventory')).map(amount), ['D87535'], 'the Inventory line is the value of the opening stock');
assert.deepEqual(
  ws.bills.map((b) => `${b.reference}:${b.side}:${Number(b.amount)}`).sort(),
  ['AC/25-26/0451:debit:100000.5', 'AC/25-26/0480:debit:25000', 'On account:credit:48000'],
  'bill-wise openings become bills; a party without them gets one On account bill',
);
assert.deepEqual(lineFor(roleId('debtors'), { partyId: acme.id }).map(amount).sort(), ['D100000.5', 'D25000']);
assert.deepEqual(lineFor(roleId('creditors'), { partyId: bharat.id }).map(amount), ['C48000']);
const drafts = (await c.req('GET', '/stock-entries?status=draft')).filter((e) => e.reference === 'Tally opening stock');
assert.equal(drafts.length, 2, 'one draft receipt per godown');
const draftLines = (await Promise.all(drafts.map((d) => c.req('GET', `/stock-entries/${d.id}`)))).flatMap((d) => d.lines);
assert.deepEqual(draftLines.map((l) => `${l.newBatchNo}:${Number(l.qty)}@${Number(l.rate)}`).sort(), ['HEAT-2231:1000.5@70', 'HEAT-2240:250@70']);
ok('opening balances fill the worksheet (ledgers, tax by duty head, bills per party, inventory) and stock lands as draft receipts per godown');

// ── Same export again: nothing new ──
const again = await upload(c, [['Master.xml', utf16(fixture)]]);
list = await rows(c, again.id);
const masterRows = list.filter((r) => r.kind !== 'opening' && r.kind !== 'stock');
assert.deepEqual([...new Set(masterRows.filter((r) => !['skip'].includes(r.proposed)).map((r) => r.proposed))], ['unchanged']);
await c.req('POST', `/tally/imports/${again.id}/commit`, {}, 201);
assert.equal((await c.req('GET', '/accounts/accounts')).length, accountsBefore + 3);
const ws2 = await c.req('GET', '/accounts/opening');
assert.deepEqual([ws2.lines, ws2.bills], [ws.lines, ws.bills], 'the worksheet is rewritten to the same balances');
const drafts2 = (await c.req('GET', '/stock-entries?status=draft')).filter((e) => e.reference === 'Tally opening stock');
assert.deepEqual(drafts2.map((d) => d.id).sort(), drafts.map((d) => d.id).sort(), 'the same drafts are rewritten, not duplicated');
const plist2 = (await c.req('GET', '/parties?limit=500'));
assert.equal((plist2.data ?? plist2).length, plist.length);
ok('importing the same export again finds every record unchanged, creates nothing and rewrites the same openings');

// ── Newer export: an edited party updates, a new ledger is added ──
const newer = fixture
  .replace('<LEDGER NAME="Acme Castings Pvt Ltd" RESERVEDNAME="">', '<LEDGER NAME="Acme Castings Private Limited" RESERVEDNAME="">')
  .replace('<NAME>Acme Castings Pvt Ltd</NAME>', '<NAME>Acme Castings Private Limited</NAME>')
  .replace('<ALTERID> 101</ALTERID>', '<ALTERID> 150</ALTERID>')
  .replace(
    '</REQUESTDATA>',
    `<TALLYMESSAGE><LEDGER NAME="Freight Inward" RESERVEDNAME=""><GUID>a1b2c3d4-0000-0000-0000-000000000001-00000199</GUID><PARENT>Direct Expenses</PARENT><ALTERID> 160</ALTERID></LEDGER></TALLYMESSAGE></REQUESTDATA>`,
  );
const third = await upload(c, [['Master-newer.xml', Buffer.from(newer)]]);
list = await rows(c, third.id);
assert.equal(row(list, 'Acme Castings Private Limited').action, 'update');
assert.equal(row(list, 'Freight Inward').action, 'new');
await c.req('POST', `/tally/imports/${third.id}/commit`, {}, 201);
const updated = await c.req('GET', `/parties/${acme.id}`);
assert.equal(updated.name, 'Acme Castings Private Limited');
assert.equal(updated.gstin, '27AAACA1234B1ZI');
assert.equal((await c.req('GET', '/accounts/accounts')).length, accountsBefore + 4);
ok('a newer ALTERID updates the linked party by GUID, and a new ledger is added');

// ── The imported openings reconcile and activate; afterwards they are closed ──
for (const d of drafts) await c.req('POST', `/stock-entries/${d.id}/submit`, {}, 201);
const rec = await c.req('GET', '/accounts/opening/reconciliation');
assert.deepEqual(rec.differences, [], 'inventory, debtors and creditors reconcile with the imported openings');
const wsNow = await c.req('GET', '/accounts/opening');
await c.req('POST', '/accounts/opening/activate', { worksheetId: wsNow.id, reviewedToken: rec.snapshotToken }, 200);
const closed = await upload(c, [['Master.xml', utf16(fixture)]]);
list = await rows(c, closed.id);
const openingRows = list.filter((r) => r.kind === 'opening' || r.kind === 'stock');
assert.ok(openingRows.length && openingRows.every((r) => r.proposed === 'skip' && /Accounting is active/.test(r.notes.join(' '))));
const forced = await c.raw('PUT', `/tally/imports/${closed.id}/rows`, { decisions: [{ id: openingRows.find((r) => r.kind === 'stock').id, action: 'new' }] });
assert.equal(forced.status, 200);
assert.equal((await c.raw('POST', `/tally/imports/${closed.id}/commit`, {})).status, 409, 'openings cannot be forced in after activation');
await c.req('POST', `/tally/imports/${closed.id}/discard`, {}, 201);
ok('the imported openings reconcile and activate; afterwards opening balances and stock are refused');

// ── Voucher history (decision 072, part 3): read-only, never in the general ledger ──
const tbBefore = await c.req('GET', '/accounts/reports/trial-balance');
const hist = await upload(c, [['DayBook.xml', utf16(daybook)]]);
list = await rows(c, hist.id, '&kind=voucher');
assert.deepEqual(list.map((r) => `${r.name}:${r.proposed}`), ['Sales FE/26-27/0001:new', 'Receipt 12:new', 'Payment 7:new', 'Journal 3:new']);
assert.match(row(list, 'Journal 3').notes.join(' '), /Cancelled in Tally/);
await c.req('POST', `/tally/imports/${hist.id}/commit`, {}, 201);
assert.deepEqual(await c.req('GET', '/accounts/reports/trial-balance'), tbBefore, 'history never reaches the general ledger');
const day = await c.req('GET', '/tally/vouchers');
assert.equal(day.total, 4);
assert.deepEqual(day.types, ['Journal', 'Payment', 'Receipt', 'Sales']);
const saleRow = day.data.find((v) => v.voucherType === 'Sales');
assert.equal(saleRow.partyId, acme.id);
assert.equal(Number(saleRow.amount), 9440);
const sale = await c.req('GET', `/tally/vouchers/${saleRow.id}`);
assert.deepEqual(sale.lines.map((l) => `${l.ledgerName}:${l.side}:${Number(l.amount)}`), ['Acme Castings Pvt Ltd:debit:9440', 'CGST:credit:720', 'Output SGST:credit:720', 'Sales - Local:credit:8000']);
assert.equal(sale.lines[0].partyId, acme.id, 'the party line links to the party');
assert.equal(sale.lines.find((l) => l.ledgerName === 'Sales - Local').accountId, null, 'a ledger not in FactoryOS keeps its Tally name');
assert.equal(sale.items[0].item, 'MS Round Bar 25mm');
assert.equal((await c.req('GET', `/tally/vouchers?partyId=${acme.id}`)).total, 2);
assert.equal((await c.req('GET', `/tally/vouchers?accountId=${hdfc.id}`)).total, 2);
assert.equal((await c.req('GET', '/tally/vouchers?type=Payment')).total, 1);
assert.equal((await c.req('GET', '/tally/vouchers?q=round%20bar')).total, 1, 'narration search');
// Same export again: nothing changes. A newer ALTERID replaces a voucher's lines.
const histAgain = await upload(c, [['DayBook.xml', utf16(daybook)]]);
assert.deepEqual([...new Set((await rows(c, histAgain.id, '&kind=voucher')).map((r) => r.proposed))], ['unchanged']);
await c.req('POST', `/tally/imports/${histAgain.id}/commit`, {}, 201);
assert.equal((await c.req('GET', '/tally/vouchers')).total, 4);
const edited = daybook.replace('<AMOUNT>-4,500.00</AMOUNT>', '<AMOUNT>-5,000.00</AMOUNT>').replace('<AMOUNT>4,500.00</AMOUNT>', '<AMOUNT>5,000.00</AMOUNT>').replace('<ALTERID> 1003</ALTERID>', '<ALTERID> 1010</ALTERID>');
const histEdit = await upload(c, [['DayBook.xml', utf16(edited)]]);
const payRow = (await rows(c, histEdit.id, '&kind=voucher')).find((r) => r.name === 'Payment 7');
assert.equal(payRow.proposed, 'update');
// Skip and back again works; a voucher only updates its own history row.
await c.req('PUT', `/tally/imports/${histEdit.id}/rows`, { decisions: [{ id: payRow.id, action: 'skip' }] });
await c.req('PUT', `/tally/imports/${histEdit.id}/rows`, { decisions: [{ id: payRow.id, action: 'update' }] });
assert.equal((await c.raw('PUT', `/tally/imports/${histEdit.id}/rows`, { decisions: [{ id: payRow.id, action: 'update', targetId: acme.id }] })).status, 400);
await c.req('POST', `/tally/imports/${histEdit.id}/commit`, {}, 201);
const payId = (await c.req('GET', '/tally/vouchers?type=Payment')).data[0].id;
let pay = await c.req('GET', `/tally/vouchers/${payId}`);
assert.deepEqual(pay.lines.map((l) => Number(l.amount)), [5000, 5000]);
// Two exports read before either is committed: the older one, committed last, does not overwrite the newer.
const version = (alter, amount) => edited.replaceAll('5,000.00', amount).replace('<ALTERID> 1010</ALTERID>', `<ALTERID> ${alter}</ALTERID>`);
const newerRead = await upload(c, [['DayBook.xml', utf16(version(1020, '6,000.00'))]]);
const olderRead = await upload(c, [['DayBook.xml', utf16(version(1015, '5,500.00'))]]);
await c.req('POST', `/tally/imports/${newerRead.id}/commit`, {}, 201);
await c.req('POST', `/tally/imports/${olderRead.id}/commit`, {}, 201);
pay = await c.req('GET', `/tally/vouchers/${payId}`);
assert.deepEqual(pay.lines.map((l) => Number(l.amount)), [6000, 6000], 'an older ALTERID never overwrites newer history');
// An edited voucher that no longer balances is a choice too.
const offBalance = version(1030, '7,000.00').replace('<AMOUNT>-7,000.00</AMOUNT>', '<AMOUNT>-7,100.00</AMOUNT>');
const unbalancedRead = await upload(c, [['DayBook.xml', utf16(offBalance)]]);
const unbalancedRow = (await rows(c, unbalancedRead.id, '&kind=voucher')).find((r) => r.name === 'Payment 7');
assert.equal(unbalancedRow.proposed, 'conflict');
await c.req('POST', `/tally/imports/${unbalancedRead.id}/discard`, {}, 201);
assert.equal((await c.raw('GET', '/tally/vouchers?from=2026-13-45')).status, 400, 'impossible dates are refused');
// What a later export lacks is listed, never deleted.
const withoutReceipt = daybook.replace(/<TALLYMESSAGE xmlns:UDF="TallyUDF">\s*<VOUCHER REMOTEID="v-2"[\s\S]*?<\/TALLYMESSAGE>/, '');
const partial = await upload(c, [['DayBook.xml', utf16(withoutReceipt)]]);
const partialRead = await c.req('GET', `/tally/imports/${partial.id}`);
assert.deepEqual(partialRead.missing.vouchers.sample.map((v) => `${v.type} ${v.number}`), ['Receipt 12']);
await c.req('POST', `/tally/imports/${partial.id}/discard`, {}, 201);
const withoutLedger = fixture.replace(/<TALLYMESSAGE xmlns:UDF="TallyUDF">\s*<LEDGER NAME="Power and Fuel"[\s\S]*?<\/TALLYMESSAGE>/, '');
const partialMasters = await upload(c, [['Master.xml', utf16(withoutLedger)]]);
const pm = await c.req('GET', `/tally/imports/${partialMasters.id}`);
assert.ok(pm.missing.masters.sample.some((m) => m.kind === 'ledger' && m.name === 'Power and Fuel'));
await c.req('POST', `/tally/imports/${partialMasters.id}/discard`, {}, 201);
assert.equal((await c.req('GET', '/tally/vouchers')).total, 4, 'nothing is deleted');
ok('Day Book vouchers become read-only history linked to ledgers and parties; re-imports update by ALTERID; missing records are listed, never deleted');

// ── Decision 075: a month kept in Tally turns its vouchers into FactoryOS documents ──
await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B2Z') }, 201);
const cut = (await c.req('GET', '/accounts/settings')).cutoverDate;
const month = cut.slice(0, 7);
const docDay = cut.replace(/-/g, '');
assert.equal((await c.raw('PUT', '/tally/books', { month: '2026-04', book: 'tally' })).status, 400, 'months before the cut-over stay history');
await c.req('PUT', '/tally/books', { month, book: 'tally' });
assert.equal((await c.req('GET', '/tally/books')).months.find((m) => m.month === month).book, 'tally');
const docVoucher = (guid, type, number, body) => `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="${type}" ACTION="Create">
      <DATE>${docDay}</DATE><GUID>${guid}</GUID><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${number}</VOUCHERNUMBER><ALTERID> 9001</ALTERID>${body}
     </VOUCHER>
    </TALLYMESSAGE>`;
const ledger = (name, amount, party = false) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${name}</LEDGERNAME><ISPARTYLEDGER>${party ? 'Yes' : 'No'}</ISPARTYLEDGER><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
const stock = (qty, rate, amount, batchName, allocLedger) =>
  `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>MS Round Bar 25mm</STOCKITEMNAME><RATE>${rate}/Kgs</RATE><AMOUNT>${amount}</AMOUNT><ACTUALQTY> ${qty} Kgs</ACTUALQTY><BATCHALLOCATIONS.LIST><GODOWNNAME>Main Location</GODOWNNAME><BATCHNAME>${batchName}</BATCHNAME><ACTUALQTY> ${qty} Kgs</ACTUALQTY></BATCHALLOCATIONS.LIST><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${allocLedger}</LEDGERNAME><AMOUNT>${amount}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>`;
const docs = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>
${docVoucher('doc-purchase-1', 'Purchase', 'TP/0001', `<REFERENCE>BST/771</REFERENCE>${ledger('Bharat Steel Traders', '5900.00', true)}${ledger('Input CGST', '-450.00')}${ledger('Input SGST', '-450.00')}${stock(50, '100.00', '-5000.00', 'HEAT-9001', 'Purchase - Local')}`)}
${docVoucher('doc-sale-1', 'Sales', 'TS/0001', `${ledger('Acme Castings Private Limited', '-9440.00', true)}${ledger('CGST', '720.00')}${ledger('Output SGST', '720.00')}${stock(100, '80.00', '8000.00', 'HEAT-2231', 'Sales - Local')}`)}
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
const tbBeforeDocs = await c.req('GET', '/accounts/reports/trial-balance');
const docImport = await upload(c, [['DayBook.xml', utf16(docs)]]);
const docRows = await rows(c, docImport.id, '&kind=document');
assert.deepEqual(docRows.map((r) => `${r.name}:${r.proposed}`).sort(), ['Purchase invoice TP/0001:new', 'Sales invoice TS/0001:new']);
await c.req('POST', `/tally/imports/${docImport.id}/commit`, {}, 201);
const sales = await c.req('GET', '/sales-invoices');
const tallySale = (sales.data ?? sales).find((i) => i.number === 'TS/0001');
assert.ok(tallySale, 'the Tally sale is a sales invoice');
const saleDoc = await c.req('GET', `/sales-invoices/${tallySale.id}`);
assert.equal(saleDoc.status, 'submitted');
assert.equal(saleDoc.source, 'tally');
assert.equal(Number(saleDoc.grandTotal), 9440);
assert.ok(saleDoc.stockEntryId, 'goods left stock');
const tbAfterDocs = await c.req('GET', '/accounts/reports/trial-balance');
assert.notDeepEqual(tbAfterDocs, tbBeforeDocs, 'the documents reach the books');
const purchases = await c.req('GET', '/purchase-invoices');
const tallyPurchase = (purchases.data ?? purchases).find((i) => i.number === 'TP/0001');
assert.ok(tallyPurchase, 'the Tally purchase is a purchase invoice');
assert.equal((await c.req('GET', `/purchase-invoices/${tallyPurchase.id}`)).supplierInvoiceNo, 'BST/771');
// The same export again changes nothing.
const docAgain = await upload(c, [['DayBook.xml', utf16(docs)]]);
assert.deepEqual([...new Set((await rows(c, docAgain.id, '&kind=document')).map((r) => r.proposed))], ['unchanged']);
await c.req('POST', `/tally/imports/${docAgain.id}/discard`, {}, 201);
// An edited voucher (newer ALTERID) is not applied over a submitted document; it waits for the document to be cancelled.
const docEdited = await upload(c, [['DayBook.xml', utf16(docs.replaceAll('<ALTERID> 9001</ALTERID>', '<ALTERID> 9002</ALTERID>'))]]);
const editedRows = await rows(c, docEdited.id, '&kind=document');
assert.deepEqual([...new Set(editedRows.map((r) => r.proposed))], ['conflict']);
assert.match(editedRows[0].notes.join(' '), /cancel/i);
await c.req('POST', `/tally/imports/${docEdited.id}/discard`, {}, 201);
// FactoryOS entry in the Tally month is refused.
const draftInTally = await c.req('POST', '/sales-invoices', { customerId: acme.id, invoiceDate: cut, lines: [{ itemId: saleDoc.lines[0].itemId, qty: '1', rate: '80', gstRate: '18' }] }, 201);
const inTallyMonth = await c.raw('POST', `/sales-invoices/${draftInTally.id}/submit`, {});
assert.equal(inTallyMonth.status, 400);
assert.match(inTallyMonth.data.message, /kept in Tally/);
// A month with Tally documents cannot go back to FactoryOS yet.
assert.equal((await c.raw('PUT', '/tally/books', { month, book: 'factoryos' })).status, 409);
ok('a month kept in Tally turns its sales and purchases into submitted documents with stock and books; FactoryOS entry there is refused');

// ── Matching an existing workspace: link by GSTIN, conflicts block commit ──
await pause();
const b = await new Client().init('Tally Matching');
const existingBharat = await b.req('POST', '/parties', { code: 'BHARAT', name: 'Bharat Steel (old name)', isCustomer: true, gstin: '27AABCB5678C1ZQ' }, 201);
for (const code of ['ACME1', 'ACME2']) await b.req('POST', '/parties', { code, name: 'Acme Castings Pvt Ltd', isCustomer: true, gstTreatment: 'unregistered' }, 201);
const bad = fixture.replace('<PARTYGSTIN>27AAACA1234B1ZI</PARTYGSTIN>', '<PARTYGSTIN>27AAACA1234B1ZI</PARTYGSTIN>').replace(
  '</REQUESTDATA>',
  `<TALLYMESSAGE><LEDGER NAME="Typo Traders" RESERVEDNAME=""><GUID>a1b2c3d4-0000-0000-0000-000000000001-00000198</GUID><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>27AAACT9999X1Z1</PARTYGSTIN><ALTERID> 170</ALTERID></LEDGER></TALLYMESSAGE></REQUESTDATA>`,
);
const bi = await upload(b, [['Master.xml', Buffer.from(bad)]]);
list = await rows(b, bi.id);
const bh = row(list, 'Bharat Steel Traders');
assert.equal(bh.action, 'link');
assert.equal(bh.targetId, existingBharat.id);
assert.equal(bh.candidates[0].reason, 'Same GSTIN');
assert.match(bh.notes.join(' '), /supplier too/);
const acmeRow = row(list, 'Acme Castings Pvt Ltd');
assert.equal(acmeRow.action, 'conflict', 'two same-name parties are offered, never picked silently');
assert.deepEqual(acmeRow.candidates.map((x) => x.reason), ['Same name', 'Same name']);
const typo = row(list, 'Typo Traders');
assert.equal(typo.action, 'conflict');
assert.match(typo.notes[0], /not valid/);
const blocked = await b.raw('POST', `/tally/imports/${bi.id}/commit`, {});
assert.equal(blocked.status, 400);
assert.match(blocked.data.message, /^2 records need a decision/);
ok('an existing party is linked by GSTIN; an invalid GSTIN is a conflict and blocks commit');

assert.equal((await b.raw('PUT', `/tally/imports/${bi.id}/rows`, { decisions: [{ id: typo.id, action: 'conflict' }] })).status, 400);
assert.equal((await b.raw('PUT', `/tally/imports/${bi.id}/rows`, { decisions: [{ id: row(list, 'Raw Materials').id, action: 'new' }] })).status, 400);
await b.req('PUT', `/tally/imports/${bi.id}/rows`, { decisions: [{ id: typo.id, action: 'new' }, { id: acmeRow.id, action: 'link', targetId: acmeRow.candidates[0].id }] });
await b.req('POST', `/tally/imports/${bi.id}/commit`, {}, 201);
const bParties = await b.req('GET', '/parties?limit=500');
const bp = bParties.data ?? bParties;
assert.equal(bp.filter((p) => p.gstin === '27AABCB5678C1ZQ').length, 1, 'no duplicate of the GSTIN party');
const linked = bp.find((p) => p.id === existingBharat.id);
assert.ok(linked.isSupplier && linked.isCustomer, 'the linked party became a supplier too');
const typoParty = bp.find((p) => p.name === 'Typo Traders');
assert.ok(typoParty && typoParty.gstin === null && typoParty.gstTreatment === 'unregistered');
const acmeLinked = bp.find((p) => p.id === acmeRow.candidates[0].id);
assert.equal(acmeLinked.gstin, '27AAACA1234B1ZI', 'a linked party without GSTIN gets the one from Tally');
assert.equal(bp.filter((p) => p.name === 'Acme Castings Pvt Ltd').length, 2, 'linked, not created');
ok('decisions are validated; same-name parties are a choice; links fill a missing GSTIN; nothing is duplicated');

// ── All or nothing ──
const before = (await b.req('GET', '/accounts/accounts')).length;
const failing = await upload(b, [['fail.xml', Buffer.from(`<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE><LEDGER NAME="Atomic Test Ledger"><GUID>atomic-1</GUID><PARENT>Indirect Expenses</PARENT><ALTERID>1</ALTERID></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><UNIT NAME="Drums"><GUID>atomic-u</GUID><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT><ALTERID>1</ALTERID></UNIT></TALLYMESSAGE>
<TALLYMESSAGE><STOCKITEM NAME="Cutting Oil"><GUID>atomic-2</GUID><BASEUNITS>Drums</BASEUNITS><ALTERID>1</ALTERID></STOCKITEM></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`)]]);
list = await rows(b, failing.id);
await b.req('PUT', `/tally/imports/${failing.id}/rows`, { decisions: [{ id: row(list, 'Drums').id, action: 'skip' }] });
const failed = await b.raw('POST', `/tally/imports/${failing.id}/commit`, {});
assert.equal(failed.status, 400);
assert.match(failed.data.message, /unit "Drums".*Cutting Oil/);
assert.equal((await b.req('GET', '/accounts/accounts')).length, before, 'the ledger before the failure was rolled back');
assert.equal((await b.req('GET', `/tally/imports/${failing.id}`)).status, 'read');
ok('a commit that cannot finish writes nothing and leaves the import open');

// ── Shapes seen in a real export ──
// Two Tally ledgers with one GSTIN are one FactoryOS party; an input-tax ledger in an own group under Duties & Taxes
// links to FactoryOS's input tax ledger instead of asking.
const shared = gstin('27ABCDS1234F1Z');
const shapesXml = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE><GROUP NAME="GST Input Credits"><GUID>shape-g</GUID><PARENT>Duties &amp; Taxes</PARENT><ALTERID>1</ALTERID></GROUP></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="Input SGST"><GUID>shape-tax</GUID><PARENT>GST Input Credits</PARENT><TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>SGST/UTGST</GSTDUTYHEAD><ALTERID>2</ALTERID></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="Steel Mart"><GUID>shape-p1</GUID><PARENT>Sundry Creditors</PARENT><PARTYGSTIN>${shared}</PARTYGSTIN><ALTERID>3</ALTERID></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="Steel Mart (Job Work)"><GUID>shape-p2</GUID><PARENT>Sundry Creditors</PARENT><PARTYGSTIN>${shared}</PARTYGSTIN><ALTERID>4</ALTERID></LEDGER></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
const shapes = await upload(b, [['shapes.xml', utf16(shapesXml)]]);
list = await rows(b, shapes.id);
assert.equal(row(list, 'Input SGST').action, 'link');
assert.equal(row(list, 'Steel Mart').action, 'new');
assert.equal(row(list, 'Steel Mart (Job Work)').action, 'new');
assert.match(row(list, 'Steel Mart (Job Work)').notes.join(' '), /Same GSTIN as "Steel Mart" in this export/);
assert.equal(list.filter((r) => r.action === 'conflict').length, 0);
await b.req('POST', `/tally/imports/${shapes.id}/commit`, {}, 201);
const steel = (await b.req('GET', '/parties?limit=500')).filter((p) => p.gstin === shared);
assert.equal(steel.length, 1, 'one party for one GSTIN');
list = await rows(b, shapes.id);
assert.equal(row(list, 'Steel Mart').resultId, steel[0].id);
assert.equal(row(list, 'Steel Mart (Job Work)').resultId, steel[0].id);
const shapesAgain = await upload(b, [['shapes.xml', utf16(shapesXml)]]);
assert.deepEqual(Object.keys(shapesAgain.counts).sort(), ['group.unchanged', 'ledger.unchanged', 'party.unchanged'], JSON.stringify(shapesAgain.counts));
await b.req('POST', `/tally/imports/${shapesAgain.id}/discard`, {}, 201);
ok('two Tally ledgers with one GSTIN are saved as one party; an input-tax ledger under Duties & Taxes links by name');

// ── An unbalanced export and negative stock (decision 073) ──
await pause();
const d = await new Client().init('Tally Difference');
const unbalanced = fixture
  .replace('<OPENINGBALANCE>4,79,535.50</OPENINGBALANCE>', '<OPENINGBALANCE>4,79,000.00</OPENINGBALANCE>')
  .replace('<OPENINGBALANCE> 250 Kgs</OPENINGBALANCE>', '<OPENINGBALANCE> -250 Kgs</OPENINGBALANCE>')
  .replace(
    '</REQUESTDATA>',
    '<TALLYMESSAGE><LEDGER NAME="Profit &amp; Loss A/c" RESERVEDNAME="Profit &amp; Loss A/c"><GUID>pl-1</GUID><PARENT>Primary</PARENT><OPENINGBALANCE>12,000.00</OPENINGBALANCE><ALTERID>1</ALTERID></LEDGER></TALLYMESSAGE></REQUESTDATA>',
  );
const ub = await upload(d, [['Master.xml', utf16(unbalanced)]]);
list = await rows(d, ub.id);
const barStock = list.find((r) => r.kind === 'stock' && r.name === 'MS Round Bar 25mm');
assert.equal(barStock.proposed, 'conflict');
assert.match(barStock.notes.join(' '), /negative opening stock/);
assert.equal((await d.raw('PUT', `/tally/imports/${ub.id}/rows`, { decisions: [{ id: barStock.id, action: 'new' }] })).status, 400, 'negative stock can only be skipped');
await d.req('PUT', `/tally/imports/${ub.id}/rows`, { decisions: [{ id: barStock.id, action: 'skip' }] });
// Skipping the bar's stock and the short capital leave the openings unbalanced; the summary names the amount.
const summary = (await d.req('GET', `/tally/imports/${ub.id}`)).openings;
assert.equal(summary.stock, '0.000000');
const refused = await d.raw('POST', `/tally/imports/${ub.id}/commit`, {});
assert.equal(refused.status, 400);
assert.equal(refused.data.difference, summary.difference);
assert.equal((await d.raw('POST', `/tally/imports/${ub.id}/commit`, { acceptDifference: '1' })).status, 400, 'a different amount is not accepted');
await d.req('POST', `/tally/imports/${ub.id}/commit`, { acceptDifference: summary.difference }, 201);
const dws = await d.req('GET', '/accounts/opening');
const dAccounts = await d.req('GET', '/accounts/accounts');
const diffLedger = dAccounts.find((a) => a.name === 'Opening difference (Tally)');
const diffLine = dws.lines.find((l) => l.accountId === diffLedger.id);
assert.equal(Number(diffLine.debit) - Number(diffLine.credit), -Number(summary.difference), 'the difference ledger balances the worksheet');
assert.equal((await d.req('GET', '/stock-entries?status=draft')).filter((e) => e.reference === 'Tally opening stock').length, 0);
const pl = dAccounts.find((a) => a.name === 'Profit & Loss A/c');
const dGroups = await d.req('GET', '/accounts/groups');
assert.equal(pl.groupId, dGroups.find((g) => g.name === 'Reserves & Surplus').id);
assert.deepEqual(dws.lines.filter((l) => l.accountId === pl.id).map((l) => Number(l.credit)), [12000], "Tally's accumulated profit goes to Profit & Loss A/c under Reserves & Surplus");
ok('negative stock can only be skipped; Profit & Loss A/c goes to Reserves; an unbalanced opening needs the exact difference accepted');

// Re-imports keep drafts in step with the worksheet: a godown left out loses its draft; a cancelled receipt is replaced.
const tallyDrafts = async () => (await d.req('GET', '/stock-entries')).filter((e) => e.reference === 'Tally opening stock');
const full = await upload(d, [['Master.xml', utf16(fixture)]]);
await d.req('POST', `/tally/imports/${full.id}/commit`, {}, 201);
assert.equal((await tallyDrafts()).filter((e) => e.status === 'draft').length, 2);
const mainOnly = fixture
  .replace('<OPENINGBALANCE> 250 Kgs</OPENINGBALANCE>', '<OPENINGBALANCE> 0 Kgs</OPENINGBALANCE>')
  .replace('<OPENINGVALUE>-17,500.00</OPENINGVALUE>', '<OPENINGVALUE>0</OPENINGVALUE>')
  .replace('<OPENINGBALANCE>4,79,535.50</OPENINGBALANCE>', '<OPENINGBALANCE>4,62,035.50</OPENINGBALANCE>');
const fewer = await upload(d, [['Master.xml', utf16(mainOnly)]]);
await d.req('POST', `/tally/imports/${fewer.id}/commit`, {}, 201);
const left = await tallyDrafts();
assert.equal(left.length, 1, "the godown without stock loses its stale draft");
await d.req('POST', `/stock-entries/${left[0].id}/submit`, {}, 201);
await d.req('POST', `/stock-entries/${left[0].id}/cancel`, { reason: 'Counted again before cut-over' }, 201);
const afterCancel = await upload(d, [['Master.xml', utf16(mainOnly)]]);
list = await rows(d, afterCancel.id);
assert.equal(list.find((r) => r.kind === 'stock').proposed, 'new', 'a cancelled receipt does not block a re-import');
await d.req('POST', `/tally/imports/${afterCancel.id}/commit`, {}, 201);
assert.equal((await tallyDrafts()).filter((e) => e.status === 'draft').length, 1);
ok('re-imports drop drafts for godowns without stock, and replace a cancelled opening receipt');

// ── Isolation and closing ──
await pause();
const other = await new Client().init('Tally Other');
assert.equal((await other.raw('GET', `/tally/imports/${imp.id}`)).status, 404);
assert.equal((await other.req('GET', '/tally/imports')).length, 0);
assert.equal((await other.req('GET', '/tally/vouchers')).total, 0);
assert.equal((await other.raw('GET', `/tally/vouchers/${saleRow.id}`)).status, 404, "another workspace cannot read this workspace's history");
await b.req('POST', `/tally/imports/${failing.id}/discard`, {}, 201);
assert.equal((await b.raw('POST', `/tally/imports/${failing.id}/commit`, {})).status, 409);
assert.equal((await b.raw('POST', `/tally/imports/${imp.id}/commit`, {})).status, 404);
assert.equal((await c.raw('POST', `/tally/imports/${imp.id}/commit`, {})).status, 409);
assert.equal((await upload(c, [['empty.xml', Buffer.from('<ENVELOPE/>')]], 400)).message, 'No Tally masters or vouchers were found in the upload');
ok('another workspace sees nothing; committed and discarded imports stay closed; an empty export is refused');

console.log(`\ntally smoke: ${checks} checks passed (${c.checks + b.checks + d.checks + other.checks} requests)`);
void gstin;
void partiesBefore;
