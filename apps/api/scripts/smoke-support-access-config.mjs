// Support access (decision 050) Task 1: disabled deployment policy, exact origin and strict wire parsing.
// Usage: pnpm --filter @factoryos/api... build && node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-config.mjs
import assert from 'node:assert/strict';
import { loadSupportConfig } from '../dist/modules/support-access/support-access.config.js';
import { parseSupportApproval, parseSupportList, parseSupportPolicy, parseSupportQuery } from '../dist/modules/support-access/support-access.types.js';

let count = 0;
const test = (name, fn) => {
  fn();
  count++;
  console.log(`PASS ${name}`);
};
const uuid = () => crypto.randomUUID();
const itemId = uuid();
const web = 'http://localhost:3000';

test('disabled by default with an 1800-second cap and the canonical web origin', () => {
  assert.deepEqual(loadSupportConfig({}, web), { enabled: false, maxDurationSeconds: 1800, origins: [web] });
  assert.equal(loadSupportConfig({ SUPPORT_ACCESS_ENABLED: 'true' }, web).enabled, true);
});
for (const v of ['1', 'TRUE', 'yes', 'on', ' true'])
  test(`invalid SUPPORT_ACCESS_ENABLED ${JSON.stringify(v)}`, () => assert.throws(() => loadSupportConfig({ SUPPORT_ACCESS_ENABLED: v }, web), /SUPPORT_ACCESS/));
for (const origin of ['http://user:pw@localhost:3000', 'http://localhost:3000/app', 'http://localhost:3000?x=1', 'http://localhost:3000#f', 'ftp://localhost', 'not a url'])
  test(`invalid web origin ${origin}`, () => assert.throws(() => loadSupportConfig({ SUPPORT_ACCESS_ENABLED: 'true' }, origin), /SUPPORT_ACCESS/));
test('a trailing slash origin normalizes to the bare origin', () => assert.deepEqual(loadSupportConfig({}, 'https://factory.example.test/').origins, ['https://factory.example.test']));

const approval = { operatorEmail: 'Ops@Example.com', targetMembershipId: uuid(), entityId: uuid(), areas: ['inventory', 'accounting'], durationSeconds: 1800, reason: 'Ticket 42: stock mismatch', password: 'Sup3r-secret-pw' };
test('approval parses and normalizes the operator email', () => assert.equal(parseSupportApproval(approval).operatorEmail, 'ops@example.com'));
test('approval rejects 299 and 1801 seconds', () => {
  assert.throws(() => parseSupportApproval({ ...approval, durationSeconds: 299 }));
  assert.throws(() => parseSupportApproval({ ...approval, durationSeconds: 1801 }));
  assert.equal(parseSupportApproval({ ...approval, durationSeconds: 300 }).durationSeconds, 300);
});
test('approval rejects unknown fields, empty or duplicate areas, short reasons and missing password', () => {
  assert.throws(() => parseSupportApproval({ ...approval, extra: 1 }));
  assert.throws(() => parseSupportApproval({ ...approval, areas: [] }));
  assert.throws(() => parseSupportApproval({ ...approval, areas: ['inventory', 'inventory'] }));
  assert.throws(() => parseSupportApproval({ ...approval, areas: ['settings'] }));
  assert.throws(() => parseSupportApproval({ ...approval, reason: 'ab' }));
  assert.throws(() => parseSupportApproval({ ...approval, password: undefined }));
  assert.throws(() => parseSupportApproval({ ...approval, targetMembershipId: 'x' }));
});
test('policy requires areas and an integer 300–1800 cap; strict', () => {
  assert.deepEqual(parseSupportPolicy({ enabled: false, maxDurationSeconds: 900, allowedAreas: ['inventory'] }), { enabled: false, maxDurationSeconds: 900, allowedAreas: ['inventory'] });
  assert.throws(() => parseSupportPolicy({ enabled: true, maxDurationSeconds: 1801, allowedAreas: ['inventory'] }));
  assert.throws(() => parseSupportPolicy({ enabled: true, maxDurationSeconds: 900.5, allowedAreas: ['inventory'] }));
  assert.throws(() => parseSupportPolicy({ enabled: true, maxDurationSeconds: 900, allowedAreas: ['inventory'], x: 1 }));
});
test('list query: limit 1–500, default 100, bounded cursor only', () => {
  assert.deepEqual(parseSupportList({}), { limit: 100 });
  assert.equal(parseSupportList({ limit: '20' }).limit, 20);
  assert.throws(() => parseSupportList({ limit: '0' }));
  assert.throws(() => parseSupportList({ limit: '501' }));
  assert.throws(() => parseSupportList({ cursor: 'x'.repeat(513) }));
  assert.throws(() => parseSupportList({ cursor: 'not base64url!' }));
  assert.throws(() => parseSupportList({ status: 'active' }));
});

test('inventory ledger needs an item; arbitrary fields such as sql fail', () => {
  assert.equal(parseSupportQuery('inventory', { panel: 'ledger', itemId }).itemId, itemId);
  assert.throws(() => parseSupportQuery('inventory', { panel: 'ledger' }));
  assert.throws(() => parseSupportQuery('inventory', { panel: 'ledger', itemId, sql: 'select 1' }));
  assert.throws(() => parseSupportQuery('inventory', { panel: 'balance', id: itemId }));
});
test('inventory owner is company, customers or a UUID; dates are ordered', () => {
  for (const owner of ['company', 'customers', uuid()]) assert.equal(parseSupportQuery('inventory', { panel: 'balance', owner }).owner, owner);
  assert.throws(() => parseSupportQuery('inventory', { panel: 'balance', owner: 'everyone' }));
  assert.throws(() => parseSupportQuery('inventory', { panel: 'ledger', itemId, from: '2026-10-10', to: '2026-10-01' }));
  assert.throws(() => parseSupportQuery('inventory', { panel: 'ledger', itemId, from: '2026-13-01' }));
});
test('documents: detail needs an id, list takes the area status enum only', () => {
  const id = uuid();
  assert.equal(parseSupportQuery('sales-invoices', { panel: 'detail', id }).id, id);
  assert.throws(() => parseSupportQuery('sales-invoices', { panel: 'detail' }));
  assert.equal(parseSupportQuery('sales-invoices', { panel: 'list', status: 'submitted' }).status, 'submitted');
  assert.throws(() => parseSupportQuery('sales-invoices', { panel: 'list', status: 'whatever' }));
  assert.equal(parseSupportQuery('work-orders', { panel: 'list', status: 'released' }).status, 'released');
  assert.throws(() => parseSupportQuery('purchase-invoices', { panel: 'list', id }));
});
test('accounting ledger needs an account; panels are fixed', () => {
  const accountId = uuid();
  assert.equal(parseSupportQuery('accounting', { panel: 'ledger', accountId }).accountId, accountId);
  assert.throws(() => parseSupportQuery('accounting', { panel: 'ledger' }));
  assert.throws(() => parseSupportQuery('accounting', { panel: 'export' }));
  assert.equal(parseSupportQuery('accounting', { panel: 'status' }).limit, 100);
});
test('unknown areas, arrays (duplicate params) and paths fail', () => {
  assert.throws(() => parseSupportQuery('settings', { panel: 'list' }));
  assert.throws(() => parseSupportQuery('sales-invoices', { panel: ['list', 'detail'] }));
  assert.throws(() => parseSupportQuery('inventory', { panel: 'balance', itemId: [itemId, itemId] }));
  assert.throws(() => parseSupportQuery('../users', { panel: 'list' }));
});

console.log(`\nSupport access config: ${count} checks passed.`);
