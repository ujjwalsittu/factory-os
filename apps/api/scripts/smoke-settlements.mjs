import assert from 'node:assert/strict';
import { Client } from './accounting-test-helpers.mjs';
const c = await new Client().init('Receipts and payments');
const customer = await c.req('POST', '/parties', { code: 'CUS', name: 'Payment customer', isCustomer: true, gstTreatment: 'unregistered' }, 201);
const supplier = await c.req('POST', '/parties', { code: 'SUP', name: 'Payment supplier', isSupplier: true, gstTreatment: 'unregistered' }, 201);
await c.activate([
  { ...c.line('debtors', '8000'), partyId: customer.id, billReference: 'CUS-USD' },
  { ...c.line('creditors', '0', '8000'), partyId: supplier.id, billReference: 'SUP-USD' },
], [], [
  { partyId: customer.id, reference: 'CUS-USD', side: 'debit', amount: '8000', currency: 'USD', exchangeRate: '80', originalAmount: '100' },
  { partyId: supplier.id, reference: 'SUP-USD', side: 'credit', amount: '8000', currency: 'USD', exchangeRate: '80', originalAmount: '100' },
]);
const date = c.settings.cutoverDate;
const all = await c.req('GET', '/accounts/bills');
const cus = all.find(b => b.partyId === customer.id), sup = all.find(b => b.partyId === supplier.id);
const input = { direction: 'receipt', partyId: customer.id, postingDate: date, currency: 'USD', exchangeRate: '83', accountId: c.account('bank'), amount: '40', bankReference: 'TRANSFER-001', narration: 'Partial customer receipt', allocations: [{ billId: cus.id, amount: '40' }] };
const preview = await c.req('POST', '/accounts/settlements/preview', input);
assert.equal(preview.cashInr, '3320.000000');
assert.equal(preview.carryingInr, '3200.000000');
assert.equal(preview.forexInr, '-120.000000');
const receipt = await c.req('POST', '/accounts/settlements', input, 201);
await c.req('POST', `/accounts/settlements/${receipt.id}/submit`, {});
let remaining = (await c.req('GET', '/accounts/bills')).find(b => b.id === cus.id);
assert.equal(remaining.openAmount, '60.000000');
assert.equal(remaining.carryingInr, '4800.000000');
await c.req('POST', `/accounts/settlements/${receipt.id}/submit`, {}, 409);
await c.req('PUT', `/accounts/settlements/${receipt.id}`, input, 409);
for (const change of [{ amount: '1000000000000000000', allocations: [] }, { amount: '999999999999999999', allocations: [] }, { amount: '1.0000001' }, { postingDate: '2099-01-01' }, { postingDate: '2025-01-01' }, { amount: '0' }, { exchangeRate: '0' }, { accountId: c.account('inventory') }, { partyId: supplier.id }, { currency: 'INR', exchangeRate: '1' }, { allocations: [{ billId: cus.id, amount: '61' }], amount: '61' }, { allocations: [{ billId: cus.id, amount: '1' }, { billId: cus.id, amount: '1' }] }]) {
  await c.req('POST', '/accounts/settlements/preview', { ...input, ...change }, 400);
}
const paymentInput = { ...input, direction: 'payment', partyId: supplier.id, narration: 'Partial supplier payment', allocations: [{ billId: sup.id, amount: '40' }] };
assert.equal((await c.req('POST', '/accounts/settlements/preview', paymentInput)).forexInr, '120.000000');
const payment = await c.req('POST', '/accounts/settlements', paymentInput, 201);
await c.req('POST', `/accounts/settlements/${payment.id}/submit`, {});
assert.deepEqual((await c.req('GET', '/accounts/trade-reconciliation')).differences, []);
const newForex = await c.req('POST', '/accounts/accounts', { code: 'FXNEW', name: 'New FX account', groupId: c.accounts.find(a => a.role === 'forex').groupId }, 201);
await c.req('PUT', '/accounts/settings', { mappings: { ...c.settings.mappings, forex: newForex.id } });
await c.req('POST', `/accounts/settlements/${receipt.id}/cancel`, { reason: 'Reverse receipt exactly' });
await c.req('POST', `/accounts/settlements/${payment.id}/cancel`, { reason: 'Reverse payment exactly' });
assert.equal((await c.req('GET', '/accounts/bills')).find(b => b.id === cus.id).openAmount, '100.000000');
assert.deepEqual((await c.req('GET', '/accounts/trade-reconciliation')).differences, []);
const over = await c.req('POST', '/accounts/settlements', { ...input, amount: '120', allocations: [{ billId: cus.id, amount: '100' }] }, 201);
await c.req('POST', `/accounts/settlements/${over.id}/submit`, {});
const credits = (await c.req('GET', '/accounts/bills')).filter(b => b.partyId === customer.id);
assert.equal(credits.length, 1);
assert.equal(credits[0].openAmount, '-20.000000');
assert.equal(credits[0].carryingInr, '-1660.000000');
assert.deepEqual((await c.req('GET', '/accounts/trade-reconciliation')).differences, []);
const role = await c.req('POST', '/roles', { name: 'Settlement observer', permissions: ['accounts.settlement.read'] }, 201);
const viewer = new Client();
const email = `viewer${Date.now()}@example.com`;
const invite = await c.req('POST', '/invitations', { email, roles: [{ roleId: role.id, entityIds: [c.entityId] }] }, 201);
await viewer.req('POST', '/auth/sign-up/email', { name: 'Settlement observer', email, password: 'Sup3r-secret-pw' });
await viewer.req('POST', '/invitations/accept', { token: invite.inviteUrl.split('/').at(-1) }, 201);
viewer.tenantId = c.tenantId; viewer.entityId = c.entityId;
await viewer.req('GET', '/accounts/settlements');
await viewer.req('GET', '/accounts/bills');
await viewer.req('POST', '/accounts/settlements/preview', input, 403);
await viewer.req('POST', '/accounts/settlements', input, 403);
const other = await c.req('POST', '/entities', { legalName: 'Other settlement entity', shortName: 'Other', code: 'OT' }, 201);
const originalEntity = c.entityId;
c.entityId = other.id;
await c.req('GET', `/accounts/settlements/${receipt.id}`, undefined, 404);
await c.req('POST', '/accounts/settlements/preview', input, 409);
c.entityId = originalEntity;
console.log('PASS receipt/payment FX, partial balance, validation, reversal and overpayment', c.checks);
