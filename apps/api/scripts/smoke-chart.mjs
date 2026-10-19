// Chart of accounts clean-up (decision 071), end to end:
//   - a new entity gets the standard Tally group tree, with the default ledgers in their standard groups;
//   - the settings read names each posting role's classification; saving still refuses a shared or wrong-type ledger;
//   - cash, bank and bank-charge checks still work through the nested groups;
//   - migration 0053 turns an entity with the old flat groups into the same tree (ledger ids, mappings and entries
//     unchanged), and merges into an "Input tax credits" group that already exists. Both run inside a rolled-back
//     transaction, so the database is left as it was.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-chart.mjs   (DATABASE_URL from the env or ../../.env)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { Client, gstin } from './accounting-test-helpers.mjs';

const dbUrl = process.env.DATABASE_URL ?? fs.readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1];
const psqlFile = (sql) => {
  const file = `/tmp/smoke-chart-${process.pid}.sql`;
  fs.writeFileSync(file, sql);
  try {
    return execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-qtA', '-f', file]).toString().trim();
  } finally {
    fs.rmSync(file, { force: true });
  }
};
const migration = fs
  .readFileSync(new URL('../../../packages/db/drizzle/0053_chart_groups.sql', import.meta.url), 'utf8')
  .replaceAll('--> statement-breakpoint', '');

let checks = 0;
const ok = (label) => (checks++, console.log(`✓ ${label}`));

const c = await new Client().init('Chart');
const groups = await c.req('GET', '/accounts/groups');
const accounts = await c.req('GET', '/accounts/accounts');
const byId = new Map(groups.map((g) => [g.id, g]));
const parentName = (g) => (g.parentId ? byId.get(g.parentId)?.name : null);
const find = (name, root) => groups.find((g) => g.name === name && g.root === root);

// ── A new entity: the standard tree ──
assert.equal(groups.length, 27, 'twenty-seven standard groups');
for (const [name, root, parent] of [
  ['Bank Accounts', 'asset', 'Current Assets'],
  ['Cash-in-Hand', 'asset', 'Current Assets'],
  ['Sundry Debtors', 'asset', 'Current Assets'],
  ['Stock-in-Hand', 'asset', 'Current Assets'],
  ['Input tax credits', 'asset', 'Current Assets'],
  ['Loans & Advances (Asset)', 'asset', 'Current Assets'],
  ['Duties & Taxes', 'liability', 'Current Liabilities'],
  ['Sundry Creditors', 'liability', 'Current Liabilities'],
  ['Secured Loans', 'liability', 'Loans (Liability)'],
  ['Reserves & Surplus', 'equity', 'Capital Account'],
  ['Purchase Accounts', 'expense', null],
  ['Direct Incomes', 'income', null],
]) {
  const g = find(name, root);
  assert.ok(g, `${name} exists`);
  assert.equal(parentName(g), parent, `${name} sits under ${parent ?? 'the root'}`);
}
assert.equal(find('Duties & Taxes', 'asset'), undefined, 'no asset-side Duties & Taxes');
ok('a new entity gets the standard group tree with sub-groups under their primary group');

const groupOf = (role) => byId.get(accounts.find((a) => a.role === role).groupId).name;
assert.equal(groupOf('input_cgst'), 'Input tax credits');
assert.equal(groupOf('pending_igst'), 'Input tax credits');
assert.equal(groupOf('tds_receivable'), 'Loans & Advances (Asset)');
assert.equal(groupOf('purchases'), 'Purchase Accounts');
assert.equal(groupOf('output_cgst'), 'Duties & Taxes');
assert.equal(groupOf('bank'), 'Bank Accounts');
ok('default ledgers sit in their standard groups (input taxes, TDS receivable, service purchases)');

// ── Settings: role classifications and the existing save rules ──
const settings = await c.req('GET', '/accounts/settings');
assert.equal(Object.keys(settings.roleRoots).length, Object.keys(settings.mappings).length, 'a classification for every role');
assert.equal(settings.roleRoots.input_cgst, 'asset');
assert.equal(settings.roleRoots.output_cgst, 'liability');
assert.equal(settings.roleRoots.sales, 'income');
ok('the settings read names the classification each posting role needs');
const shared = { ...settings.mappings, cash: settings.mappings.bank };
assert.match((await c.req('PUT', '/accounts/settings', { mappings: shared }, 400)).message, /distinct account/);
// Sales and cost of goods sold swapped: still one ledger per role, but each of the wrong classification.
const swapped = { ...settings.mappings, sales: settings.mappings.cogs, cogs: settings.mappings.sales };
assert.match((await c.req('PUT', '/accounts/settings', { mappings: swapped }, 400)).message, /Map \w+ to an? \w+ account/);
await c.req('PUT', '/accounts/settings', { mappings: settings.mappings });
ok('saving refuses one ledger for two roles and a ledger of the wrong classification, and accepts the defaults');

// ── Cash and bank checks walk the nested groups ──
await c.activate();
const sub = await c.req('POST', '/accounts/groups', { name: 'Branch banks', root: 'asset', parentId: find('Bank Accounts', 'asset').id }, 201);
const branch = await c.req('POST', '/accounts/accounts', { code: 'BR-BANK', name: 'Branch bank', groupId: sub.id }, 201);
const customer = await c.req('POST', '/parties', { code: 'CH-CUS', name: 'Chart Customer', isCustomer: true, gstin: gstin('27AAACC1234B1Z') }, 201);
const date = c.settings.cutoverDate;
const R = (accountId) => ({ direction: 'receipt', currency: 'INR', exchangeRate: '1', partyId: customer.id, accountId, postingDate: date, amount: '100', allocations: [] });
const receipt = await c.req('POST', '/accounts/settlements', R(branch.id), 201);
await c.req('POST', `/accounts/settlements/${receipt.id}/submit`);
const notCash = await c.req('POST', '/accounts/settlements', R(settings.mappings.sales), 400);
assert.match(notCash.message, /not a cash or bank account|Choose an active cash or bank account/);
ok('a ledger in a sub-group of Bank Accounts takes receipts; a sales ledger is still refused');

// ── Migration 0053 on an entity with the old flat groups ──
// A separate fresh entity, so the receipt above does not pin any group in place.
const E = (await new Client().init('Chart migration')).entityId;
const oldKeys = [
  'Bank Accounts:asset', 'Cash-in-Hand:asset', 'Current Assets:asset', 'Duties & Taxes:asset', 'Fixed Assets:asset',
  'Stock-in-Hand:asset', 'Sundry Debtors:asset', 'Capital Account:equity', 'Direct Expenses:expense',
  'Indirect Expenses:expense', 'Sales Accounts:income', 'Current Liabilities:liability', 'Duties & Taxes:liability',
  'Sundry Creditors:liability',
].map((k) => `'${k.replaceAll("'", "''")}'`).join(',');
// Rebuild the pre-071 layout for this entity: the input-tax group back to its old name, every group top level, the
// moved ledgers back where 0040-era seeding put them, and the groups that did not exist then removed.
const flatten = `
UPDATE account_group SET key = 'Duties & Taxes:asset', name = 'Duties & Taxes' WHERE entity_id = '${E}' AND key = 'Input tax credits:asset';
UPDATE account_group SET parent_id = NULL WHERE entity_id = '${E}';
UPDATE gl_account a SET group_id = g.id FROM account_group g WHERE a.entity_id = '${E}' AND g.entity_id = a.entity_id
  AND g.key = 'Current Assets:asset' AND a.role IN ('pending_cgst','pending_sgst','pending_igst','pending_cess','tds_receivable','tcs_recoverable');
UPDATE gl_account a SET group_id = g.id FROM account_group g WHERE a.entity_id = '${E}' AND g.entity_id = a.entity_id
  AND g.key = 'Direct Expenses:expense' AND a.role = 'purchases';
DELETE FROM account_group g WHERE g.entity_id = '${E}' AND g.key NOT IN (${oldKeys})
  AND NOT EXISTS (SELECT 1 FROM gl_account a WHERE a.group_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM account_group c WHERE c.parent_id = g.id);`;
const snapshot = (label) => `
SELECT '${label}|' || (SELECT md5(string_agg(id::text || code || coalesce(role, ''), ',' ORDER BY id)) FROM gl_account WHERE entity_id = '${E}')
  || '|' || (SELECT md5(mappings::text) FROM accounting_settings WHERE entity_id = '${E}')
  || '|' || (SELECT count(*) FROM gl_entry WHERE entity_id = '${E}')
  || '|' || (SELECT count(*) FROM account_group WHERE entity_id = '${E}');`;
const tree = `
SELECT 'tree|' || string_agg(g.name || '/' || g.root || '/' || coalesce(p.name, '-'), ';' ORDER BY g.root, g.name)
FROM account_group g LEFT JOIN account_group p ON p.id = g.parent_id WHERE g.entity_id = '${E}';
SELECT 'ledgers|' || string_agg(a.role || '>' || g.name, ';' ORDER BY a.role)
FROM gl_account a JOIN account_group g ON g.id = a.group_id WHERE a.entity_id = '${E}' AND a.role IS NOT NULL;`;
const expectedTree = groups
  .map((g) => `${g.name}/${g.root}/${parentName(g) ?? '-'}`)
  .sort((a, b) => {
    const [an, ar] = a.split('/'), [bn, br] = b.split('/');
    return ar === br ? (an < bn ? -1 : an > bn ? 1 : 0) : ar < br ? -1 : 1;
  });
const expectedLedgers = accounts
  .filter((a) => a.role)
  .map((a) => `${a.role}>${byId.get(a.groupId).name}`)
  .sort();
const rows = (out) => Object.fromEntries(out.split('\n').filter(Boolean).map((l) => [l.split('|')[0], l.split('|').slice(1)]));

let out = rows(psqlFile(`BEGIN;\n${flatten}\n${snapshot('flat')}\n${migration}\n${snapshot('after')}\n${tree}\nROLLBACK;`));
assert.equal(out.flat[3], '14', 'the flattened entity has the fourteen old groups');
assert.deepEqual(out.after.slice(0, 3), out.flat.slice(0, 3), 'ledger ids, mappings and entries unchanged');
assert.deepEqual(out.tree[0].split(';').sort(), [...expectedTree].sort(), 'the migrated tree matches a new entity');
assert.deepEqual(out.ledgers[0].split(';').sort(), expectedLedgers, 'every default ledger lands in its standard group');
ok('migration 0053 turns the old flat groups into the standard tree; ledger ids, mappings and entries unchanged');

// Collision: the entity already has an "Input tax credits" asset group alongside the old asset Duties & Taxes.
out = rows(psqlFile(`BEGIN;\n${flatten}
INSERT INTO account_group (tenant_id, entity_id, key, name, root) SELECT tenant_id, entity_id, 'Input tax credits:asset', 'Input tax credits', 'asset' FROM account_group WHERE entity_id = '${E}' LIMIT 1;
${snapshot('flat')}\n${migration}\n${snapshot('after')}\n${tree}
SELECT 'old|' || (SELECT count(*) FROM gl_account a JOIN account_group g ON g.id = a.group_id WHERE g.entity_id = '${E}' AND g.key = 'Duties & Taxes:asset')
  || '|' || (SELECT count(*) FROM account_group WHERE entity_id = '${E}' AND key = 'Duties & Taxes:asset');
ROLLBACK;`));
assert.deepEqual(out.after.slice(0, 3), out.flat.slice(0, 3), 'ledger ids, mappings and entries unchanged');
assert.deepEqual(out.ledgers[0].split(';').sort(), expectedLedgers, 'input ledgers join the existing Input tax credits group');
assert.deepEqual(out.old, ['0', '1'], 'the old group is left in place, empty');
ok('when "Input tax credits" already exists, the migration merges into it and leaves the old group empty');

const after = psqlFile(`SELECT count(*) FROM account_group WHERE entity_id = '${E}' AND key = 'Duties & Taxes:asset';`);
assert.equal(after, '0', 'the rolled-back transactions left the entity untouched');
ok('both migration runs were rolled back');

console.log(`\nchart smoke: ${checks} checks passed`);
