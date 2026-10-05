import assert from 'node:assert/strict';
import { createDb } from '../../../packages/db/dist/index.js';
import { Client, gstin } from './accounting-test-helpers.mjs';
const c = await new Client().init('Trade upgrade');
const customer = await c.req('POST', '/parties', { code: 'CUS', name: 'Opening customer', isCustomer: true, gstTreatment: 'unregistered' }, 201);
const supplier = await c.req('POST', '/parties', { code: 'SUP', name: 'Opening supplier', isSupplier: true, gstTreatment: 'overseas' }, 201);
const date = (await c.req('GET', '/accounts/opening/reconciliation')).cutoverDate;
const reg = await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
const uom = (await c.req('GET', '/uoms')).find(u => u.code === 'NOS');
await c.req('POST', '/hsn-codes', { code: '9983', kind: 'sac', description: 'Services', gstRate: '0', effectiveFrom: '2025-04-01' }, 201);
const item = await c.req('POST', '/items', { code: 'SVC', name: 'Test service', type: 'service', stockUomId: uom.id, hsnCode: '9983' }, 201);
const historical = await c.req('POST', '/purchase-invoices', { supplierId: supplier.id, gstRegistrationId: reg.id, supplierInvoiceNo: 'HISTUSD', supplierInvoiceDate: date, postingDate: date, currency: 'USD', exchangeRate: '80', lines: [{ itemId: item.id, qty: '1', rate: '100', gstRate: '0' }] }, 201);
await c.req('POST', `/purchase-invoices/${historical.id}/submit`, {}, 201);
await c.activate([
  { ...c.line('debtors', '4800'), partyId: customer.id, billReference: 'USD-OPEN' },
  { ...c.line('creditors', '0', '100'), partyId: supplier.id, billReference: 'SUP-OPEN' },
  { ...c.line('creditors', '0', '4800'), partyId: supplier.id, billReference: 'HISTUSD' },
  c.line('equity', '100'),
], [], [
  { partyId: customer.id, reference: 'USD-OPEN', side: 'debit', amount: '4800', currency: 'USD', exchangeRate: '80', originalAmount: '60' },
  { partyId: supplier.id, reference: 'SUP-OPEN', side: 'credit', amount: '100' },
  { partyId: supplier.id, reference: 'HISTUSD', side: 'credit', amount: '4800', invoiceId: historical.id, currency: 'USD', exchangeRate: '80', originalAmount: '100' },
], [{ invoiceId: historical.id, amount: '3200', reason: 'Paid before cutover' }]);
const linked = await c.req('GET', `/accounts/bills?partyId=${supplier.id}&side=payable&currency=USD`);
assert.equal(linked.length, 1);
assert.equal(linked[0].openAmount, '60.000000');
assert.equal(linked[0].carryingInr, '4800.000000');
const bills = await c.req('GET', `/accounts/bills?partyId=${customer.id}&side=receivable&currency=USD`);
assert.equal(bills.length, 1);
assert.equal(bills[0].openAmount, '60.000000');
assert.equal(bills[0].carryingInr, '4800.000000');
const again = await c.req('GET', `/accounts/bills?partyId=${customer.id}&side=receivable&currency=USD`);
assert.equal(again[0].id, bills[0].id);
const journal = await c.req('POST', '/accounts/journals', { postingDate: date, narration: 'Prior journal compatibility', lines: [{ ...c.line('debtors', '20'), partyId: customer.id, billReference: 'USD-OPEN', tradeReference: { mode: 'new', reference: 'USD-OPEN' } }, c.line('equity', '0', '20')] }, 201);
await c.req('POST', `/accounts/journals/${journal.id}/submit`, {}, 200);
const journalBills = await c.req('GET', `/accounts/bills?partyId=${customer.id}&side=receivable&currency=INR`);
assert.equal(journalBills.length, 1);
assert.equal(journalBills[0].openAmount, '20.000000');
assert.notEqual(journalBills[0].id, bills[0].id);
await c.req('POST', `/accounts/journals/${journal.id}/cancel`, { reason: 'Reverse compatibility fixture' }, 200);
const cleared = await c.req('GET', `/accounts/bills?partyId=${customer.id}&side=receivable&currency=INR`);
assert.equal(cleared.length, 0);
const concurrent = await Promise.all([c.req('GET', '/accounts/bills'), c.req('GET', '/accounts/bills')]);
assert.deepEqual(concurrent[0].map(b => b.id).sort(), concurrent[1].map(b => b.id).sort());
const reconciliation = await c.req('GET', '/accounts/trade-reconciliation');
assert.deepEqual(reconciliation.differences, []);
process.loadEnvFile(new URL('../../../.env', import.meta.url));
const db = createDb(process.env.DATABASE_URL);
try {
  const own = await db.$client.query('select id from trade_bill where id=$1 and entity_id=$2', [bills[0].id, c.entityId]);
  assert.equal(own.rowCount, 1, 'DB connection must match this API fixture');
  await assert.rejects(db.$client.query('update trade_bill set reference=reference where id=$1', [bills[0].id]), /append-only/);
  await assert.rejects(db.$client.query('delete from trade_bill_effect where bill_id=$1', [bills[0].id]), /append-only/);
  await db.$client.query(`insert into trade_bill_effect (tenant_id,entity_id,bill_id,source_type,source_id,origin_key,posting_date,amount,carrying_inr) values ($1,$2,$3,'test_corruption',gen_random_uuid(),'mismatch',$4,1,1)`, [c.tenantId,c.entityId,bills[0].id,date]);
  const blocked = await c.req('GET', '/accounts/trade-reconciliation', undefined, 409);
  assert.ok(blocked.differences.length > 0);
} finally { await db.$client.end(); }
console.log('PASS opening foreign residual, repeatable upgrade and trade-control reconciliation', c.checks);
