// Asset items and asset purchases (decision 069), end to end through the API:
//   - the Asset item type: never stocked, tracking forced to none, cannot become (or stop being) an asset, hidden from
//     sellable lists, refused on stock entries, BOMs and sales documents;
//   - a purchase invoice for an asset: the line's ledger (an active asset ledger of the entity), else the Fixed assets
//     mapping; tax that cannot be claimed back goes into the asset's cost, claimable tax is input GST as usual;
//   - the first asset invoice of an entity whose books are already active adds the Fixed assets ledger and mapping;
//     with neither a ledger nor a mapping the submit is refused and nothing posts;
//   - books not active: submitting posts nothing; cancelling a posted invoice reverses it.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-asset-items.mjs   (DATABASE_URL from the env or ../../.env)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const dbUrl = process.env.DATABASE_URL ?? fs.readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1];
const psql = (q) => execFileSync('psql', [dbUrl, '-qtAc', q]).toString().trim();
let checks = 0;
const fail = async (c, method, path, body, status, label, pattern) => {
  const r = await c.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  checks++;
  ok(label);
  return r.data;
};

/** Both workspaces get a GST registration, an HSN code, a supplier and a customer. */
async function setup(c) {
  const registration = await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
  await c.req('POST', '/hsn-codes', { code: '8479', kind: 'hsn', description: 'Machinery', gstRate: '18', effectiveFrom: '2025-04-01' }, 201);
  const uoms = await c.req('GET', '/uoms');
  const supplier = await c.req('POST', '/parties', { code: 'SUP', name: 'Machine Supplier', isSupplier: true, gstin: gstin('27AAACB1234B1Z') }, 201);
  return { registration, nos: uoms.find((u) => u.code === 'NOS').id, supplier };
}
const voucherOf = async (c, id) => {
  const all = await c.req('GET', '/accounts/journals');
  const found = all.find((j) => j.sourceType === 'purchase_invoice' && j.sourceId === id && j.purpose === 'main');
  assert.ok(found, 'a purchase voucher exists');
  return c.req('GET', `/accounts/journals/${found.id}`);
};
/** Amounts come back with six decimals; R(n) is n rupees in the same scale. */
const R = (n) => BigInt(n) * 1000000n;
const scaled = (v) => {
  const [whole, frac = ''] = v.split('.');
  return BigInt(whole + frac.padEnd(6, '0').slice(0, 6));
};
const sum = (v, accountId, side) => v.entries.filter((e) => e.accountId === accountId).reduce((s, e) => s + scaled(e[side]), 0n);

// ── A workspace with active books ──
const c = await new Client().init('Asset Items');
await c.activate();
const date = c.settings.cutoverDate;
const { registration, nos, supplier } = await setup(c);

// ── The item type ──
const lathe = await c.req('POST', '/items', { code: 'LATHE-1', name: 'CNC lathe', type: 'asset', tracking: 'batch', stockUomId: nos, hsnCode: '8479' }, 201);
assert.equal(lathe.type, 'asset');
assert.equal(lathe.isStockItem, false);
assert.equal(lathe.tracking, 'none');
ok('an asset item is never stocked and never tracked, even when asked');
const rod = await c.req('POST', '/items', { code: 'ROD-1', name: 'Brass rod', type: 'raw_material', stockUomId: nos, hsnCode: '8479' }, 201);
await fail(c, 'PATCH', `/items/${lathe.id}`, { type: 'service' }, 400, 'an asset cannot become another type', /cannot become an asset or stop being one/);
await fail(c, 'PATCH', `/items/${rod.id}`, { type: 'asset' }, 400, 'an item cannot become an asset', /cannot become an asset or stop being one/);
const sellable = await c.req('GET', '/items?sellable=true&limit=50');
assert.ok(sellable.some((i) => i.id === rod.id) && !sellable.some((i) => i.id === lathe.id), 'sellable list excludes assets');
const assets = await c.req('GET', '/items?type=asset');
assert.deepEqual(assets.map((i) => i.code), ['LATHE-1']);
ok('the sellable list leaves assets out, and the Asset type filter finds them');

// ── Refused where assets do not belong ──
const wh = (await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201)).id;
const draft = await c.req('POST', '/stock-entries', { postingDate: date, purpose: 'receipt', lines: [{ itemId: lathe.id, qty: '1', toWarehouseId: wh, rate: '100' }] }, 201);
await fail(c, 'POST', `/stock-entries/${draft.id}/submit`, {}, 400, 'an asset is refused when a stock entry is submitted', /not a stock item/);
await fail(c, 'POST', '/manufacturing/boms', { itemId: rod.id, revision: 'A', materials: [{ itemId: lathe.id, qty: '1' }], operations: [] }, 400, 'an asset is refused as a BOM material', /not a stock item/);
const customer = await c.req('POST', '/parties', { code: 'CUS', name: 'Customer', isCustomer: true, gstin: gstin('27AAACC1234B1Z'), addresses: [{ label: 'Works', line1: 'Test Road', city: 'Pune', stateCode: '27', pincode: '411001' }] }, 201);
await fail(c, 'POST', '/sales-invoices', { customerId: customer.id, gstRegistrationId: registration.id, invoiceDate: date, lines: [{ itemId: lathe.id, qty: '1', rate: '100' }] }, 400, 'an asset is refused on a sales invoice', /asset disposal is not built yet/);
await fail(c, 'POST', '/quotations', { customerId: customer.id, quotationDate: date, validUntil: date, lines: [{ itemId: lathe.id, qty: '1', rate: '100' }] }, 400, 'an asset is refused on a quotation', /asset disposal is not built yet/);

// ── Purchase invoices ──
const invoice = (no, lines, extra = {}) => ({
  supplierId: supplier.id,
  gstRegistrationId: registration.id,
  supplierInvoiceNo: no,
  supplierInvoiceDate: date,
  postingDate: date,
  itcEligible: true,
  lines,
  ...extra,
});
const post = async (b) => {
  const inv = await c.req('POST', '/purchase-invoices', b, 201);
  await c.req('POST', `/purchase-invoices/${inv.id}/submit`, {}, 201);
  return inv;
};
const expenseLedger = c.accounts.find((a) => a.role === 'purchases').id;
await fail(c, 'POST', '/purchase-invoices', invoice('AS-BAD-1', [{ itemId: lathe.id, qty: '1', rate: '1000', assetAccountId: expenseLedger }]), 400, 'the line ledger must be an asset ledger', /choose an active asset ledger/);
await fail(c, 'POST', '/purchase-invoices', invoice('AS-BAD-2', [{ itemId: rod.id, qty: '1', rate: '1000', assetAccountId: c.account('fixed_assets') }]), 400, 'a ledger on a non-asset line is refused', /only for asset items/);
const fa = c.account('fixed_assets');
assert.ok(fa, 'new books carry the Fixed assets ledger');

// 1. Mapping: no ledger on the line, claimable tax.
const a1 = await post(invoice('AS-1', [{ itemId: lathe.id, qty: '2', rate: '50000' }]));
const v1 = await voucherOf(c, a1.id);
assert.equal(sum(v1, fa, 'debit'), R(100000), 'the Fixed assets mapping is debited with the taxable value');
assert.equal(sum(v1, c.account('input_cgst'), 'debit'), R(9000));
assert.equal(sum(v1, c.account('input_sgst'), 'debit'), R(9000));
assert.equal(sum(v1, c.account('creditors'), 'credit'), R(118000));
assert.equal(sum(v1, c.account('purchases'), 'debit'), 0n, 'not an expense');
ok('an asset line with no ledger is debited to the Fixed assets mapping; claimable tax is input GST');

// 2. A ledger the person adds for the line.
const group = (await c.req('GET', '/accounts/groups')).find((g) => g.root === 'asset');
const plant = await c.req('POST', '/accounts/accounts', { code: 'PLANT', name: 'Plant and machinery', groupId: group.id }, 201);
const a2 = await post(invoice('AS-2', [{ itemId: lathe.id, qty: '1', rate: '20000', assetAccountId: plant.id }]));
const v2 = await voucherOf(c, a2.id);
assert.equal(sum(v2, plant.id, 'debit'), R(20000), "the line's ledger is debited");
assert.equal(sum(v2, fa, 'debit'), 0n);
const read = await c.req('GET', `/purchase-invoices/${a2.id}`);
assert.equal(read.lines[0].assetAccountId, plant.id);
assert.equal(read.lines[0].itemType, 'asset');
ok("the line's own ledger wins, and the invoice reads it back");

// 3. Tax that cannot be claimed goes into the cost.
const a3 = await post(invoice('AS-3', [{ itemId: lathe.id, qty: '1', rate: '10000' }], { itcEligible: false }));
const v3 = await voucherOf(c, a3.id);
assert.equal(sum(v3, fa, 'debit'), R(11800), 'taxable value plus the tax');
assert.equal(sum(v3, c.account('noncreditable_tax'), 'debit'), 0n, 'not the non-creditable tax expense');
assert.equal(sum(v3, c.account('input_cgst'), 'debit'), 0n);
assert.equal(sum(v3, c.account('creditors'), 'credit'), R(11800));
ok('non-creditable tax is added to the cost of the asset');

// 4. A mixed invoice: goods and an asset.
const a4 = await post(invoice('AS-4', [{ itemId: lathe.id, qty: '1', rate: '30000', assetAccountId: plant.id }]));
await c.req('POST', `/purchase-invoices/${a4.id}/cancel`, { reason: 'Entered by mistake' }, 201);
const all = await c.req('GET', '/accounts/journals');
assert.ok(all.some((j) => j.sourceId === a4.id && j.purpose !== 'main'), 'cancelling posts a reversal');
ok('cancelling a posted asset invoice reverses it');

// ── First use on an entity whose chart lacks the ledger; refusal with neither ──
const eid = c.entityId;
psql(`update accounting_settings set mappings = mappings - 'fixed_assets' where entity_id = '${eid}'`);
const fixedId = psql(`select id from gl_account where entity_id = '${eid}' and role = 'fixed_assets'`);
const used = psql(`select count(*) from gl_entry where account_id = '${fixedId}'`);
// The ledger already carries postings, so rename it away from the role instead of deleting it: the chart step then adds a new one.
psql(`update gl_account set role = null, code = 'OLD_FIXED_ASSETS' where id = '${fixedId}'`);
assert.ok(Number(used) > 0);
const a5 = await post(invoice('AS-5', [{ itemId: lathe.id, qty: '1', rate: '5000' }]));
const v5 = await voucherOf(c, a5.id);
const created = psql(`select id from gl_account where entity_id = '${eid}' and role = 'fixed_assets'`);
assert.ok(created && created !== fixedId, 'the first asset invoice added the Fixed assets ledger');
assert.equal(sum(v5, created, 'debit'), R(5000));
assert.equal(psql(`select mappings->>'fixed_assets' from accounting_settings where entity_id = '${eid}'`), created, 'and its mapping');
ok('the first asset invoice on books without the ledger adds the ledger and mapping, then posts');

// Refusal: the code is taken by a ledger without the role, so the chart step cannot add it, and the mapping is gone.
psql(`update gl_account set role = null, code = 'OLD_FA_2' where id = '${created}'`);
psql(`update accounting_settings set mappings = mappings - 'fixed_assets' where entity_id = '${eid}'`);
await c.req('POST', '/accounts/accounts', { code: 'FIXED_ASSETS', name: 'My own fixed assets', groupId: group.id }, 201);
const before = (await c.req('GET', '/accounts/journals')).length;
const bad = await c.req('POST', '/purchase-invoices', invoice('AS-6', [{ itemId: lathe.id, qty: '1', rate: '5000' }]), 201);
await fail(c, 'POST', `/purchase-invoices/${bad.id}/submit`, {}, 400, 'with no ledger on the line and no mapping, the submit is refused', /choose an asset ledger, or map Fixed assets in Accounting setup/);
assert.equal((await c.req('GET', '/accounts/journals')).length, before, 'nothing posted');
assert.equal((await c.req('GET', `/purchase-invoices/${bad.id}`)).status, 'draft', 'the invoice is still a draft');
const ok6 = await c.req('PUT', `/purchase-invoices/${bad.id}`, invoice('AS-6', [{ itemId: lathe.id, qty: '1', rate: '5000', assetAccountId: plant.id }]));
assert.ok(ok6);
await c.req('POST', `/purchase-invoices/${bad.id}/submit`, {}, 201);
ok('naming a ledger on the line then lets it through');

// ── Books not active: nothing posts ──
const d = await new Client().init('Asset Items Inactive');
const s2 = await setup(d);
const asset2 = await d.req('POST', '/items', { code: 'PRESS-1', name: 'Press', type: 'asset', stockUomId: s2.nos, hsnCode: '8479' }, 201);
const inv2 = await d.req('POST', '/purchase-invoices', { supplierId: s2.supplier.id, gstRegistrationId: s2.registration.id, supplierInvoiceNo: 'IN-1', supplierInvoiceDate: new Date().toISOString().slice(0, 10), postingDate: new Date().toISOString().slice(0, 10), itcEligible: true, lines: [{ itemId: asset2.id, qty: '1', rate: '1000' }] }, 201);
await d.req('POST', `/purchase-invoices/${inv2.id}/submit`, {}, 201);
assert.equal(psql(`select count(*) from journal_voucher where entity_id = '${d.entityId}'`), '0', 'no voucher without books');
ok('with books not active, an asset invoice submits and posts nothing');

console.log(`Asset items smoke: ${checks + c.checks + d.checks} request checks, all passing`);
