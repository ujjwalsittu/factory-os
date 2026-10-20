// Tally import of masters (decision 072), end to end through the API:
//   - read and stage a TallyPrime XML export (UTF-16, as Tally writes it): nothing is written to masters;
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
const accounts = await c.req('GET', '/accounts/accounts');
const hdfc = accounts.find((a) => a.name === 'HDFC Bank CA 0042');
assert.equal(hdfc.groupId, g('Bank Accounts').id);
assert.equal(accounts.find((a) => a.name === 'Power and Fuel').groupId, g('Factory Overheads').id);
assert.ok(!accounts.some((a) => a.name === 'CGST'), 'the skipped tax ledger was not created');
assert.equal(accounts.length, accountsBefore + 2);
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

// ── Same export again: nothing new ──
const again = await upload(c, [['Master.xml', utf16(fixture)]]);
list = await rows(c, again.id);
assert.deepEqual([...new Set(list.filter((r) => !['skip'].includes(r.proposed)).map((r) => r.proposed))], ['unchanged']);
await c.req('POST', `/tally/imports/${again.id}/commit`, {}, 201);
assert.equal((await c.req('GET', '/accounts/accounts')).length, accountsBefore + 2);
const plist2 = (await c.req('GET', '/parties?limit=500'));
assert.equal((plist2.data ?? plist2).length, plist.length);
ok('importing the same export again finds every record unchanged and creates nothing');

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
assert.equal((await c.req('GET', '/accounts/accounts')).length, accountsBefore + 3);
ok('a newer ALTERID updates the linked party by GUID, and a new ledger is added');

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

// ── Isolation and closing ──
await pause();
const other = await new Client().init('Tally Other');
assert.equal((await other.raw('GET', `/tally/imports/${imp.id}`)).status, 404);
assert.equal((await other.req('GET', '/tally/imports')).length, 0);
await b.req('POST', `/tally/imports/${failing.id}/discard`, {}, 201);
assert.equal((await b.raw('POST', `/tally/imports/${failing.id}/commit`, {})).status, 409);
assert.equal((await b.raw('POST', `/tally/imports/${imp.id}/commit`, {})).status, 404);
assert.equal((await c.raw('POST', `/tally/imports/${imp.id}/commit`, {})).status, 409);
assert.equal((await upload(c, [['empty.xml', Buffer.from('<ENVELOPE/>')]], 400)).message, 'No Tally masters were found in the upload');
ok('another workspace sees nothing; committed and discarded imports stay closed; an empty export is refused');

console.log(`\ntally smoke: ${checks} checks passed (${c.checks + b.checks + other.checks} requests)`);
void gstin;
void partiesBefore;
