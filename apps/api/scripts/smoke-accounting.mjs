import assert from 'node:assert/strict';
const base = `${process.env.API ?? 'http://localhost:4001'}/api`;
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3001';
let cookie = '',
  tenantId,
  entityId,
  checks = 0;
async function req(method, path, body, status = 200) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Cookie: cookie,
      ...(tenantId && { 'x-tenant-id': tenantId }),
      ...(entityId && { 'x-entity-id': entityId }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const cookies = res.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  const data = await res.json();
  assert.equal(
    res.status,
    status,
    `${method} ${path}: ${JSON.stringify(data)}`,
  );
  checks++;
  return data;
}
const email = `gl${Date.now()}@example.com`;
await req('POST', '/auth/sign-up/email', {
  email,
  password: 'Sup3r-secret-pw',
  name: 'GL Accountant',
});
const workspace = await req(
  'POST',
  '/tenants',
  {
    name: 'GL Test',
    entity: {
      legalName: 'GL Private Limited',
      shortName: 'GL',
      code: 'GL',
      pan: 'AAACA1234B',
    },
  },
  201,
);
tenantId = workspace.tenant.id;
entityId = workspace.entity.id;
const settings = await req('GET', '/accounts/settings');
assert.equal(settings.active, false);
const accounts = await req('GET', '/accounts/accounts');
const account = (role) => {
  const a = accounts.find((a) => a.role === role);
  assert.ok(a, role);
  return a.id;
};
const lines = [
  { accountId: account('cash'), debit: '100.000001', credit: '0' },
  { accountId: account('equity'), debit: '0', credit: '100.000001' },
];
await req(
  'POST',
  '/accounts/journals',
  { postingDate: '2026-10-05', narration: 'Opening test journal', lines },
  409,
);
const opening = await req('PUT', '/accounts/opening', {
  lines,
  bills: [],
  settlements: [],
  receiptBaselines: [],
});
const preview = await req('GET', '/accounts/opening/reconciliation');
await req(
  'POST',
  '/accounts/opening/activate',
  { worksheetId: opening.id, reviewedToken: '0'.repeat(64) },
  409,
);
await req('POST', '/accounts/opening/activate', {
  worksheetId: opening.id,
  reviewedToken: preview.snapshotToken,
});
await req(
  'POST',
  '/accounts/opening/activate',
  { worksheetId: opening.id, reviewedToken: preview.snapshotToken },
  409,
);
const active = await req('GET', '/accounts/settings');
assert.equal(active.active, true);
const totals = await req('POST', '/accounts/journals/preview', {
  lines: [lines[0], { ...lines[1], credit: '100' }],
});
assert.equal(totals.difference, '0.000001');
const journal = await req(
  'POST',
  '/accounts/journals',
  { postingDate: active.cutoverDate, narration: 'Cash investment', lines },
  201,
);
await req('POST', `/accounts/journals/${journal.id}/submit`);
await req('POST', `/accounts/journals/${journal.id}/submit`, {}, 409);
const detail = await req('GET', `/accounts/journals/${journal.id}`);
assert.equal(detail.status, 'submitted');
assert.equal(detail.entries.length, 2);
await req(
  'POST',
  '/accounts/journals',
  {
    postingDate: active.cutoverDate,
    narration: 'Invalid unbalanced journal',
    lines: [lines[0], { ...lines[1], credit: '100' }],
  },
  400,
);
await req(
  'POST',
  '/accounts/journals',
  {
    postingDate: active.cutoverDate,
    narration: 'Forbidden inventory adjustment',
    lines: [{ ...lines[0], accountId: account('inventory') }, lines[1]],
  },
  400,
);
if (process.env.FOUNDATION_ONLY) {
  await req('POST', `/accounts/journals/${journal.id}/cancel`, {
    reason: 'Reverse the test investment',
  });
  const reverse = await req('GET', `/accounts/journals/${journal.id}`);
  assert.equal(reverse.reversal.entries.length, 2);
  console.log(`Accounting foundation checks passed (${checks}).`);
  process.exit(0);
}
const groups = await req('GET', '/accounts/groups');
const cashGroup = groups.find((g) => g.name === 'Cash-in-Hand');
await req('PUT', `/accounts/groups/${cashGroup.id}`, {
  name: 'Cash Group Customized',
});
await req(
  'PUT',
  `/accounts/groups/${cashGroup.id}`,
  { parentId: cashGroup.id },
  400,
);
const replacement = await req(
  'POST',
  '/accounts/accounts',
  {
    code: 'NEW-INVENTORY',
    name: 'New inventory control',
    groupId: groups.find((g) => g.name === 'Stock-in-Hand').id,
  },
  201,
);
await req('PUT', '/accounts/settings', {
  mappings: { ...active.mappings, inventory: replacement.id },
});
await req(
  'POST',
  '/accounts/journals',
  {
    postingDate: active.cutoverDate,
    narration: 'Historic inventory remains protected',
    lines: [{ ...lines[0], accountId: account('inventory') }, lines[1]],
  },
  400,
);
const tb = await req('GET', '/accounts/reports/trial-balance');
assert.equal(tb.debit, tb.credit);
assert.equal(tb.debit, '200.000002');
await req('POST', `/accounts/journals/${journal.id}/cancel`, {
  reason: 'Reverse the test investment',
});
await req(
  'POST',
  `/accounts/journals/${journal.id}/cancel`,
  { reason: 'Repeated cancellation' },
  409,
);
const reversed = await req('GET', `/accounts/journals/${journal.id}`);
assert.equal(reversed.status, 'cancelled');
assert.equal(reversed.reversal.entries.length, 2);
const after = await req('GET', '/accounts/reports/trial-balance');
assert.equal(
  after.accounts.find((a) => a.id === account('cash')).balance,
  '100.000001',
);
const ledger = await req(
  'GET',
  `/accounts/reports/ledger?accountId=${account('cash')}`,
);
assert.equal(ledger.entries.length, 3);
assert.equal(ledger.closing, '100.000001');
await req(
  'GET',
  '/accounts/reports/ledger?accountId=00000000-0000-4000-8000-000000000000',
  undefined,
  404,
);
console.log(`Accounting foundation checks passed (${checks}).`);
